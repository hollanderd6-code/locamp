const { supabase } = require('./supabase');
const { sendEmail } = require('./email');

function joursRetard(dateEmission, delai) {
  const ech = new Date(dateEmission);
  ech.setDate(ech.getDate() + delai);
  return Math.floor((Date.now() - ech.getTime()) / 86400000);
}

// Liste les factures impayées d'un camping avec reste dû, retard et balance âgée.
async function listImpayes(campingId) {
  const { data: camp } = await supabase.from('campings').select('parametres').eq('id', campingId).maybeSingle();
  const delai = Number(camp?.parametres?.facturation?.delai_paiement ?? 30);
  const { data: factures } = await supabase.from('factures')
    .select('id,numero,resident_id,total_ttc,montant_regle,date_emission,statut')
    .eq('camping_id', campingId).in('statut', ['emise', 'partielle', 'en_retard']);

  const impayes = [];
  const aging = { a_echoir: 0, j0_30: 0, j31_60: 0, j61_90: 0, j90_plus: 0 };
  for (const f of (factures || [])) {
    const reste = Math.round((Number(f.total_ttc) - Number(f.montant_regle)) * 100) / 100;
    if (reste <= 0) continue;
    const jr = joursRetard(f.date_emission, delai);
    impayes.push({ id: f.id, numero: f.numero, resident_id: f.resident_id, reste, jours_retard: jr, en_retard: jr > 0 });
    if (jr <= 0) aging.a_echoir += reste;
    else if (jr <= 30) aging.j0_30 += reste;
    else if (jr <= 60) aging.j31_60 += reste;
    else if (jr <= 90) aging.j61_90 += reste;
    else aging.j90_plus += reste;
  }
  for (const k in aging) aging[k] = Math.round(aging[k] * 100) / 100;
  return { delai, impayes, aging, total_du: Math.round(impayes.reduce((s, f) => s + f.reste, 0) * 100) / 100 };
}

// Envoie les relances pour les factures en retard.
// cooldownJours : ne pas relancer une facture déjà relancée il y a moins de N jours.
async function runRelances(campingId, { cooldownJours = 1 } = {}) {
  const { impayes } = await listImpayes(campingId);
  const res = { impayes: impayes.length, envoyees: 0, ignorees: 0, erreurs: 0 };
  for (const f of impayes) {
    if (f.jours_retard <= 0) { res.ignorees++; continue; }
    const { data: prev } = await supabase.from('relances').select('created_at')
      .eq('camping_id', campingId).eq('facture_id', f.id)
      .order('created_at', { ascending: false });
    const niveau = (prev?.length || 0) + 1;
    if (prev?.[0] && (Date.now() - new Date(prev[0].created_at).getTime()) < cooldownJours * 86400000) {
      res.ignorees++; continue;
    }
    const { data: r } = await supabase.from('residents').select('nom,prenom,email').eq('id', f.resident_id).maybeSingle();
    const subject = `Rappel de paiement — facture ${f.numero}`;
    const html = `<p>Bonjour ${r?.prenom || ''} ${r?.nom || ''},</p>`
      + `<p>Sauf erreur de notre part, la facture <b>${f.numero}</b> reste due pour un montant de <b>${f.reste.toFixed(2)} €</b> `
      + `(échéance dépassée de ${f.jours_retard} jours).</p><p>Merci de bien vouloir régulariser dans les meilleurs délais.</p>`;
    let statut = 'envoyee';
    try {
      if (r?.email) { const out = await sendEmail({ to: r.email, subject, html }); if (out.skipped) statut = 'en_attente'; }
      else statut = 'en_attente';
    } catch (e) { console.error('[relance email]', e.message); statut = 'echec'; res.erreurs++; }
    await supabase.from('relances').insert({
      camping_id: campingId, facture_id: f.id, resident_id: f.resident_id, niveau, canal: 'email',
      statut, message: subject, sent_at: statut === 'envoyee' ? new Date().toISOString() : null,
    });
    if (f.statut !== 'en_retard') await supabase.from('factures').update({ statut: 'en_retard' }).eq('id', f.id);
    if (statut === 'envoyee') res.envoyees++;
  }
  return res;
}

module.exports = { listImpayes, runRelances };

const { supabase } = require('./supabase');
const { sendEmail } = require('./email');
const { creerNotifsStaff } = require('./notifications');

function joursRetard(dateEmission, delai) {
  const ech = new Date(dateEmission);
  ech.setDate(ech.getDate() + delai);
  return Math.floor((Date.now() - ech.getTime()) / 86400000);
}

// Liste les factures impayées d'un camping avec reste dû, retard et balance âgée.
async function listImpayes(campingId, range) {
  const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
  const { data: camp } = await supabase.from('campings').select('parametres').eq('id', campingId).maybeSingle();
  const delai = Number(camp?.parametres?.facturation?.delai_paiement ?? 30);
  let factQ = supabase.from('factures')
    .select('id,numero,resident_id,total_ttc,montant_regle,date_emission,statut')
    .eq('camping_id', campingId).in('statut', ['emise', 'partielle', 'en_retard']);
  if (range && range.debut && range.fin) factQ = factQ.gte('date_emission', range.debut).lte('date_emission', range.fin);
  const [{ data: factures }, { data: regs }] = await Promise.all([
    factQ,
    supabase.from('reglements').select('resident_id,montant,affectations').eq('camping_id', campingId),
  ]);

  // Crédit encaissé mais NON affecté, par résident : il éteint virtuellement les impayés
  // (un client avec une avance n'est pas « impayé »), exactement comme le ferait le lettrage.
  const credit = {};
  (regs || []).forEach((g) => {
    if (!g.resident_id) return;
    const aff = (g.affectations || []).reduce((x, a) => x + Number((a && a.montant) || 0), 0);
    credit[g.resident_id] = r2((credit[g.resident_id] || 0) + Math.max(0, Number(g.montant || 0) - aff));
  });

  const impayes = [];
  const aging = { a_echoir: 0, j0_30: 0, j31_60: 0, j61_90: 0, j90_plus: 0 };
  // Plus anciennes d'abord : le crédit absorbe les factures dans le bon ordre.
  const facts = (factures || []).slice().sort((a, b) => String(a.date_emission).localeCompare(String(b.date_emission)));
  for (const f of facts) {
    let reste = r2(Number(f.total_ttc) - Number(f.montant_regle));
    if (reste <= 0) continue;
    const cr = credit[f.resident_id] || 0;
    if (cr > 0) {
      const absorbe = Math.min(cr, reste);
      reste = r2(reste - absorbe);
      credit[f.resident_id] = r2(cr - absorbe);
    }
    if (reste <= 0) continue;
    const jr = joursRetard(f.date_emission, delai);
    impayes.push({ id: f.id, numero: f.numero, resident_id: f.resident_id, reste, jours_retard: jr, en_retard: jr > 0 });
    if (jr <= 0) aging.a_echoir += reste;
    else if (jr <= 30) aging.j0_30 += reste;
    else if (jr <= 60) aging.j31_60 += reste;
    else if (jr <= 90) aging.j61_90 += reste;
    else aging.j90_plus += reste;
  }
  for (const k in aging) aging[k] = r2(aging[k]);
  return { delai, impayes, aging, total_du: r2(impayes.reduce((s, f) => s + f.reste, 0)) };
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

    // Notification staff « rappel » actionnable : pointe vers la facture pour encaisser directement.
    const nomResident = `${r?.prenom || ''} ${r?.nom || ''}`.trim() || 'un résident';
    await creerNotifsStaff(campingId, {
      type: 'relance', perm: 'encaisser',
      titre: `Rappel de paiement — facture ${f.numero}`,
      corps: `${f.reste.toFixed(2)} € dus par ${nomResident} (retard de ${f.jours_retard} j). À encaisser.`,
      entite: 'facture', entite_id: f.id,
      donnees: { numero: f.numero, reste: f.reste, jours_retard: f.jours_retard, resident_id: f.resident_id, niveau },
    });

    if (statut === 'envoyee') res.envoyees++;
  }
  return res;
}

module.exports = { listImpayes, runRelances };

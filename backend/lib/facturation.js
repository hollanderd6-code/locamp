const { supabase } = require('./supabase');
const { buildFacturePdf } = require('./pdf');
const { uploadDocument, downloadDocument } = require('./storage');
const { sendEmail } = require('./email');

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }        // m : 1-12
function currentPeriode() { return new Date().toISOString().slice(0, 7); } // 'YYYY-MM'
function periodeLabel(p) { const [y, m] = p.split('-').map(Number); return `${MOIS[m - 1]} ${y}`; }

// Calcule montant_ht par ligne + totaux HT/TVA/TTC (arrondi 2 décimales).
// Conserve les champs de période (date_debut/date_fin) et déduit les nuits.
function computeTotals(lignes) {
  let ht = 0, tva = 0;
  const out = (lignes || []).map((l) => {
    const q = Number(l.quantite || 1);
    const pu = Number(l.pu_ht || 0);
    const taux = Number(l.taux_tva || 0);
    const mHt = Math.round(q * pu * 100) / 100;
    ht += mHt;
    tva += Math.round(mHt * taux) / 100;
    let nuits = l.nuits != null && l.nuits !== '' ? Number(l.nuits) : null;
    if (nuits == null && l.date_debut && l.date_fin) {
      const d = Math.round((new Date(l.date_fin) - new Date(l.date_debut)) / 86400000);
      nuits = d > 0 ? d : null;
    }
    return {
      designation: l.designation, quantite: q, pu_ht: pu, taux_tva: taux, montant_ht: mHt,
      date_debut: l.date_debut || null, date_fin: l.date_fin || null, nuits,
    };
  });
  ht = Math.round(ht * 100) / 100;
  tva = Math.round(tva * 100) / 100;
  return { lignes: out, total_ht: ht, total_tva: tva, total_ttc: Math.round((ht + tva) * 100) / 100 };
}

// Construit les lignes d'un contrat pour une période (prorata entrée/sortie + taxe de séjour).
function buildLignes(contrat, resident, periode, parametres) {
  const [y, m] = periode.split('-').map(Number);
  const dim = daysInMonth(y, m);
  const start = `${periode}-01`;
  const end = `${periode}-${String(dim).padStart(2, '0')}`;

  let first = 1, last = dim;
  if (contrat.date_debut && contrat.date_debut > start && contrat.date_debut <= end) first = Number(contrat.date_debut.slice(8, 10));
  if (contrat.date_fin && contrat.date_fin >= start && contrat.date_fin < end) last = Number(contrat.date_fin.slice(8, 10));
  const activeDays = last - first + 1;
  const factor = (activeDays > 0 && activeDays < dim) ? activeDays / dim : 1;

  const lignes = [];
  const dDebut = `${periode}-${String(first).padStart(2, '0')}`;
  const dFin = `${periode}-${String(last).padStart(2, '0')}`;
  const loyer = Number(contrat.montant_mensuel || 0);
  const tvaLoyer = Number(parametres?.facturation?.tva_taux_loyer || 0);
  if (loyer > 0) {
    const montant = Math.round(loyer * factor * 100) / 100;
    lignes.push({
      designation: factor < 1
        ? `Loyer emplacement — ${periodeLabel(periode)} (prorata ${activeDays}/${dim} j)`
        : `Loyer emplacement — ${periodeLabel(periode)}`,
      date_debut: dDebut, date_fin: dFin, nuits: activeDays,
      quantite: 1, pu_ht: montant, taux_tva: tvaLoyer,
    });
  }

  const ts = parametres?.taxe_sejour;
  if (ts && ts.actif && Number(ts.tarif_nuit_personne) > 0) {
    const occ = resident?.foyer?.occupants ?? resident?.foyer?.personnes ?? 1;
    const personnes = Number(occ) || 1;
    const nuits = activeDays;
    const montant = Math.round(Number(ts.tarif_nuit_personne) * personnes * nuits * 100) / 100;
    if (montant > 0) {
      lignes.push({
        designation: `Taxe de séjour (${personnes} pers. × ${nuits} nuits)`,
        date_debut: dDebut, date_fin: dFin, nuits,
        quantite: 1, pu_ht: montant, taux_tva: 0,
      });
    }
  }
  return lignes;
}

// Numéro de facture atomique et continu : F-AAAA-NNNNN
async function nextNumeroFacture(campingId) {
  const year = new Date().getFullYear();
  const { data, error } = await supabase.rpc('next_compteur', { p_camping: campingId, p_cle: `facture:${year}` });
  if (error) throw error;
  const seq = Array.isArray(data) ? data[0] : data;
  return `F-${year}-${String(seq).padStart(5, '0')}`;
}

// Génère le PDF d'une facture, l'archive, met à jour pdf_path.
async function genererPdfFacture(campingId, facture) {
  const [camping, resident] = await Promise.all([
    supabase.from('campings').select('nom,raison_sociale,adresse,email,telephone,siret,tva,parametres,logo_path').eq('id', campingId).maybeSingle(),
    facture.resident_id
      ? supabase.from('residents').select('civilite,nom,prenom,adresse,email').eq('id', facture.resident_id).maybeSingle()
      : Promise.resolve({ data: {} }),
  ]);
  const campData = camping.data || {};
  if (campData.logo_path) {
    try { campData.logo = await downloadDocument(campData.logo_path); }
    catch (e) { console.error('[pdf logo]', e.message); }
  }
  const pdf = await buildFacturePdf({ camping: campData, resident: resident.data || {}, facture });
  const path = `factures/${campingId}/${facture.id}.pdf`;
  await uploadDocument(path, pdf, 'application/pdf');
  await supabase.from('factures').update({ pdf_path: path }).eq('id', facture.id);
  return path;
}

// Envoie une facture par e-mail au résident (PDF en pièce jointe).
// Idempotent : ne renvoie pas si déjà envoyée, sauf force:true.
async function envoyerFactureEmail(campingId, factureId, { force = false } = {}) {
  const { data: facture } = await supabase.from('factures').select('*')
    .eq('camping_id', campingId).eq('id', factureId).maybeSingle();
  if (!facture) return { error: 'introuvable' };
  if (['avoir', 'annulee'].includes(facture.statut)) return { skipped: 'statut' };
  if (!force && facture.email_envoye_at) return { skipped: 'deja_envoye' };

  const [campR, resR] = await Promise.all([
    supabase.from('campings').select('nom,raison_sociale,email,parametres').eq('id', campingId).maybeSingle(),
    facture.resident_id
      ? supabase.from('residents').select('civilite,nom,prenom,email').eq('id', facture.resident_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const camping = campR.data || {};
  const resident = resR.data;
  if (!resident?.email) return { skipped: 'sans_email' };

  const path = facture.pdf_path || await genererPdfFacture(campingId, facture);
  const buffer = await downloadDocument(path);

  const nomCamping = camping.nom || camping.raison_sociale || 'Votre camping';
  const fparams = (camping.parametres && camping.parametres.facturation) || {};
  const sender = fparams.email ? { email: fparams.email, name: nomCamping } : { name: nomCamping };
  const periode = facture.periode ? periodeLabel(facture.periode) : null;

  const subject = `Votre facture ${facture.numero}${periode ? ' — ' + periode : ''}`;
  const html = `<p>Bonjour ${resident.prenom || ''} ${resident.nom || ''},</p>`
    + `<p>Veuillez trouver ci-joint votre facture <b>${facture.numero}</b>${periode ? ` (${periode})` : ''} `
    + `d'un montant de <b>${Number(facture.total_ttc).toFixed(2)} €</b>.</p>`
    + (fparams.message_email ? `<p>${fparams.message_email}</p>` : '')
    + `<p>Cordialement,<br>${nomCamping}</p>`;

  const out = await sendEmail({
    to: resident.email, subject, html, sender,
    attachments: [{ name: `${facture.numero}.pdf`, content: buffer }],
  });
  if (out.skipped) return { skipped: 'email_non_configure' };

  await supabase.from('factures').update({ email_envoye_at: new Date().toISOString() }).eq('id', factureId);
  return { sent: true, to: resident.email };
}

// Crée une facture à partir de lignes déjà prêtes. Renvoie la facture (avec PDF).
async function creerFacture({ campingId, resident_id, contrat_id, periode, lignes, statut = 'emise', avoir_de = null }) {
  const t = computeTotals(lignes);
  const numero = await nextNumeroFacture(campingId);
  const { data: facture, error } = await supabase.from('factures').insert({
    camping_id: campingId, resident_id: resident_id || null, contrat_id: contrat_id || null,
    numero, periode: periode || null, date_emission: new Date().toISOString().slice(0, 10),
    lignes: t.lignes, total_ht: t.total_ht, total_tva: t.total_tva, total_ttc: t.total_ttc,
    statut, avoir_de,
  }).select().single();
  if (error) throw error;
  await genererPdfFacture(campingId, facture).catch((e) => console.error('[pdf facture]', e.message));

  // Envoi automatique au résident (si activé) — best-effort, ne bloque ni ne casse la création.
  if (facture.statut === 'emise') {
    Promise.resolve().then(async () => {
      const { data: camp } = await supabase.from('campings').select('parametres').eq('id', campingId).maybeSingle();
      if (camp?.parametres?.facturation?.email_auto === false) return;   // activé par défaut
      const out = await envoyerFactureEmail(campingId, facture.id, {});
      if (out.error || (out.skipped && out.skipped !== 'deja_envoye')) console.log('[facture email]', facture.numero, out);
    }).catch((e) => console.error('[facture email]', e.message));
  }

  return facture;
}

// Facturation mensuelle d'un camping pour une période.
async function runFacturationMensuelle(campingId, periode) {
  periode = periode || currentPeriode();
  const [y, m] = periode.split('-').map(Number);
  const dim = daysInMonth(y, m);
  const start = `${periode}-01`;
  const end = `${periode}-${String(dim).padStart(2, '0')}`;

  const { data: camp } = await supabase.from('campings').select('parametres').eq('id', campingId).maybeSingle();
  const parametres = camp?.parametres || {};

  const { data: contrats, error } = await supabase.from('contrats').select('*')
    .eq('camping_id', campingId).in('statut', ['signe', 'actif']).not('resident_id', 'is', null);
  if (error) throw error;

  const res = { periode, crees: 0, ignores: 0, erreurs: 0, factures: [] };
  for (const c of (contrats || [])) {
    if (c.date_debut && c.date_debut > end) { res.ignores++; continue; }
    if (c.date_fin && c.date_fin < start) { res.ignores++; continue; }

    const { data: existing } = await supabase.from('factures').select('id')
      .eq('camping_id', campingId).eq('contrat_id', c.id).eq('periode', periode)
      .neq('statut', 'avoir').maybeSingle();
    if (existing) { res.ignores++; continue; }

    const { data: resident } = await supabase.from('residents')
      .select('foyer').eq('id', c.resident_id).maybeSingle();

    const lignes = buildLignes(c, resident || {}, periode, parametres);
    if (!lignes.length) { res.ignores++; continue; }

    try {
      const f = await creerFacture({ campingId, resident_id: c.resident_id, contrat_id: c.id, periode, lignes });
      res.crees++;
      res.factures.push({ id: f.id, numero: f.numero, total_ttc: f.total_ttc, resident_id: c.resident_id });
    } catch (e) {
      console.error('[facturation]', c.id, e.message);
      res.erreurs++;
    }
  }
  return res;
}

module.exports = { runFacturationMensuelle, creerFacture, buildLignes, computeTotals, genererPdfFacture, envoyerFactureEmail, currentPeriode };

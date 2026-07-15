const { supabase } = require('./supabase');
const { buildFacturePdf } = require('./pdf');
const { uploadDocument, downloadDocument, BUCKET } = require('./storage');
const { sendEmail } = require('./email');
const { inscrireFacture } = require('./fiscal');

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }        // m : 1-12
function currentPeriode() { return new Date().toISOString().slice(0, 7); } // 'YYYY-MM'
function periodeLabel(p) { const [y, m] = p.split('-').map(Number); return `${MOIS[m - 1]} ${y}`; }

// Calcule montant_ht par ligne + totaux HT/TVA/TTC (arrondi 2 décimales).
// Conserve les champs de période (date_debut/date_fin) et déduit les nuits.
// HT dérivé d'un prix TTC : HT = TTC / (1 + taux/100)
function htDepuisTtc(ttc, taux) {
  const t = Number(taux || 0);
  return Math.round((Number(ttc || 0) / (1 + t / 100)) * 100) / 100;
}

function computeTotals(lignes) {
  let ht = 0, tva = 0;
  const out = (lignes || []).map((l) => {
    const q = Number(l.quantite || 1);
    const taux = Number(l.taux_tva || 0);
    // saisie TTC prioritaire : on en déduit le PU HT (stocké et utilisé partout ensuite)
    const pu = (l.pu_ttc !== undefined && l.pu_ttc !== null && l.pu_ttc !== '')
      ? htDepuisTtc(l.pu_ttc, taux)
      : Number(l.pu_ht || 0);
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
      quantite: 1, pu_ttc: montant, taux_tva: tvaLoyer,   // loyer saisi TTC -> HT dérivé
    });
  }

  // --- Lignes récurrentes du contrat ("montant type" du résident) ---
  // Saisies une fois sur le contrat, reprises à chaque facturation mensuelle.
  // prorata:true -> ajustées au nombre de jours de présence, comme le loyer.
  for (const r of (contrat.lignes_recurrentes || [])) {
    const pu = Number(r.pu_ttc || 0);
    if (!r.designation || pu === 0) continue;
    const auProrata = r.prorata === true && factor < 1;
    const montant = auProrata ? Math.round(pu * factor * 100) / 100 : Math.round(pu * 100) / 100;
    if (montant === 0) continue;
    lignes.push({
      designation: auProrata
        ? `${r.designation} — ${periodeLabel(periode)} (prorata ${activeDays}/${dim} j)`
        : `${r.designation} — ${periodeLabel(periode)}`,
      date_debut: dDebut, date_fin: dFin, nuits: activeDays,
      quantite: Number(r.quantite || 1),
      pu_ttc: montant,
      taux_tva: Number(r.taux_tva || 0),
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
// Génère un PDF proforma (aucune écriture en base facture) et renvoie son chemin de stockage.
async function genererProformaPdf(campingId, residentId, lignes) {
  const t = computeTotals(lignes);
  const [camping, resident] = await Promise.all([
    supabase.from('campings').select('nom,raison_sociale,adresse,email,telephone,siret,tva,parametres,logo_path').eq('id', campingId).maybeSingle(),
    supabase.from('residents').select('civilite,nom,prenom,adresse,email').eq('id', residentId).maybeSingle(),
  ]);
  const campData = camping.data || {};
  if (campData.logo_path) {
    try { campData.logo = await downloadDocument(campData.logo_path); }
    catch (e) { console.error('[pdf logo]', e.message); }
  }
  const facture = {
    proforma: true, numero: null, date_emission: new Date().toISOString().slice(0, 10),
    lignes: t.lignes, total_ht: t.total_ht, total_tva: t.total_tva, total_ttc: t.total_ttc, statut: 'emise',
  };
  const pdf = await buildFacturePdf({ camping: campData, resident: resident.data || {}, facture });
  const path = `proformas/${campingId}/${residentId}.pdf`;
  const { error: upErr } = await supabase.storage.from(BUCKET)
    .upload(path, pdf, { contentType: 'application/pdf', upsert: true });
  if (upErr) throw upErr;
  return path;
}

// Libellés par défaut des modes de règlement (surchargés par moyens_paiement si défini).
const LIB_MODE = { espece: 'Espèces', cheque: 'Chèque', virement: 'Virement', tpe: 'Carte bancaire', stripe: 'Paiement en ligne', ancv: 'ANCV' };

// Récupère le détail de paiement d'une facture (pour la mention d'acquit sur le PDF).
// Renvoie { regle, reste, acquittee, lignes:[{date,label,montant}] } ou null.
async function construirePaiement(campingId, facture) {
  try {
    if (!facture || !facture.id || facture.proforma) return null;
    if (['avoir', 'annulee'].includes(facture.statut)) return null;
    const ttc = Number(facture.total_ttc || 0);
    if (ttc <= 0) return null;
    const { data: regs } = await supabase.from('reglements')
      .select('mode,montant,date_reglement,affectations')
      .eq('camping_id', campingId)
      .contains('affectations', [{ facture_id: facture.id }]);
    if (!regs || !regs.length) return null;
    const { data: moyens } = await supabase.from('moyens_paiement').select('code,libelle').eq('camping_id', campingId);
    const lib = { ...LIB_MODE };
    (moyens || []).forEach((m) => { if (m.libelle) lib[m.code] = m.libelle; });
    let regle = 0; const lignes = [];
    for (const r of regs) {
      const aff = (r.affectations || []).find((a) => a.facture_id === facture.id);
      const m = Math.round(Number((aff && aff.montant) || 0) * 100) / 100;
      if (m <= 0) continue;
      regle += m;
      lignes.push({ date: r.date_reglement, label: lib[r.mode] || r.mode, montant: m });
    }
    regle = Math.round(regle * 100) / 100;
    lignes.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const reste = Math.round((ttc - regle) * 100) / 100;
    return { regle, reste, acquittee: reste <= 0.004 && regle > 0, lignes };
  } catch (e) { console.error('[paiement pdf]', e.message); return null; }
}

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
  const paiement = await construirePaiement(campingId, facture);
  const pdf = await buildFacturePdf({ camping: campData, resident: resident.data || {}, facture: { ...facture, paiement } });
  const path = `factures/${campingId}/${facture.id}.pdf`;
  const { error: upErr } = await supabase.storage.from(BUCKET)
    .upload(path, pdf, { contentType: 'application/pdf', upsert: true });
  if (upErr) throw upErr;
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
async function creerFacture({ campingId, resident_id, contrat_id, periode, lignes, statut = 'emise', avoir_de = null, req = null }) {
  const t = computeTotals(lignes);
  const numero = await nextNumeroFacture(campingId);
  const { data: facture, error } = await supabase.from('factures').insert({
    camping_id: campingId, resident_id: resident_id || null, contrat_id: contrat_id || null,
    numero, periode: periode || null, date_emission: new Date().toISOString().slice(0, 10),
    lignes: t.lignes, total_ht: t.total_ht, total_tva: t.total_tva, total_ttc: t.total_ttc,
    statut, avoir_de,
  }).select().single();
  if (error) throw error;

  // Inaltérabilité (art. 286-I-3° bis du CGI) : la facture entre dans la chaîne fiscale.
  await inscrireFacture(campingId, facture, req);

  // Auto-lettrage : consomme le crédit d'avance du résident sur ses factures impayées
  // (dont celle-ci). Sans effet sur la chaîne fiscale. Avant le PDF pour qu'il reflète l'acquit.
  if (facture.statut === 'emise' && !avoir_de && resident_id) {
    try { await require('./lettrage').appliquerCredit(campingId, resident_id); }
    catch (e) { console.error('[auto-lettrage]', e.message); }
  }

  await genererPdfFacture(campingId, facture).catch((e) => console.error('[pdf facture]', e.message));

  // Notification in-app portail : nouvelle facture (pas les avoirs) — best-effort.
  if (facture.statut === 'emise' && !avoir_de && resident_id) {
    Promise.resolve().then(async () => {
      const { creerNotifResident } = require('./notifications');
      const reste = Math.round((Number(facture.total_ttc) || 0) * 100) / 100;
      await creerNotifResident(campingId, resident_id, {
        type: 'nouvelle_facture',
        titre: `Nouvelle facture ${facture.numero}`,
        corps: `Montant : ${reste.toFixed(2)} €. Consultable dans votre espace locataire.`,
        entite: 'facture', entite_id: facture.id,
        donnees: { numero: facture.numero, total_ttc: facture.total_ttc },
      });
    }).catch((e) => console.error('[facture notif]', e.message));
  }

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

// Facturation mensuelle d'UN résident (bouton « Générer la facture du mois »).
// Même logique que le batch : loyer + lignes récurrentes + taxe de séjour, anti-doublon.
async function runFacturationResident(campingId, residentId, periode) {
  periode = periode || currentPeriode();
  const [y, m] = periode.split('-').map(Number);
  const dim = daysInMonth(y, m);
  const start = `${periode}-01`;
  const end = `${periode}-${String(dim).padStart(2, '0')}`;

  const { data: camp } = await supabase.from('campings').select('parametres').eq('id', campingId).maybeSingle();
  const parametres = camp?.parametres || {};

  const { data: contrats } = await supabase.from('contrats').select('*')
    .eq('camping_id', campingId).eq('resident_id', residentId)
    .in('statut', ['signe', 'actif']).order('created_at', { ascending: false });
  const c = (contrats || []).find((x) =>
    !(x.date_debut && x.date_debut > end) && !(x.date_fin && x.date_fin < start));
  if (!c) return { error: 'Aucun contrat actif pour ce résident sur cette période', code: 400 };

  const { data: existing } = await supabase.from('factures').select('id,numero')
    .eq('camping_id', campingId).eq('contrat_id', c.id).eq('periode', periode)
    .neq('statut', 'avoir').maybeSingle();
  if (existing) return { error: `Facture déjà émise pour cette période (${existing.numero})`, code: 409 };

  const { data: resident } = await supabase.from('residents')
    .select('foyer').eq('id', residentId).maybeSingle();

  const lignes = buildLignes(c, resident || {}, periode, parametres);
  if (!lignes.length) return { error: 'Rien à facturer pour cette période (ni loyer, ni ligne récurrente)', code: 400 };

  const facture = await creerFacture({ campingId, resident_id: residentId, contrat_id: c.id, periode, lignes });
  return { facture };
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

module.exports = { runFacturationMensuelle, runFacturationResident, creerFacture, buildLignes, computeTotals, htDepuisTtc, genererPdfFacture, genererProformaPdf, envoyerFactureEmail, currentPeriode };

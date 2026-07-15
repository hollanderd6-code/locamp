const { supabase } = require('./supabase');
const { buildFacturePdf } = require('./pdf');
const { uploadDocument, downloadDocument, BUCKET } = require('./storage');
const { sendEmail } = require('./email');
const { inscrireFacture } = require('./fiscal');

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }        // m : 1-12
// Ajoute n jours à une date 'YYYY-MM-DD' (UTC, sans dérive de fuseau).
function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
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
    // Saisie TTC prioritaire. On calcule d'abord le TOTAL TTC de la ligne
    // (quantité × PU TTC), PUIS on en déduit le HT. Ne JAMAIS arrondir le PU HT
    // avant de multiplier : sur un petit PU (0,39 €/kWh -> 0,35 arrondi) on perdrait
    // 0,005 €/unité × quantité (100 kWh -> 39,00 € et non 38,50 €).
    const hasTtc = l.pu_ttc !== undefined && l.pu_ttc !== null && l.pu_ttc !== '';
    let pu, mHt, mTva;
    if (hasTtc) {
      const mTtc = Math.round(q * Number(l.pu_ttc) * 100) / 100;
      mHt = htDepuisTtc(mTtc, taux);
      mTva = Math.round((mTtc - mHt) * 100) / 100;   // TVA = TTC - HT : la ligne retombe pile sur le TTC saisi
      pu = q ? Math.round((mHt / q) * 100) / 100 : mHt; // PU HT indicatif (affichage)
    } else {
      pu = Number(l.pu_ht || 0);
      mHt = Math.round(q * pu * 100) / 100;
      mTva = Math.round(mHt * taux) / 100;
    }
    ht += mHt;
    tva += mTva;
    let nuits = l.nuits != null && l.nuits !== '' ? Number(l.nuits) : null;
    if (nuits == null && l.date_debut && l.date_fin) {
      const d = Math.round((new Date(l.date_fin) - new Date(l.date_debut)) / 86400000);
      nuits = d > 0 ? d : null;
    }
    return {
      designation: l.designation, quantite: q, pu_ht: pu, taux_tva: taux, montant_ht: mHt,
      // On conserve le PU TTC source sur les lignes saisies en TTC : un ré-enregistrement
      // du brouillon repart du TTC exact (et non du PU HT arrondi) -> pas de dérive.
      ...(hasTtc ? { pu_ttc: Math.round(Number(l.pu_ttc) * 10000) / 10000 } : {}),
      date_debut: l.date_debut || null, date_fin: l.date_fin || null, nuits,
    };
  });
  ht = Math.round(ht * 100) / 100;
  tva = Math.round(tva * 100) / 100;
  return { lignes: out, total_ht: ht, total_tva: tva, total_ttc: Math.round((ht + tva) * 100) / 100 };
}

// Construit les lignes de facture d'un résident pour une période.
//
// Les MONTANTS (loyer + lignes récurrentes) viennent de resident.facturation :
// c'est la configuration vivante, modifiable à tout moment (révision de tarif).
// Le CONTRAT (optionnel) ne sert qu'aux DATES de présence, pour le prorata d'un
// mois partiel (entrée/sortie). Sans contrat -> mois entier, résident facturable.
function buildLignes(contrat, resident, periode, parametres) {
  const [y, m] = periode.split('-').map(Number);
  const dim = daysInMonth(y, m);
  const start = `${periode}-01`;
  const end = `${periode}-${String(dim).padStart(2, '0')}`;
  const c = contrat || {};
  const fact = (resident && resident.facturation) || {};

  let first = 1, last = dim;
  if (c.date_debut && c.date_debut > start && c.date_debut <= end) first = Number(c.date_debut.slice(8, 10));
  if (c.date_fin && c.date_fin >= start && c.date_fin < end) last = Number(c.date_fin.slice(8, 10));
  const activeDays = last - first + 1;
  const factor = (activeDays > 0 && activeDays < dim) ? activeDays / dim : 1;

  const lignes = [];
  const dDebut = `${periode}-${String(first).padStart(2, '0')}`;
  // Convention hôtelière : « Au » = jour de DÉPART (entrée + nuits), pas le dernier
  // jour de présence. Un mois complet va donc du 01/09 au 01/10 (30 nuits).
  const dFin = addDays(dDebut, activeDays);
  // Loyer : configuré sur le résident ; repli sur le contrat pour les fiches pas encore migrées.
  const loyer = Number(fact.loyer_mensuel != null ? fact.loyer_mensuel : (c.montant_mensuel || 0));
  const tvaLoyer = Number(fact.loyer_tva != null ? fact.loyer_tva : (parametres?.facturation?.tva_taux_loyer || 0));
  const loyerProrata = fact.loyer_prorata !== false;   // prorata par défaut
  if (loyer > 0) {
    const proratise = loyerProrata && factor < 1;
    const montant = proratise ? Math.round(loyer * factor * 100) / 100 : Math.round(loyer * 100) / 100;
    lignes.push({
      designation: proratise
        ? `Loyer emplacement — ${periodeLabel(periode)} (prorata ${activeDays}/${dim} j)`
        : `Loyer emplacement — ${periodeLabel(periode)}`,
      date_debut: dDebut, date_fin: dFin, nuits: activeDays,
      quantite: 1, pu_ttc: montant, taux_tva: tvaLoyer,   // loyer saisi TTC -> HT dérivé
    });
  }

  // --- Lignes récurrentes du contrat ("montant type" du résident) ---
  // Saisies une fois sur le contrat, reprises à chaque facturation mensuelle.
  // prorata:true -> ajustées au nombre de jours de présence, comme le loyer.
  for (const r of (fact.lignes || c.lignes_recurrentes || [])) {
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

// Résout la configuration de facturation applicable à un résident, dans l'ordre :
//   1. config PROPRE du résident (tarif négocié) si elle porte un loyer ou des lignes ;
//   2. sinon le MODÈLE de facturation rattaché à son emplacement
//      (parametres.factures_types[], référencé par emplacement.meta.facture_type_id) — live ;
//   3. sinon rien : buildLignes retombera sur le contrat.
function resoudreFacturation(resident, emplacement, parametres) {
  const own = (resident && resident.facturation) || {};
  const aOwn = Number(own.loyer_mensuel || 0) > 0 || (own.lignes || []).length > 0;
  if (aOwn) return own;
  const typeId = emplacement && emplacement.meta && emplacement.meta.facture_type_id;
  if (typeId) {
    const t = ((parametres && parametres.factures_types) || []).find((x) => x && x.id === typeId);
    if (t) {
      return {
        loyer_mensuel: Number(t.loyer_mensuel || 0),
        loyer_tva: Number(t.loyer_tva || 0),
        loyer_prorata: t.loyer_prorata !== false,
        lignes: Array.isArray(t.lignes) ? t.lignes : [],
        _modele_id: t.id, _modele_nom: t.nom,
      };
    }
  }
  return own;
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
  // Un brouillon s'imprime en PROFORMA (pas de n° comptable, mention « ne vaut pas facture »).
  const pdf = await buildFacturePdf({
    camping: campData, resident: resident.data || {},
    facture: { ...facture, paiement, proforma: facture.statut === 'brouillon' },
  });
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
  const brouillon = statut === 'brouillon';
  // Un brouillon ne consomme AUCUN numéro de la séquence fiscale (la numérotation
  // doit rester continue) : il porte un numéro provisoire jusqu'à son émission.
  const numero = brouillon
    ? `PROFORMA-${require('crypto').randomUUID().slice(0, 8)}`
    : await nextNumeroFacture(campingId);
  const { data: facture, error } = await supabase.from('factures').insert({
    camping_id: campingId, resident_id: resident_id || null, contrat_id: contrat_id || null,
    numero, periode: periode || null, date_emission: new Date().toISOString().slice(0, 10),
    lignes: t.lignes, total_ht: t.total_ht, total_tva: t.total_tva, total_ttc: t.total_ttc,
    statut, avoir_de,
  }).select().single();
  if (error) throw error;

  // Un brouillon reste hors chaîne fiscale, sans e-mail ni notification :
  // rien n'est définitif tant qu'il n'est pas émis.
  if (brouillon) {
    await genererPdfFacture(campingId, facture).catch((e) => console.error('[pdf brouillon]', e.message));
    return facture;
  }

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

// Émission d'un brouillon : c'est ICI que tout devient définitif.
//   - numéro définitif attribué (la séquence n'est consommée qu'à cet instant)
//   - entrée dans la chaîne d'inaltérabilité (art. 286-I-3° bis du CGI)
//   - lettrage du crédit d'avance, PDF, e-mail au locataire, notification portail
async function emettreFacture(campingId, factureId, req = null) {
  const { data: f } = await supabase.from('factures').select('*')
    .eq('camping_id', campingId).eq('id', factureId).maybeSingle();
  if (!f) return { error: 'Facture introuvable', code: 404 };
  if (f.statut !== 'brouillon') return { error: 'Cette facture est déjà émise', code: 409 };
  if (!(f.lignes || []).length) return { error: 'Facture vide : ajoutez au moins une ligne', code: 400 };

  const numero = await nextNumeroFacture(campingId);
  const { data: facture, error } = await supabase.from('factures').update({
    numero, statut: 'emise', date_emission: new Date().toISOString().slice(0, 10),
  }).eq('camping_id', campingId).eq('id', factureId).select().single();
  if (error) throw error;

  await inscrireFacture(campingId, facture, req);

  if (facture.resident_id) {
    try { await require('./lettrage').appliquerCredit(campingId, facture.resident_id); }
    catch (e) { console.error('[emission:lettrage]', e.message); }
  }

  await genererPdfFacture(campingId, facture).catch((e) => console.error('[pdf emission]', e.message));

  // Notification portail (best-effort)
  if (facture.resident_id) {
    Promise.resolve().then(async () => {
      const { creerNotifResident } = require('./notifications');
      await creerNotifResident(campingId, facture.resident_id, {
        type: 'nouvelle_facture',
        titre: `Nouvelle facture ${facture.numero}`,
        corps: `Montant : ${Number(facture.total_ttc).toFixed(2)} €. Consultable dans votre espace locataire.`,
        entite: 'facture', entite_id: facture.id,
        donnees: { numero: facture.numero, total_ttc: facture.total_ttc },
      });
    }).catch((e) => console.error('[emission notif]', e.message));
  }

  // E-mail au locataire — uniquement à l'émission.
  Promise.resolve().then(async () => {
    const { data: camp } = await supabase.from('campings').select('parametres').eq('id', campingId).maybeSingle();
    if (camp?.parametres?.facturation?.email_auto === false) return;
    const out = await envoyerFactureEmail(campingId, facture.id, {});
    if (out.error || (out.skipped && out.skipped !== 'deja_envoye')) console.log('[emission email]', facture.numero, out);
  }).catch((e) => console.error('[emission email]', e.message));

  return { facture };
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

  const { data: resident } = await supabase.from('residents')
    .select('id,foyer,facturation,emplacement_id').eq('camping_id', campingId).eq('id', residentId).maybeSingle();
  if (!resident) return { error: 'Résident introuvable', code: 404 };

  // Le contrat est FACULTATIF : il ne sert qu'aux dates de présence (prorata).
  const { data: contrats } = await supabase.from('contrats').select('*')
    .eq('camping_id', campingId).eq('resident_id', residentId)
    .in('statut', ['signe', 'actif']).order('created_at', { ascending: false });
  const c = (contrats || []).find((x) =>
    !(x.date_debut && x.date_debut > end) && !(x.date_fin && x.date_fin < start)) || null;

  // Anti-doublon : une seule facture de période par résident (avec ou sans contrat).
  const { data: existing } = await supabase.from('factures').select('id,numero')
    .eq('camping_id', campingId).eq('resident_id', residentId).eq('periode', periode)
    .neq('statut', 'avoir').neq('statut', 'annulee').maybeSingle();
  if (existing) return { error: `Facture déjà émise pour cette période (${existing.numero})`, code: 409 };

  // Config applicable : résident > modèle du logement (live). Résolue AVANT le garde-fou
  // pour qu'un logement doté d'un modèle soit facturable sans config propre au résident.
  let emplacement = null;
  if (resident.emplacement_id) {
    const { data: emp } = await supabase.from('emplacements').select('meta')
      .eq('camping_id', campingId).eq('id', resident.emplacement_id).maybeSingle();
    emplacement = emp || null;
  }
  resident.facturation = resoudreFacturation(resident, emplacement, parametres);

  // Garde-fou : sans loyer ni ligne récurrente configurés, il n'y a rien à facturer.
  // (Sans ce contrôle, on émettrait une facture ne contenant que la taxe de séjour.)
  const fact = resident.facturation || {};
  if (!(Number(fact.loyer_mensuel || 0) > 0) && !(fact.lignes || []).length) {
    return { error: 'Aucun montant configuré pour ce résident, ni de modèle sur son logement. Configurez le loyer via « Configurer », ou rattachez un modèle de facturation à l\'emplacement.', code: 400 };
  }

  const lignes = buildLignes(c, resident, periode, parametres);

  // Prestations non facturées (charges eau/élec, ventes...) : reprises dans le
  // même brouillon. Les cautions ne sont pas facturables.
  // NB : la colonne pu_ttc n'existe pas — la source de vérité est montant_ttc,
  // dont on redéduit le PU TTC (évite les lignes à 0 € et la dérive d'arrondi).
  const { data: prestas } = await supabase.from('prestations')
    .select('id,type,designation,quantite,pu_ht,taux_tva,montant_ttc,date_debut,date_fin')
    .eq('camping_id', campingId).eq('resident_id', residentId)
    .neq('type', 'caution').neq('statut', 'facturee').neq('statut', 'annulee');
  for (const p of (prestas || [])) {
    const q = Number(p.quantite || 1);
    const ttc = Number(p.montant_ttc);
    const ligne = {
      designation: p.designation,
      quantite: q, taux_tva: Number(p.taux_tva || 0),
      date_debut: p.date_debut || null, date_fin: p.date_fin || null,
    };
    if (Number.isFinite(ttc) && ttc > 0) ligne.pu_ttc = Math.round((ttc / q) * 10000) / 10000;
    else ligne.pu_ht = Number(p.pu_ht || 0);
    lignes.push(ligne);
  }

  if (!lignes.length) return { error: 'Rien à facturer pour cette période.', code: 400 };

  // Créée en BROUILLON : rien de définitif tant qu'elle n'est pas émise.
  const facture = await creerFacture({
    campingId, resident_id: residentId, contrat_id: c ? c.id : null,
    periode, lignes, statut: 'brouillon',
  });

  // Les prestations reprises sont rattachées au brouillon (libérées s'il est supprimé).
  const ids = (prestas || []).map((p) => p.id);
  if (ids.length) {
    await supabase.from('prestations').update({ statut: 'facturee', facture_id: facture.id })
      .eq('camping_id', campingId).in('id', ids);
  }

  return { facture, prestations: ids.length };
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

  // On parcourt les RÉSIDENTS actifs (la facturation vit sur le résident) ;
  // le contrat, s'il existe, ne fournit que les dates de présence (prorata).
  const { data: residents, error } = await supabase.from('residents')
    .select('id,foyer,facturation,emplacement_id').eq('camping_id', campingId).eq('actif', true);
  if (error) throw error;

  // Modèles de facturation par emplacement (résolution live du "montant type" du logement).
  const { data: emps } = await supabase.from('emplacements').select('id,meta').eq('camping_id', campingId);
  const empMap = {}; (emps || []).forEach((e) => { empMap[e.id] = e; });

  const { data: contrats } = await supabase.from('contrats').select('*')
    .eq('camping_id', campingId).in('statut', ['signe', 'actif']).not('resident_id', 'is', null);
  const parRes = {};
  for (const c of (contrats || [])) if (!parRes[c.resident_id]) parRes[c.resident_id] = c;

  const res = { periode, crees: 0, ignores: 0, erreurs: 0, factures: [] };
  for (const r of (residents || [])) {
    const c = parRes[r.id] || null;
    // hors période (entrée postérieure / départ antérieur) : rien à facturer
    if (c && c.date_debut && c.date_debut > end) { res.ignores++; continue; }
    if (c && c.date_fin && c.date_fin < start) { res.ignores++; continue; }

    const { data: existing } = await supabase.from('factures').select('id')
      .eq('camping_id', campingId).eq('resident_id', r.id).eq('periode', periode)
      .neq('statut', 'avoir').neq('statut', 'annulee').maybeSingle();
    if (existing) { res.ignores++; continue; }

    // Résout la config applicable (résident > modèle du logement) avant construction.
    r.facturation = resoudreFacturation(r, empMap[r.emplacement_id] || null, parametres);
    const lignes = buildLignes(c, r, periode, parametres);
    if (!lignes.length) { res.ignores++; continue; }

    try {
      const f = await creerFacture({ campingId, resident_id: r.id, contrat_id: c ? c.id : null, periode, lignes });
      res.crees++;
      res.factures.push({ id: f.id, numero: f.numero, total_ttc: f.total_ttc, resident_id: r.id });
    } catch (e) {
      console.error('[facturation]', r.id, e.message);
      res.erreurs++;
    }
  }
  return res;
}

module.exports = { runFacturationMensuelle, runFacturationResident, emettreFacture, creerFacture, buildLignes, computeTotals, htDepuisTtc, resoudreFacturation, genererPdfFacture, genererProformaPdf, envoyerFactureEmail, currentPeriode };

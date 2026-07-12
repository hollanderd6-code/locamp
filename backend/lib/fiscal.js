const { supabase } = require('./supabase');

/* ============================================================
   Conformité loi anti-fraude TVA — art. 286-I-3° bis du CGI
   ISCA : Inaltérabilité · Sécurisation · Conservation · Archivage

   Le hachage est calculé DANS PostgreSQL, sous verrou (fiscal_append),
   pour qu'aucune écriture concurrente ne puisse rompre la chaîne.
   ============================================================ */

const RACINE = '0'.repeat(64);
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;

/**
 * Inscrit un événement fiscal dans la chaîne (best-effort : n'interrompt jamais
 * l'opération métier, mais toute anomalie est journalisée).
 */
async function inscrire(campingId, { type, entite, entite_id, donnees, montant, auteur_id, auteur_email }) {
  try {
    const { data, error } = await supabase.rpc('fiscal_append', {
      p_camping: campingId,
      p_type: type,
      p_entite: entite || null,
      p_entite_id: entite_id || null,
      p_donnees: donnees || {},
      p_montant: montant == null ? null : Number(montant),
      p_auteur: auteur_id || null,
      p_auteur_email: auteur_email || null,
    });
    if (error) throw error;
    return Array.isArray(data) ? data[0] : data;
  } catch (e) {
    console.error('[fiscal:inscrire]', type, e.message);
    return null;
  }
}

/** Raccourci : événement facture (ou avoir). */
const inscrireFacture = (campingId, facture, req) => inscrire(campingId, {
  type: facture.statut === 'avoir' ? 'avoir' : 'facture',
  entite: 'factures',
  entite_id: facture.id,
  donnees: {
    numero: facture.numero,
    date_emission: facture.date_emission,
    resident_id: facture.resident_id,
    total_ht: r2(facture.total_ht),
    total_tva: r2(facture.total_tva),
    total_ttc: r2(facture.total_ttc),
    nb_lignes: (facture.lignes || []).length,
  },
  montant: r2(facture.total_ttc),
  auteur_id: req?.user?.uid,
  auteur_email: req?.user?.email,
});

/** Raccourci : événement encaissement. */
const inscrireReglement = (campingId, reglement, req) => inscrire(campingId, {
  type: 'reglement',
  entite: 'reglements',
  entite_id: reglement.id,
  donnees: {
    mode: reglement.mode,
    date_reglement: reglement.date_reglement,
    resident_id: reglement.resident_id,
    reference: reglement.reference || null,
    montant: r2(reglement.montant),
  },
  montant: r2(reglement.montant),
  auteur_id: req?.user?.uid,
  auteur_email: req?.user?.email,
});

/**
 * Vérifie l'intégrité de la chaîne. Le recalcul est fait EN BASE (fiscal_verifier) :
 * PostgreSQL normalise jsonb et les timestamps, un recalcul en JS donnerait
 * un hash différent et signalerait de fausses altérations.
 */
async function verifierChaine(campingId) {
  const [{ data: anos, error }, { data: bornes }, { count }] = await Promise.all([
    supabase.rpc('fiscal_verifier', { p_camping: campingId }),
    supabase.from('journal_fiscal').select('seq,hash,horodatage')
      .eq('camping_id', campingId).order('seq', { ascending: false }).limit(1),
    supabase.from('journal_fiscal').select('id', { count: 'exact', head: true })
      .eq('camping_id', campingId),
  ]);
  if (error) throw error;

  const { data: premier } = await supabase.from('journal_fiscal')
    .select('horodatage').eq('camping_id', campingId).order('seq').limit(1);

  const anomalies = (anos || []).map((a) => ({ seq: a.seq, type: a.anomalie, message: a.detail }));
  return {
    integre: anomalies.length === 0,
    enregistrements: count || 0,
    premier: premier?.[0]?.horodatage || null,
    dernier: bornes?.[0]?.horodatage || null,
    empreinte_finale: bornes?.[0]?.hash || RACINE,
    anomalies,
  };
}

/** Bornes d'une période de clôture. */
function bornes(type, periode) {
  if (type === 'journaliere') return { debut: periode, fin: periode };
  if (type === 'mensuelle') {
    const [a, m] = periode.split('-').map(Number);
    return { debut: `${periode}-01`, fin: new Date(a, m, 0).toISOString().slice(0, 10) };
  }
  return { debut: `${periode}-01-01`, fin: `${periode}-12-31` };
}

/**
 * Clôture une période : fige les totaux, les chaîne, et alimente le cumul perpétuel.
 * Idempotent : une période déjà clôturée n'est jamais re-clôturée (inaltérabilité).
 */
async function cloturer(campingId, type, periode, req) {
  const { data: deja } = await supabase.from('clotures_fiscales').select('id,periode')
    .eq('camping_id', campingId).eq('type', type).eq('periode', periode).maybeSingle();
  if (deja) return { deja_cloturee: true, periode };

  const { debut, fin } = bornes(type, periode);

  const [factRes, reglRes, seqRes] = await Promise.all([
    // Toutes les factures, y compris celles annulées par un avoir : elles ont bien été
    // émises. L'avoir (montant déjà négatif) les contrepasse ; les exclure fausserait le total.
    supabase.from('factures').select('id,total_ht,total_tva,total_ttc,statut')
      .eq('camping_id', campingId).gte('date_emission', debut).lte('date_emission', fin),
    supabase.from('reglements').select('id,montant,mode')
      .eq('camping_id', campingId).gte('date_reglement', debut).lte('date_reglement', fin),
    supabase.from('journal_fiscal').select('seq')
      .eq('camping_id', campingId).order('seq', { ascending: false }).limit(1),
  ]);

  const factures = factRes.data || [];
  const reglements = reglRes.data || [];

  // Les montants d'un avoir sont DÉJÀ négatifs : aucun signe supplémentaire,
  // sinon l'avoir gonflerait le chiffre d'affaires au lieu de le réduire.
  let ht = 0, tva = 0, ttc = 0;
  for (const f of factures) {
    ht += Number(f.total_ht || 0);
    tva += Number(f.total_tva || 0);
    ttc += Number(f.total_ttc || 0);
  }
  const encaisse = reglements.reduce((s, r) => s + Number(r.montant || 0), 0);

  const parMode = {};
  reglements.forEach((r) => { parMode[r.mode] = r2((parMode[r.mode] || 0) + Number(r.montant)); });

  const seqFin = seqRes.data?.[0]?.seq || 0;

  const { data, error } = await supabase.rpc('fiscal_cloture', {
    p_camping: campingId, p_type: type, p_periode: periode,
    p_seq_debut: null, p_seq_fin: seqFin,
    p_nb_fact: factures.length, p_nb_regl: reglements.length,
    p_ht: r2(ht), p_tva: r2(tva), p_ttc: r2(ttc), p_encaisse: r2(encaisse),
    p_detail: { par_mode: parMode, debut, fin },
    p_auteur: req?.user?.uid || null,
  });
  if (error) throw error;
  const cloture = Array.isArray(data) ? data[0] : data;

  // la clôture elle-même entre dans le journal : elle est donc chaînée deux fois
  await inscrire(campingId, {
    type: 'cloture', entite: 'clotures_fiscales', entite_id: cloture.id,
    donnees: { type, periode, total_ttc: r2(ttc), total_encaisse: r2(encaisse),
      cumul_perpetuel: Number(cloture.cumul_perpetuel), hash: cloture.hash },
    montant: r2(ttc),
    auteur_id: req?.user?.uid, auteur_email: req?.user?.email,
  });

  return { cloture };
}

/** Clôture automatique de la veille, pour tous les campings actifs. */
async function cloturerVeille() {
  const d = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const { data: campings } = await supabase.from('campings').select('id,nom');
  let n = 0;
  for (const c of (campings || [])) {
    try {
      const out = await cloturer(c.id, 'journaliere', d, null);
      if (!out.deja_cloturee) n += 1;
    } catch (e) { console.error('[fiscal:cloture auto]', c.id, e.message); }
  }
  if (n) console.log(`[fiscal] clôture journalière du ${d} : ${n} camping(s)`);
  return n;
}

module.exports = {
  inscrire, inscrireFacture, inscrireReglement,
  verifierChaine, cloturer, cloturerVeille, RACINE,
};

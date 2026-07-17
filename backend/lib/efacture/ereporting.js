/* ============================================================================
   E-reporting — transmission des données de transaction (flux B2C).

   Principe : pour les ventes aux PARTICULIERS, on ne transmet pas la facture
   (c'est le rôle du Factur-X en B2B), mais les DONNÉES agrégées de la période.

   Deux flux :
     - 'transaction'  : ventes B2C de la période, ventilées par taux de TVA ;
     - 'encaissement' : encaissements de la période (la TVA sur prestations de
       services étant exigible à l'encaissement, l'administration veut aussi
       cette donnée).

   Le périmètre B2C = les factures dont le client n'a PAS de SIRET. Un client
   entreprise relève du Factur-X et ne doit surtout pas être compté ici, sinon
   l'opération serait déclarée deux fois.
   ========================================================================== */

const { supabase } = require('../supabase');

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;

// Bornes d'une période 'AAAA-MM' -> { debut: 'AAAA-MM-01', fin: 'AAAA-MM-JJ' }
function bornes(periode) {
  const [y, m] = String(periode).split('-').map(Number);
  const dernier = new Date(y, m, 0).getDate();
  return { debut: `${periode}-01`, fin: `${periode}-${String(dernier).padStart(2, '0')}` };
}

// SIREN d'un SIRET (identifie un client entreprise).
function estEntreprise(resident) {
  const n = String((resident && resident.siret) || '').replace(/\D/g, '');
  return n.length >= 9;
}

/* ---------- Flux « transaction » : ventes B2C de la période ---------- */
async function agregerTransactions(campingId, periode) {
  const { debut, fin } = bornes(periode);

  // Les avoirs et annulations n'ont pas à être déclarés comme ventes :
  // un avoir viendra en diminution (montants négatifs déjà portés par ses lignes).
  const { data: factures } = await supabase.from('factures')
    .select('id,numero,resident_id,date_emission,lignes,total_ht,total_tva,total_ttc,statut')
    .eq('camping_id', campingId)
    .gte('date_emission', debut).lte('date_emission', fin)
    .neq('statut', 'brouillon').neq('statut', 'annulee');

  const ids = [...new Set((factures || []).map((f) => f.resident_id).filter(Boolean))];
  const entreprises = new Set();
  if (ids.length) {
    const { data: rs } = await supabase.from('residents').select('id,siret').in('id', ids);
    (rs || []).forEach((r) => { if (estEntreprise(r)) entreprises.add(r.id); });
  }

  const parTaux = {};
  let nb = 0, ht = 0, tva = 0, ttc = 0;
  const exclues = [];

  for (const f of (factures || [])) {
    // Client entreprise -> Factur-X, pas d'e-reporting (sinon double déclaration).
    if (f.resident_id && entreprises.has(f.resident_id)) { exclues.push(f.numero); continue; }
    nb++;
    ht = r2(ht + Number(f.total_ht || 0));
    tva = r2(tva + Number(f.total_tva || 0));
    ttc = r2(ttc + Number(f.total_ttc || 0));

    // Ventilation par taux : c'est le niveau de détail attendu.
    for (const l of (f.lignes || [])) {
      const taux = Number(l.taux_tva || 0);
      const base = Number(l.montant_ht || 0);
      if (!parTaux[taux]) parTaux[taux] = { taux, base_ht: 0, montant_tva: 0 };
      parTaux[taux].base_ht = r2(parTaux[taux].base_ht + base);
      parTaux[taux].montant_tva = r2(parTaux[taux].montant_tva + base * taux / 100);
    }
  }

  return {
    type: 'transaction', periode,
    nb_operations: nb,
    total_ht: ht, total_tva: tva, total_ttc: ttc,
    ventilation_tva: Object.values(parTaux).sort((a, b) => a.taux - b.taux),
    exclues_b2b: exclues,   // transmises en Factur-X, hors e-reporting
  };
}

/* ---------- Flux « encaissement » : paiements reçus sur la période ---------- */
async function agregerEncaissements(campingId, periode) {
  const { debut, fin } = bornes(periode);

  const { data: regs } = await supabase.from('reglements')
    .select('id,resident_id,mode,montant,date_reglement,affectations')
    .eq('camping_id', campingId)
    .gte('date_reglement', debut).lte('date_reglement', fin);

  const ids = [...new Set((regs || []).map((r) => r.resident_id).filter(Boolean))];
  const entreprises = new Set();
  if (ids.length) {
    const { data: rs } = await supabase.from('residents').select('id,siret').in('id', ids);
    (rs || []).forEach((r) => { if (estEntreprise(r)) entreprises.add(r.id); });
  }

  const parMode = {};
  let nb = 0, ttc = 0;
  for (const r of (regs || [])) {
    if (r.resident_id && entreprises.has(r.resident_id)) continue;   // B2B : hors flux B2C
    nb++;
    const m = Number(r.montant || 0);
    ttc = r2(ttc + m);
    parMode[r.mode] = r2((parMode[r.mode] || 0) + m);
  }

  return {
    type: 'encaissement', periode,
    nb_operations: nb,
    total_ht: 0, total_tva: 0, total_ttc: ttc,   // un encaissement est un montant TTC
    par_mode: Object.entries(parMode).map(([mode, montant]) => ({ mode, montant })),
  };
}

// Calcule l'agrégat d'une période sans rien enregistrer (aperçu avant transmission).
async function calculer(campingId, periode, type = 'transaction') {
  if (!/^\d{4}-\d{2}$/.test(String(periode || ''))) return { error: 'Période attendue au format AAAA-MM', code: 400 };
  return type === 'encaissement'
    ? await agregerEncaissements(campingId, periode)
    : await agregerTransactions(campingId, periode);
}

/* ---------- Transmission via la Plateforme Agréée ---------- */
async function transmettre(campingId, periode, type = 'transaction') {
  const { contexte, getDriver } = require('./index');

  const ctx = await contexte(campingId);
  if (!ctx.connexion || ctx.connexion.statut !== 'connecte' && ctx.connexion.statut !== 'connectee') {
    return { error: 'Aucune plateforme connectée. Paramètres → Facturation électronique.', code: 400 };
  }
  const driver = getDriver(ctx.connexion.pa_code);
  if (!driver) return { error: `Pilote « ${ctx.connexion.pa_code} » introuvable`, code: 400 };

  // Un lot déjà transmis ne se retransmet pas : la période est figée.
  const { data: existant } = await supabase.from('ereporting_lots').select('id,statut,doc_externe_id')
    .eq('camping_id', campingId).eq('periode', periode).eq('type', type).maybeSingle();
  if (existant && existant.statut === 'transmis') {
    return { error: `Période déjà transmise (réf. ${existant.doc_externe_id || '—'})`, code: 409 };
  }

  const lot = await calculer(campingId, periode, type);
  if (lot.error) return lot;
  if (!lot.nb_operations) return { error: 'Aucune opération à déclarer sur cette période.', code: 400 };

  let out;
  try {
    out = await driver.ereporting(ctx, { ...lot, nb: lot.nb_operations });
  } catch (e) {
    console.error('[ereporting] pilote :', e.message);
    await enregistrer(campingId, periode, type, lot, {
      statut: 'erreur', pa_code: ctx.connexion.pa_code, message: e.message,
    });
    return { error: `Transmission refusée par la plateforme : ${e.message}`, code: 502 };
  }

  const enreg = await enregistrer(campingId, periode, type, lot, {
    statut: out.statut === 'transmis' ? 'transmis' : 'erreur',
    pa_code: ctx.connexion.pa_code,
    doc_externe_id: out.doc_externe_id || null,
    message: out.message || null,
    transmis_at: new Date().toISOString(),
  });
  return { lot: enreg, resume: out.resume || null };
}

async function enregistrer(campingId, periode, type, lot, meta) {
  const row = {
    camping_id: campingId, periode, type,
    donnees: lot,
    nb_operations: lot.nb_operations || 0,
    total_ht: lot.total_ht || 0, total_tva: lot.total_tva || 0, total_ttc: lot.total_ttc || 0,
    ...meta,
  };
  const { data, error } = await supabase.from('ereporting_lots')
    .upsert(row, { onConflict: 'camping_id,periode,type' }).select().single();
  if (error) throw error;
  return data;
}

// Historique des lots transmis (justificatif déclaratif).
async function historique(campingId, limit = 24) {
  const { data } = await supabase.from('ereporting_lots')
    .select('id,periode,type,nb_operations,total_ht,total_tva,total_ttc,statut,pa_code,doc_externe_id,message,transmis_at')
    .eq('camping_id', campingId)
    .order('periode', { ascending: false }).limit(limit);
  return data || [];
}

module.exports = { calculer, transmettre, historique, bornes };

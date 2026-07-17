/* ============================================================================
   Reception des factures fournisseurs.
   Locamp (OD) interroge la Plateforme Agreee via le pilote (recevoir), importe
   les nouvelles factures et gere leur cycle de vie cote acheteur.
   ========================================================================== */

const { supabase } = require('../supabase');
const ef = require('./index');

const STATUTS = ['recue', 'acceptee', 'refusee', 'litige', 'comptabilisee'];

/** Interroge la PA et importe les nouvelles factures (sans ecraser les statuts deja poses). */
async function synchroniser(campingId) {
  const ctx = await ef.contexte(campingId);
  if (!ctx.connexion || !/connect/.test(ctx.connexion.statut || '')) {
    return { error: 'Aucune plateforme connectee. Parametres -> Facturation electronique.', code: 400 };
  }
  const driver = ef.getDriver(ctx.connexion.pa_code);
  if (typeof driver.recevoir !== 'function') return { error: 'Pilote sans reception', code: 400 };

  const recues = (await driver.recevoir(ctx)) || [];
  if (!recues.length) return { importees: 0, total: 0 };

  const rows = recues.map((d) => ({
    camping_id: campingId,
    pa_code: ctx.connexion.pa_code,
    doc_externe_id: String(d.doc_externe_id),
    emetteur_nom: d.emetteur_nom || null,
    emetteur_siren: d.emetteur_siren || null,
    numero: d.numero || null,
    date_facture: d.date_facture || null,
    total_ht: d.total_ht != null ? d.total_ht : null,
    total_tva: d.total_tva != null ? d.total_tva : null,
    total_ttc: d.total_ttc != null ? d.total_ttc : null,
    devise: d.devise || 'EUR',
    format: d.format || null,
    payload: d.payload || {},
  }));

  // On ne garde que les factures pas encore connues (dedup par doc_externe_id).
  const ids = rows.map((r) => r.doc_externe_id);
  const { data: existants } = await supabase.from('efacture_recues')
    .select('doc_externe_id').eq('camping_id', campingId).in('doc_externe_id', ids);
  const connus = new Set((existants || []).map((e) => e.doc_externe_id));
  const nouvelles = rows.filter((r) => !connus.has(r.doc_externe_id));

  if (nouvelles.length) {
    const { error } = await supabase.from('efacture_recues')
      .upsert(nouvelles, { onConflict: 'camping_id,doc_externe_id', ignoreDuplicates: true });
    if (error) throw error;
  }
  return { importees: nouvelles.length, total: rows.length };
}

async function lister(campingId, statut) {
  let q = supabase.from('efacture_recues').select('*').eq('camping_id', campingId);
  if (statut) q = q.eq('statut', statut);
  const { data, error } = await q.order('date_facture', { ascending: false, nullsFirst: false })
    .order('recue_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function changerStatut(campingId, id, statut, motif) {
  if (!STATUTS.includes(statut)) return { error: 'Statut invalide', code: 400 };
  const { data: rec } = await supabase.from('efacture_recues')
    .select('*').eq('camping_id', campingId).eq('id', id).maybeSingle();
  if (!rec) return { error: 'Facture introuvable', code: 404 };

  const { data, error } = await supabase.from('efacture_recues')
    .update({ statut, motif: motif || null, statut_maj_at: new Date().toISOString() })
    .eq('camping_id', campingId).eq('id', id).select().maybeSingle();
  if (error) throw error;

  // Notifie la PA du statut si le pilote le sait (cycle de vie renvoye a l'emetteur).
  try {
    const ctx = await ef.contexte(campingId);
    const driver = ef.getDriver(rec.pa_code);
    if (typeof driver.notifierStatut === 'function') {
      await driver.notifierStatut(ctx, { doc_externe_id: rec.doc_externe_id, statut, motif });
    }
  } catch (_) { /* best-effort : le statut local reste pose */ }

  return { ok: true, facture: data };
}

module.exports = { synchroniser, lister, changerStatut, STATUTS };

/* ============================================================================
   Indexation / revalorisation des loyers.
   Aperçu -> détail avant/après par résident, puis application en un clic.
   - Écrit le nouveau loyer dans la config de facturation du résident
     (residents.facturation.loyer_mensuel) : c'est elle qui pilote la
     facturation mensuelle.
   - Peut aussi revaloriser les modèles partagés (parametres.factures_types) ;
     les résidents qui suivent un modèle suivent alors automatiquement.
   - Les contrats signés ne sont JAMAIS modifiés (documents scellés) :
     l'avenant contractuel passe par le renouvellement -> signature.
   Chaque campagne est journalisée (loyer_indexations) : taux, référence,
   détail complet avant/après.
   ========================================================================== */

const express = require('express');
const { supabase } = require('../lib/supabase');
const { writeAudit } = require('../lib/audit');
const { auth, campingScope, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(auth, campingScope);

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;

/** Résout le loyer effectif de chaque résident actif (même logique que la facturation). */
async function resoudreLoyers(cid) {
  const [{ data: residents }, { data: emplacements }, { data: camp }, { data: contrats }] = await Promise.all([
    supabase.from('residents').select('id,nom,prenom,emplacement_id,facturation').eq('camping_id', cid).eq('actif', true),
    supabase.from('emplacements').select('id,numero,meta').eq('camping_id', cid),
    supabase.from('campings').select('parametres').eq('id', cid).maybeSingle(),
    supabase.from('contrats').select('id,resident_id,montant_mensuel,statut,date_debut').eq('camping_id', cid).neq('statut', 'annule'),
  ]);
  const empMap = {}; (emplacements || []).forEach((e) => { empMap[e.id] = e; });
  const types = (camp && camp.parametres && camp.parametres.factures_types) || [];
  const typeMap = {}; types.forEach((t) => { if (t && t.id) typeMap[t.id] = t; });
  // dernier contrat par résident (repli)
  const ctrMap = {};
  (contrats || []).forEach((c) => {
    const cur = ctrMap[c.resident_id];
    if (!cur || String(c.date_debut || '') > String(cur.date_debut || '')) ctrMap[c.resident_id] = c;
  });

  const items = [];
  for (const r of (residents || [])) {
    const own = r.facturation || {};
    const nom = [r.prenom, r.nom].filter(Boolean).join(' ');
    const emp = r.emplacement_id ? empMap[r.emplacement_id] : null;
    if (Number(own.loyer_mensuel || 0) > 0 || (own.lignes || []).length > 0) {
      items.push({ resident_id: r.id, nom, emplacement: emp ? emp.numero : null,
        source: 'fiche', avant: r2(own.loyer_mensuel || 0) });
      continue;
    }
    const typeId = emp && emp.meta && emp.meta.facture_type_id;
    if (typeId && typeMap[typeId]) {
      items.push({ resident_id: r.id, nom, emplacement: emp ? emp.numero : null,
        source: 'modele', modele_id: typeId, modele_nom: typeMap[typeId].nom || 'modèle',
        avant: r2(typeMap[typeId].loyer_mensuel || 0) });
      continue;
    }
    const c = ctrMap[r.id];
    items.push({ resident_id: r.id, nom, emplacement: emp ? emp.numero : null,
      source: 'contrat', contrat_id: c ? c.id : null, avant: r2(c ? c.montant_mensuel : 0) });
  }
  return { items, types };
}

/** Calcule l'après pour un taux (%). Les loyers à 0 ne sont pas indexés. */
function projeter(items, taux) {
  const t = Number(taux) / 100;
  return items.map((x) => ({ ...x, apres: x.avant > 0 ? r2(x.avant * (1 + t)) : x.avant }));
}

// GET /api/indexation/apercu?taux=3.26  -> avant/après par résident + modèles partagés
router.get('/apercu', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const taux = Number(req.query.taux);
    if (!Number.isFinite(taux) || taux <= -100 || taux > 100) return res.status(400).json({ error: 'Taux invalide' });
    const { items, types } = await resoudreLoyers(req.activeCampingId);
    const loyers = projeter(items, taux);
    const modeles = (types || []).filter((t) => Number(t.loyer_mensuel || 0) > 0)
      .map((t) => ({ id: t.id, nom: t.nom || 'modèle', avant: r2(t.loyer_mensuel), apres: r2(Number(t.loyer_mensuel) * (1 + taux / 100)) }));
    res.json({ taux, loyers, modeles });
  } catch (e) { console.error('[indexation:apercu]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/indexation  { taux, reference?, appliquer_modeles? }
router.post('/', requireRole('admin'), async (req, res) => {
  try {
    const b = req.body || {};
    const taux = Number(b.taux);
    if (!Number.isFinite(taux) || taux <= -100 || taux > 100) return res.status(400).json({ error: 'Taux invalide' });
    const cid = req.activeCampingId;
    const appliquerModeles = b.appliquer_modeles !== false;

    const { items, types } = await resoudreLoyers(cid);
    const loyers = projeter(items, taux);
    const details = [];
    let nb_loyers = 0, nb_modeles = 0;

    // 1) Modèles partagés (une seule écriture dans campings.parametres).
    if (appliquerModeles) {
      const { data: camp } = await supabase.from('campings').select('parametres').eq('id', cid).maybeSingle();
      const parametres = (camp && camp.parametres) || {};
      const ft = Array.isArray(parametres.factures_types) ? parametres.factures_types : [];
      let touche = false;
      const maj = ft.map((t) => {
        const av = Number(t && t.loyer_mensuel || 0);
        if (!(av > 0)) return t;
        touche = true; nb_modeles++;
        details.push({ modele_id: t.id, nom: `[modèle] ${t.nom || ''}`.trim(), avant: r2(av), apres: r2(av * (1 + taux / 100)), source: 'modele' });
        return { ...t, loyer_mensuel: r2(av * (1 + taux / 100)) };
      });
      if (touche) {
        const { error } = await supabase.from('campings')
          .update({ parametres: { ...parametres, factures_types: maj } }).eq('id', cid);
        if (error) throw error;
      }
    }

    // 2) Loyers individuels : sources 'fiche' et 'contrat' -> écrits dans la config
    //    de facturation du résident. Source 'modele' : suit son modèle (déjà traité).
    for (const x of loyers) {
      if (x.source === 'modele' || !(x.avant > 0) || x.apres === x.avant) continue;
      const { data: r } = await supabase.from('residents').select('facturation')
        .eq('camping_id', cid).eq('id', x.resident_id).maybeSingle();
      const fact = (r && r.facturation) || {};
      const { error } = await supabase.from('residents')
        .update({ facturation: { ...fact, loyer_mensuel: x.apres } })
        .eq('camping_id', cid).eq('id', x.resident_id);
      if (error) throw error;
      details.push({ resident_id: x.resident_id, nom: x.nom, avant: x.avant, apres: x.apres, source: x.source });
      nb_loyers++;
    }

    const { data: camp2 } = await supabase.from('loyer_indexations').insert({
      camping_id: cid, taux, reference: b.reference ? String(b.reference).slice(0, 120) : null,
      nb_loyers, nb_modeles, details, auteur_id: req.user.uid,
    }).select().single();

    await writeAudit(req, { action: 'loyers.indexation', entite: 'loyer_indexations', entite_id: camp2 ? camp2.id : null,
      apres: { taux, reference: b.reference || null, nb_loyers, nb_modeles } });
    res.status(201).json({ ok: true, taux, nb_loyers, nb_modeles });
  } catch (e) { console.error('[indexation:apply]', e.message); res.status(500).json({ error: 'Erreur serveur — la migration db/26_indexation.sql a-t-elle été exécutée ?' }); }
});

// GET /api/indexation/historique
router.get('/historique', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const { data, error } = await supabase.from('loyer_indexations')
      .select('id,taux,reference,nb_loyers,nb_modeles,created_at')
      .eq('camping_id', req.activeCampingId).order('created_at', { ascending: false }).limit(24);
    if (error) throw error;
    res.json({ indexations: data || [] });
  } catch (e) { console.error('[indexation:histo]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;

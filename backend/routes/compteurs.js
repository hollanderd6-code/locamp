const express = require('express');
const { supabase } = require('../lib/supabase');
const { writeAudit } = require('../lib/audit');
const { auth, campingScope, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(auth, campingScope);

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;

// Deux fluides sur le même moteur : mêmes règles (index croissant, verrou des
// charges facturées, correction en chaîne), tarifs et unités distincts.
const TYPES = {
  elec: { unite: 'kWh', prixKey: 'prix_kwh', tvaKey: 'taux_tva', seuilAlerte: 50, designation: (a, b, c) => `Charges [${a}\u203a${b}|${c} kWh]` },
  eau: { unite: 'm\u00b3', prixKey: 'prix_m3_eau', tvaKey: 'taux_tva_eau', seuilAlerte: 10, designation: (a, b, c) => `Eau [${a}\u203a${b}|${c} m\u00b3]` },
};
const typeDe = (v) => (v === 'eau' ? 'eau' : 'elec');

// Tarif TTC du fluide (null si non configuré).
function tarifPour(energie, type) {
  const T = TYPES[type];
  const prix = Number(energie[T.prixKey]);
  if (!Number.isFinite(prix) || prix <= 0) return null;
  return { prix, taux: Number(energie[T.tvaKey] ?? 10), unite: T.unite };
}

// Montants d'une charge à partir d'une conso (TTC d'abord, HT dérivé du total —
// ne jamais arrondir le PU HT avant de multiplier).
function chargeMontants(conso, tarif) {
  if (!(conso > 0) || !tarif) return null;
  const ttc = r2(conso * tarif.prix);
  return { pu_ht: r2(tarif.prix / (1 + tarif.taux / 100)), taux_tva: tarif.taux, montant_ht: r2(ttc / (1 + tarif.taux / 100)), montant_ttc: ttc };
}

// Vérifie que toutes les charges visées sont modifiables (statut en_cours). Une charge
// déjà facturée ou annulée est verrouillée (elle est engagée sur une facture émise).
async function chargesModifiables(cid, ids) {
  const real = [...new Set(ids.filter(Boolean))];
  if (!real.length) return { ok: true };
  const { data } = await supabase.from('prestations').select('id,statut').eq('camping_id', cid).in('id', real);
  const bloquee = (data || []).find((p) => p.statut !== 'en_cours');
  return bloquee ? { ok: false, statut: bloquee.statut } : { ok: true };
}

// (Re)calcule la charge d'un relevé selon son prédécesseur. Crée / met à jour / supprime
// la prestation liée. Retourne { conso, prestation_id }. Suppose la charge modifiable.
async function appliquerCharge(cid, energie, resident, releve, prev, existingPrestationId) {
  const type = typeDe(releve.type);
  const T = TYPES[type];
  const tarif = tarifPour(energie, type);
  const conso = prev ? r2(Number(releve.index_kwh) - Number(prev.index_kwh)) : null;
  const m = (conso != null && resident) ? chargeMontants(conso, tarif) : null;
  if (m) {
    const payload = {
      camping_id: cid, resident_id: resident.id, emplacement_id: releve.emplacement_id, type: 'charge',
      designation: T.designation(Number(prev.index_kwh), Number(releve.index_kwh), conso),
      date_debut: prev.date_releve, date_fin: releve.date_releve,
      quantite: conso, pu_ht: m.pu_ht, taux_tva: m.taux_tva, montant_ht: m.montant_ht, montant_ttc: m.montant_ttc,
    };
    if (existingPrestationId) {
      const { error } = await supabase.from('prestations')
        .update({ ...payload, updated_at: new Date().toISOString() }).eq('camping_id', cid).eq('id', existingPrestationId);
      if (error) throw error;
      return { conso, prestation_id: existingPrestationId };
    }
    const { data, error } = await supabase.from('prestations').insert(payload).select('id').single();
    if (error) throw error;
    return { conso, prestation_id: data.id };
  }
  // Pas de charge à créer : on retire l'éventuelle charge existante (conso nulle / plus de résident).
  if (existingPrestationId) await supabase.from('prestations').delete().eq('camping_id', cid).eq('id', existingPrestationId);
  return { conso, prestation_id: null };
}

// GET /api/compteurs?type=elec|eau  -> tournée : emplacements + résident + dernier relevé du fluide
router.get('/', async (req, res) => {
  try {
    const t = typeDe(req.query.type);
    const [empRes, resRes, relRes, campRes] = await Promise.all([
      supabase.from('emplacements').select('id,numero,secteur').eq('camping_id', req.activeCampingId).order('numero'),
      supabase.from('residents').select('id,nom,prenom,emplacement_id').eq('camping_id', req.activeCampingId).eq('actif', true),
      supabase.from('releves_compteurs').select('emplacement_id,date_releve,index_kwh,conso_kwh,created_at')
        .eq('camping_id', req.activeCampingId).eq('type', t)
        .order('date_releve', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('campings').select('parametres').eq('id', req.activeCampingId).maybeSingle(),
    ]);
    if (relRes.error) throw new Error(relRes.error.message + ' — la migration db/28_compteurs_eau.sql a-t-elle été exécutée ?');
    const residents = {};
    (resRes.data || []).forEach((r) => { if (r.emplacement_id && !residents[r.emplacement_id]) residents[r.emplacement_id] = r; });
    const dernier = {};
    (relRes.data || []).forEach((rl) => { if (!dernier[rl.emplacement_id]) dernier[rl.emplacement_id] = rl; });
    const energie = campRes.data?.parametres?.energie || {};
    const tarif = tarifPour(energie, t);
    res.json({
      type: t, unite: TYPES[t].unite,
      prix: tarif ? tarif.prix : null,
      taux_tva: tarif ? tarif.taux : Number(energie[TYPES[t].tvaKey] ?? 10),
      // compat ancien front (élec)
      prix_kwh: energie.prix_kwh != null ? Number(energie.prix_kwh) : null,
      emplacements: (empRes.data || []).map((e) => ({
        ...e,
        resident: residents[e.id] ? { id: residents[e.id].id, nom: residents[e.id].nom, prenom: residents[e.id].prenom } : null,
        dernier_releve: dernier[e.id] || null,
      })),
    });
  } catch (e) { console.error('[compteurs:list]', e.message); res.status(500).json({ error: e.message || 'Erreur serveur' }); }
});

// GET /api/compteurs/:emplacementId/historique?type=  (relevés + statut de la charge liée)
router.get('/:emplacementId/historique', async (req, res) => {
  try {
    const cid = req.activeCampingId;
    const t = typeDe(req.query.type);
    const { data, error } = await supabase.from('releves_compteurs').select('*')
      .eq('camping_id', cid).eq('emplacement_id', req.params.emplacementId).eq('type', t)
      .order('date_releve', { ascending: false }).order('created_at', { ascending: false }).limit(24);
    if (error) throw error;
    const releves = data || [];
    const pids = releves.map((r) => r.prestation_id).filter(Boolean);
    const charges = {};
    if (pids.length) {
      const { data: pr } = await supabase.from('prestations').select('id,statut,montant_ttc').eq('camping_id', cid).in('id', pids);
      (pr || []).forEach((p) => { charges[p.id] = { statut: p.statut, montant_ttc: Number(p.montant_ttc) }; });
    }
    res.json({ type: t, unite: TYPES[t].unite, releves: releves.map((r) => ({ ...r, charge: r.prestation_id ? (charges[r.prestation_id] || null) : null })) });
  } catch (e) { console.error('[compteurs:histo]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/compteurs/releve  { emplacement_id, index_kwh, type?, date_releve?, note? }
// Enregistre le relevé du fluide ; si un relevé précédent existe + résident rattaché + tarif
// configuré, crée automatiquement une prestation "charge" (conso × prix TTC) en_cours.
router.post('/releve', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.emplacement_id) return res.status(400).json({ error: 'emplacement_id requis' });
    const t = typeDe(b.type);
    const T = TYPES[t];
    const index_kwh = Number(b.index_kwh);
    if (!Number.isFinite(index_kwh) || index_kwh < 0) return res.status(400).json({ error: 'Index invalide' });
    const date_releve = b.date_releve || new Date().toISOString().slice(0, 10);

    const { data: prec } = await supabase.from('releves_compteurs')
      .select('date_releve,index_kwh')
      .eq('camping_id', req.activeCampingId).eq('emplacement_id', b.emplacement_id).eq('type', t)
      .order('date_releve', { ascending: false }).order('created_at', { ascending: false }).limit(1).maybeSingle();

    if (prec && index_kwh < Number(prec.index_kwh)) {
      return res.status(400).json({ error: `Index inférieur au précédent (${prec.index_kwh}). Compteur remplacé ? Corrige ou contacte le support.` });
    }
    const conso = prec ? r2(index_kwh - Number(prec.index_kwh)) : null;

    // Détection de surconsommation : conso > 2× la moyenne des 3 dernières (fuite,
    // compteur défaillant, erreur de saisie). Avertissement seulement, jamais bloquant.
    let alerte = null;
    if (conso != null && conso > 0) {
      const { data: histo } = await supabase.from('releves_compteurs')
        .select('conso_kwh').eq('camping_id', req.activeCampingId).eq('emplacement_id', b.emplacement_id).eq('type', t)
        .not('conso_kwh', 'is', null).gt('conso_kwh', 0)
        .order('date_releve', { ascending: false }).order('created_at', { ascending: false }).limit(3);
      const consos = (histo || []).map((h) => Number(h.conso_kwh)).filter((x) => x > 0);
      if (consos.length >= 2) {
        const moy = consos.reduce((s, x) => s + x, 0) / consos.length;
        if (conso > 2 * moy && conso - moy >= T.seuilAlerte) {
          alerte = `Consommation inhabituelle : ${conso} ${T.unite} contre ${r2(moy)} ${T.unite} en moyenne sur les ${consos.length} derniers relevés. Vérifie l'index saisi (ou une fuite/un appareil défaillant).`;
        }
      }
    }

    // prestation auto si possible
    let prestation = null, info = null;
    if (conso != null && conso > 0) {
      const [{ data: resident }, { data: camp }] = await Promise.all([
        supabase.from('residents').select('id').eq('camping_id', req.activeCampingId)
          .eq('emplacement_id', b.emplacement_id).eq('actif', true).limit(1).maybeSingle(),
        supabase.from('campings').select('parametres').eq('id', req.activeCampingId).maybeSingle(),
      ]);
      const energie = camp?.parametres?.energie || {};
      const tarif = tarifPour(energie, t);
      if (!resident) info = 'Relevé enregistré — aucun résident rattaché, pas de charge créée.';
      else if (!tarif) info = `Relevé enregistré — prix du ${T.unite} non configuré (Paramètres → Énergie & eau), pas de charge créée.`;
      else {
        const m = chargeMontants(conso, tarif);
        const ins = await supabase.from('prestations').insert({
          camping_id: req.activeCampingId, resident_id: resident.id, emplacement_id: b.emplacement_id,
          type: 'charge',
          designation: T.designation(Number(prec.index_kwh), index_kwh, conso),
          date_debut: prec.date_releve, date_fin: date_releve,
          quantite: conso, pu_ht: m.pu_ht, taux_tva: m.taux_tva,
          montant_ht: m.montant_ht, montant_ttc: m.montant_ttc,
        }).select().single();
        if (ins.error) throw ins.error;
        prestation = ins.data;
      }
    } else if (conso == null) {
      info = 'Premier relevé enregistré (index de départ) — la prochaine saisie calculera la consommation.';
    } else {
      info = 'Relevé enregistré — consommation nulle, pas de charge créée.';
    }

    const { data: releve, error } = await supabase.from('releves_compteurs').insert({
      camping_id: req.activeCampingId, emplacement_id: b.emplacement_id, type: t,
      date_releve, index_kwh, conso_kwh: conso, prestation_id: prestation?.id || null,
      note: b.note ? String(b.note).slice(0, 500) : null,
    }).select().single();
    if (error) throw error;

    await writeAudit(req, { action: 'create', entite: 'releves_compteurs', entite_id: releve.id, apres: { type: t, index_kwh, conso, prestation_id: prestation?.id || null } });
    res.status(201).json({ releve, prestation, info, alerte, unite: T.unite });
  } catch (e) { console.error('[compteurs:releve]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// PUT /api/compteurs/releve/:id/note  { note }  -> édite uniquement la note.
// Non soumis au verrou "facturé" : une note est documentaire, pas comptable.
router.put('/releve/:id/note', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const cid = req.activeCampingId;
    const note = req.body && req.body.note != null ? String(req.body.note).slice(0, 500) : null;
    const { data, error } = await supabase.from('releves_compteurs')
      .update({ note }).eq('camping_id', cid).eq('id', req.params.id).select('id,note').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Relevé introuvable' });
    await writeAudit(req, { action: 'update', entite: 'releves_compteurs', entite_id: data.id, apres: { note } });
    res.json({ ok: true, note: data.note });
  } catch (e) { console.error('[compteurs:releve-note]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// PUT /api/compteurs/releve/:id  { index_kwh?, date_releve? }  -> correction d'un relevé
// Recalcule la conso + la charge de CE relevé ET du relevé suivant (qui s'appuie sur cet index).
// Les voisins sont pris dans la même série (même fluide).
router.put('/releve/:id', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const cid = req.activeCampingId;
    const { data: releve } = await supabase.from('releves_compteurs').select('*')
      .eq('camping_id', cid).eq('id', req.params.id).maybeSingle();
    if (!releve) return res.status(404).json({ error: 'Relevé introuvable' });
    const t = typeDe(releve.type);

    const b = req.body || {};
    const newIndex = b.index_kwh != null && b.index_kwh !== '' ? Number(b.index_kwh) : Number(releve.index_kwh);
    if (!Number.isFinite(newIndex) || newIndex < 0) return res.status(400).json({ error: 'Index invalide' });
    const newDate = b.date_releve || releve.date_releve;

    // Voisins chronologiques de la même série (ordre existant conservé).
    const { data: tous } = await supabase.from('releves_compteurs')
      .select('id,date_releve,index_kwh,prestation_id,created_at,type')
      .eq('camping_id', cid).eq('emplacement_id', releve.emplacement_id).eq('type', t)
      .order('date_releve', { ascending: true }).order('created_at', { ascending: true });
    const asc = tous || [];
    const pos = asc.findIndex((x) => x.id === releve.id);
    const prev = pos > 0 ? asc[pos - 1] : null;
    const next = pos >= 0 && pos < asc.length - 1 ? asc[pos + 1] : null;

    if (prev && newIndex < Number(prev.index_kwh)) {
      return res.status(400).json({ error: `Index inférieur au relevé précédent (${prev.index_kwh}).` });
    }
    if (next && newIndex > Number(next.index_kwh)) {
      return res.status(400).json({ error: `Index supérieur au relevé suivant (${next.index_kwh}). Corrige d'abord le relevé suivant.` });
    }

    const g = await chargesModifiables(cid, [releve.prestation_id, next && next.prestation_id]);
    if (!g.ok) {
      return res.status(409).json({ error: `Impossible : une charge concernée est déjà ${g.statut === 'facturee' ? 'facturée' : g.statut}. Fais un avoir sur la facture avant de corriger ce relevé.` });
    }

    const [{ data: resident }, { data: camp }] = await Promise.all([
      supabase.from('residents').select('id').eq('camping_id', cid).eq('emplacement_id', releve.emplacement_id).eq('actif', true).limit(1).maybeSingle(),
      supabase.from('campings').select('parametres').eq('id', cid).maybeSingle(),
    ]);
    const energie = camp?.parametres?.energie || {};

    // 1) ce relevé
    const selfRow = { ...releve, index_kwh: newIndex, date_releve: newDate };
    const rSelf = await appliquerCharge(cid, energie, resident, selfRow, prev, releve.prestation_id);
    await supabase.from('releves_compteurs')
      .update({ index_kwh: newIndex, date_releve: newDate, conso_kwh: rSelf.conso, prestation_id: rSelf.prestation_id })
      .eq('camping_id', cid).eq('id', releve.id);

    // 2) le relevé suivant (son prédécesseur est désormais ce relevé corrigé)
    if (next) {
      const rNext = await appliquerCharge(cid, energie, resident, next, selfRow, next.prestation_id);
      await supabase.from('releves_compteurs')
        .update({ conso_kwh: rNext.conso, prestation_id: rNext.prestation_id })
        .eq('camping_id', cid).eq('id', next.id);
    }

    await writeAudit(req, { action: 'update', entite: 'releves_compteurs', entite_id: releve.id,
      avant: { index_kwh: releve.index_kwh, date_releve: releve.date_releve },
      apres: { index_kwh: newIndex, date_releve: newDate, conso: rSelf.conso } });
    res.json({ ok: true, conso: rSelf.conso, suivant_recalcule: !!next });
  } catch (e) { console.error('[compteurs:releve-put]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// DELETE /api/compteurs/releve/:id  -> supprime un relevé + sa charge, recale le relevé suivant
router.delete('/releve/:id', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const cid = req.activeCampingId;
    const { data: releve } = await supabase.from('releves_compteurs').select('*')
      .eq('camping_id', cid).eq('id', req.params.id).maybeSingle();
    if (!releve) return res.status(404).json({ error: 'Relevé introuvable' });
    const t = typeDe(releve.type);

    const { data: tous } = await supabase.from('releves_compteurs')
      .select('id,date_releve,index_kwh,prestation_id,created_at,type')
      .eq('camping_id', cid).eq('emplacement_id', releve.emplacement_id).eq('type', t)
      .order('date_releve', { ascending: true }).order('created_at', { ascending: true });
    const asc = tous || [];
    const pos = asc.findIndex((x) => x.id === releve.id);
    const prev = pos > 0 ? asc[pos - 1] : null;
    const next = pos >= 0 && pos < asc.length - 1 ? asc[pos + 1] : null;

    const g = await chargesModifiables(cid, [releve.prestation_id, next && next.prestation_id]);
    if (!g.ok) {
      return res.status(409).json({ error: `Impossible : une charge concernée est déjà ${g.statut === 'facturee' ? 'facturée' : g.statut}. Fais un avoir sur la facture avant de supprimer ce relevé.` });
    }

    const [{ data: resident }, { data: camp }] = await Promise.all([
      supabase.from('residents').select('id').eq('camping_id', cid).eq('emplacement_id', releve.emplacement_id).eq('actif', true).limit(1).maybeSingle(),
      supabase.from('campings').select('parametres').eq('id', cid).maybeSingle(),
    ]);
    const energie = camp?.parametres?.energie || {};

    // Supprime la charge de ce relevé puis le relevé.
    if (releve.prestation_id) await supabase.from('prestations').delete().eq('camping_id', cid).eq('id', releve.prestation_id);
    await supabase.from('releves_compteurs').delete().eq('camping_id', cid).eq('id', releve.id);

    // Recale le relevé suivant sur le prédécesseur restant (prev). Si prev == null,
    // le suivant devient le premier relevé (conso nulle, sa charge est retirée).
    if (next) {
      const rNext = await appliquerCharge(cid, energie, resident, next, prev, next.prestation_id);
      await supabase.from('releves_compteurs')
        .update({ conso_kwh: rNext.conso, prestation_id: rNext.prestation_id })
        .eq('camping_id', cid).eq('id', next.id);
    }

    await writeAudit(req, { action: 'delete', entite: 'releves_compteurs', entite_id: releve.id,
      avant: { type: t, index_kwh: releve.index_kwh, date_releve: releve.date_releve } });
    res.json({ ok: true, suivant_recalcule: !!next });
  } catch (e) { console.error('[compteurs:releve-delete]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;

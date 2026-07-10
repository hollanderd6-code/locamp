const express = require('express');
const { supabase } = require('../lib/supabase');
const { writeAudit } = require('../lib/audit');
const { auth, campingScope, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(auth, campingScope);

const EMP_FIELDS = ['numero', 'secteur', 'type', 'statut', 'loyer_base', 'periodicite',
  'coord_x', 'coord_y', 'latitude', 'longitude', 'meta'];

function pick(body, fields) {
  const out = {};
  for (const f of fields) if (body[f] !== undefined) out[f] = body[f];
  return out;
}

// GET /api/emplacements  (filtres: statut, secteur, type)
router.get('/', async (req, res) => {
  try {
    let q = supabase.from('emplacements').select('*').eq('camping_id', req.activeCampingId);
    if (req.query.statut) q = q.eq('statut', req.query.statut);
    if (req.query.secteur) q = q.eq('secteur', req.query.secteur);
    if (req.query.type) q = q.eq('type', req.query.type);
    const { data, error } = await q.order('numero');
    if (error) throw error;
    res.json({ emplacements: data });
  } catch (e) {
    console.error('[emplacements:list]', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/emplacements/carte  -> données pour la carte interactive
// (défini AVANT /:id pour éviter la collision de route)
router.get('/carte', async (req, res) => {
  try {
    const cid = req.activeCampingId;
    const [emps, ress, camp] = await Promise.all([
      supabase.from('emplacements')
        .select('id,numero,secteur,type,statut,coord_x,coord_y,latitude,longitude')
        .eq('camping_id', cid),
      supabase.from('residents')
        .select('id,nom,prenom,emplacement_id')
        .eq('camping_id', cid).not('emplacement_id', 'is', null),
      supabase.from('campings').select('parametres').eq('id', cid).maybeSingle(),
    ]);
    if (emps.error) throw emps.error;
    if (ress.error) throw ress.error;

    const byEmp = {};
    (ress.data || []).forEach((r) => {
      byEmp[r.emplacement_id] = { id: r.id, nom: r.nom, prenom: r.prenom };
    });
    const emplacements = (emps.data || []).map((e) => ({ ...e, resident: byEmp[e.id] || null }));

    res.json({
      plan: camp.data?.parametres?.plan || null,   // { mode, image_url, ... } configurable
      emplacements,
    });
  } catch (e) {
    console.error('[emplacements:carte]', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/emplacements/:id  (avec résident courant)
router.get('/:id', async (req, res) => {
  try {
    const { data: emp, error } = await supabase.from('emplacements').select('*')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!emp) return res.status(404).json({ error: 'Emplacement introuvable' });

    const { data: residents } = await supabase.from('residents')
      .select('id,nom,prenom,email,telephone,solde')
      .eq('camping_id', req.activeCampingId).eq('emplacement_id', emp.id);

    res.json({ emplacement: emp, residents: residents || [] });
  } catch (e) {
    console.error('[emplacements:get]', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/emplacements  (admin, gestionnaire)
router.post('/', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const body = pick(req.body || {}, EMP_FIELDS);
    if (!body.numero) return res.status(400).json({ error: 'numero requis' });
    body.camping_id = req.activeCampingId;

    const { data, error } = await supabase.from('emplacements').insert(body).select().single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Numéro déjà utilisé' });
      throw error;
    }
    await writeAudit(req, { action: 'create', entite: 'emplacements', entite_id: data.id, apres: data });
    res.status(201).json({ emplacement: data });
  } catch (e) {
    console.error('[emplacements:create]', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/emplacements/positions  -> enregistrement groupé des positions carte
// (défini AVANT /:id pour éviter la collision de route)
router.put('/positions', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const positions = Array.isArray(req.body?.positions) ? req.body.positions : [];
    if (!positions.length) return res.json({ updated: 0 });

    const bornX = (v) => (v == null ? null : Math.round(Math.max(0, Math.min(1000, Number(v)))));
    const bornY = (v) => (v == null ? null : Math.round(Math.max(0, Math.min(620, Number(v)))));

    let updated = 0;
    for (const p of positions) {
      if (!p || !p.id) continue;
      const patch = { coord_x: bornX(p.coord_x), coord_y: bornY(p.coord_y) };
      const { error } = await supabase.from('emplacements').update(patch)
        .eq('camping_id', req.activeCampingId).eq('id', p.id);
      if (error) throw error;
      updated += 1;
    }
    await writeAudit(req, { action: 'update', entite: 'emplacements', entite_id: null, apres: { positions_maj: updated } });
    res.json({ updated });
  } catch (e) {
    console.error('[emplacements:positions]', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/emplacements/:id  (admin, gestionnaire)
router.put('/:id', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const { data: avant } = await supabase.from('emplacements').select('*')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).maybeSingle();
    if (!avant) return res.status(404).json({ error: 'Emplacement introuvable' });

    const patch = pick(req.body || {}, EMP_FIELDS);
    const { data, error } = await supabase.from('emplacements').update(patch)
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).select().single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Numéro déjà utilisé' });
      throw error;
    }
    await writeAudit(req, { action: 'update', entite: 'emplacements', entite_id: data.id, avant, apres: data });
    res.json({ emplacement: data });
  } catch (e) {
    console.error('[emplacements:update]', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

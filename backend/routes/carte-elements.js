const express = require('express');
const { supabase } = require('../lib/supabase');
const { writeAudit } = require('../lib/audit');
const { auth, campingScope, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(auth, campingScope);

const TYPES = ['accueil', 'sanitaires', 'piscine', 'restaurant', 'laverie', 'aire_jeux',
  'local', 'parking', 'allee', 'zone', 'eau', 'arbre', 'texte', 'barriere'];

const NUM = ['x', 'y', 'largeur', 'hauteur', 'x2', 'y2', 'rotation', 'z'];

function clean(b) {
  const out = {};
  if (b.type !== undefined) out.type = b.type;
  if (b.libelle !== undefined) out.libelle = b.libelle || null;
  if (b.couleur !== undefined) out.couleur = b.couleur || null;
  for (const k of NUM) {
    if (b[k] !== undefined) out[k] = b[k] === null || b[k] === '' ? null : Number(b[k]);
  }
  return out;
}

// GET /api/carte-elements
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase.from('carte_elements').select('*')
      .eq('camping_id', req.activeCampingId).order('z').order('created_at');
    if (error) throw error;
    res.json({ elements: data || [] });
  } catch (e) {
    console.error('[carte-elements:list]', e.message);
    res.json({ elements: [], migration_manquante: true });   // table absente : la carte reste utilisable
  }
});

// POST /api/carte-elements
router.post('/', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const row = clean(req.body || {});
    if (!TYPES.includes(row.type)) return res.status(400).json({ error: 'Type invalide' });
    row.camping_id = req.activeCampingId;
    if (row.x == null) row.x = 100;
    if (row.y == null) row.y = 100;
    const { data, error } = await supabase.from('carte_elements').insert(row).select().single();
    if (error) throw error;
    await writeAudit(req, { action: 'create', entite: 'carte_elements', entite_id: data.id, apres: { type: data.type, libelle: data.libelle } });
    res.status(201).json({ element: data });
  } catch (e) { console.error('[carte-elements:create]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// PUT /api/carte-elements/batch  { elements: [{id, x, y, ...}] }  -> enregistrement groupé
router.put('/batch', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const list = Array.isArray(req.body?.elements) ? req.body.elements : [];
    let updated = 0;
    for (const el of list) {
      if (!el?.id) continue;
      const patch = clean(el);
      delete patch.type;
      const { error } = await supabase.from('carte_elements').update(patch)
        .eq('camping_id', req.activeCampingId).eq('id', el.id);
      if (error) throw error;
      updated += 1;
    }
    await writeAudit(req, { action: 'update', entite: 'carte_elements', apres: { elements_maj: updated } });
    res.json({ updated });
  } catch (e) { console.error('[carte-elements:batch]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// DELETE /api/carte-elements/:id
router.delete('/:id', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const { error } = await supabase.from('carte_elements').delete()
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id);
    if (error) throw error;
    await writeAudit(req, { action: 'delete', entite: 'carte_elements', entite_id: req.params.id });
    res.json({ ok: true });
  } catch (e) { console.error('[carte-elements:delete]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;

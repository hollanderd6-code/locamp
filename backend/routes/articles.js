const express = require('express');
const { supabase } = require('../lib/supabase');
const { writeAudit } = require('../lib/audit');
const { auth, campingScope, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(auth, campingScope);

const FIELDS = ['designation', 'prix_ht', 'taux_tva', 'unite', 'actif'];
function pick(body) {
  const out = {};
  for (const f of FIELDS) if (body[f] !== undefined) out[f] = body[f];
  return out;
}

// GET /api/articles  (?inclure_inactifs=1)
router.get('/', async (req, res) => {
  try {
    let q = supabase.from('articles').select('*').eq('camping_id', req.activeCampingId);
    if (req.query.inclure_inactifs !== '1') q = q.eq('actif', true);
    const { data, error } = await q.order('designation');
    if (error) throw error;
    res.json({ articles: data });
  } catch (e) { console.error('[articles:list]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/articles
router.post('/', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const body = pick(req.body || {});
    if (!body.designation) return res.status(400).json({ error: 'Désignation requise' });
    body.camping_id = req.activeCampingId;
    body.prix_ht = Number(body.prix_ht || 0);
    body.taux_tva = Number(body.taux_tva || 0);
    const { data, error } = await supabase.from('articles').insert(body).select().single();
    if (error) throw error;
    await writeAudit(req, { action: 'create', entite: 'articles', entite_id: data.id, apres: data });
    res.status(201).json({ article: data });
  } catch (e) { console.error('[articles:create]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// PUT /api/articles/:id
router.put('/:id', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const patch = pick(req.body || {});
    if (patch.prix_ht !== undefined) patch.prix_ht = Number(patch.prix_ht || 0);
    if (patch.taux_tva !== undefined) patch.taux_tva = Number(patch.taux_tva || 0);
    const { data, error } = await supabase.from('articles').update(patch)
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).select().single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Article introuvable' });
    await writeAudit(req, { action: 'update', entite: 'articles', entite_id: data.id, apres: data });
    res.json({ article: data });
  } catch (e) { console.error('[articles:update]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// DELETE /api/articles/:id  (désactivation logique)
router.delete('/:id', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const { error } = await supabase.from('articles').update({ actif: false })
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id);
    if (error) throw error;
    await writeAudit(req, { action: 'delete', entite: 'articles', entite_id: req.params.id });
    res.json({ ok: true });
  } catch (e) { console.error('[articles:delete]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;

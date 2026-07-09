const express = require('express');
const { supabase } = require('../lib/supabase');
const { writeAudit } = require('../lib/audit');
const { auth, campingScope, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(auth, campingScope);

const FIELDS = ['nom', 'type', 'clauses', 'reglement_interieur'];
function pick(b, f) { const o = {}; for (const k of f) if (b[k] !== undefined) o[k] = b[k]; return o; }

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase.from('contrat_modeles').select('*')
      .eq('camping_id', req.activeCampingId).order('nom');
    if (error) throw error;
    res.json({ modeles: data });
  } catch (e) { console.error('[modeles:list]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

router.post('/', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const body = pick(req.body || {}, FIELDS);
    if (!body.nom) return res.status(400).json({ error: 'nom requis' });
    body.camping_id = req.activeCampingId;
    const { data, error } = await supabase.from('contrat_modeles').insert(body).select().single();
    if (error) throw error;
    await writeAudit(req, { action: 'create', entite: 'contrat_modeles', entite_id: data.id, apres: data });
    res.status(201).json({ modele: data });
  } catch (e) { console.error('[modeles:create]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

router.put('/:id', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const { data, error } = await supabase.from('contrat_modeles').update(pick(req.body || {}, FIELDS))
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).select().single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Modèle introuvable' });
    await writeAudit(req, { action: 'update', entite: 'contrat_modeles', entite_id: data.id, apres: data });
    res.json({ modele: data });
  } catch (e) { console.error('[modeles:update]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;

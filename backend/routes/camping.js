const express = require('express');
const { supabase } = require('../lib/supabase');
const { writeAudit } = require('../lib/audit');
const { auth, campingScope, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(auth, campingScope);

// GET /api/camping  -> infos + paramètres du camping actif
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase.from('campings')
      .select('id,nom,raison_sociale,siret,tva,adresse,email,telephone,parametres')
      .eq('id', req.activeCampingId).maybeSingle();
    if (error) throw error;
    res.json({ camping: data });
  } catch (e) { console.error('[camping:get]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// PUT /api/camping/parametres  -> fusionne les paramètres (facturation, taxe_sejour, plan...)
router.put('/parametres', requireRole('admin'), async (req, res) => {
  try {
    const { data: camp } = await supabase.from('campings').select('parametres').eq('id', req.activeCampingId).maybeSingle();
    const merged = { ...(camp?.parametres || {}), ...(req.body || {}) };
    const { data, error } = await supabase.from('campings').update({ parametres: merged })
      .eq('id', req.activeCampingId).select('id,parametres').single();
    if (error) throw error;
    await writeAudit(req, { action: 'update', entite: 'campings', entite_id: req.activeCampingId, apres: { parametres: merged } });
    res.json({ camping: data });
  } catch (e) { console.error('[camping:params]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// PUT /api/camping  -> infos légales (admin)
router.put('/', requireRole('admin'), async (req, res) => {
  try {
    const patch = {};
    for (const f of ['nom', 'raison_sociale', 'siret', 'tva', 'adresse', 'email', 'telephone']) {
      if (req.body[f] !== undefined) patch[f] = req.body[f];
    }
    const { data, error } = await supabase.from('campings').update(patch)
      .eq('id', req.activeCampingId).select('id,nom,raison_sociale,siret,tva,adresse,email,telephone').single();
    if (error) throw error;
    await writeAudit(req, { action: 'update', entite: 'campings', entite_id: req.activeCampingId, apres: patch });
    res.json({ camping: data });
  } catch (e) { console.error('[camping:update]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;

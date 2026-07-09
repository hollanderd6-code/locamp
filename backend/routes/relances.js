const express = require('express');
const { supabase } = require('../lib/supabase');
const { writeAudit } = require('../lib/audit');
const { listImpayes, runRelances } = require('../lib/relances');
const { auth, campingScope, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(auth, campingScope);

// GET /api/relances/impayes  -> factures impayées + balance âgée
router.get('/impayes', async (req, res) => {
  try {
    const data = await listImpayes(req.activeCampingId);
    res.json(data);
  } catch (e) { console.error('[relances:impayes]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/relances  -> historique des relances
router.get('/', async (req, res) => {
  try {
    let q = supabase.from('relances').select('*').eq('camping_id', req.activeCampingId);
    if (req.query.facture_id) q = q.eq('facture_id', req.query.facture_id);
    const { data, error } = await q.order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ relances: data });
  } catch (e) { console.error('[relances:list]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/relances/run  -> envoie les relances des factures en retard
router.post('/run', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const result = await runRelances(req.activeCampingId);
    await writeAudit(req, { action: 'run_relances', entite: 'relances', apres: result });
    res.json(result);
  } catch (e) { console.error('[relances:run]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;

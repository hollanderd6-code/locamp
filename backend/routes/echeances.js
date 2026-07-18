const express = require('express');
const { auth, campingScope, requireRole } = require('../middleware/auth');
const echeances = require('../lib/echeances');

let writeAudit = () => {};
try { ({ writeAudit } = require('../lib/audit')); } catch (_) { /* audit optionnel */ }

const router = express.Router();
router.use(auth, campingScope);

// GET /api/echeances?horizon=90  -> assurances + contrats arrivant à échéance
router.get('/', async (req, res) => {
  try {
    const horizon = Math.min(Math.max(parseInt(req.query.horizon, 10) || 90, 7), 365);
    res.json({ echeances: await echeances.lister(req.activeCampingId, horizon) });
  } catch (e) {
    console.error('[echeances:list]', e.message);
    res.status(500).json({ error: 'Erreur serveur — la migration db/25_echeances.sql a-t-elle été exécutée ?' });
  }
});

// POST /api/echeances/rappels  -> déclenche les rappels dus maintenant (idempotent)
router.post('/rappels', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const out = await echeances.runRappels(req.activeCampingId);
    writeAudit(req, { action: 'echeances.rappels', entite: 'echeance_rappels', apres: out });
    res.json(out);
  } catch (e) { console.error('[echeances:rappels]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;

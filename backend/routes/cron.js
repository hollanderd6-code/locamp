const express = require('express');
const { supabase } = require('../lib/supabase');
const { runFacturationMensuelle, currentPeriode } = require('../lib/facturation');
const { runRelances } = require('../lib/relances');

const router = express.Router();

// Protection par secret partagé (en-tête x-cron-secret). Aucune session utilisateur.
router.use((req, res, next) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers['x-cron-secret'] !== secret) return res.status(403).json({ error: 'Interdit' });
  next();
});

async function forEachCamping(fn) {
  const { data: campings, error } = await supabase.from('campings').select('id,nom').eq('actif', true);
  if (error) throw error;
  const resultats = [];
  for (const c of (campings || [])) {
    try { resultats.push({ camping_id: c.id, nom: c.nom, ...(await fn(c.id)) }); }
    catch (e) { resultats.push({ camping_id: c.id, nom: c.nom, erreur: e.message }); }
  }
  return resultats;
}

// POST /api/cron/facturation-mensuelle  { periode? }
router.post('/facturation-mensuelle', async (req, res) => {
  try {
    const periode = (req.body && req.body.periode) || currentPeriode();
    const resultats = await forEachCamping((id) => runFacturationMensuelle(id, periode).then((r) => ({ ...r, factures: undefined })));
    res.json({ periode, campings: resultats.length, resultats });
  } catch (e) { console.error('[cron:facturation]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/cron/relances
router.post('/relances', async (req, res) => {
  try {
    const resultats = await forEachCamping((id) => runRelances(id));
    res.json({ campings: resultats.length, resultats });
  } catch (e) { console.error('[cron:relances]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;

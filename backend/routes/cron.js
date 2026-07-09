const express = require('express');
const { supabase } = require('../lib/supabase');
const { runFacturationMensuelle, currentPeriode } = require('../lib/facturation');

const router = express.Router();

// Protection par secret partagé (en-tête x-cron-secret).
// Aucune session utilisateur : ce endpoint est appelé par un Cron Job Render.
router.use((req, res, next) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers['x-cron-secret'] !== secret) {
    return res.status(403).json({ error: 'Interdit' });
  }
  next();
});

// POST /api/cron/facturation-mensuelle   { periode?: 'YYYY-MM' }
// Lance la facturation pour TOUS les campings actifs.
router.post('/facturation-mensuelle', async (req, res) => {
  try {
    const periode = (req.body && req.body.periode) || currentPeriode();
    const { data: campings, error } = await supabase.from('campings').select('id,nom').eq('actif', true);
    if (error) throw error;

    const resultats = [];
    for (const c of (campings || [])) {
      try {
        const r = await runFacturationMensuelle(c.id, periode);
        resultats.push({ camping_id: c.id, nom: c.nom, ...r, factures: undefined });
      } catch (e) {
        console.error('[cron:facturation]', c.id, e.message);
        resultats.push({ camping_id: c.id, nom: c.nom, erreur: e.message });
      }
    }
    res.json({ periode, campings: resultats.length, resultats });
  } catch (e) {
    console.error('[cron:facturation]', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

const express = require('express');
const { supabase } = require('../lib/supabase');
const { enregistrerToken } = require('../lib/push');
const { auth, campingScope } = require('../middleware/auth');

const router = express.Router();
router.use(auth, campingScope);

// POST /api/push/register  { token, platform }
// Enregistre le jeton FCM de l'appareil d'un membre du staff (app gestion).
// Idempotent : un même appareil (token) ne crée jamais de doublon.
router.post('/register', async (req, res) => {
  try {
    const { token, platform } = req.body || {};
    if (!token) return res.status(400).json({ error: 'token requis' });
    const out = await enregistrerToken({
      campingId: req.activeCampingId, canal: 'staff',
      userId: req.user.uid, token, platform, app: 'gestion',
    });
    if (out.error) throw new Error(out.error);
    res.json({ ok: true });
  } catch (e) {
    console.error('[push:register]', e.message);
    res.status(500).json({ error: 'Erreur serveur — la migration db/16_push_tokens.sql a-t-elle été exécutée ?' });
  }
});

// DELETE /api/push/register  { token }  -> à la déconnexion
router.delete('/register', async (req, res) => {
  try {
    const token = (req.body && req.body.token) || req.query.token;
    if (!token) return res.status(400).json({ error: 'token requis' });
    await supabase.from('push_tokens').delete()
      .eq('user_id', req.user.uid).eq('token', token);
    res.json({ ok: true });
  } catch (e) { console.error('[push:delete]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;

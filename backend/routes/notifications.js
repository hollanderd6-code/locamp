const express = require('express');
const { supabase } = require('../lib/supabase');
const { auth, campingScope } = require('../middleware/auth');

const router = express.Router();
router.use(auth, campingScope);

// GET /api/notifications?statut=non-lus&limit=30
//   -> notifications du staff connecté sur le camping actif
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    let q = supabase.from('notifications')
      .select('id,type,titre,corps,entite,entite_id,lien,donnees,lu,lu_at,created_at')
      .eq('camping_id', req.activeCampingId)
      .eq('destinataire_user_id', req.user.uid)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (req.query.statut === 'non-lus') q = q.eq('lu', false);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ notifications: data || [] });
  } catch (e) { console.error('[notifications:list]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/notifications/compteur  -> nombre de non-lues (badge, poll léger)
router.get('/compteur', async (req, res) => {
  try {
    const { count, error } = await supabase.from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('camping_id', req.activeCampingId)
      .eq('destinataire_user_id', req.user.uid)
      .eq('lu', false);
    if (error) throw error;
    res.json({ non_lues: count || 0 });
  } catch (e) { console.error('[notifications:compteur]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/notifications/:id/lu  -> marque une notification comme lue
router.post('/:id/lu', async (req, res) => {
  try {
    const { data, error } = await supabase.from('notifications')
      .update({ lu: true, lu_at: new Date().toISOString() })
      .eq('camping_id', req.activeCampingId)
      .eq('destinataire_user_id', req.user.uid)
      .eq('id', req.params.id)
      .select('id').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Notification introuvable' });
    res.json({ ok: true });
  } catch (e) { console.error('[notifications:lu]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/notifications/tout-lu  -> marque tout comme lu
router.post('/tout-lu', async (req, res) => {
  try {
    const { error } = await supabase.from('notifications')
      .update({ lu: true, lu_at: new Date().toISOString() })
      .eq('camping_id', req.activeCampingId)
      .eq('destinataire_user_id', req.user.uid)
      .eq('lu', false);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { console.error('[notifications:tout-lu]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;

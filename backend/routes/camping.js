const express = require('express');
const multer = require('multer');
const { supabase } = require('../lib/supabase');
const { writeAudit } = require('../lib/audit');
const { signedUrl, BUCKET } = require('../lib/storage');
const { auth, campingScope, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(auth, campingScope);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 } });

// GET /api/camping  -> infos + paramètres du camping actif
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase.from('campings')
      .select('id,nom,raison_sociale,siret,tva,adresse,email,telephone,parametres,logo_path')
      .eq('id', req.activeCampingId).maybeSingle();
    if (error) throw error;
    res.json({ camping: data });
  } catch (e) { console.error('[camping:get]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/camping/logo  -> URL signée du logo (aperçu)
router.get('/logo', async (req, res) => {
  try {
    const { data } = await supabase.from('campings').select('logo_path').eq('id', req.activeCampingId).maybeSingle();
    if (!data?.logo_path) return res.json({ url: null });
    res.json({ url: await signedUrl(data.logo_path, 300) });
  } catch (e) { console.error('[camping:logo:get]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/camping/logo  (image, admin)
router.post('/logo', requireRole('admin'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Fichier manquant (champ "file")' });
    if (!/^image\//.test(req.file.mimetype)) return res.status(400).json({ error: 'Image requise (PNG ou JPG)' });
    const ext = (req.file.originalname.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    const path = `logos/${req.activeCampingId}.${ext}`;
    const { error: upErr } = await supabase.storage.from(BUCKET)
      .upload(path, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
    if (upErr) throw upErr;
    await supabase.from('campings').update({ logo_path: path }).eq('id', req.activeCampingId);
    await writeAudit(req, { action: 'update', entite: 'campings', entite_id: req.activeCampingId, apres: { logo_path: path } });
    res.json({ ok: true, logo_path: path, url: await signedUrl(path, 300) });
  } catch (e) { console.error('[camping:logo]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
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

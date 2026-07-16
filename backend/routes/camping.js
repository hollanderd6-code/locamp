const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const { supabase } = require('../lib/supabase');
const { writeAudit } = require('../lib/audit');
const { signedUrl, BUCKET } = require('../lib/storage');
const { canEmbedImage } = require('../lib/pdf');
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

// POST /api/camping/logo  (image, admin) — normalisée en PNG propre pour le PDF
router.post('/logo', requireRole('admin'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Fichier manquant (champ "file")' });
    let png;
    try {
      png = await sharp(req.file.buffer)
        .resize({ width: 600, height: 300, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .png()
        .toBuffer();
    } catch (_) {
      return res.status(400).json({ error: 'Image illisible. Utilise un PNG ou un JPEG.' });
    }
    if (!canEmbedImage(png)) return res.status(400).json({ error: 'Image non exploitable sur les factures.' });
    const path = `logos/${req.activeCampingId}.png`;
    const { error: upErr } = await supabase.storage.from(BUCKET)
      .upload(path, png, { contentType: 'image/png', upsert: true });
    if (upErr) throw upErr;
    await supabase.from('campings').update({ logo_path: path }).eq('id', req.activeCampingId);
    await writeAudit(req, { action: 'update', entite: 'campings', entite_id: req.activeCampingId, apres: { logo_path: path } });
    res.json({ ok: true, logo_path: path, url: await signedUrl(path, 300) });
  } catch (e) { console.error('[camping:logo]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// ---- Plan de fond de la carte (scan du plan papier du camping) ----
// Stocké dans parametres.carte_fond = { path, w, h, opacite }. Pas de migration.
// GET -> URL signée + opacité ; POST -> upload ; PUT -> opacité ; DELETE -> retrait.
router.get('/carte-fond', async (req, res) => {
  try {
    const { data } = await supabase.from('campings').select('parametres').eq('id', req.activeCampingId).maybeSingle();
    const f = (data?.parametres || {}).carte_fond || null;
    if (!f?.path) return res.json({ url: null, opacite: null });
    res.json({ url: await signedUrl(f.path, 3600), opacite: f.opacite ?? 0.6, w: f.w || null, h: f.h || null });
  } catch (e) { console.error('[camping:carte-fond:get]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

router.post('/carte-fond', requireRole('admin', 'gestionnaire'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Fichier manquant (champ "file")' });
    let img; let meta;
    try {
      const s = sharp(req.file.buffer).rotate();               // respecte l'orientation EXIF des scans photo
      meta = await s.metadata();
      img = await s.resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' }).jpeg({ quality: 82 }).toBuffer();
    } catch (_) {
      return res.status(400).json({ error: 'Image illisible. Utilise un PNG ou un JPEG.' });
    }
    const path = `plans/${req.activeCampingId}.jpg`;
    const { error: upErr } = await supabase.storage.from(BUCKET)
      .upload(path, img, { contentType: 'image/jpeg', upsert: true });
    if (upErr) throw upErr;
    const { data: c } = await supabase.from('campings').select('parametres').eq('id', req.activeCampingId).maybeSingle();
    const parametres = { ...(c?.parametres || {}) };
    const opacite = parametres.carte_fond?.opacite ?? 0.6;
    parametres.carte_fond = { path, w: meta?.width || null, h: meta?.height || null, opacite };
    await supabase.from('campings').update({ parametres }).eq('id', req.activeCampingId);
    await writeAudit(req, { action: 'update', entite: 'campings', entite_id: req.activeCampingId, apres: { carte_fond: path } });
    res.json({ ok: true, url: await signedUrl(path, 3600), opacite });
  } catch (e) { console.error('[camping:carte-fond]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

router.put('/carte-fond', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const op = Math.max(0.1, Math.min(1, Number(req.body?.opacite)));
    if (!Number.isFinite(op)) return res.status(400).json({ error: 'opacite invalide' });
    const { data: c } = await supabase.from('campings').select('parametres').eq('id', req.activeCampingId).maybeSingle();
    const parametres = { ...(c?.parametres || {}) };
    if (!parametres.carte_fond?.path) return res.status(404).json({ error: 'Aucun plan de fond' });
    parametres.carte_fond = { ...parametres.carte_fond, opacite: op };
    await supabase.from('campings').update({ parametres }).eq('id', req.activeCampingId);
    res.json({ ok: true, opacite: op });
  } catch (e) { console.error('[camping:carte-fond:put]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

router.delete('/carte-fond', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const { data: c } = await supabase.from('campings').select('parametres').eq('id', req.activeCampingId).maybeSingle();
    const parametres = { ...(c?.parametres || {}) };
    const path = parametres.carte_fond?.path;
    if (path) { try { await supabase.storage.from(BUCKET).remove([path]); } catch (_) { /* best effort */ } }
    delete parametres.carte_fond;
    await supabase.from('campings').update({ parametres }).eq('id', req.activeCampingId);
    await writeAudit(req, { action: 'update', entite: 'campings', entite_id: req.activeCampingId, apres: { carte_fond: null } });
    res.json({ ok: true });
  } catch (e) { console.error('[camping:carte-fond:del]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/camping  -> crée un nouvel espace camping ; le créateur en devient admin.
// Volontairement hors requireRole : il s'agit de créer un camping, pas d'agir sur l'actif.
router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    const nom = String(b.nom || '').trim();
    if (!nom) return res.status(400).json({ error: 'Nom du camping requis' });

    const row = {
      nom,
      raison_sociale: b.raison_sociale || null,
      siret: b.siret || null,
      tva: b.tva || null,
      adresse: b.adresse || null,
      email: b.email || null,
      telephone: b.telephone || null,
      parametres: {},
    };
    const { data: camping, error } = await supabase.from('campings').insert(row).select().single();
    if (error) throw error;

    const { error: linkErr } = await supabase.from('user_campings')
      .insert({ user_id: req.user.uid, camping_id: camping.id, role: 'admin' });
    if (linkErr) {
      await supabase.from('campings').delete().eq('id', camping.id);   // pas d'espace orphelin
      throw linkErr;
    }

    await writeAudit(req, { action: 'create', entite: 'campings', entite_id: camping.id, apres: { nom } });
    res.status(201).json({ camping });
  } catch (e) { console.error('[camping:create]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
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

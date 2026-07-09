const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { writeAudit } = require('../lib/audit');
const { uploadDocument, signedUrl, removeDocument } = require('../lib/storage');
const { auth, campingScope, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(auth, campingScope);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 Mo
});

function safeName(name = 'fichier') {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

// POST /api/documents  (multipart: file + resident_id, type, date_expiration?, emplacement_id?)
router.post('/', requireRole('admin', 'gestionnaire'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Fichier manquant (champ "file")' });
    const { resident_id, type, date_expiration, emplacement_id } = req.body || {};
    if (!resident_id) return res.status(400).json({ error: 'resident_id requis' });

    // vérifie que le résident appartient bien au camping actif
    const { data: resident } = await supabase.from('residents').select('id')
      .eq('camping_id', req.activeCampingId).eq('id', resident_id).maybeSingle();
    if (!resident) return res.status(404).json({ error: 'Résident introuvable' });

    const fname = safeName(req.file.originalname);
    const path = `${req.activeCampingId}/${resident_id}/${crypto.randomUUID()}_${fname}`;
    await uploadDocument(path, req.file.buffer, req.file.mimetype);

    const { data, error } = await supabase.from('documents').insert({
      camping_id: req.activeCampingId,
      resident_id,
      emplacement_id: emplacement_id || null,
      type: type || null,
      nom_fichier: req.file.originalname,
      storage_path: path,
      taille: req.file.size,
      mime: req.file.mimetype,
      date_expiration: date_expiration || null,
      auteur_id: req.user.uid,
    }).select('id,type,nom_fichier,taille,mime,date_expiration,created_at').single();
    if (error) {
      await removeDocument(path).catch(() => {}); // rollback fichier si insert échoue
      throw error;
    }

    await writeAudit(req, { action: 'create', entite: 'documents', entite_id: data.id,
      apres: { type: data.type, nom_fichier: data.nom_fichier, resident_id } });
    res.status(201).json({ document: data });
  } catch (e) {
    console.error('[documents:create]', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/documents?resident_id=...  (métadonnées uniquement)
router.get('/', async (req, res) => {
  try {
    let q = supabase.from('documents')
      .select('id,type,nom_fichier,taille,mime,date_expiration,resident_id,created_at')
      .eq('camping_id', req.activeCampingId);
    if (req.query.resident_id) q = q.eq('resident_id', req.query.resident_id);
    const { data, error } = await q.order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ documents: data });
  } catch (e) {
    console.error('[documents:list]', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/documents/:id/url  -> lien signé temporaire (accès journalisé)
router.get('/:id/url', async (req, res) => {
  try {
    const { data: doc } = await supabase.from('documents').select('id,storage_path,nom_fichier')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).maybeSingle();
    if (!doc) return res.status(404).json({ error: 'Document introuvable' });

    const url = await signedUrl(doc.storage_path, 120);
    await writeAudit(req, { action: 'access', entite: 'documents', entite_id: doc.id,
      apres: { nom_fichier: doc.nom_fichier } });
    res.json({ url, expires_in: 120 });
  } catch (e) {
    console.error('[documents:url]', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/documents/:id  (admin, gestionnaire)
router.delete('/:id', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const { data: doc } = await supabase.from('documents').select('*')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).maybeSingle();
    if (!doc) return res.status(404).json({ error: 'Document introuvable' });

    await removeDocument(doc.storage_path).catch((e) => console.error('[storage remove]', e.message));
    const { error } = await supabase.from('documents').delete()
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id);
    if (error) throw error;

    await writeAudit(req, { action: 'delete', entite: 'documents', entite_id: doc.id,
      avant: { type: doc.type, nom_fichier: doc.nom_fichier } });
    res.json({ ok: true });
  } catch (e) {
    console.error('[documents:delete]', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

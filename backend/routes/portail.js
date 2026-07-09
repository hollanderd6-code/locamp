const express = require('express');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { sendEmail } = require('../lib/email');
const { checkoutFacture } = require('../lib/stripe');
const { uploadDocument, signedUrl } = require('../lib/storage');
const { authResident } = require('../middleware/auth');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// Journalisation légère des actions du portail (le résident n'est pas un utilisateur staff).
async function auditPortail(req, resident, action, extra = {}) {
  try {
    await supabase.from('audit_log').insert({
      camping_id: resident.camping_id, auteur_id: null, auteur_email: resident.email,
      action, entite: extra.entite || 'portail', entite_id: extra.entite_id || null, apres: extra.apres || null,
      ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || null,
    });
  } catch (e) { console.error('[portail audit]', e.message); }
}

// ---------- Demande d'accès (lien magique) ----------
// POST /api/portail/demande-acces { email }
router.post('/demande-acces', async (req, res) => {
  try {
    const email = (req.body?.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'email requis' });

    const { data: resident } = await supabase.from('residents')
      .select('id,camping_id,nom,prenom,email').eq('email', email).eq('actif', true).maybeSingle();

    // Réponse générique (pas d'énumération d'emails)
    const generic = { ok: true, message: 'Si un compte existe, un e-mail de connexion a été envoyé.' };

    if (resident) {
      const magic = jwt.sign({ typ: 'resident-magic', rid: resident.id, cid: resident.camping_id, email: resident.email },
        JWT_SECRET, { expiresIn: '30m' });
      const base = process.env.PUBLIC_APP_URL || `https://${req.headers.host}`;
      const lien = `${base}/portail/connexion?token=${magic}`;
      const html = `<p>Bonjour ${resident.prenom || ''},</p>`
        + `<p>Voici votre lien de connexion à votre espace locataire (valable 30 minutes) :</p>`
        + `<p><a href="${lien}">Accéder à mon espace</a></p>`;
      const out = await sendEmail({ to: resident.email, subject: 'Votre accès à l\u2019espace locataire', html });
      await auditPortail(req, { camping_id: resident.camping_id, email: resident.email }, 'portail_demande_acces');
      // Aide au test si e-mail non configuré et mode dev activé
      if (process.env.PORTAIL_DEV === 'true' && out.skipped) return res.json({ ...generic, dev_token: magic, dev_lien: lien });
    }
    res.json(generic);
  } catch (e) { console.error('[portail:demande]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// ---------- Échange du lien magique contre une session ----------
// POST /api/portail/session { token }
router.post('/session', async (req, res) => {
  try {
    const token = req.body?.token;
    if (!token) return res.status(400).json({ error: 'token requis' });
    let p;
    try { p = jwt.verify(token, JWT_SECRET); } catch { return res.status(401).json({ error: 'Lien invalide ou expiré' }); }
    if (p.typ !== 'resident-magic') return res.status(401).json({ error: 'Lien invalide' });

    const { data: resident } = await supabase.from('residents')
      .select('id,camping_id,nom,prenom,email').eq('id', p.rid).eq('actif', true).maybeSingle();
    if (!resident) return res.status(401).json({ error: 'Compte introuvable' });

    const session = jwt.sign({ typ: 'resident', rid: resident.id, cid: resident.camping_id, email: resident.email },
      JWT_SECRET, { expiresIn: '7d' });
    await auditPortail(req, resident, 'portail_connexion');
    res.json({ token: session, resident: { id: resident.id, nom: resident.nom, prenom: resident.prenom, email: resident.email } });
  } catch (e) { console.error('[portail:session]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// ===== À partir d'ici : routes protégées par session résident =====
router.use(authResident);

// GET /api/portail/moi
router.get('/moi', async (req, res) => {
  try {
    const { data: resident } = await supabase.from('residents')
      .select('id,civilite,nom,prenom,email,telephone,adresse,emplacement_id,solde')
      .eq('id', req.resident.id).eq('camping_id', req.resident.camping_id).maybeSingle();
    if (!resident) return res.status(404).json({ error: 'Introuvable' });
    let emplacement = null;
    if (resident.emplacement_id) {
      const { data } = await supabase.from('emplacements').select('numero,secteur,type').eq('id', resident.emplacement_id).maybeSingle();
      emplacement = data || null;
    }
    res.json({ resident, emplacement });
  } catch (e) { console.error('[portail:moi]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/portail/factures
router.get('/factures', async (req, res) => {
  try {
    const { data, error } = await supabase.from('factures')
      .select('id,numero,periode,date_emission,total_ttc,montant_regle,statut')
      .eq('camping_id', req.resident.camping_id).eq('resident_id', req.resident.id)
      .order('date_emission', { ascending: false });
    if (error) throw error;
    const factures = (data || []).map((f) => ({ ...f, reste: Math.round((Number(f.total_ttc) - Number(f.montant_regle)) * 100) / 100 }));
    res.json({ factures });
  } catch (e) { console.error('[portail:factures]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/portail/factures/:id/pdf
router.get('/factures/:id/pdf', async (req, res) => {
  try {
    const { data: f } = await supabase.from('factures').select('id,pdf_path,numero')
      .eq('camping_id', req.resident.camping_id).eq('resident_id', req.resident.id).eq('id', req.params.id).maybeSingle();
    if (!f || !f.pdf_path) return res.status(404).json({ error: 'Facture introuvable' });
    const url = await signedUrl(f.pdf_path, 120);
    res.json({ url, expires_in: 120 });
  } catch (e) { console.error('[portail:facture-pdf]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/portail/factures/:id/payer  -> lien Stripe
router.post('/factures/:id/payer', async (req, res) => {
  try {
    const { data: f } = await supabase.from('factures').select('*')
      .eq('camping_id', req.resident.camping_id).eq('resident_id', req.resident.id).eq('id', req.params.id).maybeSingle();
    if (!f) return res.status(404).json({ error: 'Facture introuvable' });
    const base = process.env.PUBLIC_APP_URL || `https://${req.headers.host}`;
    const out = await checkoutFacture(f, req.resident.camping_id, base);
    if (!out) return res.status(400).json({ error: 'Paiement en ligne non disponible' });
    if (out.error) return res.status(400).json({ error: out.error });
    await auditPortail(req, req.resident, 'portail_paiement', { entite: 'factures', entite_id: f.id, apres: { numero: f.numero } });
    res.json({ url: out.url });
  } catch (e) { console.error('[portail:payer]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/portail/documents
router.get('/documents', async (req, res) => {
  try {
    const { data, error } = await supabase.from('documents')
      .select('id,type,nom_fichier,date_expiration,created_at')
      .eq('camping_id', req.resident.camping_id).eq('resident_id', req.resident.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ documents: data });
  } catch (e) { console.error('[portail:documents]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/portail/documents/:id/url
router.get('/documents/:id/url', async (req, res) => {
  try {
    const { data: doc } = await supabase.from('documents').select('id,storage_path')
      .eq('camping_id', req.resident.camping_id).eq('resident_id', req.resident.id).eq('id', req.params.id).maybeSingle();
    if (!doc) return res.status(404).json({ error: 'Document introuvable' });
    const url = await signedUrl(doc.storage_path, 120);
    res.json({ url, expires_in: 120 });
  } catch (e) { console.error('[portail:doc-url]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/portail/documents  (multipart: file + type) -> le résident dépose un document
router.post('/documents', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Fichier manquant (champ "file")' });
    const type = req.body?.type || 'depot_locataire';
    const fname = (req.file.originalname || 'fichier').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
    const path = `portail/${req.resident.camping_id}/${req.resident.id}/${crypto.randomUUID()}_${fname}`;
    await uploadDocument(path, req.file.buffer, req.file.mimetype);
    const { data, error } = await supabase.from('documents').insert({
      camping_id: req.resident.camping_id, resident_id: req.resident.id, type,
      nom_fichier: req.file.originalname, storage_path: path, taille: req.file.size, mime: req.file.mimetype,
    }).select('id,type,nom_fichier,created_at').single();
    if (error) throw error;
    await auditPortail(req, req.resident, 'portail_depot_document', { entite: 'documents', entite_id: data.id });
    res.status(201).json({ document: data });
  } catch (e) { console.error('[portail:doc-upload]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;

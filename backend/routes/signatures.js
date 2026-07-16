const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const { supabase } = require('../lib/supabase');
const { writeAudit } = require('../lib/audit');
const { sendEmail } = require('../lib/email');
const { uploadDocument, signedUrl } = require('../lib/storage');
const { sha256, nbPages, normaliserChamps, signerDocument, envoyerOtp, tracer, CONSENTEMENT } = require('../lib/signature');
const { auth, campingScope, requirePerm } = require('../middleware/auth');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

// Adresse IP réelle derrière le proxy Render
const ipDe = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  || req.ip || req.socket?.remoteAddress || 'inconnue';

/* =====================  PARTIE PUBLIQUE (signataire)  ===================== */
/* Placée AVANT les middlewares d'authentification admin : le signataire n'a
   pas de compte, il arrive par un lien à usage unique.                       */

// GET /api/signatures/signer/:jeton  -> le document à signer
router.get('/signer/:jeton', async (req, res) => {
  try {
    const { data: doc } = await supabase.from('documents_signature').select('*')
      .eq('jeton', req.params.jeton).maybeSingle();
    if (!doc) return res.status(404).json({ error: 'Lien invalide' });
    if (doc.statut === 'signe') return res.status(409).json({ error: 'Ce document est déjà signé', deja: true });
    if (doc.statut === 'annule') return res.status(409).json({ error: 'Ce document a été annulé' });
    if (doc.jeton_expire && new Date(doc.jeton_expire) < new Date()) {
      return res.status(410).json({ error: 'Ce lien a expiré. Demandez-en un nouveau au camping.' });
    }

    const [{ data: resident }, { data: camping }] = await Promise.all([
      doc.resident_id
        ? supabase.from('residents').select('nom,prenom,civilite,email,telephone').eq('id', doc.resident_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from('campings').select('nom,raison_sociale').eq('id', doc.camping_id).maybeSingle(),
    ]);

    // Piste d'audit : connexion à la page de signature puis affichage du document.
    await tracer(doc.id, "Connexion à la page d'action", { ip: ipDe(req), detail: req.headers['user-agent'] || null });
    await tracer(doc.id, 'Affichage du document', { ip: ipDe(req), detail: `SHA-256 : ${doc.hash_original}` });
    const url = await signedUrl(doc.storage_path, 1800);

    res.json({
      titre: doc.titre,
      message: doc.message,
      champs: doc.champs,
      nb_pages: doc.nb_pages,
      url,
      consentement: CONSENTEMENT,
      signataire: resident ? `${resident.prenom || ''} ${resident.nom}`.trim() : null,
      camping: camping?.nom || camping?.raison_sociale || 'Le camping',
      otp_requis: !!(resident && resident.telephone),   // identification par SMS si un portable est connu
      otp_valide: !!doc.otp_valide_at,
    });
  } catch (e) { console.error('[sign:get]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/signatures/signer/:jeton/otp  -> envoie un code à 6 chiffres par SMS
router.post('/signer/:jeton/otp', async (req, res) => {
  try {
    const out = await envoyerOtp({ jeton: req.params.jeton, ip: ipDe(req) });
    if (out.error) return res.status(out.code || 400).json({ error: out.error });
    res.json(out);
  } catch (e) { console.error('[sign:otp]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/signatures/signer/:jeton  -> signature via le lien reçu par e-mail
router.post('/signer/:jeton', async (req, res) => {
  try {
    const out = await signerDocument({
      jeton: req.params.jeton,
      corps: req.body || {},
      ip: ipDe(req),
      userAgent: req.headers['user-agent'] || null,
      canal: 'lien_email',
    });
    if (out.error) return res.status(out.code || 400).json({ error: out.error });
    res.json({ ok: true, message: out.message });
  } catch (e) { console.error('[sign:post]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

/* =====================  PARTIE ADMIN  ===================== */
router.use(auth, campingScope);

// GET /api/signatures  -> liste
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase.from('documents_signature')
      .select('id,titre,statut,resident_id,nb_pages,date_envoi,date_signature,created_at,champs')
      .eq('camping_id', req.activeCampingId).order('created_at', { ascending: false }).limit(100);
    if (error) throw error;

    const ids = [...new Set((data || []).map((d) => d.resident_id).filter(Boolean))];
    const rmap = {};
    if (ids.length) {
      const { data: rs } = await supabase.from('residents').select('id,nom,prenom').in('id', ids);
      (rs || []).forEach((r) => { rmap[r.id] = `${r.prenom || ''} ${r.nom}`.trim(); });
    }
    res.json({ documents: (data || []).map((d) => ({ ...d, resident_nom: rmap[d.resident_id] || null })) });
  } catch (e) {
    console.error('[sign:list]', e.message);
    res.status(500).json({ error: 'Signature indisponible — la migration db/19_signature.sql a-t-elle été exécutée ?' });
  }
});

// POST /api/signatures  (dépôt du PDF)
router.post('/', requirePerm('gerer_residents'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Document PDF requis' });
    if (req.file.mimetype !== 'application/pdf') return res.status(400).json({ error: 'Le document doit être un PDF' });
    const titre = String(req.body.titre || req.file.originalname || 'Document').slice(0, 160);

    const id = crypto.randomUUID();
    const path = `signatures/${req.activeCampingId}/${id}.pdf`;
    await uploadDocument(path, req.file.buffer, 'application/pdf');

    const { data, error } = await supabase.from('documents_signature').insert({
      id,
      camping_id: req.activeCampingId,
      resident_id: req.body.resident_id || null,
      titre,
      message: req.body.message || null,
      storage_path: path,
      hash_original: sha256(req.file.buffer),
      nb_pages: await nbPages(req.file.buffer),
      champs: [],
      statut: 'brouillon',
      auteur_id: req.user.uid,
    }).select().single();
    if (error) throw error;

    await tracer(data.id, 'Transaction créée', { ip: ipDe(req), detail: `${req.user.email || ''} — ${titre}` });
    await writeAudit(req, { action: 'create', entite: 'documents_signature', entite_id: data.id,
      apres: { titre, hash: data.hash_original } });
    res.status(201).json({ document: data });
  } catch (e) { console.error('[sign:create]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/signatures/:id  -> détail + URL du PDF (pour l'éditeur de zones)
router.get('/:id', async (req, res) => {
  try {
    const { data: doc } = await supabase.from('documents_signature').select('*')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).maybeSingle();
    if (!doc) return res.status(404).json({ error: 'Document introuvable' });

    const url = await signedUrl(doc.storage_signe || doc.storage_path, 1800);
    const { data: preuve } = await supabase.from('signatures_preuves').select('*')
      .eq('document_id', doc.id).maybeSingle();

    res.json({ document: doc, url, preuve: preuve || null, consentement: CONSENTEMENT });
  } catch (e) { console.error('[sign:detail]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// PUT /api/signatures/:id/champs  { champs: [...] }
router.put('/:id/champs', requirePerm('gerer_residents'), async (req, res) => {
  try {
    const { data: doc } = await supabase.from('documents_signature').select('id,statut')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).maybeSingle();
    if (!doc) return res.status(404).json({ error: 'Document introuvable' });
    if (doc.statut === 'signe') return res.status(409).json({ error: 'Document déjà signé — non modifiable' });

    const champs = normaliserChamps(req.body?.champs);
    const { error } = await supabase.from('documents_signature').update({ champs })
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true, champs });
  } catch (e) { console.error('[sign:champs]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/signatures/:id/envoyer
router.post('/:id/envoyer', requirePerm('gerer_residents'), async (req, res) => {
  try {
    const { data: doc } = await supabase.from('documents_signature').select('*')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).maybeSingle();
    if (!doc) return res.status(404).json({ error: 'Document introuvable' });
    if (doc.statut === 'signe') return res.status(409).json({ error: 'Document déjà signé' });
    if (doc.statut === 'annule') return res.status(409).json({ error: 'Document annulé — il ne peut plus être envoyé' });
    if (!doc.resident_id) return res.status(400).json({ error: 'Aucun signataire désigné' });
    if (!(doc.champs || []).length) return res.status(400).json({ error: 'Place au moins une zone de signature' });

    const { data: resident } = await supabase.from('residents').select('nom,prenom,email')
      .eq('id', doc.resident_id).maybeSingle();
    if (!resident?.email) return res.status(400).json({ error: 'Le signataire n\u2019a pas d\u2019adresse e-mail' });

    const jeton = crypto.randomBytes(32).toString('hex');
    const expire = new Date(Date.now() + 30 * 86400000).toISOString();   // 30 jours

    await supabase.from('documents_signature').update({
      statut: 'envoye', jeton, jeton_expire: expire, date_envoi: new Date().toISOString(),
    }).eq('id', doc.id);

    const { data: camping } = await supabase.from('campings').select('nom,raison_sociale')
      .eq('id', req.activeCampingId).maybeSingle();
    const nomCamping = camping?.nom || camping?.raison_sociale || 'Votre camping';
    // URL de base : sans slash final. Fallback sur l'hôte de la requête si la
    // variable n'est pas définie (un lien RELATIF forcerait Brevo à le réécrire).
    const base = (process.env.PUBLIC_APP_URL
      || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const lien = `${base}/signature/?jeton=${jeton}`;

    await sendEmail({
      to: resident.email,
      subject: `Document à signer — ${doc.titre}`,
      html: `<p>Bonjour ${resident.prenom || ''},</p>`
        + `<p>${nomCamping} vous invite à signer électroniquement le document suivant :</p>`
        + `<p><b>${doc.titre}</b></p>`
        + (doc.message ? `<p>${String(doc.message).replace(/</g, '&lt;')}</p>` : '')
        + `<p><a href="${lien}" style="display:inline-block;padding:12px 22px;background:#175243;color:#fff;`
        + `border-radius:8px;text-decoration:none;font-weight:600">Lire et signer le document</a></p>`
        + `<p style="font-size:13px;color:#444;margin-top:14px">Si le bouton ne fonctionne pas, copiez-collez ce lien dans votre navigateur :<br>`
        + `<span style="font-size:12px;color:#175243;word-break:break-all">${lien}</span></p>`
        + `<p style="font-size:12px;color:#666">Ce lien vous est personnel et expire dans 30 jours. `
        + `La signature électronique a la même valeur qu\u2019une signature manuscrite (règlement eIDAS).</p>`,
    });

    await tracer(doc.id, "Envoi de l'invitation", { ip: ipDe(req), detail: `à ${resident.email} par email` });
    await writeAudit(req, { action: 'email', entite: 'documents_signature', entite_id: doc.id,
      apres: { envoye_a: resident.email } });

    res.json({ ok: true, envoye_a: resident.email });
  } catch (e) { console.error('[sign:envoyer]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// DELETE /api/signatures/:id  (annulation ; le dossier de preuve est conservé)
router.delete('/:id', requirePerm('gerer_residents'), async (req, res) => {
  try {
    const { data: doc } = await supabase.from('documents_signature').select('id,statut')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).maybeSingle();
    if (!doc) return res.status(404).json({ error: 'Document introuvable' });
    if (doc.statut === 'signe') {
      return res.status(409).json({ error: 'Un document signé ne peut pas être supprimé (valeur probante)' });
    }
    await supabase.from('documents_signature').update({ statut: 'annule', jeton: null })
      .eq('id', doc.id);
    await writeAudit(req, { action: 'delete', entite: 'documents_signature', entite_id: doc.id });
    res.json({ ok: true });
  } catch (e) { console.error('[sign:delete]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;

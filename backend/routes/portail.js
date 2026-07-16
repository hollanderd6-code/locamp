const express = require('express');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { sendEmail } = require('../lib/email');
const { checkoutFacture } = require('../lib/stripe');
const { genererPdfFacture } = require('../lib/facturation');
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
      const lien = `${base}/portail/?token=${magic}`;
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
/* ============ AUTHENTIFICATION (routes publiques) ============ */
const pauth = require('../lib/portail-auth');

// GET /api/portail/activation/:jeton  -> vérifie le lien avant d'afficher le formulaire
router.get('/activation/:jeton', async (req, res) => {
  try {
    const out = await pauth.verifierActivation(req.params.jeton);
    if (out.error) return res.status(400).json({ error: out.error });
    res.json(out);
  } catch (e) { console.error('[portail:activation]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/portail/activation  { jeton, mot_de_passe }
// Le clic sur le lien reçu par e-mail VAUT vérification de l'adresse.
router.post('/activation', async (req, res) => {
  try {
    const out = await pauth.activerCompte(req.body?.jeton, req.body?.mot_de_passe);
    if (out.error) return res.status(out.code || 400).json({ error: out.error });
    res.json({ token: out.token, message: 'Espace activé. Bienvenue !' });
  } catch (e) { console.error('[portail:activer]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/portail/connexion  { email, mot_de_passe }
router.post('/connexion', async (req, res) => {
  try {
    const out = await pauth.connexion(req.body?.email, req.body?.mot_de_passe);
    if (out.error) return res.status(out.code || 401).json({ error: out.error, non_active: out.non_active });
    await auditPortail(req, { email: (req.body?.email || '').toLowerCase() }, 'portail_connexion');
    res.json({ token: out.token });
  } catch (e) { console.error('[portail:connexion]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/portail/mdp-oublie  { email }
router.post('/mdp-oublie', async (req, res) => {
  try {
    const out = await pauth.demanderReset(req.body?.email);
    res.json(out);
  } catch (e) { console.error('[portail:oubli]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/portail/mdp-reinit  { jeton, mot_de_passe }
router.post('/mdp-reinit', async (req, res) => {
  try {
    const out = await pauth.reinitialiser(req.body?.jeton, req.body?.mot_de_passe);
    if (out.error) return res.status(out.code || 400).json({ error: out.error });
    res.json({ token: out.token, message: 'Mot de passe modifié.' });
  } catch (e) { console.error('[portail:reinit]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

router.use(authResident);

// GET /api/portail/moi
router.get('/moi', async (req, res) => {
  try {
    const [{ data: resident }, { data: camping }] = await Promise.all([
      supabase.from('residents')
        .select('id,civilite,nom,prenom,email,telephone,adresse,emplacement_id,solde')
        .eq('id', req.resident.id).eq('camping_id', req.resident.camping_id).maybeSingle(),
      supabase.from('campings').select('nom,raison_sociale,parametres').eq('id', req.resident.camping_id).maybeSingle(),
    ]);
    if (!resident) return res.status(404).json({ error: 'Introuvable' });
    let emplacement = null;
    if (resident.emplacement_id) {
      const { data } = await supabase.from('emplacements').select('numero,secteur,type').eq('id', resident.emplacement_id).maybeSingle();
      emplacement = data || null;
    }
    res.json({
      resident, emplacement,
      camping: { nom: camping?.nom || camping?.raison_sociale || 'Votre camping' },
      paiement_en_ligne: !!process.env.STRIPE_SECRET_KEY,
      delai_paiement: Number(camping?.parametres?.facturation?.delai_paiement ?? 30),
    });
  } catch (e) { console.error('[portail:moi]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/portail/factures
router.get('/factures', async (req, res) => {
  try {
    const [{ data, error }, { data: camping }] = await Promise.all([
      supabase.from('factures')
        .select('id,numero,periode,date_emission,total_ttc,montant_regle,statut')
        .eq('camping_id', req.resident.camping_id).eq('resident_id', req.resident.id)
        .order('date_emission', { ascending: false }),
      supabase.from('campings').select('parametres').eq('id', req.resident.camping_id).maybeSingle(),
    ]);
    if (error) throw error;
    const delai = Number(camping?.parametres?.facturation?.delai_paiement ?? 30);
    const today = new Date();
    const factures = (data || []).map((f) => {
      const reste = Math.round((Number(f.total_ttc) - Number(f.montant_regle)) * 100) / 100;
      let date_echeance = null, jours_retard = 0;
      if (f.date_emission) {
        const e = new Date(f.date_emission);
        e.setDate(e.getDate() + delai);
        date_echeance = e.toISOString().slice(0, 10);
        if (reste > 0.004 && !['avoir', 'annulee', 'reglee'].includes(f.statut)) {
          jours_retard = Math.max(0, Math.floor((today - e) / 86400000));
        }
      }
      return { ...f, reste, date_echeance, jours_retard };
    });
    res.json({ factures });
  } catch (e) { console.error('[portail:factures]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/portail/factures/:id/pdf  (génère à la volée si absent)
router.get('/factures/:id/pdf', async (req, res) => {
  try {
    const { data: f } = await supabase.from('factures').select('*')
      .eq('camping_id', req.resident.camping_id).eq('resident_id', req.resident.id).eq('id', req.params.id).maybeSingle();
    if (!f) return res.status(404).json({ error: 'Facture introuvable' });
    const path = f.pdf_path || await genererPdfFacture(req.resident.camping_id, f);
    const url = await signedUrl(path, 120);
    res.json({ url, expires_in: 120 });
  } catch (e) { console.error('[portail:facture-pdf]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/portail/prestations  -> séjours & prestations en préparation (non facturées)
router.get('/prestations', async (req, res) => {
  try {
    const { data, error } = await supabase.from('prestations')
      .select('id,type,designation,date_debut,date_fin,quantite,montant_ttc,statut')
      .eq('camping_id', req.resident.camping_id).eq('resident_id', req.resident.id)
      .eq('statut', 'en_cours')
      .order('date_debut', { ascending: true, nullsFirst: false });
    if (error) throw error;
    res.json({ prestations: data || [] });
  } catch (e) {
    // table absente (migration pas encore passée) : ne pas casser le portail
    console.error('[portail:prestations]', e.message);
    res.json({ prestations: [] });
  }
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

// GET /api/portail/messages  -> fil du résident (et marque lus les messages du camping)
router.get('/messages', async (req, res) => {
  try {
    const { data, error } = await supabase.from('messages').select('id,auteur,corps,created_at,lu')
      .eq('camping_id', req.resident.camping_id).eq('resident_id', req.resident.id)
      .order('created_at', { ascending: true });
    if (error) throw error;
    await supabase.from('messages').update({ lu: true })
      .eq('camping_id', req.resident.camping_id).eq('resident_id', req.resident.id)
      .eq('auteur', 'camping').eq('lu', false);
    res.json({ messages: data || [] });
  } catch (e) {
    console.error('[portail:messages]', e.message);
    res.json({ messages: [] });   // table absente : ne pas casser le portail
  }
});

// POST /api/portail/messages { corps }
router.post('/messages', async (req, res) => {
  try {
    const corps = String(req.body?.corps || '').trim();
    if (!corps) return res.status(400).json({ error: 'Message vide' });
    if (corps.length > 4000) return res.status(400).json({ error: 'Message trop long (4000 caractères max)' });
    const { data, error } = await supabase.from('messages').insert({
      camping_id: req.resident.camping_id, resident_id: req.resident.id, auteur: 'resident', corps,
    }).select('id,auteur,corps,created_at').single();
    if (error) throw error;
    await auditPortail(req, req.resident, 'portail_message', { entite: 'messages', entite_id: data.id });

    // Notifier le staff (cloche + push). Best-effort : ne bloque jamais l'envoi du message.
    (async () => {
      const { creerNotifsStaff } = require('../lib/notifications');
      const { data: r } = await supabase.from('residents').select('nom,prenom')
        .eq('id', req.resident.id).maybeSingle();
      const nom = `${(r && r.prenom) || ''} ${(r && r.nom) || ''}`.trim() || 'Un résident';
      await creerNotifsStaff(req.resident.camping_id, {
        type: 'nouveau_message', perm: 'messagerie',
        titre: `Nouveau message de ${nom}`,
        corps: corps.slice(0, 140),
        entite: 'message', entite_id: data.id,
        donnees: { resident_id: req.resident.id },
      });
    })().catch((e) => console.error('[portail:message notif]', e.message));

    res.status(201).json({ message: data });
  } catch (e) { console.error('[portail:message]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/portail/mes-donnees  -> droit d'accès et portabilité (art. 15 & 20 du RGPD)
// Le résident exerce son droit lui-même, sans intermédiaire.
router.get('/mes-donnees', async (req, res) => {
  try {
    const { exporterDonnees } = require('../lib/rgpd');
    const data = await exporterDonnees(req.resident.camping_id, req.resident.id);
    if (!data) return res.status(404).json({ error: 'Introuvable' });

    // la demande est tracée (art. 12 : le responsable doit pouvoir la démontrer)
    try {
      await supabase.from('demandes_rgpd').insert({
        camping_id: req.resident.camping_id, resident_id: req.resident.id,
        type: 'acces', origine: 'portail', statut: 'traitee',
      });
    } catch (e) { console.error('[portail:rgpd]', e.message); }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="mes_donnees.json"');
    res.send(JSON.stringify(data, null, 2));
  } catch (e) { console.error('[portail:mes-donnees]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

/* ==================== SIGNATURE ÉLECTRONIQUE ====================
   Le résident signe DEPUIS SON ESPACE, déjà authentifié par le portail.
   Preuve d'identité plus forte qu'un simple lien : la session vaut
   authentification (lien à usage unique envoyé à son adresse e-mail).
   ================================================================ */

// GET /api/portail/signatures  -> documents en attente de sa signature
router.get('/signatures', async (req, res) => {
  try {
    const { data, error } = await supabase.from('documents_signature')
      .select('id,titre,message,nb_pages,champs,statut,date_envoi,date_signature,storage_signe')
      .eq('camping_id', req.resident.camping_id)
      .eq('resident_id', req.resident.id)
      .in('statut', ['envoye', 'signe'])
      .order('created_at', { ascending: false });
    if (error) throw error;
    const docs = data || [];
    res.json({
      a_signer: docs.filter((d) => d.statut === 'envoye'),
      signes: docs.filter((d) => d.statut === 'signe'),
    });
  } catch (e) {
    console.error('[portail:signatures]', e.message);
    res.json({ a_signer: [], signes: [] });   // table absente : ne casse pas le portail
  }
});

// GET /api/portail/signatures/:id  -> le document à lire et signer
router.get('/signatures/:id', async (req, res) => {
  try {
    const { data: doc } = await supabase.from('documents_signature').select('*')
      .eq('camping_id', req.resident.camping_id)
      .eq('resident_id', req.resident.id)
      .eq('id', req.params.id).maybeSingle();
    if (!doc) return res.status(404).json({ error: 'Document introuvable' });

    const { CONSENTEMENT } = require('../lib/signature');
    const chemin = doc.statut === 'signe' && doc.storage_signe ? doc.storage_signe : doc.storage_path;
    res.json({
      id: doc.id, titre: doc.titre, message: doc.message,
      champs: doc.champs || [], nb_pages: doc.nb_pages, statut: doc.statut,
      url: await signedUrl(chemin, 1800),
      consentement: CONSENTEMENT,
    });
  } catch (e) { console.error('[portail:signature]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/portail/signatures/:id/signer  { valeurs, signature_png, consentement }
router.post('/signatures/:id/signer', async (req, res) => {
  try {
    const { signerDocument } = require('../lib/signature');
    const out = await signerDocument({
      campingId: req.resident.camping_id,
      documentId: req.params.id,
      residentId: req.resident.id,
      corps: req.body || {},
      ip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'inconnue',
      userAgent: req.headers['user-agent'] || null,
      canal: 'portail',              // authentifié : preuve d'identité renforcée
    });
    if (out.error) return res.status(out.code || 400).json({ error: out.error });

    await auditPortail(req, req.resident, 'portail_signature',
      { entite: 'documents_signature', entite_id: req.params.id });

    res.json({ ok: true, message: out.message });
  } catch (e) { console.error('[portail:signer]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// ---------- Notifications du portail locataire ----------

// GET /api/portail/notifications?statut=non-lus&limit=30
router.get('/notifications', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    let q = supabase.from('notifications')
      .select('id,type,titre,corps,entite,entite_id,lien,donnees,lu,lu_at,created_at')
      .eq('camping_id', req.resident.camping_id)
      .eq('destinataire_resident_id', req.resident.id)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (req.query.statut === 'non-lus') q = q.eq('lu', false);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ notifications: data || [] });
  } catch (e) {
    console.error('[portail:notifications]', e.message);
    res.json({ notifications: [] });   // table absente : ne pas casser le portail
  }
});

// GET /api/portail/notifications/compteur
router.get('/notifications/compteur', async (req, res) => {
  try {
    const { count, error } = await supabase.from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('camping_id', req.resident.camping_id)
      .eq('destinataire_resident_id', req.resident.id)
      .eq('lu', false);
    if (error) throw error;
    res.json({ non_lues: count || 0 });
  } catch (e) {
    console.error('[portail:notif-compteur]', e.message);
    res.json({ non_lues: 0 });
  }
});

// POST /api/portail/notifications/:id/lu
router.post('/notifications/:id/lu', async (req, res) => {
  try {
    const { data, error } = await supabase.from('notifications')
      .update({ lu: true, lu_at: new Date().toISOString() })
      .eq('camping_id', req.resident.camping_id)
      .eq('destinataire_resident_id', req.resident.id)
      .eq('id', req.params.id)
      .select('id').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Notification introuvable' });
    res.json({ ok: true });
  } catch (e) { console.error('[portail:notif-lu]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/portail/notifications/tout-lu
router.post('/notifications/tout-lu', async (req, res) => {
  try {
    const { error } = await supabase.from('notifications')
      .update({ lu: true, lu_at: new Date().toISOString() })
      .eq('camping_id', req.resident.camping_id)
      .eq('destinataire_resident_id', req.resident.id)
      .eq('lu', false);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { console.error('[portail:notif-tout-lu]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// ---------- Notifications push (app locataire) ----------

// POST /api/portail/push/register  { token, platform }
// Enregistre le jeton FCM de l'appareil du résident (idempotent : upsert sur le jeton).
router.post('/push/register', async (req, res) => {
  try {
    const { token, platform } = req.body || {};
    if (!token) return res.status(400).json({ error: 'token requis' });
    const { enregistrerToken } = require('../lib/push');
    const out = await enregistrerToken({
      campingId: req.resident.camping_id, canal: 'portail',
      residentId: req.resident.id, token, platform, app: 'portail',
    });
    if (out.error) throw new Error(out.error);
    res.json({ ok: true });
  } catch (e) {
    console.error('[portail:push-register]', e.message);
    res.status(500).json({ error: 'Erreur serveur — la migration db/16_push_tokens.sql a-t-elle été exécutée ?' });
  }
});

// DELETE /api/portail/push/register  { token }  -> à la déconnexion
router.delete('/push/register', async (req, res) => {
  try {
    const token = (req.body && req.body.token) || req.query.token;
    if (!token) return res.status(400).json({ error: 'token requis' });
    await supabase.from('push_tokens').delete()
      .eq('resident_id', req.resident.id).eq('token', token);
    res.json({ ok: true });
  } catch (e) { console.error('[portail:push-delete]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;

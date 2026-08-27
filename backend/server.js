require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const campingRoutes = require('./routes/camping');
const emplacementsRoutes = require('./routes/emplacements');
const residentsRoutes = require('./routes/residents');
const documentsRoutes = require('./routes/documents');
const contratsRoutes = require('./routes/contrats');
const contratModelesRoutes = require('./routes/contratModeles');
const facturesRoutes = require('./routes/factures');
const taxeSejourRoutes = require('./routes/taxeSejour');
const reglementsRoutes = require('./routes/reglements');
const remisesRoutes = require('./routes/remises');
const moyensPaiementRoutes = require('./routes/moyens-paiement');
const relancesRoutes = require('./routes/relances');
const comptaRoutes = require('./routes/compta');
const dashboardRoutes = require('./routes/dashboard');
const articlesRoutes = require('./routes/articles');
const prestationsRoutes = require('./routes/prestations');
const messagesRoutes = require('./routes/messages');
const notificationsRoutes = require('./routes/notifications');
const adminRoutes = require('./routes/admin');
const fiscalRoutes = require('./routes/fiscal');
const exercicesRoutes = require('./routes/exercices');
const rgpdRoutes = require('./routes/rgpd');
const signaturesRoutes = require('./routes/signatures');
const carteElementsRoutes = require('./routes/carte-elements');
const compteursRoutes = require('./routes/compteurs');
const portailRoutes = require('./routes/portail');
const efactureRoutes = require('./routes/efacture');
const cronRoutes = require('./routes/cron');
const { stripeWebhook } = require('./routes/webhooks');

const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

/* ==================== SÉCURITÉ ==================== */

// Derrière le proxy de Render : sans ceci, req.ip renvoie l'IP du proxy et non celle
// du client — le limiteur de débit bloquerait alors tout le monde en même temps.
app.set('trust proxy', 1);

// En-têtes de sécurité HTTP (HSTS, anti-clickjacking, anti-sniffing…).
// La politique de contenu autorise ce dont le front a réellement besoin.
// Note : 'unsafe-inline' reste requis pour les scripts tant que le front utilise
// des gestionnaires onclick="…" ; le retirer suppose de les refactoriser.
const SUPABASE = process.env.SUPABASE_URL || '';
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com', 'https://js.stripe.com'],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:', SUPABASE].filter(Boolean),
      connectSrc: ["'self'", SUPABASE, 'https://api.stripe.com'].filter(Boolean),
      frameSrc: ["'self'", 'https://js.stripe.com', 'blob:', SUPABASE].filter(Boolean),
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],           // interdit l'inclusion dans une iframe
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,          // sinon les PDF/CDN externes sont bloqués
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
}));

// CORS restreint : seul le domaine de l'application peut appeler l'API.
const ORIGINES = [process.env.PUBLIC_APP_URL, process.env.PUBLIC_APP_URL_2]
  .filter(Boolean).map((u) => u.replace(/\/$/, ''));
// Origines des apps mobiles Capacitor (fichiers embarqués : iOS/Android).
const ORIGINES_APP = ['capacitor://localhost', 'ionic://localhost', 'http://localhost', 'https://localhost'];
app.use(cors({
  origin(origin, cb) {
    // requêtes de même origine (front servi par ce serveur) : pas d'en-tête Origin
    if (!origin) return cb(null, true);
    if (ORIGINES_APP.includes(origin)) return cb(null, true);   // apps mobiles
    if (!ORIGINES.length) return cb(null, true);   // non configuré : on ne casse rien
    return cb(null, ORIGINES.includes(origin.replace(/\/$/, '')));
  },
  credentials: false,
}));

// ---- Limitation de débit ----
const limiteur = (max, minutes, message) => rateLimit({
  windowMs: minutes * 60 * 1000,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: message },
});

// Connexion : protège contre la force brute (sans ceci, un attaquant peut
// tester des millions de mots de passe sans aucune entrave).
app.use('/api/auth/login', limiteur(8, 15,
  'Trop de tentatives de connexion. Réessayez dans 15 minutes.'));
app.use('/api/auth/register', limiteur(5, 60, 'Trop de créations de compte. Réessayez plus tard.'));

// Lien magique du portail : évite l'envoi massif d'e-mails.
app.use('/api/portail/demande-acces', limiteur(6, 15,
  'Trop de demandes. Réessayez dans 15 minutes.'));

// Connexion du portail : protège contre la force brute sur les mots de passe.
app.use('/api/portail/connexion', limiteur(10, 15,
  'Trop de tentatives de connexion. Réessayez dans 15 minutes.'));
app.use('/api/portail/mdp-oublie', limiteur(5, 30,
  'Trop de demandes. Réessayez plus tard.'));
app.use('/api/portail/activation', limiteur(12, 15,
  'Trop de tentatives. Réessayez plus tard.'));
app.use('/api/portail/mdp-reinit', limiteur(10, 15,
  'Trop de tentatives. Réessayez plus tard.'));

// Signature électronique (page publique).
app.use('/api/signatures/signer', limiteur(30, 15, 'Trop de requêtes. Réessayez plus tard.'));

// Garde-fou général sur l'API.
app.use('/api/', limiteur(600, 15, 'Trop de requêtes. Réessayez dans quelques minutes.'));

/* ================================================== */

// Webhook Stripe : corps brut requis pour la vérification de signature (AVANT express.json)
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhook);

app.use(express.json({ limit: '2mb' }));

// Front admin (fichiers statiques)
/* La politique de confidentialite, sur une adresse sans extension : elle
   figure dans la fiche du Play Store et doit survivre a un changement de
   technologie. Posee avant le routage de l'application, qui renverrait
   sinon l'ecran de connexion — de quoi faire rejeter la soumission. */
app.get(['/confidentialite', '/politique-de-confidentialite'], (req, res) =>
  res.sendFile(require('path').join(__dirname, 'public', 'confidentialite.html')));

/* Lien de confiance de l'application Android. Android verifie ici que le
   site autorise l'application a s'afficher sans barre d'adresse.

   Une route explicite est indispensable : express.static repond 404 sur
   tout segment commencant par un point, donc un fichier depose dans
   public/.well-known/ existerait sans jamais etre servi.

   L'empreinte vient de l'environnement : elle identifie la cle de
   signature, et changera le jour ou la cle changera. */
app.get('/.well-known/assetlinks.json', (req, res) => {
  /* assetlinks.json est une LISTE : un site peut autoriser plusieurs
     applications. Avec une seule declaration, la seconde application
     garderait la barre d'adresse de Chrome — et rien ne le signalerait,
     puisque la premiere continuerait de fonctionner. */
  const empreinte1 = process.env.ANDROID_FINGERPRINT;
  if (!empreinte1) {
    return res.status(503).type('application/json').send(JSON.stringify({
      erreur: 'ANDROID_FINGERPRINT absente de l\'environnement.',
      ou: 'Console Play, Integrite de l\'application, SHA-256 du certificat de signature.'
    }, null, 2));
  }

  const apps = [
    { id: process.env.ANDROID_APP_ID || 'com.locamp.gestion', emp: empreinte1 }
  ];

  /* Deux applications du meme compte Play partagent leur empreinte de
     deploiement. On reutilise donc la premiere si la seconde n'est pas
     posee — une supposition explicite plutot qu'un silence. */
  if (process.env.ANDROID_APP_ID_2) {
    apps.push({
      id: process.env.ANDROID_APP_ID_2,
      emp: process.env.ANDROID_FINGERPRINT_2 || empreinte1
    });
  }

  res.type('application/json').send(JSON.stringify(apps.map((a) => ({
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: a.id,
      sha256_cert_fingerprints: a.emp.split(',').map((f) => f.trim()).filter(Boolean)
    }
  })), null, 2));
});

/* Sans « Cache-Control », chaque client decide seul — et WKWebView garde
   une feuille de style des heures sans interroger le serveur. Dans une
   application, aucun geste utilisateur ne force le rafraichissement : une
   correction deployee restait donc invisible.

   « no-cache » ne veut pas dire « ne garde rien » : le client garde, mais
   demande si ca a change. L'ETag rend la question presque gratuite — le
   serveur repond « 304 » en quelques octets.

   Les images et les polices gardent un cache long : elles ne changent pas
   sans changer de nom. */
// Ping cron — reponse vide, 204
app.get("/healthz", (req, res) => res.status(204).end());

app.use(express.static('public', {
  etag: true,
  setHeaders(res, chemin) {
    if (/\.(html|css|js|json|svg)$/i.test(chemin)) {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (/\.(png|jpg|jpeg|webp|ico|woff2?|ttf)$/i.test(chemin)) {
      res.setHeader('Cache-Control', 'public, max-age=604800');
    }
  },
}));

/* ---------- Tâches planifiées ----------
   Elles ne tournent plus dans ce process. Deux boucles setInterval
   lançaient ici les relances (12 h) et la clôture fiscale (6 h) :

     · si Render met le service en veille, elles ne partent jamais —
       les relances d'impayés s'arrêtent sans que personne ne le voie ;
     · si Render lance deux instances, elles partent deux fois.

   Elles sont désormais déclenchées de l'extérieur, par les Cron Jobs
   Render, sur /api/cron/* (protégé par x-cron-secret) :

     quotidien 05:00   POST /api/cron/cloture-fiscale
     quotidien 07:00   POST /api/cron/relances
     quotidien 08:00   POST /api/cron/echeances
     1er du mois 06:00 POST /api/cron/facturation-mensuelle

   Si ces tâches semblent ne plus s'exécuter, c'est ici qu'il faut
   regarder : le code n'en déclenche plus aucune de lui-même. */

// Compat liens magiques déjà envoyés : /portail/connexion?token=... -> /portail/?token=...
app.get('/portail/connexion', (req, res) => {
  const t = req.query.token ? `?token=${encodeURIComponent(req.query.token)}` : '';
  res.redirect(302, `/portail/${t}`);
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/camping', campingRoutes);
app.use('/api/emplacements', emplacementsRoutes);
app.use('/api/residents', residentsRoutes);
app.use('/api/documents', documentsRoutes);
app.use('/api/contrats', contratsRoutes);
app.use('/api/contrat-modeles', contratModelesRoutes);
app.use('/api/factures', facturesRoutes);
app.use('/api/taxe-sejour', taxeSejourRoutes);
app.use('/api/reglements', reglementsRoutes);
app.use('/api/remises', remisesRoutes);
app.use('/api/moyens-paiement', moyensPaiementRoutes);
app.use('/api/relances', relancesRoutes);
app.use('/api/compta', comptaRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/articles', articlesRoutes);
app.use('/api/prestations', prestationsRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/fiscal', fiscalRoutes);
app.use('/api/exercices', exercicesRoutes);
app.use('/api/efacture', efactureRoutes);
app.use('/api/echeances', require('./routes/echeances'));
app.use('/api/indexation', require('./routes/indexation'));
app.use('/api/rgpd', rgpdRoutes);
app.use('/api/signatures', signaturesRoutes);
app.use('/api/carte-elements', carteElementsRoutes);
app.use('/api/compteurs', compteursRoutes);
app.use('/api/portail', portailRoutes);
app.use('/api/cron', cronRoutes);

// 404 : JSON pour l'API, index.html sinon (SPA)
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Route introuvable' });
  res.sendFile(require('path').join(__dirname, 'public', 'index.html'));
});

// Handler d'erreur global
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'Erreur serveur' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[server] démarré sur le port ${PORT}`));

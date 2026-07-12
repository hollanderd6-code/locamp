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
const adminRoutes = require('./routes/admin');
const fiscalRoutes = require('./routes/fiscal');
const rgpdRoutes = require('./routes/rgpd');
const signaturesRoutes = require('./routes/signatures');
const carteElementsRoutes = require('./routes/carte-elements');
const compteursRoutes = require('./routes/compteurs');
const portailRoutes = require('./routes/portail');
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
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:', SUPABASE].filter(Boolean),
      connectSrc: ["'self'", SUPABASE, 'https://api.stripe.com'].filter(Boolean),
      frameSrc: ["'self'", 'https://js.stripe.com'],
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
app.use(cors({
  origin(origin, cb) {
    // requêtes de même origine (front servi par ce serveur) : pas d'en-tête Origin
    if (!origin) return cb(null, true);
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

// Signature électronique (page publique).
app.use('/api/signatures/signer', limiteur(30, 15, 'Trop de requêtes. Réessayez plus tard.'));

// Garde-fou général sur l'API.
app.use('/api/', limiteur(600, 15, 'Trop de requêtes. Réessayez dans quelques minutes.'));

/* ================================================== */

// Webhook Stripe : corps brut requis pour la vérification de signature (AVANT express.json)
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhook);

app.use(express.json({ limit: '2mb' }));

// Front admin (fichiers statiques)
app.use(express.static('public'));

// ---------- Relances automatiques quotidiennes ----------
// Pour chaque camping ayant activé parametres.relances.auto, relance les factures
// en retard (au plus une relance par facture tous les 7 jours).
async function relancesAutomatiques() {
  try {
    const { runRelances } = require('./lib/relances');
    const { supabase } = require('./lib/supabase');
    const { data: campings } = await supabase.from('campings').select('id,nom,parametres');
    for (const c of (campings || [])) {
      if (c.parametres?.relances?.auto !== true) continue;
      try {
        const out = await runRelances(c.id, { cooldownJours: 7 });
        if (out.envoyees) console.log(`[relances auto] ${c.nom || c.id} : ${out.envoyees} envoyée(s)`);
      } catch (e) { console.error('[relances auto]', c.id, e.message); }
    }
  } catch (e) { console.error('[relances auto]', e.message); }
}
// Clôture fiscale journalière automatique (archivage — art. 286-I-3° bis du CGI)
async function cloturesAutomatiques() {
  try { await require('./lib/fiscal').cloturerVeille(); }
  catch (e) { console.error('[fiscal:cloture auto]', e.message); }
}
setTimeout(cloturesAutomatiques, 120 * 1000);
setInterval(cloturesAutomatiques, 6 * 60 * 60 * 1000);

setTimeout(relancesAutomatiques, 90 * 1000);              // au démarrage (après 90 s)
setInterval(relancesAutomatiques, 12 * 60 * 60 * 1000);   // puis toutes les 12 h

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
app.use('/api/admin', adminRoutes);
app.use('/api/fiscal', fiscalRoutes);
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

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
const relancesRoutes = require('./routes/relances');
const comptaRoutes = require('./routes/compta');
const dashboardRoutes = require('./routes/dashboard');
const articlesRoutes = require('./routes/articles');
const prestationsRoutes = require('./routes/prestations');
const messagesRoutes = require('./routes/messages');
const adminRoutes = require('./routes/admin');
const carteElementsRoutes = require('./routes/carte-elements');
const compteursRoutes = require('./routes/compteurs');
const portailRoutes = require('./routes/portail');
const cronRoutes = require('./routes/cron');
const { stripeWebhook } = require('./routes/webhooks');

const app = express();
app.use(cors());

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
app.use('/api/relances', relancesRoutes);
app.use('/api/compta', comptaRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/articles', articlesRoutes);
app.use('/api/prestations', prestationsRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/admin', adminRoutes);
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

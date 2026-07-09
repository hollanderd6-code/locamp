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
const relancesRoutes = require('./routes/relances');
const cronRoutes = require('./routes/cron');
const { stripeWebhook } = require('./routes/webhooks');

const app = express();
app.use(cors());

// Webhook Stripe : corps brut requis pour la vérification de signature (AVANT express.json)
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhook);

app.use(express.json({ limit: '2mb' }));

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
app.use('/api/relances', relancesRoutes);
app.use('/api/cron', cronRoutes);

// 404
app.use((req, res) => res.status(404).json({ error: 'Route introuvable' }));

// Handler d'erreur global
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'Erreur serveur' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[server] démarré sur le port ${PORT}`));

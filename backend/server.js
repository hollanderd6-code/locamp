require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const emplacementsRoutes = require('./routes/emplacements');
const residentsRoutes = require('./routes/residents');
const documentsRoutes = require('./routes/documents');
const contratsRoutes = require('./routes/contrats');
const contratModelesRoutes = require('./routes/contratModeles');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Health check (utilisé par Render pour vérifier que le service tourne)
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/emplacements', emplacementsRoutes);
app.use('/api/residents', residentsRoutes);
app.use('/api/documents', documentsRoutes);
app.use('/api/contrats', contratsRoutes);
app.use('/api/contrat-modeles', contratModelesRoutes);

// 404
app.use((req, res) => res.status(404).json({ error: 'Route introuvable' }));

// Handler d'erreur global
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'Erreur serveur' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[server] démarré sur le port ${PORT}`));

const express = require('express');
const { auth, campingScope, requirePerm, requireRole } = require('../middleware/auth');
const ef = require('../lib/efacture');

let writeAudit = () => {};
try { ({ writeAudit } = require('../lib/audit')); } catch (_) { /* audit optionnel */ }

const router = express.Router();
router.use(auth, campingScope);

// Liste des plateformes agréées branchables (pour le formulaire de connexion).
router.get('/plateformes', requirePerm('compta'), (req, res) => {
  res.json({ plateformes: ef.listPlateformes() });
});

// État de la connexion du camping actif.
router.get('/connexion', requirePerm('compta'), async (req, res) => {
  try {
    const cx = await ef.chargerConnexion(req.activeCampingId);
    if (!cx) return res.json({ connexion: null });
    // On ne renvoie jamais les secrets au client.
    let etat = { statut: cx.statut, message: cx.message, adresse_routage: cx.adresse_routage };
    try {
      const ctx = await ef.contexte(req.activeCampingId);
      etat = { ...etat, ...(await ef.getDriver(cx.pa_code).status(ctx)) };
    } catch (_) { /* pilote absent : on garde l'état stocké */ }
    res.json({
      connexion: {
        pa_code: cx.pa_code, statut: etat.statut, adresse_routage: etat.adresse_routage,
        message: etat.message, connecte_at: cx.connecte_at, config_public: cx.config_public,
      },
    });
  } catch (e) { console.error('[efacture:connexion:get]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// Connecter (ou reconnecter) une plateforme agréée.
router.post('/connexion', requireRole('admin'), async (req, res) => {
  try {
    const { pa_code, config } = req.body || {};
    if (!pa_code) return res.status(400).json({ error: 'Plateforme non précisée' });
    const driver = ef.getDriver(pa_code);
    const ctx = await ef.contexte(req.activeCampingId);
    const r = await driver.connect(ctx, config || {});
    await ef.enregistrerConnexion(req.activeCampingId, {
      pa_code,
      statut: r.statut || 'connecte',
      adresse_routage: r.adresse_routage || null,
      message: r.message || null,
      config_public: r.config_public || {},
      secrets: r.secrets || null,
    });
    writeAudit(req, { action: 'efacture.connexion', entite: 'efacture_connexions', entite_id: null, apres: { pa_code, statut: r.statut } });
    res.json({ ok: true, statut: r.statut, adresse_routage: r.adresse_routage, message: r.message });
  } catch (e) { console.error('[efacture:connexion:post]', e.message); res.status(500).json({ error: e.message || 'Erreur serveur' }); }
});

// Déconnecter la plateforme.
router.delete('/connexion', requireRole('admin'), async (req, res) => {
  try {
    const cx = await ef.chargerConnexion(req.activeCampingId);
    if (cx) {
      try { await ef.getDriver(cx.pa_code).disconnect(await ef.contexte(req.activeCampingId)); } catch (_) {}
    }
    await ef.supprimerConnexion(req.activeCampingId);
    writeAudit(req, { action: 'efacture.deconnexion', entite: 'efacture_connexions', entite_id: null, apres: {} });
    res.json({ ok: true });
  } catch (e) { console.error('[efacture:connexion:delete]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

/* ---------- E-reporting (données de transaction B2C) ---------- */

// GET /api/efacture/ereporting?periode=AAAA-MM&type=transaction  -> aperçu (rien n'est transmis)
router.get('/ereporting', requirePerm('compta'), async (req, res) => {
  try {
    const { calculer } = require('../lib/efacture/ereporting');
    const periode = req.query.periode || new Date().toISOString().slice(0, 7);
    const out = await calculer(req.activeCampingId, periode, req.query.type || 'transaction');
    if (out.error) return res.status(out.code || 400).json({ error: out.error });
    res.json({ lot: out });
  } catch (e) {
    console.error('[efacture:erep-preview]', e.message);
    res.status(500).json({ error: 'Erreur serveur — la migration db/22_ereporting.sql a-t-elle été exécutée ?' });
  }
});

// GET /api/efacture/ereporting/historique  -> lots déjà transmis (justificatif)
router.get('/ereporting/historique', requirePerm('compta'), async (req, res) => {
  try {
    const { historique } = require('../lib/efacture/ereporting');
    res.json({ lots: await historique(req.activeCampingId) });
  } catch (e) {
    console.error('[efacture:erep-histo]', e.message);
    res.json({ lots: [] });
  }
});

// POST /api/efacture/ereporting  { periode, type }  -> transmet à la Plateforme Agréée
router.post('/ereporting', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const { transmettre } = require('../lib/efacture/ereporting');
    const { periode, type } = req.body || {};
    if (!periode) return res.status(400).json({ error: 'periode requise (AAAA-MM)' });
    const out = await transmettre(req.activeCampingId, periode, type || 'transaction');
    if (out.error) return res.status(out.code || 400).json({ error: out.error });
    await writeAudit(req, { action: 'create', entite: 'ereporting_lots', entite_id: out.lot.id,
      apres: { periode, type: type || 'transaction', nb: out.lot.nb_operations, total_ttc: out.lot.total_ttc } });
    res.json(out);
  } catch (e) { console.error('[efacture:erep-post]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;

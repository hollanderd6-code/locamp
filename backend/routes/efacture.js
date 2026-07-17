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

module.exports = router;

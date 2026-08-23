const express = require('express');
const { supabase } = require('../lib/supabase');
const { runFacturationMensuelle, currentPeriode } = require('../lib/facturation');
const { runRelances } = require('../lib/relances');

const router = express.Router();

// Protection par secret partagé (en-tête x-cron-secret). Aucune session utilisateur.
router.use((req, res, next) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers['x-cron-secret'] !== secret) return res.status(403).json({ error: 'Interdit' });
  next();
});

async function forEachCamping(fn) {
  const { data: campings, error } = await supabase.from('campings').select('id,nom').eq('actif', true);
  if (error) throw error;
  const resultats = [];
  for (const c of (campings || [])) {
    try { resultats.push({ camping_id: c.id, nom: c.nom, ...(await fn(c.id)) }); }
    catch (e) { resultats.push({ camping_id: c.id, nom: c.nom, erreur: e.message }); }
  }
  return resultats;
}

// POST /api/cron/facturation-mensuelle  { periode? }
router.post('/facturation-mensuelle', async (req, res) => {
  try {
    const periode = (req.body && req.body.periode) || currentPeriode();
    const resultats = await forEachCamping((id) => runFacturationMensuelle(id, periode).then((r) => ({ ...r, factures: undefined })));
    res.json({ periode, campings: resultats.length, resultats });
  } catch (e) { console.error('[cron:facturation]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/cron/echeances  -> rappels assurances + fins de contrat (tous campings)
router.post('/echeances', async (req, res) => {
  try {
    const { runRappels } = require('../lib/echeances');
    const resultats = await forEachCamping((id) => runRappels(id));
    res.json({ campings: resultats.length, resultats });
  } catch (e) { console.error('[cron:echeances]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

/* POST /api/cron/relances
   Reprend EXACTEMENT le comportement de la boucle qu'elle remplace :
     · uniquement les campings ayant activé parametres.relances.auto ;
     · cooldown de 7 jours (une facture n'est pas relancée deux fois
       dans la semaine).
   Sans ces deux règles, la route relançait tous les campings actifs
   tous les jours — ce n'est pas ce que la boucle faisait.

   ?force=1 ignore le réglage du camping et passe le cooldown à 1 jour :
   pour un déclenchement manuel depuis l'interface, jamais pour le cron. */
router.post('/relances', async (req, res) => {
  try {
    const force = req.query.force === '1' || req.body?.force === true;
    const cooldownJours = force ? 1 : 7;

    const { data: campings, error } = await supabase
      .from('campings').select('id,nom,parametres').eq('actif', true);
    if (error) throw error;

    const resultats = [];
    for (const c of (campings || [])) {
      if (!force && c.parametres?.relances?.auto !== true) {
        resultats.push({ camping_id: c.id, nom: c.nom, ignore: 'relances automatiques désactivées' });
        continue;
      }
      try {
        resultats.push({ camping_id: c.id, nom: c.nom, ...(await runRelances(c.id, { cooldownJours })) });
      } catch (e) {
        resultats.push({ camping_id: c.id, nom: c.nom, erreur: e.message });
      }
    }
    const envoyees = resultats.reduce((n, r) => n + (r.envoyees || 0), 0);
    console.log('[cron:relances] ' + resultats.length + ' camping(s), ' + envoyees + ' relance(s) envoyée(s)');
    res.json({ campings: resultats.length, envoyees, resultats });
  } catch (e) { console.error('[cron:relances]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

/* POST /api/cron/cloture-fiscale
   Clôture la journée de la veille pour tous les campings — archivage
   exigé par l'article 286-I-3° bis du CGI.

   cloturerVeille() est idempotent : une période déjà clôturée n'est
   jamais re-clôturée. Un double appel est donc sans effet, et une
   journée manquée peut être rattrapée en relançant. */
router.post('/cloture-fiscale', async (req, res) => {
  try {
    const out = await require('../lib/fiscal').cloturerVeille();
    console.log('[cron:cloture-fiscale] terminé');
    res.json({ ok: true, resultat: out || null });
  } catch (e) {
    console.error('[cron:cloture-fiscale]', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

#!/usr/bin/env node
/* ============================================================
   Sortir les tâches planifiées du process web
   ============================================================
   Cibles : backend/routes/cron.js et backend/server.js

   ── LE PROBLÈME ──────────────────────────────────────────────────
   server.js lance deux boucles dans le process web :

     setInterval(relancesAutomatiques, 12 h)
     setInterval(cloturesAutomatiques,  6 h)

   Trois défauts, dans l'ordre de gravité :

   1. Si Render met le service en veille (pas de trafic), elles ne
      partent jamais. Les relances d'impayés s'arrêtent sans que
      personne ne le voie — c'est de l'argent qui ne rentre pas.

   2. Si Render lance deux instances, elles partent DEUX FOIS. Le
      cooldown de 7 jours limite la casse sur les relances ; la
      clôture fiscale, elle, est idempotente (elle vérifie avant
      d'écrire), donc protégée. Mais on tient par chance, pas par
      construction.

   3. Le premier départ est à 90 s après le démarrage. Un service qui
      redémarre souvent relance donc en boucle, et un service qui ne
      redémarre jamais attend 12 h.

   ── LE PIÈGE, TROUVÉ AVANT DE BASCULER ───────────────────────────
   Les deux chemins ne font pas la même chose :

     setInterval  →  campings ayant activé parametres.relances.auto
                     cooldown 7 jours
     /api/cron/relances →  TOUS les campings actifs
                           cooldown 1 jour  (valeur par défaut de runRelances)

   Basculer sans rien changer enverrait des relances à des campings
   qui ne les ont pas demandées, sept fois plus souvent. Ce script
   aligne donc la route sur le comportement actuel AVANT de retirer
   les boucles.

   ── CE QU'IL FAIT ────────────────────────────────────────────────
   1. /api/cron/relances respecte le réglage du camping et le cooldown
      de 7 jours. Un `?force=1` permet de forcer depuis l'interface.
   2. Ajoute /api/cron/cloture-fiscale, qui n'existait pas.
   3. Retire les deux setInterval de server.js.

   ── ORDRE D'OPÉRATIONS — IMPORTANT ───────────────────────────────
   Ce script retire les boucles. Tant que les Cron Jobs Render ne sont
   pas créés, PLUS RIEN ne tourne automatiquement. Créez-les d'abord,
   ou dans la foulée. Le script rappelle les commandes à la fin.

   Usage :
     node outils/cron-hors-process.js --essai
     node outils/cron-hors-process.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const RACINE = process.cwd();
const F_CRON = path.join(RACINE, 'backend', 'routes', 'cron.js');
const F_SRV = path.join(RACINE, 'backend', 'server.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

for (const [f, q] of [[F_CRON, 'backend/routes/cron.js'], [F_SRV, 'backend/server.js']]) {
  if (!fs.existsSync(f)) {
    console.error('\n  \u2717 ' + q + ' introuvable. Lancez depuis la racine du dépôt.\n');
    process.exit(1);
  }
}

/* ══ 1. cron.js ═══════════════════════════════════════════════ */
let cron = fs.readFileSync(F_CRON, 'utf8');
let cronFait = false;

if (cron.indexOf('cloture-fiscale') !== -1) {
  console.log('  déjà fait  routes cron');
} else {
  const A = `// POST /api/cron/relances
router.post('/relances', async (req, res) => {
  try {
    const resultats = await forEachCamping((id) => runRelances(id));
    res.json({ campings: resultats.length, resultats });
  } catch (e) { console.error('[cron:relances]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});`;

  const N = `/* POST /api/cron/relances
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
});`;

  if (cron.split(A).length - 1 !== 1) {
    console.error('\n  \u2717 La route /relances n\'a pas été trouvée telle quelle dans cron.js.');
    console.error('    Rien n\'a été écrit.\n');
    process.exit(1);
  }
  cron = cron.split(A).join(N);
  cronFait = true;
  console.log('  appliqué   /relances aligné + /cloture-fiscale ajoutée');
}

/* ══ 2. server.js ═════════════════════════════════════════════ */
let srv = fs.readFileSync(F_SRV, 'utf8');
let srvFait = false;

const DEBUT = "// ---------- Relances automatiques quotidiennes ----------";
const FIN = "setInterval(relancesAutomatiques, 12 * 60 * 60 * 1000);   // puis toutes les 12 h";

const i = srv.indexOf(DEBUT);
const j = srv.indexOf(FIN);

if (i === -1 && srv.indexOf('Tâches planifiées') !== -1) {
  console.log('  déjà fait  boucles retirées de server.js');
} else if (i === -1 || j === -1) {
  console.error('\n  \u2717 Le bloc des tâches planifiées n\'a pas été trouvé dans server.js.');
  console.error('    Repérez-le à la main :  grep -n "setInterval" backend/server.js');
  console.error('    Rien n\'a été écrit.\n');
  process.exit(1);
} else {
  const REMPLACEMENT = `/* ---------- Tâches planifiées ----------
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
   regarder : le code n'en déclenche plus aucune de lui-même. */`;

  srv = srv.slice(0, i) + REMPLACEMENT + srv.slice(j + FIN.length);
  srvFait = true;
  console.log('  appliqué   boucles retirées de server.js');
}

if (!cronFait && !srvFait) {
  console.log('\n  Tout était déjà appliqué.\n');
  process.exit(0);
}

for (const [nom, src] of [['cron.js', cron], ['server.js', srv]]) {
  try { new Function(src); }
  catch (e) {
    console.error('\n  \u2717 ' + nom + ' serait invalide : ' + e.message);
    console.error('    AUCUN fichier n\'a été écrit.\n');
    process.exit(1);
  }
}

if (!ESSAI) {
  if (cronFait) fs.writeFileSync(F_CRON, cron, 'utf8');
  if (srvFait) fs.writeFileSync(F_SRV, srv, 'utf8');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune écriture —' : '— APPLIQUÉ —'));
console.log('  Syntaxe des deux fichiers vérifiée.');
console.log('\n  \u26a0  PLUS AUCUNE TÂCHE NE TOURNE TANT QUE LES CRON JOBS');
console.log('     RENDER NE SONT PAS CRÉÉS. À faire maintenant.');
console.log('\n  Render → New → Cron Job, un par ligne. Commande :');
console.log('     curl -fsS -X POST "$RENDER_URL/api/cron/<tâche>" -H "x-cron-secret: $CRON_SECRET"');
console.log('\n     0 5 * * *   cloture-fiscale        (archivage CGI, la veille)');
console.log('     0 7 * * *   relances                (impayés)');
console.log('     0 8 * * *   echeances               (assurances, fins de contrat)');
console.log('     0 6 1 * *   facturation-mensuelle   (le 1er du mois)');
console.log('\n  Variables à définir sur chaque Cron Job :');
console.log('     RENDER_URL   = l\'URL publique du service web');
console.log('     CRON_SECRET  = la même valeur que sur le service web');
console.log('\n  Le -fsS du curl fait échouer le job si l\'API répond une erreur :');
console.log('  sans lui, Render afficherait « succès » sur un 500.');
console.log('\n  VÉRIFICATION IMMÉDIATE, sans attendre l\'heure :');
console.log('     curl -X POST "$URL/api/cron/relances" -H "x-cron-secret: $CRON_SECRET"');
console.log('  La réponse liste chaque camping et dit lesquels sont ignorés');
console.log('  faute d\'avoir activé les relances automatiques.');
if (ESSAI) console.log('\n  Relancez sans --essai pour appliquer.');
console.log('');

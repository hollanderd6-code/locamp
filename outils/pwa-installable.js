#!/usr/bin/env node
/* ============================================================
   outils/pwa-installable.js
   Rendre l'application réellement installable
   ============================================================
   Cibles : backend/public/index.html
            backend/public/sw.js  (fourni a cote de ce script)

   ── OU L'ON EN ETAIT ─────────────────────────────────────────────
   Le manifeste etait complet et les icones sont desormais en place,
   mais aucun service worker n'existait. Sans lui :

     · Chrome n'affiche pas « Installer l'application » ;
     · l'empaquetage pour le Play Store est refuse ;
     · chaque ouverture retelecharge toute la coquille.

   ── CE QUE FAIT CE SCRIPT ────────────────────────────────────────
   Il enregistre le service worker, et rien d'autre. L'enregistrement
   est place APRES le chargement de la page : un service worker qui
   s'installe pendant le premier affichage se dispute la bande passante
   avec ce que l'utilisateur attend de voir.

   ── LA MISE A JOUR, TRAITEE D'EMBLEE ─────────────────────────────
   Le defaut le plus courant d'une application installee est d'enfermer
   l'utilisateur dans une vieille version : il rafraichit, rien ne
   change, et personne ne comprend pourquoi. Ici la nouvelle version
   prend la main des son installation, et la page se recharge une fois —
   une seule, un drapeau de session empeche la boucle.

   Pendant une session de developpement, on ne veut pas de cette
   mecanique : sur localhost, le service worker n'est pas enregistre.

   ── CE QUI N'EST PAS MIS EN CACHE ────────────────────────────────
   Aucun appel a l'API. Locamp affiche des soldes et des encaissements ;
   un montant perime serait pire qu'une erreur, parce que rien ne
   signalerait qu'il est perime. Le detail est commente dans sw.js.

   Usage :
     node outils/pwa-installable.js --essai
     node outils/pwa-installable.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const INDEX = path.join(process.cwd(), 'backend', 'public', 'index.html');
const SW    = path.join(process.cwd(), 'backend', 'public', 'sw.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!fs.existsSync(INDEX)) echec('backend/public/index.html introuvable. Lancez depuis la racine du projet.');

let index = fs.readFileSync(INDEX, 'utf8');

if (index.indexOf('serviceWorker') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

const ANCIEN = `<script src="/app.js"></script>
</body>`;

const NOUVEAU = `<script src="/app.js"></script>

<script>
/* ---- Service worker ----
   Enregistre APRES le chargement : s'installer pendant le premier affichage
   reviendrait a disputer la bande passante a ce que l'utilisateur attend.

   Pas sur localhost — pendant le developpement, un cache de coquille ne fait
   que masquer les modifications qu'on vient d'ecrire. */
if ('serviceWorker' in navigator
    && location.hostname !== 'localhost'
    && location.hostname !== '127.0.0.1') {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function (e) {
      console.warn('[PWA] enregistrement impossible :', e.message);
    });

    /* Une nouvelle version prend la main : on recharge une fois pour que
       l'utilisateur la voie. Sans le drapeau, deux onglets peuvent se
       recharger l'un l'autre indefiniment. */
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (sessionStorage.getItem('locamp_sw_recharge')) return;
      sessionStorage.setItem('locamp_sw_recharge', '1');
      location.reload();
    });
  });
}
</script>
</body>`;

if (index.split(ANCIEN).length - 1 !== 1) echec('index.html : fin de document introuvable.');
index = index.split(ANCIEN).join(NOUVEAU);

if (!ESSAI) {
  fs.writeFileSync(INDEX, index, 'utf8');
  if (fs.readFileSync(INDEX, 'utf8').indexOf('serviceWorker') === -1) {
    echec('L\'enregistrement n\'est pas dans le fichier apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Service worker enregistre apres le chargement de la page.');
console.log('  Rien de l\'API n\'est mis en cache.\n');

if (!fs.existsSync(SW)) {
  console.log('  \u26a0  backend/public/sw.js est absent. Copiez-le :');
  console.log('     cp ~/Downloads/livraison-pwa/sw.js backend/public/\n');
}
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

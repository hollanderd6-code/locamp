#!/usr/bin/env node
/* ============================================================
   outils/barre-sans-defilement.js
   Les treize entrées tiennent sans faire défiler
   ============================================================
   Cible : backend/public/styles.css

   Il manquait une trentaine de pixels pour voir tout le menu d'un seul
   coup d'oeil. Un menu qui defile sur grand ecran cache toujours les
   memes entrees — celles du bas, Parametres et Administration.

   Ces pixels sont pris sur les marges, pas sur les cibles :

     · les entrees passent de 10 a 8 px de marge verticale
       (treize entrees, cinquante-deux pixels gagnes) ;
     · les intertitres de 20 a 13 px au-dessus
       (trois intertitres, vingt et un pixels).

   La hauteur utile d'une entree reste de 33 px, ce qui est confortable
   a la souris. Le telephone n'est pas concerne : ses cibles restent a
   48 px, ou le doigt impose la contrainte.

   Si le parc de menus grandit encore, la reponse ne sera plus le
   serrage mais le regroupement — trois sections de quatre entrees se
   lisent mieux que treize d'affilee.

   Usage :
     node outils/barre-sans-defilement.js --essai
     node outils/barre-sans-defilement.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'backend', 'public', 'styles.css');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('backend/public/styles.css introuvable. Lancez depuis la racine du projet.');

let css = fs.readFileSync(CIBLE, 'utf8');

if (css.indexOf('══ BARRE : SANS DEFILEMENT') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}
if (css.indexOf('══ BARRE : FINITIONS') === -1) echec('Appliquez d\'abord outils/barre-finitions.js.');

css += `

/* ════════════════════════════════════════════════════════════════
   ══ BARRE : SANS DEFILEMENT ══
   ────────────────────────────────────────────────────────────────
   Trente pixels manquaient pour voir les treize entrees d'un coup. Un
   menu qui defile cache toujours les memes : celles du bas, Parametres
   et Administration.

   Ils sont pris sur les marges, jamais sur les cibles : la hauteur utile
   d'une entree reste de 33 px, confortable a la souris. Le telephone
   garde ses 48 px — la c'est le doigt qui commande.
   ──────────────────────────────────────────────────────────────── */
@media (min-width:881px){
  body .sidebar .nav a{padding:8px 12px}
  body .sidebar .nav-grp{padding:13px 12px 7px}
  body .sidebar .nav-grp:first-child{padding-top:4px}
  body .sidebar .nav{margin-top:6px;gap:0}
  body .sidebar .sidebar-head::after{margin:14px 2px 0}
  body .sidebar .sidebar-foot{padding-top:12px;margin-top:12px}
}
`;

if (!ESSAI) {
  fs.writeFileSync(CIBLE, css, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('══ BARRE : SANS DEFILEMENT') === -1) {
    echec('Le correctif n\'est pas dans le fichier apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Environ 75 px gagnes sur grand ecran, pris aux marges.');
console.log('  Cibles inchangees sur telephone.\n');
console.log('  Rechargez avec Cmd+Maj+R.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

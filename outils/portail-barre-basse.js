#!/usr/bin/env node
/* ============================================================
   outils/portail-barre-basse.js
   La barre de défilement, et la barre d'onglets qui se rétrécit
   ============================================================
   Cible : backend/public/portail/portail.css

   ── 1. LA BARRE DE DEFILEMENT ────────────────────────────────────
   Le trait gris vertical, entoure sur la capture, est la barre de
   defilement de WebKit. Dans un navigateur, elle a sa raison d'etre :
   elle dit ou l'on se trouve dans la page. Dans une application, elle
   ne fait que trahir le webview — aucune application native n'en
   affiche.

   ── 2. LA BARRE D'ONGLETS QUI SE RETRECIT ────────────────────────
   En defilant, les libelles « Solde », « Factures » se coupent par le
   bas. La cause : la barre n'a pas de hauteur propre. Elle se contente
   de son contenu plus le padding de zone sure — et sur iOS, la valeur
   de « env(safe-area-inset-bottom) » VARIE pendant le defilement, quand
   le systeme escamote l'indicateur d'accueil.

   Une barre dont la hauteur depend d'une valeur mouvante se deforme donc
   au toucher. On lui donne une hauteur minimale fixe, a laquelle la zone
   sure s'AJOUTE : la barre peut descendre plus bas sur un appareil a
   encoche, mais jamais remonter au point de couper son texte.

   ── 3. LE PIED SOUS LA BARRE ─────────────────────────────────────
   « Espace securise… Confidentialite » s'affiche juste au-dessus de la
   barre d'onglets, sans marge : le lien se touche difficilement. Une
   reserve l'en ecarte.

   Usage :
     node outils/portail-barre-basse.js --essai
     node outils/portail-barre-basse.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'backend', 'public', 'portail', 'portail.css');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('backend/public/portail/portail.css introuvable.');

let css = fs.readFileSync(CIBLE, 'utf8');

if (css.indexOf('BARRE BASSE') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

css += `

/* ════════════════════════════════════════════════════════════════
   ══ BARRE BASSE ══
   ──────────────────────────────────────────────────────────────── */

/* La barre de defilement de WebKit trahit le webview : aucune
   application native n'en affiche. Le contenu continue de defiler. */
::-webkit-scrollbar{width:0;height:0}
html{scrollbar-width:none}
body{-ms-overflow-style:none}

/* La barre d'onglets se coupait en defilant : sa hauteur dependait de
   « env(safe-area-inset-bottom) », dont iOS fait varier la valeur quand
   il escamote l'indicateur d'accueil. Une hauteur minimale fixe, a
   laquelle la zone sure s'ajoute : la barre peut descendre plus bas,
   jamais remonter au point de couper son texte. */
body .onglets{
  min-height:56px;
  box-sizing:content-box;
  padding-top:6px;
  padding-bottom:max(6px, env(safe-area-inset-bottom));
  align-items:flex-start;
}
body .onglets a,
body .onglets button{
  min-height:44px;   /* la cible reste franche, quoi qu'il arrive au-dessous */
}

/* Le pied s'ecartait a peine de la barre : le lien se touchait mal. */
body .footy{
  margin-bottom:18px;
  padding-bottom:0;
}
`;

if (!ESSAI) {
  fs.writeFileSync(CIBLE, css, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('BARRE BASSE') === -1) {
    echec('Le correctif n\'est pas dans le fichier apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Barre de defilement masquee.');
console.log('  Barre d\'onglets a hauteur fixe : elle ne se coupe plus.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

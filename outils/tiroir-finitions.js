#!/usr/bin/env node
/* ============================================================
   outils/tiroir-finitions.js
   Le pied du tiroir, et le vide sous l'enseigne
   ============================================================
   Cible : backend/public/styles.css

   Le tiroir s'ouvre et le menu s'y trouve. Restent deux defauts, tous
   deux dus a la meme cause que le precedent : l'ancien montage mobile
   emploie « body.nav-open ... », un element et deux classes, que mes
   regles a deux classes ne peuvent pas battre. Cette fois-ci elles
   reprennent le meme selecteur.

   ── 1. LE PIED RESTE EN COLONNE ──────────────────────────────────
   tiroir-source.js epargnait deliberement .sidebar-foot — sa direction
   en ligne est voulue. Mais l'ancien montage la force en colonne AVEC
   « body.nav-open », et centre le contenu : l'initiale, le nom et le
   bouton s'empilent au milieu, ce qui donne un bloc flottant sans
   alignement avec le reste du tiroir.

   Le pied redevient une ligne : l'initiale, le nom et le role au fil du
   texte, le bouton de sortie a droite.

   ── 2. UN VIDE DE CENT PIXELS SOUS L'ENSEIGNE ────────────────────
   Trois marges s'additionnaient entre le filet et « EXPLOITATION » : la
   marge basse du filet, la marge haute du menu, et le retrait du premier
   intertitre. Chacune raisonnable seule, ensemble un trou plus grand que
   deux entrees de menu.

   Le filet porte desormais la separation a lui seul.

   ── 3. DEUX ENTREES DE PLUS A L'ECRAN ────────────────────────────
   Faire defiler treize entrees est normal sur un telephone. Mais 14 px
   de marge intérieure par entree, plus 18 px avant chaque intertitre,
   coutaient deux entrees de visible pour rien : les cibles restent a
   48 px de haut, ce qui est la seule contrainte reelle.

   Usage :
     node outils/tiroir-finitions.js --essai
     node outils/tiroir-finitions.js
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

if (css.indexOf('══ TIROIR : FINITIONS') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}
if (css.indexOf('══ ENVELOPPE') === -1) echec('Appliquez d\'abord outils/enveloppe-locamp.js.');

css += `

/* ════════════════════════════════════════════════════════════════
   ══ TIROIR : FINITIONS ══
   ────────────────────────────────────────────────────────────────
   Meme lecon que precedemment : l'ancien montage mobile ecrit
   « body.nav-open ... » — un element et deux classes. Une regle a deux
   classes ne le bat pas, ou qu'elle se trouve dans la feuille. Ces
   regles reprennent donc le selecteur a l'identique.
   ──────────────────────────────────────────────────────────────── */
@media (max-width:880px){

  /* ---- Le haut : une seule separation ----
     Le filet, la marge du menu et le retrait du premier intertitre
     s'additionnaient : cent pixels de vide, soit deux entrees perdues. */
  body.nav-open .sidebar-head::after{margin:15px 0 0}
  body.nav-open .nav{margin-top:10px}
  body.nav-open .nav-grp:first-child{padding-top:4px}
  body.nav-open #camping-switch{margin-bottom:7px}
  body.nav-open #exercice-switch{margin-bottom:0}

  /* ---- Le menu : deux entrees de plus a l'ecran ----
     La cible reste a 48 px de haut — c'est la seule contrainte reelle.
     Ce sont les marges autour qui coutaient de la place. */
  body.nav-open .nav a{padding:12px 13px;min-height:48px}
  body.nav-open .nav-grp{padding:14px 13px 6px}

  /* ---- Le pied : une ligne, pas une colonne ----
     L'ancien montage le passait en colonne et centrait son contenu, ce
     qui detachait le bloc du reste du tiroir. */
  body.nav-open .sidebar-foot{
    flex-direction:row;
    align-items:center;
    justify-content:flex-start;
    gap:10px;
    text-align:left;
    flex-wrap:nowrap;
    padding-top:14px;
    margin-top:10px;
  }
  body.nav-open .sidebar-foot .user-ini{width:34px;height:34px;flex:0 0 auto;font-size:13px}
  body.nav-open .sidebar-foot .user-bloc{flex:1 1 auto;min-width:0;text-align:left}
  body.nav-open .sidebar-foot .user-name{font-size:13px}
  body.nav-open .sidebar-foot .user-role{font-size:10.5px}

  /* Le bouton de sortie : une icone, alignee a droite. Un « span » masque
     laissait sinon une case vide a cote d'elle. */
  body.nav-open .sidebar-foot #logout-btn{
    flex:0 0 auto;width:34px;height:34px;min-width:0;padding:0;
    display:flex;align-items:center;justify-content:center;border-radius:9px}
  body.nav-open .sidebar-foot #logout-btn span{display:none}
  body.nav-open .sidebar-foot #logout-btn svg{width:15px;height:15px}
}
`;

if (!ESSAI) {
  fs.writeFileSync(CIBLE, css, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('══ TIROIR : FINITIONS') === -1) {
    echec('Le correctif n\'est pas dans le fichier apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Pied du tiroir : une ligne, aligne a gauche, sortie a droite.');
console.log('  Vide sous l\'enseigne resorbe, deux entrees de plus a l\'ecran.\n');
console.log('  Rechargez avec Cmd+Maj+R.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

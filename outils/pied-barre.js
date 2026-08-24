#!/usr/bin/env node
/* ============================================================
   outils/pied-barre.js
   Le pied de barre, et le bouton que j'avais ignoré
   ============================================================
   Cible : backend/public/styles.css

   ── CE QUE LA MESURE A REVELE ────────────────────────────────────
   Les enfants du pied, tiroir ouvert :

       DIV     user-ini      « CI »
       DIV     user-bloc     « Charles Induni / Gestionnaire »
       BUTTON  btn-ghost     « Notifications0 »      <-- inconnu de moi
       BUTTON  btn-ghost     « Se deconnecter »

   Un bouton Notifications, pose par une autre partie du produit. Mes
   regles ne connaissaient que la sortie : lui a donc herite d'un
   « span{display:none} » destine a l'autre, ce qui l'a vide de son texte
   sans le vider de sa boite. D'ou le carre muet sur la capture.

   ── LA CONSEQUENCE, PLUS LARGE QU'ELLE N'Y PARAIT ────────────────
   Quatre elements empiles en colonne, le pied mesure pres de 200 px. Il
   prend cette hauteur au menu, qui doit alors defiler des « Impayes » —
   sur grand ecran comme sur telephone. Le defaut visible etait le pied ;
   le defaut couteux etait le menu tronque.

   ── CE QUI EST FAIT ──────────────────────────────────────────────
   Le pied devient une grille de deux lignes :

       [CI]  Charles Induni / Gestionnaire        [sortie]
       [ Notifications                        3 ]

   Notifications garde sa pleine largeur : c'est une action avec un
   compteur, pas une icone d'appoint. La sortie reste une icone. Le pied
   passe ainsi de 200 a environ 90 px, et le menu recupere la place.

   Le selecteur est « body .sidebar .sidebar-foot » — un element et deux
   classes, de quoi passer devant l'ancien montage sans avoir a deviner
   ce qu'il contient. C'est la troisieme fois que la specificite decide :
   autant la prendre au serieux d'emblee.

   Usage :
     node outils/pied-barre.js --essai
     node outils/pied-barre.js
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

if (css.indexOf('══ PIED DE BARRE') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}
if (css.indexOf('══ ENVELOPPE') === -1) echec('Appliquez d\'abord outils/enveloppe-locamp.js.');

css += `

/* ════════════════════════════════════════════════════════════════
   ══ PIED DE BARRE ══
   ────────────────────────────────────────────────────────────────
   Le pied contient QUATRE elements, pas trois : l'initiale, le nom, un
   bouton Notifications pose par ailleurs, et la sortie. Empiles en
   colonne, ils occupaient pres de 200 px — pris au menu, qui devait
   defiler des « Impayes ».

   Une grille de deux lignes, valable sur les deux tailles d'ecran :

       [CI]  Nom / role                    [sortie]
       [ Notifications                  3 ]

   Notifications garde sa largeur : une action avec un compteur n'est pas
   une icone d'appoint. La sortie, faite une fois par jour, en est une.
   ──────────────────────────────────────────────────────────────── */

body .sidebar .sidebar-foot{
  display:grid;
  grid-template-columns:auto minmax(0,1fr) auto;
  align-items:center;
  gap:9px 10px;
  flex:0 0 auto;
  width:auto;
  text-align:left;
  padding-top:14px;
  margin-top:14px;
  border-top:1px solid rgba(255,255,255,.08);
}

body .sidebar .sidebar-foot .user-ini{
  grid-column:1;width:32px;height:32px;flex:none;border-radius:50%;
  background:#1B3A31;border:1px solid rgba(185,138,60,.30);
  display:flex;align-items:center;justify-content:center;
  font-family:"Fraunces",serif;font-size:13px;font-weight:600;color:var(--or-clair)}

body .sidebar .sidebar-foot .user-bloc{grid-column:2;min-width:0;text-align:left}
body .sidebar .sidebar-foot .user-name{display:block;font-size:12.5px;font-weight:600;
  color:#D8E3DD;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
body .sidebar .sidebar-foot .user-role{font-size:10.5px;color:#6F8378;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* La sortie : une icone, au bout de la premiere ligne. */
body .sidebar .sidebar-foot #logout-btn{
  grid-column:3;width:32px;height:32px;min-width:0;padding:0;flex:none;
  display:flex;align-items:center;justify-content:center;border-radius:9px;
  border-color:rgba(255,255,255,.10)}
body .sidebar .sidebar-foot #logout-btn span{display:none}
body .sidebar .sidebar-foot #logout-btn svg{width:15px;height:15px}

/* Notifications : seconde ligne, pleine largeur, son compteur a droite.
   Le « :not » evite de lui appliquer les regles ecrites pour la sortie —
   c'est ce qui l'avait vide de son texte sans vider sa boite. */
body .sidebar .sidebar-foot .btn-ghost:not(#logout-btn){
  grid-column:1 / -1;
  width:100%;height:auto;min-height:38px;padding:9px 12px;
  display:flex;align-items:center;justify-content:space-between;gap:8px;
  border-radius:9px;border-color:rgba(255,255,255,.10);
  color:#C3D2CA;font-size:12.5px;font-weight:500;text-align:left}
body .sidebar .sidebar-foot .btn-ghost:not(#logout-btn) span{display:inline-flex}
body .sidebar .sidebar-foot .btn-ghost:not(#logout-btn):hover{
  background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.20)}

@media (max-width:880px){
  /* Le tiroir suit la meme grille, en cibles un peu plus grandes. */
  body.nav-open .sidebar-foot{grid-template-columns:auto minmax(0,1fr) auto;
    display:grid;margin-top:10px}
  body.nav-open .sidebar-foot .user-ini{width:34px;height:34px}
  body.nav-open .sidebar-foot #logout-btn{width:34px;height:34px}
  body.nav-open .sidebar-foot .btn-ghost:not(#logout-btn){min-height:44px;font-size:13.5px}
}
`;

if (!ESSAI) {
  fs.writeFileSync(CIBLE, css, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('══ PIED DE BARRE') === -1) {
    echec('Le correctif n\'est pas dans le fichier apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Pied en deux lignes : identite et sortie, puis Notifications.');
console.log('  Il passe de ~200 a ~90 px : le menu recupere la place.\n');
console.log('  Rechargez avec Cmd+Maj+R.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

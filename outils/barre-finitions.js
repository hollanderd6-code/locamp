#!/usr/bin/env node
/* ============================================================
   outils/barre-finitions.js
   Le vide sous l'enseigne, et l'ordre du pied
   ============================================================
   Cible : backend/public/styles.css

   ── 1. CENT PIXELS DE VIDE, SUR GRAND ECRAN ──────────────────────
   J'avais resorbe ce trou dans le seul « @media (max-width:880px) » :
   sur grand ecran il subsistait. C'est lui qui obligeait a faire defiler
   un menu qui, sans lui, tient entierement.

   Quatre marges s'additionnaient entre le filet et « EXPLOITATION » :
   le remplissage bas de l'enseigne, la marge basse du filet, la marge
   haute du menu, et le retrait du premier intertitre. Chacune modeste,
   ensemble plus haut que deux entrees.

   Le filet porte seul la separation.

   ── 2. LE PIED : TROIS LIGNES AU LIEU DE DEUX ────────────────────
   La grille etait posee, mais je n'avais fixe que les colonnes. Or en
   grille, un element declare en colonne 3 APRES un element qui occupe
   toute la largeur ne peut pas remonter : le placement automatique
   avance et ne revient jamais en arriere. La sortie se retrouvait donc
   seule sur une troisieme ligne.

   Les lignes sont desormais explicites. Erreur de raisonnement, pas de
   specificite : j'ai decrit les colonnes en pensant avoir decrit la
   grille.

   ── 3. LE BOUTON NOTIFICATIONS ───────────────────────────────────
   Son libelle s'affichait deux fois trop grand : la taille du texte des
   boutons est fixee ailleurs avec plus de poids que ma regle. Il prend
   ici la meme forme que les autres lignes de la barre — meme taille,
   meme graisse, cloche a la taille des icones de menu — et son compteur
   va a droite.

   Usage :
     node outils/barre-finitions.js --essai
     node outils/barre-finitions.js
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

if (css.indexOf('══ BARRE : FINITIONS') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}
if (css.indexOf('══ PIED DE BARRE') === -1) echec('Appliquez d\'abord outils/pied-barre.js.');

css += `

/* ════════════════════════════════════════════════════════════════
   ══ BARRE : FINITIONS ══
   ──────────────────────────────────────────────────────────────── */

/* ---- Le vide sous l'enseigne ----
   Quatre marges s'additionnaient : remplissage bas de l'enseigne, marge du
   filet, marge du menu, retrait du premier intertitre. Plus haut que deux
   entrees de menu — et c'est ce qui obligeait a faire defiler sur grand
   ecran un menu qui tient sans cela. Le filet suffit a separer. */
body .sidebar .sidebar-head{padding-bottom:0}
body .sidebar .sidebar-head::after{margin:16px 2px 0}
body .sidebar .nav{margin-top:8px}
body .sidebar .nav-grp:first-child{padding-top:6px}
body .sidebar #camping-switch{margin-bottom:7px}
body .sidebar #exercice-switch{margin-bottom:0}

/* ---- Le pied : les LIGNES, pas seulement les colonnes ----
   En grille, un element declare en colonne 3 apres un element pose sur
   toute la largeur ne remonte pas : le placement automatique avance et ne
   revient jamais. La sortie tombait donc sur une troisieme ligne. */
body .sidebar .sidebar-foot{grid-template-rows:auto auto}
body .sidebar .sidebar-foot .user-ini{grid-row:1;grid-column:1}
body .sidebar .sidebar-foot .user-bloc{grid-row:1;grid-column:2}
body .sidebar .sidebar-foot #logout-btn{grid-row:1;grid-column:3}
body .sidebar .sidebar-foot .btn-ghost:not(#logout-btn){grid-row:2;grid-column:1 / -1}

/* ---- Notifications : une ligne de barre, pas une banniere ----
   Son libelle s'affichait deux fois trop grand, la taille du texte des
   boutons etant fixee ailleurs avec plus de poids. Il prend ici la forme
   des autres lignes du menu, compteur a droite. */
body .sidebar .sidebar-foot .btn-ghost:not(#logout-btn),
body .sidebar .sidebar-foot .btn-ghost:not(#logout-btn) *{
  font-size:12.5px;
  font-weight:500;
  line-height:1.3;
  letter-spacing:0;
  text-transform:none}
body .sidebar .sidebar-foot .btn-ghost:not(#logout-btn){
  min-height:36px;padding:8px 12px;gap:9px;color:#9FB3A9}
body .sidebar .sidebar-foot .btn-ghost:not(#logout-btn) svg,
body .sidebar .sidebar-foot .btn-ghost:not(#logout-btn) i{
  width:15px;height:15px;font-size:13px;flex:none;opacity:.72}
/* Le compteur file a droite quel que soit le balisage du bouton. */
body .sidebar .sidebar-foot .btn-ghost:not(#logout-btn) span:last-child{margin-left:auto}

@media (max-width:880px){
  body.nav-open .sidebar-head{padding-bottom:0}
  body.nav-open .sidebar-head::after{margin:15px 0 0}
  body.nav-open .nav{margin-top:8px}
  body.nav-open .sidebar-foot .btn-ghost:not(#logout-btn),
  body.nav-open .sidebar-foot .btn-ghost:not(#logout-btn) *{font-size:13.5px}
  body.nav-open .sidebar-foot .btn-ghost:not(#logout-btn){min-height:44px}
}
`;

if (!ESSAI) {
  fs.writeFileSync(CIBLE, css, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('══ BARRE : FINITIONS') === -1) {
    echec('Le correctif n\'est pas dans le fichier apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Vide sous l\'enseigne resorbe sur les deux tailles.');
console.log('  Pied sur deux lignes : la sortie remonte a cote du nom.');
console.log('  Notifications a la taille des autres lignes de la barre.\n');
console.log('  Rechargez avec Cmd+Maj+R.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

#!/usr/bin/env node
/* ============================================================
   Quatre défauts vus à l'écran
   ============================================================
   Cibles : backend/public/app.js et backend/public/styles.css

   ── 1. L'EXERCICE COMPTABLE SE TERMINE UN MOIS TROP TÔT ──────────
   L'écran Comptabilité annonce :

       Exercice en cours : 01/01/2026 → 30/11/2026 (année civile)

   Une année civile se termine le 31 décembre. Le calcul perd un mois.

   La cause est dans exerciceCourant() :

       new Date(y, 11, 0)     // dernier jour de… novembre

   new Date(année, mois, 0) renvoie le dernier jour du mois PRÉCÉDENT,
   parce que les mois sont numérotés à partir de zéro et que le jour 0
   est la veille du 1er. Pour obtenir le 31 décembre il faut donc
   passer 12, pas 11.

   Le fichier contient déjà exBornesAn(), qui fait le même calcul et le
   fait juste. Deux implémentations concurrentes, et c'est la fausse qui
   s'affiche — c'est la cinquième fois que ce motif apparaît dans ce
   produit. La bonne l'emporte, la fausse disparaît.

   Portée : le défaut ne touche QUE l'exercice en année civile (mois de
   début = janvier), c'est-à-dire le réglage par défaut. Pour un
   exercice décalé — avril, juillet, octobre — les deux fonctions
   donnaient le même résultat. C'est donc la majorité des campings qui
   lisait une date fausse.

   L'exercice n'est utilisé ici que pour l'affichage : les exports FEC
   prennent les dates saisies dans le formulaire, ils ne sont pas
   faussés. Mais un gestionnaire qui lit « jusqu'au 30/11 » peut
   exporter la mauvaise période — le dégât est en aval.

   ── 2. LE NOM DU CAMPING EST COUPÉ ───────────────────────────────
   La barre latérale affiche « Camping Le parc des gra », coupé net au
   milieu d'un mot, sans point de suspension. Rien n'indique que le
   texte continue. Un gestionnaire multi-sites ne peut pas distinguer
   deux campings dont les noms commencent pareil.

   ── 3. UN BOUTON QUI NE DIT PAS CE QU'IL FAIT ────────────────────
   En bas de la barre latérale, un bouton pleine largeur contenant une
   seule cloche en émoji. Ni libellé, ni compteur, ni infobulle. Un
   émoji n'est pas une icône : son dessin change d'un système à
   l'autre, il n'hérite pas de la couleur du texte, et un lecteur
   d'écran l'annonce « cloche ». Remplacé par une icône tracée et le
   mot « Notifications ».

   ── 4. LES CHAMPS DE CONNEXION EN JAUNE FLUO ─────────────────────
   Le remplissage automatique du navigateur impose son propre fond
   jaune, qui écrase la palette au premier écran que voit
   l'utilisateur. Ce jaune n'est pas une couleur du produit.

   Usage :
     node outils/defauts-ecran.js --essai
     node outils/defauts-ecran.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const RACINE = process.cwd();
const F_JS = path.join(RACINE, 'backend', 'public', 'app.js');
const F_CSS = path.join(RACINE, 'backend', 'public', 'styles.css');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

for (const [f, q] of [[F_JS, 'backend/public/app.js'], [F_CSS, 'backend/public/styles.css']]) {
  if (!fs.existsSync(f)) {
    console.error('\n  \u2717 ' + q + ' introuvable. Lancez depuis la racine du dépôt.\n');
    process.exit(1);
  }
}

let js = fs.readFileSync(F_JS, 'utf8');
let css = fs.readFileSync(F_CSS, 'utf8');

if (js.indexOf('exerciceCourant supprimée') !== -1) {
  console.log('\n  Déjà appliqué — rien à faire.\n');
  process.exit(0);
}

const editsJs = [];

/* ── 1. L'exercice ───────────────────────────────────────────── */
editsJs.push(['exerciceCourant remplacée par exBornesAn',
`function exerciceCourant(debutMois) {
  // debutMois : 1-12 (parametres.exercice_debut_mois). Renvoie {debut, fin} ISO de l'exercice en cours.
  const dm = Math.min(Math.max(Number(debutMois || 1), 1), 12);
  const now = new Date();
  let y = now.getFullYear();
  if (now.getMonth() + 1 < dm) y -= 1;
  const debut = \`\${y}-\${String(dm).padStart(2, '0')}-01\`;
  const finDate = new Date(y + (dm === 1 ? 0 : 1), dm === 1 ? 11 : dm - 1, 0); // dernier jour du mois précédent, année suivante
  const fin = \`\${finDate.getFullYear()}-\${String(finDate.getMonth() + 1).padStart(2, '0')}-\${String(finDate.getDate()).padStart(2, '0')}\`;
  return { debut, fin };
}`,
`/* exerciceCourant supprimée : elle calculait une fin d'exercice un mois
   trop tôt en année civile (30/11 au lieu du 31/12), à cause d'un
   new Date(y, 11, 0) — qui renvoie le dernier jour de NOVEMBRE, les mois
   étant numérotés à partir de zéro.

   exBornesAn(), déjà présente dans ce fichier, fait le même calcul
   correctement. Une seule implémentation désormais : deux fonctions qui
   calculent la même chose finissent toujours par diverger, et c'est la
   fausse qui s'affichait. */
function exerciceCourant(debutMois) {
  return exBornesAn(exAnCourant(debutMois), debutMois);
}`]);

/* ── 3. Le bouton de notifications ───────────────────────────── */
editsJs.push(['bouton Notifications : icône tracée et libellé',
  `🔔`,
  `<svg class="nav-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8.5a6 6 0 1 0-12 0c0 6-2 7.5-2 7.5h16s-2-1.5-2-7.5z"/><path d="M13.7 20a2 2 0 0 1-3.4 0"/></svg><span>Notifications</span>`]);

let faitsJs = 0;
for (const [nom, avant, apres] of editsJs) {
  const n = js.split(avant).length - 1;
  if (n < 1) {
    console.error('\n  \u2717 ' + nom + ' : motif introuvable. Rien n\'a été écrit.\n');
    process.exit(1);
  }
  js = js.split(avant).join(apres);
  console.log('  appliqué  ' + nom + (n > 1 ? '  (' + n + ' occurrences)' : ''));
  faitsJs += n;
}

/* ── 2 et 4 : CSS ────────────────────────────────────────────── */
const CSS_AJOUT = `

/* ---------------- Corrections d'écran ----------------
   Ajoutées après revue des captures du 23 août 2026. */

/* Le sélecteur de camping coupait le nom au milieu d'un mot, sans rien
   indiquer : « Camping Le parc des gra ». Un point de suspension dit au
   moins qu'il manque quelque chose, et l'infobulle donne le nom entier.
   Un <select> ne tronque pas proprement de lui-même : text-overflow ne
   s'applique qu'au texte replié, d'où le padding qui dégage la flèche. */
.camping-switch select{
  text-overflow:ellipsis;
  white-space:nowrap;
  overflow:hidden;
  padding-right:34px;
}

/* Le remplissage automatique du navigateur impose un fond jaune vif qui
   écrase la palette — sur l'écran de connexion, c'est la première chose
   que voit l'utilisateur. Aucune propriété ne le désactive : la seule
   parade est une transition de fond assez longue pour que la couleur
   imposée n'apparaisse jamais, et une couleur de texte forcée par
   -webkit-text-fill-color, que l'autofill respecte. */
input:-webkit-autofill,
input:-webkit-autofill:hover,
input:-webkit-autofill:focus,
input:-webkit-autofill:active{
  -webkit-text-fill-color:var(--encre);
  -webkit-box-shadow:0 0 0 1000px var(--carte) inset;
  box-shadow:0 0 0 1000px var(--carte) inset;
  caret-color:var(--encre);
  transition:background-color 100000s ease-in-out 0s;
}
`;

if (css.indexOf('-webkit-autofill') === -1) {
  css += CSS_AJOUT;
  console.log('  appliqué  nom du camping tronqué proprement');
  console.log('  appliqué  champs de connexion : plus de jaune imposé');
} else {
  console.log('  déjà fait CSS');
}

/* ── Contrôles ───────────────────────────────────────────────── */
try {
  new Function(js);
} catch (e) {
  console.error('\n  \u2717 app.js serait invalide : ' + e.message + '\n    Rien n\'a été écrit.\n');
  process.exit(1);
}

// exerciceCourant doit maintenant s'appuyer sur des fonctions existantes.
for (const f of ['exBornesAn', 'exAnCourant']) {
  if (!new RegExp('function\\s+' + f + '\\b').test(js)) {
    console.error('\n  \u2717 ' + f + ' introuvable : le remplacement casserait la page.');
    console.error('    Rien n\'a été écrit.\n');
    process.exit(1);
  }
}

if (js.indexOf('🔔') !== -1) {
  console.error('\n  \u2717 Un émoji cloche subsiste. Rien n\'a été écrit.\n');
  process.exit(1);
}

if (!ESSAI) {
  fs.writeFileSync(F_JS, js, 'utf8');
  fs.writeFileSync(F_CSS, css, 'utf8');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune écriture —' : '— APPLIQUÉ —'));
console.log('  Syntaxe vérifiée. exBornesAn et exAnCourant présentes.');
console.log('\n  À VÉRIFIER À L\'ÉCRAN');
console.log('    · Comptabilité : « Exercice en cours » doit afficher');
console.log('      01/01/2026 → 31/12/2026, et non 30/11 ;');
console.log('    · barre latérale : le nom long du camping se termine par');
console.log('      « … » et le nom entier apparaît au survol ;');
console.log('    · bas de la barre : « Notifications » avec une icône ;');
console.log('    · connexion : après un remplissage automatique, les champs');
console.log('      restent blancs.');
console.log('\n  RESTE À REGARDER — vu sur les mêmes captures, non traité');
console.log('    L\'écran Comptabilité empile trois cartes très espacées pour');
console.log('    peu de contenu : « Choisir un mois puis Calculer » répète ce');
console.log('    que le bouton dit déjà, et « Aucune campagne pour le moment »');
console.log('    occupe une carte entière. C\'est une question de mise en page,');
console.log('    pas un défaut — à traiter dans la revue écran par écran.');
if (ESSAI) console.log('\n  Relancez sans --essai pour appliquer.');
console.log('');

#!/usr/bin/env node
/* ============================================================
   outils/onglets-hauteur.js
   La barre d'onglets, corrigée pour ce qu'elle est vraiment
   ============================================================
   Cible : backend/public/portail/portail.css

   ── MON ERREUR ───────────────────────────────────────────────────
   J'ai ecrit, sans lire la regle d'origine :

       body .onglets{
         min-height:56px;
         box-sizing:content-box;
         align-items:flex-start;    <-- inutile
       }

   Or la barre est une GRILLE :

       .onglets{
         position:fixed;left:0;right:0;bottom:0;
         display:grid;grid-template-columns:repeat(4,1fr);
         padding-bottom:env(safe-area-inset-bottom);
       }

   « align-items:flex-start » ne veut rien dire hors d'un conteneur
   flex ; et « content-box » sur une grille rend le calcul de hauteur
   imprevisible. J'ai ecrit des valeurs qui ne pouvaient pas agir.

   C'est la troisieme fois aujourd'hui que je corrige a l'aveugle une
   regle que je n'avais pas lue.

   ── LA VRAIE CAUSE DU RETRECISSEMENT ─────────────────────────────
   La hauteur de la barre est celle de son contenu, plus
   « env(safe-area-inset-bottom) ». Cette valeur n'est pas constante :
   iOS la fait varier pendant le defilement, quand il escamote
   l'indicateur d'accueil. La barre suit — et ses libelles se coupent.

   ── LA CORRECTION ────────────────────────────────────────────────
   Une hauteur TOTALE explicite :

       height:calc(58px + env(safe-area-inset-bottom));
       box-sizing:border-box;

   La zone sure entre desormais DANS la hauteur declaree au lieu de s'y
   ajouter. Quand iOS fait varier l'inset, c'est la reserve du bas qui
   change, jamais la place des libelles : ils gardent leurs 58 px.

   Les boutons s'alignent sur cette bande de 58 px, ancres en haut de la
   cellule — « align-content » et non « align-items », puisqu'il s'agit
   d'une grille a une seule ligne.

   Usage :
     node outils/onglets-hauteur.js --essai
     node outils/onglets-hauteur.js
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

if (css.indexOf('HAUTEUR DE LA BARRE') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

/* On retire d'abord mes deux blocs precedents : ils portaient des valeurs
   inoperantes sur une grille, et les laisser brouillerait la lecture. */
const A_RETIRER = [
  `body .onglets{
  min-height:56px;
  box-sizing:content-box;
  padding-top:6px;
  padding-bottom:max(6px, env(safe-area-inset-bottom));
  align-items:flex-start;
}`,
  `.onglets{
  padding-bottom:calc(6px + env(safe-area-inset-bottom));
}`,
];

let retires = 0;
for (const bloc of A_RETIRER) {
  const n = css.split(bloc).length - 1;
  if (n) { css = css.split(bloc).join('/* remplace plus bas — voir HAUTEUR DE LA BARRE */'); retires += n; }
}

css += `

/* ════════════════════════════════════════════════════════════════
   ══ HAUTEUR DE LA BARRE ══
   ────────────────────────────────────────────────────────────────
   La barre est une GRILLE en position fixe, dont la hauteur valait
   « contenu + env(safe-area-inset-bottom) ». Or iOS fait varier cet
   inset pendant le defilement, quand il escamote l'indicateur
   d'accueil : la barre suivait, et ses libelles se coupaient.

   Une hauteur TOTALE explicite regle cela. La zone sure entre dans la
   hauteur declaree au lieu de s'y ajouter : quand l'inset varie, c'est
   la reserve du bas qui change, jamais la place des libelles.
   ──────────────────────────────────────────────────────────────── */

body .onglets{
  height:calc(58px + env(safe-area-inset-bottom));
  box-sizing:border-box;
  padding-top:5px;
  padding-bottom:env(safe-area-inset-bottom);
  /* Grille a une seule ligne : « align-content », pas « align-items ». */
  align-content:start;
  overflow:hidden;
}

body .onglets button{
  height:53px;
  padding:0;
  gap:3px;
  min-width:0;   /* un libelle long se tronque au lieu d'elargir la grille */
}
body .onglets button span{
  max-width:100%;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}

/* Le contenu s'arrete au-dessus de la barre, hauteur reelle comprise. */
body #espace{
  padding-bottom:calc(70px + env(safe-area-inset-bottom));
}
`;

if (!ESSAI) {
  fs.writeFileSync(CIBLE, css, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('HAUTEUR DE LA BARRE') === -1) {
    echec('Le correctif n\'est pas dans le fichier apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  ' + retires + ' bloc(s) inoperant(s) retire(s).');
console.log('  Hauteur totale explicite : la zone sure n\'ajoute plus rien.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

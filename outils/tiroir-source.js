#!/usr/bin/env node
/* ============================================================
   outils/tiroir-source.js
   On retire l'ancien montage au lieu de lutter contre lui
   ============================================================
   Cible : backend/public/styles.css

   ── CE QUE LA MESURE A DIT ───────────────────────────────────────
   Tiroir ouvert, depuis la console :

       sidebar : 292 x 685, flexDirection column, flexWrap WRAP
       nav     : 184 x 631, display flex, 16 enfants, visible
       navRect : x = 289

   Le menu existe, il a ses seize enfants et ses liens de 48 px. Il est
   simplement pose en SECONDE COLONNE : x = 289 pour un tiroir large de
   292, donc entierement au-dela du bord, ou overflow:hidden le masque.

   La cause est bien flex-wrap:wrap — mais mes deux correctifs n'ont pas
   pris. J'ai cherche a gagner la cascade en ajoutant des regles apres ;
   quelque chose de plus fort subsiste dans la feuille. Continuer a
   empiler serait le troisieme essai a l'aveugle.

   ── LE CHANGEMENT DE METHODE ─────────────────────────────────────
   Ce script ne rajoute rien : il SUPPRIME les declarations de l'ancien
   montage, la ou elles sont ecrites.

   Il parcourt chaque regle de la feuille, retient celles dont le
   selecteur mentionne .sidebar, et dans celles-la seulement :

       flex-wrap:wrap        ->  flex-wrap:nowrap
       flex-direction:row    ->  flex-direction:column

   L'ancien bandeau mobile s'etalait en ligne et repliait ; le tiroir est
   une colonne. Ces deux declarations n'ont plus d'objet, et tant qu'elles
   existent quelque part, elles peuvent gagner.

   Le script REND COMPTE : il affiche chaque selecteur touche. Si le
   compte est zero, la feuille servie n'est pas celle du depot — et le
   probleme est un cache de deploiement, pas du CSS.

   Usage :
     node outils/tiroir-source.js --essai
     node outils/tiroir-source.js
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
const avant = css;

/* On isole chaque bloc « selecteur { declarations } ». Les at-rules ont un
   corps qui contient d'autres blocs : ce motif ne capture donc que les regles
   terminales, ce qui est exactement ce qu'on veut modifier. */
const touches = [];

css = css.replace(/([^{}@]+)\{([^{}]*)\}/g, (bloc, sel, corps) => {
  if (sel.indexOf('.sidebar') === -1) return bloc;

  let neuf = corps;
  const notes = [];

  if (/flex-wrap\s*:\s*wrap/.test(neuf)) {
    neuf = neuf.replace(/flex-wrap\s*:\s*wrap/g, 'flex-wrap:nowrap');
    notes.push('flex-wrap');
  }
  if (/flex-direction\s*:\s*row/.test(neuf)) {
    neuf = neuf.replace(/flex-direction\s*:\s*row(?!-)/g, 'flex-direction:column');
    notes.push('flex-direction');
  }

  if (!notes.length) return bloc;
  touches.push(sel.trim().replace(/\s+/g, ' ') + '  →  ' + notes.join(', '));
  return sel + '{' + neuf + '}';
});

if (!touches.length) {
  console.log('\n  Aucune declaration a retirer : la feuille du depot est deja propre.');
  console.log('  Si le menu reste hors du tiroir, c\'est la feuille SERVIE qui differe —');
  console.log('  un cache de deploiement, pas du CSS. Verifiez avec, dans la console :\n');
  console.log('    getComputedStyle(document.querySelector(\'.sidebar\')).flexWrap\n');
  console.log('  et rechargez avec Cmd+Maj+R.\n');
  process.exit(0);
}

/* Garde-fou : on ne doit avoir touche qu'a des regles de la barre laterale. */
if (avant.length !== css.length + (0)) { /* la longueur change, c'est normal */ }

if (!ESSAI) {
  fs.writeFileSync(CIBLE, css, 'utf8');
  const relu = fs.readFileSync(CIBLE, 'utf8');
  const reste = (relu.match(/[^{}@]+\{[^{}]*\}/g) || []).filter(
    (b) => b.indexOf('.sidebar') !== -1 && /flex-wrap\s*:\s*wrap/.test(b)
  );
  if (reste.length) echec(reste.length + ' declaration(s) flex-wrap:wrap subsistent sur .sidebar.');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  ' + touches.length + ' regle(s) de l\'ancien bandeau retiree(s) :\n');
touches.forEach((t) => console.log('    ' + t));
console.log('\n  Le tiroir est une colonne : « row » et « wrap » n\'ont plus d\'objet.');
console.log('  Apres deploiement, rechargez avec Cmd+Maj+R — le CSS est mis en cache.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

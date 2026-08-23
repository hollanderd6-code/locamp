#!/usr/bin/env node
/* ============================================================
   outils/carte-statut-correctif.js
   Correctif : « Maximum call stack size exceeded » sur la carte
   ============================================================
   Cible : backend/public/app.js

   ── CE QUI S'EST PASSE ───────────────────────────────────────────
   outils/carte-statut-reel.js ajoutait cette ligne :

       window.statutReel = (e) => statutReel(e);

   Or app.js est un script classique, pas un module : une fonction
   declaree a son niveau superieur EST deja une propriete de window.
   « function statutReel » valait donc deja window.statutReel.

   La ligne l'ecrasait par une fleche qui, pour resoudre « statutReel »
   dans son corps, remonte la chaine de portee jusqu'au global — et y
   trouve desormais la fleche elle-meme. Chaque appel se rappelait
   indefiniment : la pile deborde au premier rendu de la carte.

   L'erreur ne pouvait pas apparaitre plus tot : elle ne se declenche
   qu'a l'execution, au premier emplacement dessine.

   ── LE CORRECTIF ─────────────────────────────────────────────────
   La ligne est retiree. Rien d'autre ne change : la deduction du statut
   et le selecteur de la fiche resident etaient corrects, et les deux
   appellent la fonction directement, jamais via window.

   Usage :
     node outils/carte-statut-correctif.js --essai
     node outils/carte-statut-correctif.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'backend', 'public', 'app.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

if (!fs.existsSync(CIBLE)) {
  console.error('\n  \u2717 backend/public/app.js introuvable. Lancez depuis la racine du projet.\n');
  process.exit(1);
}

let src = fs.readFileSync(CIBLE, 'utf8');

const LIGNE = `
window.statutReel = (e) => statutReel(e);`;

const n = src.split(LIGNE).length - 1;

if (n === 0) {
  console.log('\n  La ligne fautive n\'est pas presente — rien a faire.\n');
  process.exit(0);
}
if (n !== 1) {
  console.error('\n  \u2717 ' + n + ' occurrence(s), 1 attendue. Rien n\'a ete ecrit.\n');
  process.exit(1);
}

src = src.split(LIGNE).join('');

/* Verification : la fonction doit rester declaree une seule fois, et plus
   aucune reference a window.statutReel ne doit subsister. */
const decl = (src.match(/function statutReel\(/g) || []).length;
const win  = (src.match(/window\.statutReel/g) || []).length;

if (decl !== 1 || win !== 0) {
  console.error('\n  \u2717 Etat inattendu : ' + decl + ' declaration(s), ' + win + ' reference(s) a window.');
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

try {
  new Function(src);
} catch (e) {
  console.error('\n  \u2717 Le resultat n\'est pas du JavaScript valide : ' + e.message);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!ESSAI) fs.writeFileSync(CIBLE, src, 'utf8');

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log('  Ligne fautive retiree. La carte se dessine de nouveau.');
console.log('  La deduction du statut est inchangee — elle etait correcte.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

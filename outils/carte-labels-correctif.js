#!/usr/bin/env node
/* ============================================================
   outils/carte-labels-correctif.js
   Correctif : « LABELS is not defined » sur la carte
   ============================================================
   Cible : backend/public/app.js

   ── CE QUE J'AI ECRIT ────────────────────────────────────────────
   Dans carte-survol-legende.js, la fonction qui nomme l'etat d'un
   emplacement pour l'infobulle :

       return LABELS[statutReel(e)] || statutReel(e);

   LABELS n'existe pas. La table des libelles s'appelle STATUT_LIB, et
   elle est deja servie par une fonction du fichier :

       const lib = (s) => STATUT_LIB[s] || String(s || '').replace(/_/g, ' ');

   J'avais utilise lib() quelques jours plus tot pour accentuer les
   statuts de contrat, puis invente un autre nom ici. L'erreur ne se voit
   qu'a l'execution, au premier emplacement dessine : la page entiere
   s'arrete sur « LABELS is not defined ».

   ── LE CORRECTIF ─────────────────────────────────────────────────
   libelleEtat passe par lib(), comme le reste du fichier. Un seul nom
   pour une seule table : c'est ce qui evite de la chercher la prochaine
   fois.

   Usage :
     node outils/carte-labels-correctif.js --essai
     node outils/carte-labels-correctif.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'backend', 'public', 'app.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('backend/public/app.js introuvable. Lancez depuis la racine du projet.');

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('LABELS[') === -1) {
  console.log('\n  Aucune reference a LABELS — rien a faire.\n');
  process.exit(0);
}

const ANCIEN = `  return LABELS[statutReel(e)] || statutReel(e);`;
const NOUVEAU = `  /* lib() lit STATUT_LIB, la table des libelles du fichier. L'infobulle
     doit nommer l'etat comme le reste du produit — et il n'existe qu'une
     table, meme si j'en avais invente une seconde sous un autre nom. */
  return lib(statutReel(e));`;

const n = src.split(ANCIEN).length - 1;
if (n !== 1) {
  /* Repli : la ligne a pu etre reformatee. On remplace alors toute
     occurrence de LABELS[...] par lib(...), ce qui reste exact. */
  const avant = src;
  src = src.replace(/LABELS\[([^\]]+)\]\s*\|\|\s*[^;\n]+/g, 'lib($1)');
  src = src.replace(/LABELS\[([^\]]+)\]/g, 'lib($1)');
  if (src === avant) echec('Reference a LABELS introuvable sous une forme connue.');
} else {
  src = src.split(ANCIEN).join(NOUVEAU);
}

if (src.indexOf('LABELS[') !== -1) echec('Il subsiste une reference a LABELS.');
if (src.indexOf('const lib = ') === -1) echec('La fonction lib() est absente du fichier.');

try { new Function(src); }
catch (e) { echec('Le resultat n\'est pas du JavaScript valide — ' + e.message); }

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('LABELS[') !== -1) {
    echec('Une reference a LABELS subsiste apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  L\'infobulle de la carte passe par lib(), comme le reste du fichier.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

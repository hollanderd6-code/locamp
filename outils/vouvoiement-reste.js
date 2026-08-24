#!/usr/bin/env node
/* ============================================================
   outils/vouvoiement-reste.js
   Les cinq derniers tutoiements
   ============================================================
   Cible : backend/public/app.js

   ── CE QUE LA VERIFICATION A TROUVE ──────────────────────────────
   Le lot precedent avait corrige cinq messages ; cinq autres avaient
   echappe a la recherche, parce que je cherchais des formulations
   entieres au lieu de verbes a l'imperatif :

     · « Glisse pour déplacer · poignée dorée pour redimensionner »
       — l'aide du mode edition de la carte
     · « Sélectionne au moins une prestation facturable »  (deux fois)
     · « Sélectionne au moins un titre »
     · « Locamp te préviendra avant l'échéance »
       — l'aide du champ « terme » d'un document

   Le dernier est le plus visible : il apparait dans le formulaire de
   depot d'un document, sous le champ de date, et c'est une phrase
   longue — le tutoiement y saute aux yeux.

   Ces messages tutoient dans une application qui vouvoie partout
   ailleurs. Ce sont des restes de notes de developpement passees en
   production. Le vouvoiement l'emporte parce que c'est le choix deja
   fait partout, et parce que Locamp s'adresse a un gestionnaire, pas a
   un camarade.

   ── UNE PRECAUTION ───────────────────────────────────────────────
   Deux messages sont identiques (« Sélectionne au moins une prestation
   facturable »). Un remplacement global les traite tous les deux ; le
   script verifie donc un COMPTE attendu par message, et non l'unicite,
   afin de ne pas echouer sur un doublon legitime.

   Usage :
     node outils/vouvoiement-reste.js --essai
     node outils/vouvoiement-reste.js
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

/* [nom, attendu, ancien, nouveau] */
const edits = [
  ['aide du mode edition de la carte', 1,
   'Glisse pour déplacer · poignée dorée pour redimensionner',
   'Glissez pour déplacer · poignée dorée pour redimensionner'],

  ['selection de prestations', 2,
   'Sélectionne au moins une prestation facturable',
   'Sélectionnez au moins une prestation facturable'],

  ['selection de titres', 1,
   'Sélectionne au moins un titre',
   'Sélectionnez au moins un titre'],

  ['aide du champ terme', 1,
   'renseigne son terme : Locamp te préviendra avant l\\u2019échéance',
   'renseignez son terme : Locamp vous préviendra avant l\\u2019échéance'],
];

const faits = [];
for (const [nom, attendu, ancien] of edits) {
  const n = src.split(ancien).length - 1;
  if (n === 0) { faits.push(nom + ' (deja corrige)'); continue; }
  if (n !== attendu) {
    echec(nom + ' : ' + n + ' occurrence(s), ' + attendu + ' attendue(s).');
  }
}

let total = 0;
for (const [, , ancien, nouveau] of edits) {
  const n = src.split(ancien).length - 1;
  if (!n) continue;
  src = src.split(ancien).join(nouveau);
  total += n;
}

if (!total) {
  console.log('\n  Tout est deja au vouvoiement — rien a faire.\n');
  process.exit(0);
}

try { new Function(src); }
catch (e) { echec('Le resultat n\'est pas du JavaScript valide — ' + e.message); }

/* Un dernier passage : reste-t-il un imperatif a la deuxieme personne du
   singulier dans les messages ? La liste est volontairement courte — elle
   signale, elle ne corrige pas. */
const suspects = [];
[/Glisse /g, /Sélectionne /g, /Écris /g, /Crée-en/g, /Imprime-le/g,
 / te préviendra/g, / tu pourras/g, /Renseigne /g, /Choisis /g, /Vérifie /g]
  .forEach((re) => { const m = src.match(re); if (m) suspects.push(m[0].trim() + ' ×' + m.length); });

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  const relu = fs.readFileSync(CIBLE, 'utf8');
  if (relu.indexOf('Sélectionne au moins') !== -1) {
    echec('Un tutoiement subsiste apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  ' + total + ' message(s) passe(s) au vouvoiement.');
faits.forEach((f) => console.log('  · ' + f));
if (suspects.length) {
  console.log('\n  \u26a0  Formes a la deuxieme personne du singulier encore presentes :');
  suspects.forEach((s) => console.log('     ' + s));
  console.log('     (a verifier a la main — certaines peuvent etre des noms de variables)');
}
console.log('');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

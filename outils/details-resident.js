#!/usr/bin/env node
/* ============================================================
   outils/details-resident.js
   Trois finitions de la fiche résident
   ============================================================
   Cibles : backend/public/app.js

   ── 1. « emis » SANS ACCENT ──────────────────────────────────────
   Le badge de statut d'un contrat affiche la valeur brute de la base :

       esc(c.statut === 'signe' ? 'signé' : c.statut)

   « signe » est traduit a la main, les autres passent tels quels :
   « emis », « resilie », « echu ». Le fichier possede pourtant deja
   LABELS et sa fonction lib(), qui accentuent tout le reste de l'appli.
   Une exception dans un seul tableau donne l'impression d'un texte
   oublie — parce que c'en est un.

   ── 2. « NOUVEAU CONTRAT » EN DOUBLE ─────────────────────────────
   Le bouton figure en haut de la fiche, a cote de « Modifier » et
   « Encaisser », et une seconde fois dans la carte Contrats plus bas.
   Deux chemins vers la meme action sur un seul ecran.

   Celui de la carte est retire, pas celui du bandeau : la carte n'est
   visible qu'apres avoir fait defiler, alors que le bandeau est la des
   l'ouverture. Et un bouton pose contre sa liste laisse croire qu'il
   agit sur elle.

   Quand la liste est vide, le texte d'accueil mentionne deja le bouton
   du haut — la ou l'utilisateur en a besoin.

   ── 3. LE TUTOIEMENT ─────────────────────────────────────────────
   Quatre messages tutoient dans une application qui vouvoie partout
   ailleurs : « Ecris le premier », « tu pourras l'envoyer »,
   « cree-en un », « imprime-le », « Selectionne un element ».

   Ce sont des restes de notes de developpement passees en production.
   Le vouvoiement l'emporte parce que c'est le choix deja fait partout.

   Usage :
     node outils/details-resident.js --essai
     node outils/details-resident.js
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

if (src.indexOf('/* statut accentue */') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

const edits = [];

/* ── 1. Le badge de statut passe par lib() ────────────────────────── */
edits.push([
  'badge de statut',
  `\${esc(c.statut === 'signe' ? 'signé' : c.statut)}`,
  `\${/* statut accentue */ esc(lib(c.statut))}`
]);

/* ── 2. Le bouton en double, celui de la carte ─────────────────────── */
edits.push([
  'bouton en double',
  `        <button class="btn btn-primary btn-sm" data-act="nouveauContrat" data-a1="\${id}">Nouveau contrat</button>`,
  `        \${/* « Nouveau contrat » est deja dans le bandeau, visible des l'ouverture.
             Un second exemplaire pose contre la liste laisse croire qu'il agit
             sur elle. */ ''}`
]);

/* ── 3. Le tutoiement ─────────────────────────────────────────────── */
edits.push([
  'messagerie',
  `Aucun message. Écris le premier ci-dessous — le client le verra sur son portail et sera notifié par e-mail.`,
  `Aucun message. Écrivez le premier ci-dessous — le client le verra sur son portail et sera notifié par e-mail.`
]);

edits.push([
  'creation de contrat',
  `Le contrat est généré depuis le modèle (variables remplies), puis tu pourras l\\u2019envoyer en signature.`,
  `Le contrat est généré depuis le modèle (variables remplies), puis vous pourrez l\\u2019envoyer en signature.`
]);

edits.push([
  'absence de modele',
  `(aucun — crée-en un dans Paramètres)`,
  `(aucun — créez-en un dans Paramètres)`
]);

edits.push([
  'impression du PDF',
  `PDF ouvert — imprime-le pour une signature papier, puis « Signé (papier) »`,
  `PDF ouvert — imprimez-le pour une signature papier, puis « Signé (papier) »`
]);

edits.push([
  'panneau de la carte',
  `Sélectionne un élément du plan pour le modifier.`,
  `Sélectionnez un élément du plan pour le modifier.`
]);

for (const [nom, ancien] of edits) {
  const n = src.split(ancien).length - 1;
  if (n !== 1) {
    console.error('\n  \u2717 ' + nom + ' : ' + n + ' occurrence(s), 1 attendue.');
    console.error('    Le fichier a change. Rien n\'a ete ecrit.\n');
    process.exit(1);
  }
}
for (const [, ancien, nouveau] of edits) src = src.split(ancien).join(nouveau);

try {
  new Function(src);
} catch (e) {
  console.error('\n  \u2717 Le resultat n\'est pas du JavaScript valide : ' + e.message);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!ESSAI) fs.writeFileSync(CIBLE, src, 'utf8');

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log('  Statuts de contrat accentues via lib().');
console.log('  « Nouveau contrat » ne figure plus qu\'une fois.');
console.log('  Cinq messages passes au vouvoiement.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

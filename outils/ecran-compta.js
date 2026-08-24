#!/usr/bin/env node
/* ============================================================
   Écran Comptabilité
   ============================================================
   Cible : backend/public/app.js

   Se termine en code 1 au moindre motif introuvable, relit le disque
   après écriture.

   ── 1. LA RACINE AFFICHÉE N'EST PAS TOUJOURS CELLE QUI S'APPLIQUE ─
   Le défaut le plus coûteux de cet écran, parce qu'il est irréversible.

   La carte « Comptes clients » enchaîne :

       [Racine: 411] [Séquence: 5]  (Enregistrer)  [Attribuer aux clients existants]
       Aperçu : 41100001, 41100002, …

   « Attribuer » est le bouton PLEIN, donc le plus visible ; « Enregistrer »
   est un bouton fantôme. Or l'ordre logique est l'inverse : la racine doit
   être enregistrée AVANT d'être attribuée.

   attribuerComptes() ne transmet pas la racine — il appelle
   POST /api/residents/attribuer-comptes sans corps. Le serveur utilise
   donc la racine ENREGISTRÉE, pas celle affichée à l'écran.

   Conséquence : changer 411 en 412, lire l'aperçu qui affiche
   « 41200001 », cliquer sur « Attribuer » — et obtenir des comptes en
   411. L'aperçu affichait une chose, le système en a fait une autre.
   Et les numéros de compte auxiliaires, une fois attribués, entrent
   dans les écritures : on ne les reprend pas.

   Le correctif détecte l'écart et refuse, en disant quoi faire.

   ── 2. LA CONFIRMATION NE DIT PAS COMBIEN ────────────────────────
       Attribuer un numéro de compte à tous les clients qui n'en ont pas ?

   Trois clients ou trois cents, ce n'est pas la même décision. Le
   nombre est compté avant, et la racine effective est nommée.

   Si le compte ne peut pas être établi — l'API ne renvoie pas le champ
   attendu — la confirmation le dit au lieu d'afficher un nombre faux.

   ── 3. « Saisis un taux » ────────────────────────────────────────
   Un tutoiement de plus, dans un écran qui vouvoie partout ailleurs.
   Et le message ne dit pas pourquoi la saisie est refusée quand le
   taux vaut zéro — une indexation à 0 % ne changerait rien.

   ── 4. LE CHAMP DE RÉFÉRENCE COUPE SON PROPRE EXEMPLE ────────────
   180 px pour « référence (ex. IRL T1 2026) » : l'écran affiche
   « référence (ex. IRL T1 2 ». L'exemple censé guider la saisie est
   tronqué au milieu. Élargi à 230 px.

   Cette référence n'est pas décorative : elle est enregistrée dans
   loyer_indexations et c'est elle qui justifie la revalorisation
   auprès du résident.

   Usage :
     node outils/ecran-compta.js --essai
     node outils/ecran-compta.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'backend', 'public', 'app.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

if (!fs.existsSync(CIBLE)) {
  console.error('\n  \u2717 backend/public/app.js introuvable. Lancez depuis la racine du dépôt.\n');
  process.exit(1);
}

let src = fs.readFileSync(CIBLE, 'utf8');
const tailleAvant = src.length;

if (src.indexOf('racineEnregistree') !== -1) {
  console.log('\n  Déjà appliqué — rien à faire.\n');
  process.exit(0);
}

const edits = [

  /* ── 1 et 2. L'attribution ─────────────────────────────────── */
  ['attribution : racine vérifiée et nombre annoncé',
`window.attribuerComptes = async () => {
  if (!await askConfirm('Attribuer un numéro de compte à tous les clients qui n\\u2019en ont pas ?')) return;
  try {
    const r = await api('/api/residents/attribuer-comptes', { method: 'POST' });
    toast(\`\${r.attribues} compte(s) attribué(s)\`);
  } catch (e) { toast(e.message, true); }
};`,

`window.attribuerComptes = async () => {
  /* Cette action n'envoie PAS la racine : le serveur utilise celle qui est
     enregistrée dans les paramètres. Un utilisateur qui modifie le champ
     puis clique directement ici — « Attribuer » est le bouton plein, donc
     le plus visible — obtient des comptes avec l'ANCIENNE racine, alors
     que l'aperçu juste en dessous affiche la nouvelle.

     Les numéros attribués entrent dans les écritures comptables : on ne
     les reprend pas. Mieux vaut refuser que produire un plan de comptes
     que personne n'a voulu. */
  let racineEnregistree = null;
  let longueurEnregistree = null;
  try {
    const { camping } = await api('/api/camping');
    const c = (camping.parametres || {}).comptabilite || {};
    racineEnregistree = String(c.racine_client || '411');
    longueurEnregistree = Number(c.longueur_seq_client || 5);
  } catch (e) { /* on continue : le contrôle ci-dessous est simplement ignoré */ }

  const racineSaisie = ($('#cc-racine')?.value || '411').replace(/[^0-9A-Za-z]/g, '');
  const longueurSaisie = Math.min(Math.max(Number($('#cc-lng')?.value || 5), 2), 8);

  if (racineEnregistree !== null
      && (racineSaisie !== racineEnregistree || longueurSaisie !== longueurEnregistree)) {
    toast('La racine affichée (' + racineSaisie + ', ' + longueurSaisie + ' chiffres) n\\u2019est pas celle '
      + 'enregistrée (' + racineEnregistree + ', ' + longueurEnregistree + ' chiffres). '
      + 'Cliquez d\\u2019abord sur « Enregistrer » : sinon les comptes seraient créés avec l\\u2019ancienne racine.', true);
    $('#cc-racine')?.focus();
    return;
  }

  /* Combien de clients sont concernés. Trois ou trois cents, ce n'est pas
     la même décision — et la confirmation ne le disait pas. */
  let sansCompte = null;
  try {
    const { residents } = await api('/api/residents');
    if (Array.isArray(residents) && residents.length && 'compte_comptable' in residents[0]) {
      sansCompte = residents.filter((r) => !String(r.compte_comptable || '').trim()).length;
    }
  } catch (e) { /* compte indisponible : on le dira plutôt que d'inventer un nombre */ }

  const laRacine = racineEnregistree || racineSaisie;
  if (sansCompte === 0) {
    toast('Tous les clients ont déjà un numéro de compte.');
    return;
  }

  const combien = sansCompte === null
    ? 'aux clients qui n\\u2019en ont pas'
    : sansCompte + ' client' + (sansCompte > 1 ? 's' : '');

  const ok = await askConfirm(
    'Attribuer un numéro de compte à ' + combien + ' ?\\n\\n'
    + 'Les comptes seront créés en ' + laRacine + ', sur '
    + (longueurEnregistree || longueurSaisie) + ' chiffres — par exemple '
    + laRacine + String(1).padStart(longueurEnregistree || longueurSaisie, '0') + '.\\n\\n'
    + 'Un numéro de compte auxiliaire entre dans les écritures comptables : '
    + 'il ne se reprend pas ensuite.'
  );
  if (!ok) return;

  try {
    const r = await api('/api/residents/attribuer-comptes', { method: 'POST' });
    toast(r.attribues + ' compte' + (r.attribues > 1 ? 's' : '') + ' attribué' + (r.attribues > 1 ? 's' : '')
      + (r.attribues ? ' en ' + laRacine + '.' : '.'));
  } catch (e) { toast(e.message, true); }
};`],

  /* ── 3. Le tutoiement ──────────────────────────────────────── */
  ['indexation : vouvoiement et motif du refus',
   `if (!Number.isFinite(taux) || taux === 0) { toast('Saisis un taux (ex. 3.26)', true); return; }`,
   `if (!Number.isFinite(taux) || taux === 0) { toast('Saisissez un taux d\\u2019indexation, par exemple 3,26 pour +3,26 %. Un taux de zéro ne changerait aucun loyer.', true); return; }`],

  /* ── 4. Le champ tronqué ───────────────────────────────────── */
  ['champ référence : l\'exemple tient en entier',
   `<input id="idx-ref" type="text" placeholder="référence (ex. IRL T1 2026)" style="width:180px">`,
   `<input id="idx-ref" type="text" placeholder="référence (ex. IRL T1 2026)" style="width:230px" title="L\u2019indice qui justifie la revalorisation. Il est conservé dans l\u2019historique et opposable au résident.">`],
];

let total = 0;
for (const [nom, avant, apres] of edits) {
  const n = src.split(avant).length - 1;
  if (n !== 1) {
    console.error('\n  \u2717 ' + nom);
    console.error('      ' + n + ' occurrence(s), 1 attendue.');
    console.error('      Motif : ' + avant.split('\n')[0].trim().slice(0, 78));
    console.error('\n    AUCUNE écriture. Le fichier est intact.\n');
    process.exit(1);
  }
  src = src.split(avant).join(apres);
  console.log('  ok  ' + nom);
  total += 1;
}

try {
  new Function(src);
} catch (e) {
  console.error('\n  \u2717 app.js serait invalide : ' + e.message + '\n    AUCUNE écriture.\n');
  process.exit(1);
}
if (src.indexOf("toast('Saisis un taux") !== -1) {
  console.error('\n  \u2717 Le tutoiement subsiste. AUCUNE écriture.\n');
  process.exit(1);
}

if (ESSAI) {
  console.log('\n— ESSAI —  ' + total + ' remplacements, syntaxe vérifiée. Rien écrit.');
  console.log('  Relancez sans --essai pour appliquer.\n');
  process.exit(0);
}

fs.writeFileSync(CIBLE, src, 'utf8');
const relu = fs.readFileSync(CIBLE, 'utf8');
if (relu.indexOf('racineEnregistree') === -1 || relu.length === tailleAvant) {
  console.error('\n  \u2717 L\'écriture n\'a pas pris. Vérifiez les droits sur le fichier.\n');
  process.exit(1);
}

console.log('\n— APPLIQUÉ —  ' + total + ' remplacements.');
console.log('  Écriture relue : ' + tailleAvant + ' → ' + relu.length + ' octets.');
console.log('\n  À VÉRIFIER À L\'ÉCRAN — Comptabilité :');
console.log('\n    Le test qui compte, sur « Comptes clients » :');
console.log('      1. changez la racine de 411 à 412 ;');
console.log('      2. SANS cliquer sur « Enregistrer », cliquez sur');
console.log('         « Attribuer aux clients existants » ;');
console.log('      3. l\'action doit être REFUSÉE, avec un message qui dit');
console.log('         d\'enregistrer d\'abord.');
console.log('      Avant ce correctif, les comptes étaient créés en 411');
console.log('      alors que l\'aperçu affichait 412 — sans retour possible.');
console.log('\n    · la confirmation annonce le nombre de clients concernés');
console.log('      et la racine utilisée ;');
console.log('    · si tous les clients ont déjà un compte, elle le dit au');
console.log('      lieu d\'appeler le serveur pour rien ;');
console.log('    · Indexation : le champ affiche « référence (ex. IRL T1');
console.log('      2026) » en entier ;');
console.log('    · un taux vide ou nul est refusé avec un motif, en');
console.log('      vouvoyant.');
console.log('\n  RESTE À DÉCIDER — deux points de mise en page');
console.log('    1. La carte « TVA sur les encaissements » occupe une');
console.log('       hauteur entière pour un champ et un bouton ; celle de');
console.log('       l\'indexation consacre un titre et une ligne à « Aucune');
console.log('       campagne pour le moment ». Beaucoup de vide pour peu');
console.log('       de contenu.');
console.log('    2. Les dates d\'export vont jusqu\'au 31/12/2026, une date');
console.log('       future : le fichier exporté aujourd\'hui s\'appellera');
console.log('       FEC_2026-12-31.txt alors qu\'il s\'arrête en août. Un');
console.log('       nom de fichier qui annonce une période qu\'il ne');
console.log('       couvre pas prête à confusion lors d\'un contrôle.');
console.log('');

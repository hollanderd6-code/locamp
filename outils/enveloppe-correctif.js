#!/usr/bin/env node
/* ============================================================
   outils/enveloppe-correctif.js
   Correctif : la page se figeait au chargement
   ============================================================
   Cible : backend/public/app.js

   ── CE QUE J'AI CASSE ────────────────────────────────────────────
   enveloppe-locamp.js posait cet observateur :

       new MutationObserver(majEnveloppe).observe(
         document.querySelector('.sidebar'), { childList:true, subtree:true, characterData:true });

   Il surveillait la barre laterale ENTIERE. Or majEnveloppe ecrit dans
   #user-ini et #user-role, qui s'y trouvent tous les deux : chaque
   ecriture declenchait l'observateur, qui rappelait la fonction, qui
   reecrivait. Boucle infinie, fil d'execution bloque, page blanche.

   Le raisonnement etait juste — le nom d'utilisateur et les selecteurs
   sont remplis a des moments differents, mieux vaut observer que
   devimer le bon instant. C'est la portee de l'observation qui etait
   fausse : j'ai surveille une zone qui contenait mes propres ecritures.

   ── LE CORRECTIF ─────────────────────────────────────────────────
   1. L'observation se limite a #user-name, le seul element qu'on ne
      touche pas. Ecrire dans ses freres ne le reveille plus.
   2. Un garde de reentrance, en second rideau : meme si une future
      modification elargissait la portee, la fonction ne pourrait plus
      s'appeler depuis elle-meme.
   3. L'observateur n'est pose que si la cible existe — un
      querySelector nul jetait une TypeError qui emportait tout le
      fichier.

   Usage :
     node outils/enveloppe-correctif.js --essai
     node outils/enveloppe-correctif.js
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

if (src.indexOf('_majEnCours') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

const ANCIEN = `function majEnveloppe() {
  const nom = (document.getElementById('user-name')?.textContent || '').trim();`;

const NOUVEAU = `let _majEnCours = false;
function majEnveloppe() {
  /* Garde de reentrance : la fonction ecrit dans le DOM, et c'est une
     mutation du DOM qui la declenche. Sans ce verrou, elargir la portee de
     l'observateur d'un cran suffit a figer la page — c'est arrive. */
  if (_majEnCours) return;
  _majEnCours = true;
  try { _majEnveloppe(); } finally { _majEnCours = false; }
}
function _majEnveloppe() {
  const nom = (document.getElementById('user-name')?.textContent || '').trim();`;

const A2 = `new MutationObserver(majEnveloppe).observe(document.querySelector('.sidebar'),
  { childList: true, subtree: true, characterData: true });`;

const N2 = `/* On observe #user-name SEUL : c'est le seul element rempli par ailleurs que
   majEnveloppe ne touche pas. Surveiller toute la barre laterale revenait a
   s'ecouter soi-meme, puisque #user-ini et #user-role y vivent aussi. */
const _cibleObs = document.getElementById('user-name');
if (_cibleObs) {
  new MutationObserver(majEnveloppe).observe(_cibleObs,
    { childList: true, subtree: true, characterData: true });
}`;

for (const [nom, a] of [['majEnveloppe', ANCIEN], ['observateur', A2]]) {
  const n = src.split(a).length - 1;
  if (n !== 1) echec(nom + ' : ' + n + ' occurrence(s), 1 attendue. Le fichier a change.');
}
src = src.split(ANCIEN).join(NOUVEAU).split(A2).join(N2);

try { new Function(src); }
catch (e) { echec('Le resultat n\'est pas du JavaScript valide — ' + e.message); }

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  const relu = fs.readFileSync(CIBLE, 'utf8');
  if (relu.indexOf('_majEnCours') === -1) echec('Le correctif n\'est pas dans le fichier apres ecriture.');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  L\'observateur ne surveille plus que #user-name.');
console.log('  Garde de reentrance en second rideau.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

#!/usr/bin/env node
/* ============================================================
   outils/portail-signer-en-tete.js
   Ce qui attend une signature passe devant tout
   ============================================================
   Cibles : backend/public/portail/portail.css
            backend/public/portail/index.html
   Prerequis : outils/portail-onglets.js applique.

   ── LE RAISONNEMENT ──────────────────────────────────────────────
   Un document a signer est la seule chose du portail qui BLOQUE le
   camping : sans cette signature, le contrat n'existe pas, la caution
   n'est pas actee, l'emplacement reste en suspens. Tout le reste —
   solde, factures, messages — informe le resident sans rien attendre
   de lui.

   Le script precedent l'avait remonte en tete de l'onglet Documents.
   C'est insuffisant : un resident qui ouvre son portail arrive sur
   « Solde », et ne verra rien. Le compteur sur l'onglet est un signal
   discret ; il faut avoir l'idee de le lire.

   ── CE QUI EST FAIT ──────────────────────────────────────────────
   Le bloc « Documents a signer » s'affiche EN TETE DE TOUS LES ONGLETS
   quand il contient quelque chose. Pas duplique, pas deplace dans le
   DOM : la meme section, sortie de la logique d'onglets.

   Quand il est vide, portail.js lui pose « hidden » et il disparait,
   comme aujourd'hui. Un bandeau permanent qui annonce zero document a
   signer apprendrait a ne plus le regarder.

   ── L'AVERTISSEMENT, ET SA MESURE ────────────────────────────────
   Le bloc recoit un filet ambre et un intitule qui dit l'attente, pas
   la categorie : « Votre signature est attendue » plutot que
   « Documents a signer ». La difference porte : l'un demande, l'autre
   classe.

   Pas de rouge. Le resident n'est pas en faute — il n'a peut-etre
   jamais ete prevenu. Le rouge est reserve aux impayes, ou il y a
   effectivement un retard.

   Une seule chose bouge par rapport a l'existant : la place du bloc et
   son intitule. Le contenu, la liste et le parcours de signature ne
   sont pas touches.

   Usage :
     node outils/portail-signer-en-tete.js --essai
     node outils/portail-signer-en-tete.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');
const P = (f) => path.join(process.cwd(), 'backend', 'public', 'portail', f);
const INDEX = P('index.html'), CSS = P('portail.css');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

for (const f of [INDEX, CSS]) {
  if (!fs.existsSync(f)) echec(f + ' introuvable. Lancez depuis la racine du projet.');
}

let index = fs.readFileSync(INDEX, 'utf8');
let css = fs.readFileSync(CSS, 'utf8');

if (css.indexOf('SIGNATURE EN TETE') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}
if (css.indexOf('ONGLETS DU PORTAIL') === -1) {
  echec('Appliquez d\'abord outils/portail-onglets.js.');
}

/* ── 1. L'intitule : ce qui est attendu, pas la categorie ─────────── */
const paires = [
  ['<div class="eyebrow">Action requise</div><h2>Documents à signer</h2>',
   '<div class="eyebrow">Action requise</div><h2>Votre signature est attendue</h2>'],
  ['<div class="eyebrow">Action requise</div>\n        <h2>Documents à signer</h2>',
   '<div class="eyebrow">Action requise</div>\n        <h2>Votre signature est attendue</h2>'],
  ['<h2>Documents à signer</h2>', '<h2>Votre signature est attendue</h2>']
];

let titreFait = false;
for (const [a, n] of paires) {
  if (index.split(a).length - 1 === 1) { index = index.split(a).join(n); titreFait = true; break; }
}

/* ── 2. Le style ─────────────────────────────────────────────────── */
css += `

/* ════════════════════════════════════════════════════════════════
   ══ SIGNATURE EN TETE ══
   ────────────────────────────────────────────────────────────────
   Un document a signer bloque le camping : sans lui, le contrat
   n'existe pas. Tout le reste du portail informe sans rien attendre.

   Le bloc sort donc de la logique d'onglets et s'affiche en premier,
   quel que soit l'onglet ouvert — un resident arrive sur « Solde » et
   ne verrait rien autrement. Vide, portail.js lui pose « hidden » et il
   disparait : un bandeau qui annonce zero document a signer apprend a
   ne plus etre regarde.
   ──────────────────────────────────────────────────────────────── */

body[data-onglet] .content{display:flex;flex-direction:column}

/* Devant tout, dans tous les onglets. « :not(.hidden) » laisse
   portail.js maitre de l'affichage quand la liste est vide. */
body[data-onglet] #sec-signer:not(.hidden){display:block;order:-2}
body[data-onglet="documents"] #sec-signer:not(.hidden){order:-2}

/* Ambre, et non rouge : le resident n'est pas en retard, il n'a
   peut-etre jamais ete prevenu. Le rouge reste aux impayes. */
#sec-signer{border-color:#E5C98F;background:linear-gradient(180deg,#FDFAF2 0%,#FFFFFF 42%)}
#sec-signer .eyebrow{color:#916018}
#sec-signer::before{content:"";display:block;height:2px;margin:-1px -1px 0;
  border-radius:2px 2px 0 0;
  background:linear-gradient(90deg,#C9A24E,#E5C98F 60%,transparent)}
`;

if (!ESSAI) {
  fs.writeFileSync(CSS, css, 'utf8');
  if (titreFait) fs.writeFileSync(INDEX, index, 'utf8');
  if (fs.readFileSync(CSS, 'utf8').indexOf('SIGNATURE EN TETE') === -1) {
    echec('Le correctif n\'est pas dans le fichier apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  « Votre signature est attendue » s\'affiche en tete de tous les onglets.');
console.log('  Filet ambre, pas rouge : le resident n\'est pas en faute.');
console.log(titreFait
  ? '  Intitule remplace dans index.html.'
  : '  \u26a0  Intitule non trouve dans index.html — a changer a la main :');
if (!titreFait) console.log('     « Documents a signer » → « Votre signature est attendue »');
console.log('\n  Vide, le bloc reste masque : portail.js en garde la maitrise.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

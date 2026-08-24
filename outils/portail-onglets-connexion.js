#!/usr/bin/env node
/* ============================================================
   Le menu du bas apparaît sur la page de connexion
   ============================================================
   Cibles : backend/public/portail/index.html
            backend/public/portail/portail.css

   ── CE QUE J'AI CASSÉ ────────────────────────────────────────────
   La barre d'onglets était déclarée DANS #espace, qui porte la classe
   « hidden » tant que le locataire n'est pas connecté. Elle disparaissait
   donc avec lui, sans qu'aucun code ne s'en occupe.

   Pour corriger un défaut iOS — « position: fixed » s'ancre au premier
   ancêtre porteur d'un filtre ou d'une transformation, et la barre
   retombait en bas du document — je l'ai déplacée en fin de <body> :

       if (barre.parentNode !== document.body) document.body.appendChild(barre);

   Le défaut iOS est réglé, mais la barre n'est plus dans #espace : elle
   ne suit plus son affichage. D'où quatre onglets sous le formulaire de
   connexion, sur mobile comme sur desktop — qui, cliqués, ne mènent
   nulle part puisque l'espace n'existe pas encore.

   ── LE CORRECTIF ─────────────────────────────────────────────────
   Ce qui décidait de l'affichage était la POSITION dans l'arbre. On le
   remplace par un état explicite : une classe sur <body>, posée en
   observant #espace. La barre reste en fin de <body> — le défaut iOS ne
   revient pas — et son affichage redevient lié à celui de l'espace.

   Observer plutôt qu'appeler : portail.js retire « hidden » de #espace
   à plusieurs endroits (connexion, lien magique, session retrouvée au
   chargement). Brancher la barre sur chacun d'eux voudrait dire en
   oublier un.

   ── LE !important, ASSUMÉ ────────────────────────────────────────
   .onglets porte son propre display dans portail.css. Le masquer depuis
   une règle ajoutée à la même feuille demanderait de connaître — et de
   suivre — cette valeur. Un !important sur la seule règle de masquage
   est plus sûr qu'une valeur recopiée qui divergera.

   Usage :
     node outils/portail-onglets-connexion.js --essai
     node outils/portail-onglets-connexion.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const F_HTML = path.join(process.cwd(), 'backend', 'public', 'portail', 'index.html');
const F_CSS = path.join(process.cwd(), 'backend', 'public', 'portail', 'portail.css');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

for (const [f, q] of [[F_HTML, 'portail/index.html'], [F_CSS, 'portail/portail.css']]) {
  if (!fs.existsSync(f)) {
    console.error('\n  \u2717 backend/public/' + q + ' introuvable. Lancez depuis la racine du dépôt.\n');
    process.exit(1);
  }
}

let html = fs.readFileSync(F_HTML, 'utf8');
let css = fs.readFileSync(F_CSS, 'utf8');
const tailleAvant = html.length;

if (html.indexOf('espace-ouvert') !== -1) {
  console.log('\n  Déjà appliqué — rien à faire.\n');
  process.exit(0);
}

/* ── 1. L'état explicite, posé en observant #espace ─────────────── */
const A1 = `  /* « position:fixed » s'ancre au premier ancetre qui porte un filtre, une
     transformation ou un backdrop-filter — pas au viewport. Sur iOS la barre
     retombait donc en bas du document, visible seulement en fin de defilement.
     La deplacer en fin de <body> supprime la question : plus d'ancetre. */
  if (barre.parentNode !== document.body) document.body.appendChild(barre);`;

const N1 = `  /* « position:fixed » s'ancre au premier ancetre qui porte un filtre, une
     transformation ou un backdrop-filter — pas au viewport. Sur iOS la barre
     retombait donc en bas du document, visible seulement en fin de defilement.
     La deplacer en fin de <body> supprime la question : plus d'ancetre. */
  if (barre.parentNode !== document.body) document.body.appendChild(barre);

  /* En sortant la barre de #espace, on l'a sortie de ce qui la masquait :
     #espace porte « hidden » tant que le locataire n'est pas connecte, et la
     barre disparaissait avec lui sans qu'aucun code ne s'en occupe. Quatre
     onglets s'affichaient donc sous le formulaire de connexion.

     Ce qui decidait de l'affichage etait la POSITION dans l'arbre ; on le
     remplace par un etat explicite. On OBSERVE #espace plutot que d'attendre
     un appel : portail.js retire « hidden » a plusieurs endroits — connexion,
     lien magique, session retrouvee au chargement — et en brancher un
     voudrait dire en oublier un autre. */
  var espace = document.getElementById('espace');
  if (espace) {
    var majPresence = function () {
      document.body.classList.toggle('espace-ouvert', !espace.classList.contains('hidden'));
    };
    new MutationObserver(majPresence).observe(espace, { attributes: true, attributeFilter: ['class'] });
    majPresence();
  }`;

if (html.split(A1).length - 1 !== 1) {
  console.error('\n  \u2717 Le bloc de déplacement de la barre est introuvable.');
  console.error('    Repérez-le :  grep -n "appendChild(barre)" backend/public/portail/index.html');
  console.error('    AUCUNE écriture.\n');
  process.exit(1);
}
html = html.split(A1).join(N1);
console.log('  ok  état « espace-ouvert » posé en observant #espace');

/* ── 2. La règle de masquage ────────────────────────────────────── */
const REGLE = `

/* ---------------- Barre d'onglets : hors de l'espace, elle n'existe pas ----
   La barre vit en fin de <body> et non dans #espace : c'est ce qui règle un
   défaut iOS où « position: fixed » s'ancrait à un ancêtre transformé au lieu
   du viewport. Mais elle a perdu du même coup ce qui la masquait — #espace et
   sa classe « hidden » — et s'affichait sous le formulaire de connexion.

   Le !important est assumé : .onglets porte son propre display ci-dessus, et
   le recopier ici pour le neutraliser créerait deux valeurs à maintenir.
   Il ne porte que sur le masquage, jamais sur l'apparence. */
body:not(.espace-ouvert) #onglets{ display:none !important; }
`;

if (/body:not\(\.espace-ouvert\)/.test(css)) {
  console.log('  -   règle CSS déjà présente');
} else {
  css += REGLE;
  console.log('  ok  règle de masquage ajoutée à portail.css');
}

/* ── Contrôles ──────────────────────────────────────────────────── */
if (html.indexOf('espace-ouvert') === -1) {
  console.error('\n  \u2717 L\'état n\'a pas été posé. AUCUNE écriture.\n');
  process.exit(1);
}
const ouv = (html.match(/<script/g) || []).length;
const fer = (html.match(/<\/script>/g) || []).length;
if (ouv !== fer) {
  console.error('\n  \u2717 Balises <script> déséquilibrées (' + ouv + '/' + fer + '). AUCUNE écriture.\n');
  process.exit(1);
}
console.log('  ok  balises <script> équilibrées (' + ouv + ')');

if (ESSAI) {
  console.log('\n— ESSAI —  rien écrit. Relancez sans --essai pour appliquer.\n');
  process.exit(0);
}

fs.writeFileSync(F_HTML, html, 'utf8');
fs.writeFileSync(F_CSS, css, 'utf8');
const relu = fs.readFileSync(F_HTML, 'utf8');
if (relu.indexOf('espace-ouvert') === -1 || relu.length === tailleAvant) {
  console.error('\n  \u2717 L\'écriture n\'a pas pris. Vérifiez les droits.\n');
  process.exit(1);
}

console.log('\n— APPLIQUÉ —  ' + tailleAvant + ' → ' + relu.length + ' octets.');
console.log('\n  À VÉRIFIER À L\'ÉCRAN — portail locataire :');
console.log('    · page de connexion : AUCUNE barre en bas, ni sur mobile ni');
console.log('      sur desktop ;');
console.log('    · une fois connecté : la barre revient, les quatre onglets');
console.log('      fonctionnent ;');
console.log('    · déconnexion : la barre repart avec l\'espace ;');
console.log('    · sur iPhone, en bas de page : la barre reste collée au bas');
console.log('      de l\'écran — le défaut d\'origine ne doit pas revenir ;');
console.log('    · écran de signature : la barre s\'efface toujours.');
console.log('');

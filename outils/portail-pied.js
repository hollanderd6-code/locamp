#!/usr/bin/env node
/* ============================================================
   outils/portail-pied.js
   Le pied ne promet plus que ce que le portail fait
   ============================================================
   Cibles : backend/public/portail/index.html
            backend/public/portail/portail.js

   ── LA PHRASE, ET CE QU'ELLE SUPPOSE ─────────────────────────────
       « Espace sécurisé — vos documents et paiements sont chiffrés. »

   Elle est ecrite en dur dans index.html. Or le paiement en ligne
   n'existe pas toujours :

     · il depend de « paiement_en_ligne », renvoye par /api/portail/moi,
       donc de ce que le camping a active ;
     · il est masque dans l'application mobile, par conformite avec la
       regle 3.1.1 d'Apple.

   Dans ces deux cas — et ils sont majoritaires aujourd'hui — le portail
   affiche des factures sans jamais encaisser. La phrase annonce alors
   une fonction absente, juste au moment ou l'on veut inspirer confiance.

   Une promesse de securite qui porte a faux abime ce qu'elle voulait
   rassurer : le lecteur qui cherche « payer » ne trouve rien, et doute
   du reste.

   ── CE QUI EST FAIT ──────────────────────────────────────────────
   Le pied s'aligne sur la realite du portail, decidee au chargement :

     avec paiement en ligne : « Espace sécurisé — vos documents et vos
                               paiements sont chiffrés. »
     sans                   : « Espace sécurisé — vos documents et vos
                               échanges sont chiffrés. »

   « Echanges » est exact : les messages passent bien par HTTPS. On ne
   retire donc pas l'assurance, on la porte sur ce qui existe.

   Le texte par defaut d'index.html devient la seconde version : si le
   script ne s'executait pas, la page dirait le moins, pas le plus.

   ── UNE MENTION AJOUTEE ──────────────────────────────────────────
   Un lien vers la politique de confidentialite. Un espace qui parle de
   securite et de donnees personnelles doit pouvoir dire ou elles vont,
   et Google Play attend ce lien accessible depuis l'application.

   Usage :
     node outils/portail-pied.js --essai
     node outils/portail-pied.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');
const P = (f) => path.join(process.cwd(), 'backend', 'public', 'portail', f);
const INDEX = P('index.html'), JS = P('portail.js');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

for (const f of [INDEX, JS]) {
  if (!fs.existsSync(f)) echec(f + ' introuvable. Lancez depuis la racine du projet.');
}

let index = fs.readFileSync(INDEX, 'utf8');
let js = fs.readFileSync(JS, 'utf8');

if (js.indexOf('majPied') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

/* ── 1. Le pied : par defaut, la version qui ne promet pas de paiement ── */
const A_PIED = `  <footer class="footy">Espace sécurisé — vos documents et paiements sont chiffrés.</footer>`;

const N_PIED = `  <!-- Le texte par defaut est celui SANS paiement : si le script ne
       s'executait pas, la page dirait le moins, pas le plus. portail.js
       l'ajuste au chargement selon ce que le camping a active. -->
  <footer class="footy">
    <span id="pied-securite">Espace sécurisé — vos documents et vos échanges sont chiffrés.</span>
    <a href="/confidentialite" target="_blank" rel="noopener">Confidentialité</a>
  </footer>`;

if (index.split(A_PIED).length - 1 !== 1) echec('index.html : pied de page introuvable.');
index = index.split(A_PIED).join(N_PIED);

/* ── 2. L'ajustement, la ou _payok est deja decide ─────────────────── */
const A_JS = `  window._payok = !!paiement_en_ligne && !window.LOCAMP_NATIVE;`;

const N_JS = `  window._payok = !!paiement_en_ligne && !window.LOCAMP_NATIVE;

  /* Le pied ne parle de paiements que s'il y en a. Annoncer des paiements
     chiffres sur un portail qui n'encaisse pas fait chercher un bouton
     inexistant — et jette le doute sur le reste de la phrase. */
  majPied();`;

if (js.split(A_JS).length - 1 !== 1) echec('portail.js : ligne « _payok » introuvable.');
js = js.split(A_JS).join(N_JS);

/* La fonction, posee avant chargerEspace pour rester lisible a cet endroit. */
const A_FN = `function renderMessages(list) {`;
const N_FN = `/* « Echanges » plutot que « paiements » quand le camping n'a pas active le
   paiement en ligne, ou dans l'application mobile ou il est masque. Les
   messages passent bien par HTTPS : on ne retire pas l'assurance, on la porte
   sur ce qui existe. */
function majPied() {
  const el = $('#pied-securite');
  if (!el) return;
  el.textContent = window._payok
    ? 'Espace sécurisé — vos documents et vos paiements sont chiffrés.'
    : 'Espace sécurisé — vos documents et vos échanges sont chiffrés.';
}

function renderMessages(list) {`;

if (js.split(A_FN).length - 1 !== 1) echec('portail.js : fonction renderMessages introuvable.');
js = js.split(A_FN).join(N_FN);

try { new Function(js); }
catch (e) { echec('portail.js : le resultat n\'est pas du JavaScript valide — ' + e.message); }

if (!ESSAI) {
  fs.writeFileSync(INDEX, index, 'utf8');
  fs.writeFileSync(JS, js, 'utf8');
  const ok = fs.readFileSync(INDEX, 'utf8').indexOf('pied-securite') !== -1
          && fs.readFileSync(JS, 'utf8').indexOf('majPied') !== -1;
  if (!ok) echec('Un fichier n\'a pas ete modifie.');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Le pied parle de paiements seulement quand il y en a.');
console.log('  Lien vers la politique de confidentialite ajoute.\n');
console.log('  Par defaut, index.html dit « échanges » : si le script ne');
console.log('  s\'executait pas, la page promettrait le moins.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

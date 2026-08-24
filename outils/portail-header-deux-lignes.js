#!/usr/bin/env node
/* ============================================================
   outils/portail-header-deux-lignes.js
   Le contexte tient sur deux lignes plutôt que de se tronquer
   ============================================================
   Cibles : backend/public/portail/portail.css
            backend/public/portail/portail.js

   ── LE DEFAUT ────────────────────────────────────────────────────
   La ligne de contexte se termine par une ellipse :

       Camping Le parc des grands clos · E…

   L'emplacement — la seule information qui distingue un resident d'un
   autre — est precisement ce qui tombe. Sur un nom de camping long, le
   troncage arrive toujours au meme endroit : juste avant le numero.

   ── CE QUI EST FAIT ──────────────────────────────────────────────
   Le point median cesse d'etre un separateur typographique pour devenir
   un retour a la ligne : le camping sur une ligne, l'emplacement sur la
   suivante. Le header gagne les quelques pixels necessaires.

   La ligne du camping garde son ellipse — un nom tres long doit bien
   s'arreter quelque part — mais l'emplacement, court par nature, est
   desormais toujours entier.

   portail.js construit cette chaine en joignant les morceaux par
   « · ». On remplace la jointure par deux lignes distinctes, plutot que
   de decouper la chaine apres coup : couper sur un caractere qui peut
   figurer dans un nom de camping serait fragile.

   Usage :
     node outils/portail-header-deux-lignes.js --essai
     node outils/portail-header-deux-lignes.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');
const P = (f) => path.join(process.cwd(), 'backend', 'public', 'portail', f);
const CSS = P('portail.css'), JS = P('portail.js');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

for (const f of [CSS, JS]) {
  if (!fs.existsSync(f)) echec(f + ' introuvable. Lancez depuis la racine du projet.');
}

let css = fs.readFileSync(CSS, 'utf8');
let js = fs.readFileSync(JS, 'utf8');

if (css.indexOf('HEADER SUR DEUX LIGNES') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

/* ── Le sous-titre devient deux lignes ────────────────────────────── */
const A_JS = `    .filter(Boolean).join(' · ');`;

if (js.split(A_JS).length - 1 !== 1) echec('portail.js : construction du sous-titre introuvable.');

/* On remonte au debut de l'affectation pour la remplacer entierement. */
const iFin = js.indexOf(A_JS);
const iDeb = js.lastIndexOf('$(\'#sous-titre\')', iFin);
if (iDeb === -1 || iDeb > iFin) echec('portail.js : affectation de #sous-titre introuvable.');

const ancienBloc = js.slice(iDeb, iFin + A_JS.length);
const morceaux = ancienBloc.slice(ancienBloc.indexOf('[') , ancienBloc.lastIndexOf(']') + 1);
if (!morceaux.startsWith('[')) echec('portail.js : liste des morceaux du sous-titre introuvable.');

const nouveauBloc = `/* Deux lignes plutot qu'une ellipse : l'emplacement est la seule information
     qui distingue un resident d'un autre, et c'est justement lui que le
     troncage emportait. On construit deux lignes au lieu de joindre par « · » —
     redecouper la chaine apres coup casserait sur un nom contenant un point
     median. */
  {
    const bouts = ${morceaux}.filter(Boolean);
    const el = $('#sous-titre');
    el.innerHTML = '';
    if (bouts.length) {
      const l1 = document.createElement('span');
      l1.className = 'ctx-camping';
      l1.textContent = bouts[0];
      el.appendChild(l1);
    }
    if (bouts.length > 1) {
      const l2 = document.createElement('span');
      l2.className = 'ctx-empl';
      l2.textContent = bouts.slice(1).join(' · ');
      el.appendChild(l2);
    }
  }`;

js = js.slice(0, iDeb) + nouveauBloc + js.slice(iFin + A_JS.length);

try { new Function(js); }
catch (e) { echec('portail.js : le resultat n\'est pas du JavaScript valide — ' + e.message); }

/* ── Le style ─────────────────────────────────────────────────────── */
css += `

/* ════════════════════════════════════════════════════════════════
   ══ HEADER SUR DEUX LIGNES ══
   ────────────────────────────────────────────────────────────────
   « Camping Le parc des grands clos · E… » : le troncage emportait
   l'emplacement, la seule donnee propre au resident. Le point median
   devient un retour a la ligne.
   ──────────────────────────────────────────────────────────────── */

.topbar .brand-sub{
  display:flex;flex-direction:column;
  white-space:normal;overflow:visible;text-overflow:clip;
  line-height:1.3;gap:1px}

/* Le nom du camping peut etre long : il garde son ellipse. */
.ctx-camping{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  font-size:12.5px}
/* L'emplacement est court par nature : il tient toujours en entier. */
.ctx-empl{font-size:12px;opacity:.82;white-space:nowrap}

/* Trois lignes au lieu de deux : le header prend la hauteur qu'il faut. */
.topbar{min-height:74px;padding-top:11px;padding-bottom:11px;align-items:center}

@media (max-width:560px){
  .topbar{min-height:70px}
  .ctx-camping{font-size:12px}
  .ctx-empl{font-size:11.5px}
}
`;

if (!ESSAI) {
  fs.writeFileSync(CSS, css, 'utf8');
  fs.writeFileSync(JS, js, 'utf8');
  const rc = fs.readFileSync(CSS, 'utf8'), rj = fs.readFileSync(JS, 'utf8');
  if (rc.indexOf('HEADER SUR DEUX LIGNES') === -1 || rj.indexOf('ctx-empl') === -1) {
    echec('Un fichier n\'a pas ete modifie.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Camping sur une ligne, emplacement sur la suivante.');
console.log('  Le header passe a 74 px pour les accueillir.\n');
console.log('  Les deux lignes sont construites separement : redecouper la');
console.log('  chaine sur « · » aurait casse sur un nom en contenant un.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

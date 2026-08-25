#!/usr/bin/env node
/* ============================================================
   outils/logo-portail.js
   Le logo affiché DANS le portail, et non celui de l'application
   ============================================================
   Cibles : backend/public/portail/index.html
            backend/public/logo-portail.svg  (fourni a cote)

   ── LA CONFUSION QUI RESTAIT ─────────────────────────────────────
   On a change les icones des applications — celles de l'ecran d'accueil
   et des fiches Play. Mais le logo qui s'affiche DANS la page, en haut
   a gauche de l'en-tete et sur l'ecran de connexion, est un troisieme
   objet : une balise du HTML.

       <div class="brand-mark"><img src="/logo.svg" ...></div>

   Le portail chargeait donc /logo.svg, la version vert fonce de la
   gestion. D'ou la vignette sombre sur fond ivoire, alors que
   l'application porte desormais l'icone beige.

   Trois endroits, trois fichiers, qu'il faut distinguer :

     · l'ecran d'accueil du telephone  →  icones du manifeste
     · la fiche du Play Store          →  televersee dans la console
     · l'interieur de la page          →  ce logo-ci

   ── CE QUI EST FAIT ──────────────────────────────────────────────
   Le portail pointe vers /logo-portail.svg, sa variante ivoire : meme
   lettre, meme filet, couleurs inversees. La gestion garde /logo.svg.

   Le remplacement porte sur TOUTES les occurrences du portail — l'en-tete
   et l'ecran de connexion en ont chacun une, et il y a peut-etre
   davantage sur les ecrans de signature.

   Usage :
     node outils/logo-portail.js --essai
     node outils/logo-portail.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');
const RACINE = path.join(process.cwd(), 'backend', 'public');
const SVG = path.join(RACINE, 'logo-portail.svg');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

/* Le logo se retrouve dans le portail et dans les ecrans de signature, qui
   sont aussi cote locataire. On traite les deux. */
const FICHIERS = [
  path.join(RACINE, 'portail', 'index.html'),
  path.join(RACINE, 'signature', 'index.html'),
];

if (!fs.existsSync(SVG)) {
  echec('backend/public/logo-portail.svg absent. Copiez-le d\'abord :\n'
    + '      cp ~/Downloads/livraison-logo-portail/logo-portail.svg backend/public/');
}

let total = 0;
const resultats = [];

for (const f of FICHIERS) {
  const nom = path.relative(RACINE, f);
  if (!fs.existsSync(f)) { resultats.push(nom + ' : absent, ignore'); continue; }

  let src = fs.readFileSync(f, 'utf8');
  if (src.indexOf('logo-portail.svg') !== -1) { resultats.push(nom + ' : deja fait'); continue; }

  const n = (src.match(/src="\/logo\.svg"/g) || []).length;
  if (!n) { resultats.push(nom + ' : aucune reference a /logo.svg'); continue; }

  src = src.split('src="/logo.svg"').join('src="/logo-portail.svg"');
  if (!ESSAI) fs.writeFileSync(f, src, 'utf8');
  total += n;
  resultats.push(nom + ' : ' + n + ' reference(s) basculee(s)');
}

if (!total && !resultats.some((r) => r.indexOf('deja fait') !== -1)) {
  echec('Aucune reference a /logo.svg trouvee dans les fichiers du portail.');
}

if (!ESSAI && total) {
  for (const f of FICHIERS) {
    if (!fs.existsSync(f)) continue;
    if (fs.readFileSync(f, 'utf8').indexOf('src="/logo.svg"') !== -1) {
      echec(path.relative(RACINE, f) + ' : une reference subsiste apres ecriture.');
    }
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
resultats.forEach((r) => console.log('  ' + r));
console.log('\n  Le portail affiche desormais sa variante ivoire.');
console.log('  La gestion garde /logo.svg, en vert fonce.\n');
console.log('  Aucune reconstruction : le site est charge en direct.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

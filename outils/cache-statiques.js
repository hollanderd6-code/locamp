#!/usr/bin/env node
/* ============================================================
   outils/cache-statiques.js
   Pourquoi tous les correctifs de la journée n'arrivaient pas
   ============================================================
   Cibles : backend/server.js
            backend/public/portail/index.html
            backend/public/index.html

   ── LE CONSTAT ───────────────────────────────────────────────────
   Verifie en ligne de commande :

       CSS local           1
       CSS servi par Render 1
       LaunchLogo          present, bon nom, bonne date

   Tout etait en place. Le telephone, lui, affichait encore l'ancienne
   version. Les correctifs etaient justes et n'arrivaient jamais.

   ── LA CAUSE ─────────────────────────────────────────────────────
   express.static envoie un ETag mais aucun « Cache-Control ». Sans
   consigne, chaque client applique sa propre heuristique — et WKWebView
   est le plus tenace : il garde une feuille de style pendant des heures
   sans meme demander au serveur si elle a change.

   Dans un navigateur, on force avec Cmd+Maj+R. Dans une application, ce
   geste n'existe pas. Supprimer l'application ne suffit pas toujours :
   le cache HTTP d'iOS survit a la reinstallation.

   ── DEUX CORRECTIONS, ET POURQUOI LES DEUX ───────────────────────

   1. LE SERVEUR DIT CE QU'IL VEUT. Les fichiers susceptibles de changer
      — HTML, CSS, JS — sont servis en « no-cache » : le client peut les
      garder, mais doit demander au serveur s'ils ont change avant de les
      reutiliser. L'ETag rend cette question quasi gratuite : le serveur
      repond « 304, inchange » en quelques octets.

      Les images et les polices gardent un cache long : elles ne changent
      pas sans changer de nom.

   2. LES LIENS PORTENT UNE VERSION. « portail.css?v=1756118400 ». Un
      cache deja pose ne connait pas cette adresse : il redemande. La
      correction n'attend donc pas l'expiration de l'ancien cache — sans
      cela, la premiere correction resterait invisible le temps que
      WKWebView veuille bien reinterroger.

      La valeur est l'horodatage du fichier : elle change quand le
      fichier change, et pas autrement.

   ── CE QUE CELA COUTE ────────────────────────────────────────────
   Une requete conditionnelle par fichier a chaque ouverture, qui repond
   « 304 » en quelques octets. En echange, une correction deployee est
   visible au lancement suivant — sur les deux applications, sans
   republier.

   Usage :
     node outils/cache-statiques.js --essai
     node outils/cache-statiques.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');
const SERVER = path.join(process.cwd(), 'backend', 'server.js');
const PUBLIC = path.join(process.cwd(), 'backend', 'public');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!fs.existsSync(SERVER)) echec('backend/server.js introuvable. Lancez depuis la racine du depot.');

let server = fs.readFileSync(SERVER, 'utf8');
const resultats = [];

/* ── 1. Le serveur ────────────────────────────────────────────────── */
if (server.indexOf('setHeaders') !== -1 && server.indexOf('no-cache') !== -1) {
  resultats.push('server.js : deja fait');
} else {
  const lignes = server.split('\n');
  const i = lignes.findIndex((l) => /^\s*app\.use\(\s*express\.static\(/.test(l));
  if (i === -1) echec('Ligne « app.use(express.static(...)) » introuvable.');

  const indent = (lignes[i].match(/^\s*/) || [''])[0];
  lignes[i] = indent + `/* Sans « Cache-Control », chaque client decide seul — et WKWebView garde
${indent}   une feuille de style des heures sans interroger le serveur. Dans une
${indent}   application, aucun geste utilisateur ne force le rafraichissement : une
${indent}   correction deployee restait donc invisible.

${indent}   « no-cache » ne veut pas dire « ne garde rien » : le client garde, mais
${indent}   demande si ca a change. L'ETag rend la question presque gratuite — le
${indent}   serveur repond « 304 » en quelques octets.

${indent}   Les images et les polices gardent un cache long : elles ne changent pas
${indent}   sans changer de nom. */
${indent}app.use(express.static('public', {
${indent}  etag: true,
${indent}  setHeaders(res, chemin) {
${indent}    if (/\\.(html|css|js|json|svg)$/i.test(chemin)) {
${indent}      res.setHeader('Cache-Control', 'no-cache');
${indent}    } else if (/\\.(png|jpg|jpeg|webp|ico|woff2?|ttf)$/i.test(chemin)) {
${indent}      res.setHeader('Cache-Control', 'public, max-age=604800');
${indent}    }
${indent}  },
${indent}}));`;

  server = lignes.join('\n');
  try { new Function(server); }
  catch (e) { echec('server.js : JavaScript invalide — ' + e.message); }
  resultats.push('server.js : en-tetes de cache poses');
}

/* ── 2. Les liens portent une version ─────────────────────────────── */
/* Un cache deja pose ne connait pas l'adresse versionnee : il redemande.
   Sans cela, la premiere correction attendrait le bon vouloir du cache. */
function versionner(fichierHtml, nom) {
  if (!fs.existsSync(fichierHtml)) { resultats.push(nom + ' : absent'); return null; }
  let html = fs.readFileSync(fichierHtml, 'utf8');
  let n = 0;

  html = html.replace(/(href|src)="(\/[^"?]+\.(?:css|js))"/g, (tout, attr, url) => {
    const f = path.join(PUBLIC, url.replace(/^\//, ''));
    if (!fs.existsSync(f)) return tout;   // ressource externe ou chemin inconnu
    n++;
    return `${attr}="${url}?v=${Math.floor(fs.statSync(f).mtimeMs / 1000)}"`;
  });

  if (!n) { resultats.push(nom + ' : rien a versionner'); return null; }
  resultats.push(nom + ' : ' + n + ' lien(s) versionne(s)');
  return html;
}

const pages = [
  [path.join(PUBLIC, 'portail', 'index.html'), 'portail/index.html'],
  [path.join(PUBLIC, 'index.html'), 'index.html'],
  [path.join(PUBLIC, 'signature', 'index.html'), 'signature/index.html'],
];

const aEcrire = [];
for (const [f, nom] of pages) {
  const html = versionner(f, nom);
  if (html) aEcrire.push([f, html]);
}

if (!ESSAI) {
  fs.writeFileSync(SERVER, server, 'utf8');
  for (const [f, html] of aEcrire) fs.writeFileSync(f, html, 'utf8');
  if (fs.readFileSync(SERVER, 'utf8').indexOf('no-cache') === -1) {
    echec('Les en-tetes ne sont pas dans server.js apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
resultats.forEach((r) => console.log('  ' + r));
console.log('\n  Apres deploiement, verifiez que l\'en-tete arrive :');
console.log('    curl -sI https://locamp.onrender.com/portail/portail.css | grep -i cache\n');
console.log('  Puis, sur le telephone : fermez completement l\'application');
console.log('  (glissez-la hors du selecteur) et relancez-la. Le lien versionne');
console.log('  contourne le cache deja pose.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

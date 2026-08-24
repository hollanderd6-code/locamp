#!/usr/bin/env node
/* ============================================================
   outils/routes-publiques.js
   Deux routes qui manquaient, et pourquoi elles manquaient
   ============================================================
   Cible : backend/server.js

   ── LA CAUSE COMMUNE ─────────────────────────────────────────────
   Deux scripts precedents cherchaient ce point d'ancrage :

       «   app.use(express.static('public')); »   (deux espaces devant)

   Or la ligne est ecrite SANS indentation dans server.js. Les deux
   scripts ont donc refuse d'ecrire — correctement, ils ont dit qu'ils
   ne trouvaient rien — mais l'echec de « route-confidentialite.js »
   est passe inapercu dans un enchainement de commandes.

   Consequence silencieuse : le portail affiche un lien
   « Confidentialite » qui menait a l'ecran de connexion, puisque
   l'application repond a toute adresse inconnue. Un reviseur Play qui
   clique sur ce lien et tombe sur une demande de mot de passe rejette
   la soumission.

   Ce script repere la ligne QUELLE QUE SOIT son indentation, et pose
   les deux routes si elles manquent — independamment l'une de l'autre.

   ── 1. LA POLITIQUE DE CONFIDENTIALITE ───────────────────────────
   Sur une adresse sans extension : elle figure dans la fiche du Play
   Store, et doit survivre a un changement de technologie. Posee avant
   express.static et avant le routage de l'application.

   ── 2. LE LIEN DE CONFIANCE DE L'APPLICATION ANDROID ─────────────
   Android verifie que le site autorise l'application a s'afficher sans
   barre d'adresse, en lisant :

       /.well-known/assetlinks.json

   Une route explicite est indispensable : express.static repond 404 sur
   tout chemin dont un segment commence par un point. Deposer le fichier
   dans public/.well-known/ ne suffirait pas — il existerait, et le site
   le nierait.

   L'empreinte vient de l'environnement, pas du depot : elle identifie
   la cle de signature et changera avec elle.

       Console Play → Test et publication → Integrite de l'application
       → Certificat de la cle de signature → SHA-256

   C'est l'empreinte de GOOGLE qu'il faut, pas celle du keystore local :
   Play resigne le bundle avec sa propre cle.

       Render → Environment :
         ANDROID_FINGERPRINT = AA:BB:CC:…
         ANDROID_APP_ID      = com.locamp.gestion

   Tant que la variable est absente, la route repond 503 et dit ou
   trouver l'empreinte, plutot que de servir un fichier muet qui
   donnerait la meme barre d'adresse sans en expliquer la cause.

   Usage :
     node outils/routes-publiques.js --essai
     node outils/routes-publiques.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'backend', 'server.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) {
  echec('backend/server.js introuvable. Lancez depuis la racine du depot (celui qui contient backend/).');
}

let src = fs.readFileSync(CIBLE, 'utf8');

/* On repere la ligne sans presumer de son indentation ni de ses guillemets :
   c'est precisement ce qui a fait echouer les deux scripts precedents. */
const lignes = src.split('\n');
const iStatic = lignes.findIndex((l) => /^\s*app\.use\(\s*express\.static\(/.test(l));
if (iStatic === -1) echec('Aucune ligne « app.use(express.static(...)) » dans server.js.');

const indent = (lignes[iStatic].match(/^\s*/) || [''])[0];
const aConf = src.indexOf('/confidentialite') !== -1;
const aLinks = src.indexOf('assetlinks') !== -1;

if (aConf && aLinks) {
  console.log('\n  Les deux routes sont deja en place — rien a faire.\n');
  process.exit(0);
}

const bloc = [];

if (!aConf) {
  bloc.push(
    indent + '/* La politique de confidentialite, sur une adresse sans extension : elle',
    indent + '   figure dans la fiche du Play Store et doit survivre a un changement de',
    indent + '   technologie. Posee avant le routage de l\'application, qui renverrait',
    indent + '   sinon l\'ecran de connexion — de quoi faire rejeter la soumission. */',
    indent + 'app.get([\'/confidentialite\', \'/politique-de-confidentialite\'], (req, res) =>',
    indent + '  res.sendFile(require(\'path\').join(__dirname, \'public\', \'confidentialite.html\')));',
    ''
  );
}

if (!aLinks) {
  bloc.push(
    indent + '/* Lien de confiance de l\'application Android. Android verifie ici que le',
    indent + '   site autorise l\'application a s\'afficher sans barre d\'adresse.',
    indent + '',
    indent + '   Une route explicite est indispensable : express.static repond 404 sur',
    indent + '   tout segment commencant par un point, donc un fichier depose dans',
    indent + '   public/.well-known/ existerait sans jamais etre servi.',
    indent + '',
    indent + '   L\'empreinte vient de l\'environnement : elle identifie la cle de',
    indent + '   signature, et changera le jour ou la cle changera. */',
    indent + 'app.get(\'/.well-known/assetlinks.json\', (req, res) => {',
    indent + '  const empreinte = process.env.ANDROID_FINGERPRINT;',
    indent + '  if (!empreinte) {',
    indent + '    /* Le dire plutot que servir un fichier vide : un JSON incomplet',
    indent + '       donnerait la meme barre d\'adresse, sans en indiquer la raison. */',
    indent + '    return res.status(503).type(\'application/json\').send(JSON.stringify({',
    indent + '      erreur: \'ANDROID_FINGERPRINT absente de l\\\'environnement.\',',
    indent + '      ou: \'Console Play, Integrite de l\\\'application, SHA-256 du certificat de signature.\'',
    indent + '    }, null, 2));',
    indent + '  }',
    indent + '  res.type(\'application/json\').send(JSON.stringify([{',
    indent + '    relation: [\'delegate_permission/common.handle_all_urls\'],',
    indent + '    target: {',
    indent + '      namespace: \'android_app\',',
    indent + '      package_name: process.env.ANDROID_APP_ID || \'com.locamp.gestion\',',
    indent + '      sha256_cert_fingerprints: empreinte.split(\',\').map((f) => f.trim()).filter(Boolean)',
    indent + '    }',
    indent + '  }], null, 2));',
    indent + '});',
    ''
  );
}

lignes.splice(iStatic, 0, ...bloc);
src = lignes.join('\n');

try { new Function(src); }
catch (e) { echec('Le resultat n\'est pas du JavaScript valide — ' + e.message); }

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  const relu = fs.readFileSync(CIBLE, 'utf8');
  if ((!aConf && relu.indexOf('/confidentialite') === -1)
   || (!aLinks && relu.indexOf('assetlinks') === -1)) {
    echec('Une route n\'est pas dans le fichier apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Point d\'ancrage trouve ligne ' + (iStatic + 1)
  + (indent ? ', indentation de ' + indent.length + ' espace(s).' : ', sans indentation.'));
if (!aConf)  console.log('  · /confidentialite posee');
else         console.log('  · /confidentialite deja presente');
if (!aLinks) console.log('  · /.well-known/assetlinks.json posee');
else         console.log('  · assetlinks deja presente');
console.log('\n  Apres deploiement :');
console.log('    curl -s -o /dev/null -w "%{http_code}\\n" https://locamp.onrender.com/confidentialite');
console.log('    curl https://locamp.onrender.com/.well-known/assetlinks.json\n');
console.log('  La premiere doit repondre 200. La seconde repondra 503 tant que');
console.log('  ANDROID_FINGERPRINT n\'est pas posee dans Render — c\'est normal,');
console.log('  et le message dit ou trouver l\'empreinte.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

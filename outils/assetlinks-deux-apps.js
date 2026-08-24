#!/usr/bin/env node
/* ============================================================
   outils/assetlinks-deux-apps.js
   Le lien de confiance doit déclarer les DEUX applications
   ============================================================
   Cible : backend/server.js

   ── LE DEFAUT QUI BLOQUERAIT LE PORTAIL ──────────────────────────
   La route que j'ai posee n'emet qu'une seule declaration :

       [{ target: { package_name: 'com.locamp.gestion', … } }]

   Or assetlinks.json est une LISTE : un site peut autoriser plusieurs
   applications. En creant l'application du portail, la seconde ne
   serait pas declaree — et Android lui laisserait la barre d'adresse
   de Chrome, exactement le symptome qu'on vient de corriger.

   Le piege est qu'on ne verrait rien du cote gestion : la premiere
   application continuerait de fonctionner. Le defaut ne se
   manifesterait que sur la nouvelle, sans dire pourquoi.

   ── CE QUI EST FAIT ──────────────────────────────────────────────
   La route parcourt une liste d'applications, chacune avec son
   identifiant et son empreinte. Les deux applications sont signees par
   Play, donc avec la MEME empreinte de deploiement — mais on ne le
   suppose pas : chaque application peut porter la sienne.

       ANDROID_APPS = com.locamp.gestion:FE:40:…,com.locamp.portail:AB:CD:…

   Trop illisible. On garde donc deux variables simples :

       ANDROID_APP_ID          = com.locamp.gestion
       ANDROID_FINGERPRINT     = FE:40:…            (existant, inchange)
       ANDROID_APP_ID_2        = com.locamp.portail
       ANDROID_FINGERPRINT_2   = FE:40:…            (souvent la meme)

   Si ANDROID_FINGERPRINT_2 est absente mais ANDROID_APP_ID_2 presente,
   on reutilise la premiere empreinte : c'est le cas courant, deux
   applications du meme compte Play. Une supposition explicite, et
   annoncee dans la reponse, vaut mieux qu'un silence.

   ── VERIFICATION ─────────────────────────────────────────────────
       curl https://locamp.onrender.com/.well-known/assetlinks.json
   Deux objets doivent apparaitre.

   Usage :
     node outils/assetlinks-deux-apps.js --essai
     node outils/assetlinks-deux-apps.js
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

if (!fs.existsSync(CIBLE)) echec('backend/server.js introuvable. Lancez depuis la racine du depot.');

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('ANDROID_APP_ID_2') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

const i0 = src.indexOf("app.get('/.well-known/assetlinks.json'");
if (i0 === -1) echec('Route assetlinks introuvable. Appliquez d\'abord routes-publiques.js.');

/* On remplace le corps de la route : de sa premiere ligne jusqu'au « }); »
   qui la ferme. Chercher la fin par accolades imbriquees plutot que par une
   chaine fixe — le corps contient lui-meme des accolades. */
let prof = 0, iFin = -1;
for (let k = src.indexOf('{', i0); k < src.length; k++) {
  if (src[k] === '{') prof++;
  else if (src[k] === '}') { prof--; if (prof === 0) { iFin = k; break; } }
}
if (iFin === -1) echec('Fin de la route assetlinks introuvable.');
const iPointVirgule = src.indexOf(';', iFin);
if (iPointVirgule === -1) echec('Fin d\'instruction introuvable.');

const indent = (src.slice(0, i0).match(/([ \t]*)$/) || ['', ''])[1];

const NOUVEAU = `app.get('/.well-known/assetlinks.json', (req, res) => {
${indent}  /* assetlinks.json est une LISTE : un site peut autoriser plusieurs
${indent}     applications. Avec une seule declaration, la seconde application
${indent}     garderait la barre d'adresse de Chrome — et rien ne le signalerait,
${indent}     puisque la premiere continuerait de fonctionner. */
${indent}  const empreinte1 = process.env.ANDROID_FINGERPRINT;
${indent}  if (!empreinte1) {
${indent}    return res.status(503).type('application/json').send(JSON.stringify({
${indent}      erreur: 'ANDROID_FINGERPRINT absente de l\\'environnement.',
${indent}      ou: 'Console Play, Integrite de l\\'application, SHA-256 du certificat de signature.'
${indent}    }, null, 2));
${indent}  }
${indent}
${indent}  const apps = [
${indent}    { id: process.env.ANDROID_APP_ID || 'com.locamp.gestion', emp: empreinte1 }
${indent}  ];
${indent}
${indent}  /* Deux applications du meme compte Play partagent leur empreinte de
${indent}     deploiement. On reutilise donc la premiere si la seconde n'est pas
${indent}     posee — une supposition explicite plutot qu'un silence. */
${indent}  if (process.env.ANDROID_APP_ID_2) {
${indent}    apps.push({
${indent}      id: process.env.ANDROID_APP_ID_2,
${indent}      emp: process.env.ANDROID_FINGERPRINT_2 || empreinte1
${indent}    });
${indent}  }
${indent}
${indent}  res.type('application/json').send(JSON.stringify(apps.map((a) => ({
${indent}    relation: ['delegate_permission/common.handle_all_urls'],
${indent}    target: {
${indent}      namespace: 'android_app',
${indent}      package_name: a.id,
${indent}      sha256_cert_fingerprints: a.emp.split(',').map((f) => f.trim()).filter(Boolean)
${indent}    }
${indent}  })), null, 2));
${indent}});`;

src = src.slice(0, i0) + NOUVEAU + src.slice(iPointVirgule + 1);

try { new Function(src); }
catch (e) { echec('Le resultat n\'est pas du JavaScript valide — ' + e.message); }

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('ANDROID_APP_ID_2') === -1) {
    echec('La route n\'a pas ete remplacee.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  La route declare autant d\'applications que d\'identifiants poses.\n');
console.log('  A ajouter dans Render → Environment :');
console.log('    ANDROID_APP_ID_2 = com.locamp.portail\n');
console.log('  ANDROID_FINGERPRINT_2 n\'est utile que si le portail est signe');
console.log('  par une autre cle. Sinon la premiere empreinte est reprise.\n');
console.log('  Verification : curl https://locamp.onrender.com/.well-known/assetlinks.json');
console.log('  Deux objets doivent apparaitre.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

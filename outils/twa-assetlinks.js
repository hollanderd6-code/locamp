#!/usr/bin/env node
/* ============================================================
   outils/twa-assetlinks.js
   Le lien de confiance entre l'application et le site
   ============================================================
   Cible : backend/server.js

   ── CE QU'ON MET EN PLACE, ET POURQUOI ───────────────────────────
   Une application Play Store en habillage du site (« TWA ») n'est pas
   un navigateur deguise : Android verifie que le site AUTORISE cette
   application a s'afficher en plein ecran. La preuve tient dans un
   fichier servi par le site :

       https://locamp.onrender.com/.well-known/assetlinks.json

   Sans lui, l'application s'ouvre mais garde la barre d'adresse de
   Chrome en haut. C'est le symptome numero un des premiers essais, et
   il ne dit pas sa cause.

   ── LE PIEGE QU'ON EVITE ─────────────────────────────────────────
   Le backend sert ses fichiers avec « express.static('public') ». Or
   express.static repond 404 sur tout chemin dont un segment commence
   par un point : deposer le fichier dans public/.well-known/ ne suffit
   donc PAS. Beaucoup de temps se perd la — le fichier existe, le site
   le nie.

   D'ou une route explicite, posee avant le service des fichiers.

   ── L'EMPREINTE NE SE COMMITE PAS ────────────────────────────────
   Elle identifie la cle qui signe l'application. On la lit dans
   l'environnement (ANDROID_FINGERPRINT), pas dans le depot : une
   empreinte en clair dans le code voyage avec chaque copie du projet,
   et changera le jour ou la cle changera.

   Tant que la variable est absente, la route repond franchement plutot
   que de servir un fichier vide — un JSON malforme donnerait la meme
   barre d'adresse sans expliquer pourquoi.

   ── LA MARCHE A SUIVRE, DANS L'ORDRE ─────────────────────────────

   1. Installer l'outil d'empaquetage :
          npm install -g @bubblewrap/cli

   2. Generer le projet Android depuis le manifeste :
          bubblewrap init --manifest https://locamp.onrender.com/manifest.json
      Repondre : nom « Locamp », identifiant « com.locamp.gestion »,
      couleur de theme #0F231D, ecran de demarrage #F6F3EC.

   3. Construire :
          bubblewrap build
      Sortie : app-release-bundle.aab, a envoyer sur la console Play.

   4. RECUPERER L'EMPREINTE. Deux cas, et c'est la que tout se joue :

      · Signature geree par Google (le defaut, recommande) :
        l'empreinte n'est PAS celle de votre cle locale. Console Play →
        Configuration → Integrite de l'application → « Certificat de la
        cle de signature d'application » → SHA-256.

      · Cle locale conservee :
            keytool -list -v -keystore android.keystore -alias android

      Prendre l'empreinte SHA-256, avec les deux-points.

   5. La poser dans Render → Environment :
          ANDROID_FINGERPRINT = AA:BB:CC:…
          ANDROID_APP_ID      = com.locamp.gestion   (si different)

   6. Verifier, avant de publier :
          curl https://locamp.onrender.com/.well-known/assetlinks.json
      Puis l'outil officiel de Google :
      https://developers.google.com/digital-asset-links/tools/generator

   L'ordre compte : l'empreinte n'existe qu'apres l'etape 3, et la
   verification d'Android peut prendre quelques heures a se propager.

   Usage :
     node outils/twa-assetlinks.js --essai
     node outils/twa-assetlinks.js
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

if (!fs.existsSync(CIBLE)) echec('backend/server.js introuvable. Lancez depuis la racine du projet.');

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('assetlinks') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

const ANCIEN = `  app.use(express.static('public'));`;

const NOUVEAU = `  /* ---- Lien de confiance de l'application Android ----
     Android verifie ici que le site autorise l'application a s'afficher sans
     barre d'adresse. Cette route est posee AVANT express.static parce que
     celui-ci repond 404 sur tout segment commencant par un point : le fichier
     depose dans public/.well-known/ ne serait jamais servi.

     L'empreinte vient de l'environnement, pas du depot : elle identifie la cle
     de signature, et changera le jour ou la cle changera. */
  app.get('/.well-known/assetlinks.json', (req, res) => {
    const empreinte = process.env.ANDROID_FINGERPRINT;
    if (!empreinte) {
      /* Mieux vaut le dire que servir un fichier vide : un JSON incomplet
         produirait la meme barre d'adresse, sans en donner la raison. */
      return res.status(503).type('application/json').send(JSON.stringify({
        erreur: 'ANDROID_FINGERPRINT absente de l\\'environnement.',
        ou: 'Console Play → Integrite de l\\'application → SHA-256 du certificat de signature.'
      }, null, 2));
    }
    res.type('application/json').send(JSON.stringify([{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: process.env.ANDROID_APP_ID || 'com.locamp.gestion',
        sha256_cert_fingerprints: empreinte.split(',').map((f) => f.trim()).filter(Boolean)
      }
    }], null, 2));
  });

  app.use(express.static('public'));`;

if (src.split(ANCIEN).length - 1 !== 1) echec('server.js : « app.use(express.static(...)) » introuvable.');
src = src.split(ANCIEN).join(NOUVEAU);

try { new Function(src); }
catch (e) { echec('Le resultat n\'est pas du JavaScript valide — ' + e.message); }

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('assetlinks') === -1) {
    echec('La route n\'est pas dans le fichier apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Route /.well-known/assetlinks.json posee avant express.static.');
console.log('  L\'empreinte est lue dans ANDROID_FINGERPRINT.\n');
console.log('  Tant que la variable est absente, la route repond 503 et dit ou');
console.log('  trouver l\'empreinte — plutot que de servir un fichier muet.\n');
console.log('  La marche a suivre complete est en tete de ce fichier.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

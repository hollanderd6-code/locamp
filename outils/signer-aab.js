#!/usr/bin/env node
/* ============================================================
   outils/signer-aab.js
   Signer les AAB Android — configuration Gradle
   ============================================================
   Cible : <app>/android/app/build.gradle  (+ keystore.properties, .gitignore)

   ── LE PROBLEME ─────────────────────────────────────────────────
   Les projets Android de Locamp n'ont aucun signingConfigs. `gradlew
   bundleRelease` produit donc un AAB NON SIGNE, que le Play Store
   refuse — et son message ne dit pas que la signature manque, d'ou
   l'impression que « l'AAB ne marche pas ».

   ── CE QUE FAIT CE SCRIPT ───────────────────────────────────────
   1. Ajoute a build.gradle la lecture d'un fichier keystore.properties
      et un signingConfigs.release qui s'en sert.
   2. Branche cette signature sur le type de build `release`.
   3. Cree keystore.properties s'il est absent, avec le chemin et
      l'alias deja remplis — le MOT DE PASSE reste a saisir par vous,
      dans votre editeur. Aucun secret ne passe par ce script.
   4. Ajoute keystore.properties, *.keystore et *.jks au .gitignore :
      une cle versionnee est une cle publique.

   La configuration reste tolerante a l'absence du fichier : sans
   keystore.properties, les builds debug continuent de fonctionner
   normalement — c'est seulement `bundleRelease` qui sortira non signe.

   Usage, depuis la racine d'une app mobile (mobile/portail, mobile/gestion) :
     node ../../outils/signer-aab.js --essai
     node ../../outils/signer-aab.js

   Ou en precisant le dossier :
     node outils/signer-aab.js mobile/portail
   ============================================================ */

const fs = require('fs');
const path = require('path');

const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');
const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const BASE = path.resolve(process.cwd(), arg || '.');
const ANDROID = path.join(BASE, 'android');
const GRADLE = path.join(ANDROID, 'app', 'build.gradle');
const PROPS = path.join(ANDROID, 'keystore.properties');
const GITIGNORE = path.join(BASE, '.gitignore');

/* Valeurs relevees dans le trousseau existant. Le mot de passe n'y est pas :
   il n'a rien a faire dans un fichier suivi par git. */
const KS_DEFAUT = {
  portail: { fichier: process.env.HOME + '/Documents/locamp-PORTAIL-keystore-SAUVEGARDE.keystore', alias: 'android' },
  gestion: { fichier: process.env.HOME + '/Documents/locamp-keystore-SAUVEGARDE.keystore', alias: 'android' },
};

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!fs.existsSync(GRADLE)) {
  echec(`${GRADLE} introuvable.\n    Lancez depuis mobile/portail ou mobile/gestion, ou passez le dossier en argument.`);
}

let g = fs.readFileSync(GRADLE, 'utf8');
/* Reference d'equilibre : un fichier Gradle peut contenir des accolades
   dans des chaines. On compare donc l'ecart AVANT et APRES, pas un zero
   absolu. */
const ECART_AVANT = (g.match(/\{/g) || []).length - (g.match(/\}/g) || []).length;

if (g.indexOf('signingConfigs') !== -1) {
  console.log('\n  build.gradle contient deja signingConfigs — rien a faire cote Gradle.');
  if (!fs.existsSync(PROPS)) console.log('  Mais keystore.properties est absent : les release sortiront non signes.\n');
  else console.log('');
  process.exit(0);
}

/* 1. La lecture du fichier de proprietes, avant le bloc android {. */
const I_ANDROID = g.search(/^android\s*\{/m);
if (I_ANDROID === -1) echec('Le bloc « android { » est introuvable dans build.gradle.');

const LECTURE = [
  '// Signature de release : les identifiants vivent dans',
  '// android/keystore.properties, hors depot (voir .gitignore).',
  '// Absent = les builds debug marchent toujours, seul bundleRelease',
  '// sortira non signe.',
  'def ksFile = rootProject.file("keystore.properties")',
  'def ks = new Properties()',
  'if (ksFile.exists()) ks.load(new FileInputStream(ksFile))',
  '',
].join('\n');

g = g.slice(0, I_ANDROID) + LECTURE + g.slice(I_ANDROID);

/* 2. Le bloc signingConfigs, juste apres l'ouverture de android {. */
const M_ANDROID = g.match(/^android\s*\{[ \t]*\r?\n/m);
if (!M_ANDROID) echec('Impossible de localiser l\'ouverture du bloc android.');
const POS = g.indexOf(M_ANDROID[0]) + M_ANDROID[0].length;

const SIGNING = [
  '    signingConfigs {',
  '        release {',
  '            if (ksFile.exists()) {',
  '                storeFile file(ks["storeFile"])',
  '                storePassword ks["storePassword"]',
  '                keyAlias ks["keyAlias"]',
  '                keyPassword ks["keyPassword"] ?: ks["storePassword"]',
  '            }',
  '        }',
  '    }',
  '',
].join('\n');

g = g.slice(0, POS) + SIGNING + g.slice(POS);

/* 3. Brancher la signature sur le type release. */
const M_RELEASE = g.match(/(buildTypes\s*\{[\s\S]{0,400}?release\s*\{[ \t]*\r?\n)/);
if (!M_RELEASE) echec('Le type de build « release » est introuvable dans buildTypes.');
g = g.replace(M_RELEASE[1], M_RELEASE[1] + '            signingConfig signingConfigs.release\n');

/* ---- Verifications ---- */
for (const [quoi, aiguille] of [
  ['la lecture de keystore.properties', 'rootProject.file("keystore.properties")'],
  ['le bloc signingConfigs', 'signingConfigs {'],
  ['le branchement sur release', 'signingConfig signingConfigs.release'],
  ['le repli mot de passe de cle', 'ks["keyPassword"] ?: ks["storePassword"]'],
]) if (g.indexOf(aiguille) === -1) echec(`Verification : ${quoi} est absent du resultat.`);

if (g.split('signingConfig signingConfigs.release').length - 1 !== 1) {
  echec('La ligne de signature apparait plusieurs fois.');
}
/* Une accolade mal placee casse tout le build. */
const ECART_APRES = (g.match(/\{/g) || []).length - (g.match(/\}/g) || []).length;
if (ECART_APRES !== ECART_AVANT) {
  echec(`Accolades desequilibrees par l'edition (ecart ${ECART_AVANT} avant, ${ECART_APRES} apres).`);
}

/* 4. keystore.properties, seulement s'il n'existe pas. */
const nom = path.basename(BASE);
const d = KS_DEFAUT[nom] || { fichier: process.env.HOME + '/chemin/vers/votre.keystore', alias: 'android' };
const MODELE = [
  '# Identifiants de signature — NE PAS COMMITTER.',
  '# storeFile : chemin absolu du trousseau. keyAlias : « android » ici.',
  '# Remplacez A_REMPLIR par le mot de passe du trousseau.',
  '# Trousseau PKCS12 : le mot de passe de la cle est le meme, keyPassword',
  '# peut donc rester vide.',
  `storeFile=${d.fichier}`,
  'storePassword=A_REMPLIR',
  `keyAlias=${d.alias}`,
  'keyPassword=',
  '',
].join('\n');

/* 5. .gitignore — une cle versionnee est une cle publique. */
let gi = fs.existsSync(GITIGNORE) ? fs.readFileSync(GITIGNORE, 'utf8') : '';
const A_IGNORER = ['android/keystore.properties', '*.keystore', '*.jks'];
const manquants = A_IGNORER.filter((l) => !gi.split(/\r?\n/).includes(l));
if (manquants.length) {
  gi = gi.replace(/\s*$/, '\n') + '\n# Signature Android — jamais dans le depot\n'
    + manquants.join('\n') + '\n';
}

if (!ESSAI) {
  fs.writeFileSync(GRADLE, g, 'utf8');
  if (!fs.existsSync(PROPS)) fs.writeFileSync(PROPS, MODELE, 'utf8');
  if (manquants.length) fs.writeFileSync(GITIGNORE, gi, 'utf8');
  if (fs.readFileSync(GRADLE, 'utf8').indexOf('signingConfig signingConfigs.release') === -1) {
    echec('L\'ajout est absent apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log(`  App : ${nom}`);
console.log('  build.gradle : signingConfigs.release + branchement sur le type release.');
if (fs.existsSync(PROPS) && !ESSAI) console.log('  keystore.properties : deja present, laisse tel quel.');
else console.log(`  keystore.properties : cree (${d.alias} / ${path.basename(d.fichier)}).`);
if (manquants.length) console.log('  .gitignore : keystore.properties, *.keystore, *.jks ajoutes.');
console.log('');
console.log('  A FAIRE ENSUITE, a la main :');
console.log(`    1. Ouvrir ${path.relative(process.cwd(), PROPS)} et remplacer A_REMPLIR`);
console.log('       par le mot de passe du trousseau.');
console.log('    2. cd android && ./gradlew bundleRelease');
console.log('    3. L\'AAB sort dans android/app/build/outputs/bundle/release/');
console.log('    4. Verifier la signature :');
console.log('       jarsigner -verify -verbose app/build/outputs/bundle/release/app-release.aab | tail -3');
console.log('');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

#!/usr/bin/env node
/* ============================================================
   outils/manifest-icones.js
   Le manifeste déclare enfin des icônes qui existent
   ============================================================
   Cible : backend/public/manifest.json

   ── DEUX DEFAUTS ─────────────────────────────────────────────────

   1. LES FICHIERS N'EXISTAIENT PAS. Le manifeste reclamait
      /icons/icone-192.png et /icons/icone-512.png, et index.html
      /icons/icone-180.png : le dossier /icons/ etait absent du depot.
      D'ou l'erreur repetee dans la console, « Download error or
      resource isn't a valid image », et une icone generique a
      l'installation.

   2. LA MEME IMAGE SERVAIT EN « ANY » ET EN « MASKABLE ». Ce sont deux
      objets differents. Android rogne une icone maskable en cercle ou
      en carre arrondi selon le fabricant : son contenu doit tenir dans
      les 80 % centraux, et son fond aller bord a bord. Notre monogramme
      porte un filet a 8/64 du bord — il aurait ete coupe.

      Une image dediee accompagne donc ce script : fond plein, lettre et
      filet ramenes dans la zone sure.

   ── CE QUE FAIT CE SCRIPT ────────────────────────────────────────
   Il ne touche qu'au manifeste : la declaration maskable pointe vers sa
   propre image, et une taille 180 est ajoutee pour l'ecran d'accueil
   iOS, qu'index.html reclamait sans que le manifeste la connaisse.

   Les quatre PNG sont a copier dans backend/public/icons/ — ils sont
   fournis a cote de ce fichier.

   Usage :
     node outils/manifest-icones.js --essai
     node outils/manifest-icones.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'backend', 'public', 'manifest.json');
const DOSSIER = path.join(process.cwd(), 'backend', 'public', 'icons');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('backend/public/manifest.json introuvable. Lancez depuis la racine du projet.');

const m = JSON.parse(fs.readFileSync(CIBLE, 'utf8'));

if (JSON.stringify(m.icons || []).indexOf('maskable.png') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

m.icons = [
  { src: '/icons/icone-180.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
  { src: '/icons/icone-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/icons/icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  // Rognee par le systeme : contenu dans les 80 % centraux, fond bord a bord.
  { src: '/icons/icone-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
];

/* On previent si les fichiers manquent : un manifeste juste qui pointe dans le
   vide est exactement le defaut qu'on corrige. */
const attendus = m.icons.map((i) => path.basename(i.src));
const manquants = attendus.filter((f) => !fs.existsSync(path.join(DOSSIER, f)));

if (!ESSAI) {
  fs.writeFileSync(CIBLE, JSON.stringify(m, null, 2) + '\n', 'utf8');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log('  Quatre icones declarees, dont une maskable dediee.\n');

if (manquants.length) {
  console.log('  \u26a0  Fichiers absents de backend/public/icons/ :');
  manquants.forEach((f) => console.log('     ' + f));
  console.log('\n  Copiez-les depuis le dossier fourni :');
  console.log('     mkdir -p backend/public/icons');
  console.log('     cp ~/Downloads/livraison-icones/*.png backend/public/icons/\n');
} else {
  console.log('  Les quatre fichiers sont en place.\n');
}
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

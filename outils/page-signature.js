#!/usr/bin/env node
/* ============================================================
   Page de signature : le zoom, la marque, les jetons
   ============================================================
   Cible : backend/public/signature/index.html

   ── CE QUE J'AVAIS MAL VU ────────────────────────────────────────
   Mon audit annonçait « aucune feuille de style ». C'était faux : la
   page porte 200 lignes de CSS en clair, avec la bonne palette. Elle
   n'est pas nue. Trois vrais défauts, en revanche.

   ── 1. LE ZOOM EST INTERDIT — le plus grave ──────────────────────
       <meta name="viewport" content="… maximum-scale=1.0, user-scalable=no">

   Sur cette page, le résident lit un contrat qui l'engage
   juridiquement, sur un téléphone, dans un cadre de 64 % de la
   hauteur d'écran. Lui interdire d'agrandir le texte est un défaut
   d'accessibilité dans tous les cas ; ici c'est un résident
   presbyte ou malvoyant qui signe un document qu'il ne peut pas
   lire. iOS ignore d'ailleurs cette directive depuis longtemps —
   elle ne pénalise donc qu'Android.

   La raison habituelle de la mettre est d'éviter le zoom
   involontaire au double-tap. `touch-action: manipulation` le
   supprime sans retirer le zoom volontaire : c'est ce qui est posé
   ici à la place.

   ── 2. AUCUNE MARQUE ─────────────────────────────────────────────
   Ni logo, ni nom. Le résident reçoit un lien par e-mail et arrive
   sur une page qui pourrait appartenir à n'importe qui. Au moment
   précis où on lui demande de s'engager, rien ne dit qui édite
   l'outil. C'est un problème de confiance avant d'être un problème
   de design — et l'onglet du navigateur affiche « Signature
   électronique », sans plus.

   ── 3. LES JETONS, UNE TROISIÈME FOIS ────────────────────────────
   La palette est redéclarée ici, avec des noms abrégés qui ne sont
   ceux de personne :

       --sapin-h   au lieu de  --sapin-hover
       --hair      au lieu de  --hairline
       --sh, --shl au lieu de  --shadow-s, --shadow-l

   Les valeurs sont identiques aujourd'hui. Le jour où le vert de
   marque change, cette page restera en arrière — et c'est celle que
   voit le résident au moment le plus formel. Elle charge désormais
   marque.css comme les deux autres faces.

   Les alias abrégés sont conservés en pointant vers les jetons
   partagés : les 200 lignes de CSS de la page continuent de
   fonctionner sans être réécrites.

   Usage :
     node outils/page-signature.js --essai
     node outils/page-signature.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'backend', 'public', 'signature', 'index.html');
const MARQUE = path.join(process.cwd(), 'backend', 'public', 'marque.css');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

if (!fs.existsSync(CIBLE)) {
  console.error('\n  \u2717 backend/public/signature/index.html introuvable.\n');
  process.exit(1);
}
if (!fs.existsSync(MARQUE)) {
  console.error('\n  \u2717 backend/public/marque.css introuvable.');
  console.error('    Appliquez d\'abord le lot « marque unifiée ».\n');
  process.exit(1);
}

let h = fs.readFileSync(CIBLE, 'utf8');

if (h.indexOf('/marque.css') !== -1) {
  console.log('\n  Déjà appliqué — rien à faire.\n');
  process.exit(0);
}

const edits = [];

/* ── 1. Le zoom ──────────────────────────────────────────────── */
edits.push(['viewport : rendre le zoom possible',
  `<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">`,
  `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`]);

/* ── 2. La marque : titre, thème, feuille partagée ───────────── */
edits.push(['en-tête : titre, couleur de thème, marque',
  `<title>Signature électronique</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">`,
  `<title>Signature électronique — Locamp</title>
<meta name="theme-color" content="#F6F3EC">
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="/logo.svg" type="image/svg+xml">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/marque.css">`]);

/* ── 3. Les jetons deviennent des alias ──────────────────────── */
edits.push(['jetons : alias vers marque.css',
  `:root{--ivoire:#F6F3EC;--carte:#fff;--encre:#1B2E28;--sapin:#175243;--sapin-h:#1C614F;
 --brume:#75837C;--hair:#E7E1D4;--laiton:#B98A3C;--rouge:#A8402A;
 --sh:0 1px 2px rgba(15,35,29,.05),0 2px 8px rgba(15,35,29,.04);
 --shl:0 8px 24px rgba(15,35,29,.10),0 24px 64px rgba(15,35,29,.12)}`,
  `/* La palette vient de marque.css, partagée avec l'outil de gestion et
   l'espace locataire. Elle était redéclarée ici avec des noms abrégés
   qui n'étaient ceux de personne : --sapin-h, --hair, --sh. Les alias
   ci-dessous les font pointer vers les jetons communs, sans avoir à
   réécrire les 200 lignes qui suivent. */
:root{
  --sapin-h:var(--sapin-hover);
  --hair:var(--hairline);
  --sh:var(--shadow-s);
  --shl:var(--shadow-l);
}`]);

/* ── 4. Le double-tap, sans interdire le zoom ────────────────── */
edits.push(['double-tap sur les cibles tactiles',
  `*{box-sizing:border-box}`,
  `*{box-sizing:border-box}
/* Supprime le zoom au double-tap sur les éléments qu'on presse vite,
   sans retirer le zoom volontaire à deux doigts — ce que faisait
   user-scalable=no. */
button,label,input,.case,.btn{touch-action:manipulation}`]);

/* ── 5. Le bandeau de marque, en tête de page ────────────────── */
edits.push(['bandeau de marque',
  `<div class="wrap">

  <div id="chargement" class="card">`,
  `<div class="wrap">

  <!-- Le résident arrive ici depuis un lien reçu par e-mail, pour signer
       un document qui l'engage. Rien n'indiquait de quel outil il s'agit.
       Une marque visible n'est pas un ornement à cet endroit : c'est ce
       qui distingue une page légitime d'une page d'hameçonnage. -->
  <header class="brand" style="margin:4px 0 20px">
    <span class="brand-mark" style="width:38px;height:38px;border-radius:11px">
      <img src="/logo.svg" alt="" width="64" height="64">
    </span>
    <span>
      <span class="brand-name" style="font-size:18px">Locamp</span>
      <span class="brand-sub" style="display:block">Signature électronique</span>
    </span>
  </header>

  <div id="chargement" class="card">`]);

/* ── Application ─────────────────────────────────────────────── */
let faits = 0;
for (const [nom, avant, apres] of edits) {
  const n = h.split(avant).length - 1;
  if (n !== 1) {
    console.error('\n  \u2717 ' + nom + ' : ' + n + ' occurrence(s), 1 attendue.');
    console.error('    Le fichier a changé. Rien n\'a été écrit.\n');
    process.exit(1);
  }
  h = h.split(avant).join(apres);
  console.log('  appliqué  ' + nom);
  faits++;
}

/* Contrôle : aucun jeton utilisé ne doit rester sans déclaration. */
const marque = fs.readFileSync(MARQUE, 'utf8');
const declares = new Set();
marque.replace(/(--[a-z0-9-]+)\s*:/gi, (t, k) => { declares.add(k); return t; });
h.replace(/(--[a-z0-9-]+)\s*:/gi, (t, k) => { declares.add(k); return t; });
const utilises = new Set();
h.replace(/var\(\s*(--[a-z0-9-]+)/g, (t, k) => { utilises.add(k); return t; });
const orphelins = [...utilises].filter((k) => !declares.has(k));

if (orphelins.length) {
  console.error('\n  \u2717 Jetons utilisés sans être déclarés : ' + orphelins.join(', '));
  console.error('    Rien n\'a été écrit.\n');
  process.exit(1);
}

if (!ESSAI) fs.writeFileSync(CIBLE, h, 'utf8');

console.log('\n' + (ESSAI ? '— ESSAI, aucune écriture —' : '— APPLIQUÉ —'));
console.log('  ' + faits + ' modifications. ' + utilises.size + ' jetons utilisés, tous déclarés.');
console.log('\n  À VÉRIFIER À L\'ÉCRAN — ouvrez un lien de signature sur');
console.log('  téléphone :');
console.log('    · le pincement à deux doigts agrandit maintenant le document ;');
console.log('    · le double-tap sur un bouton ne zoome plus ;');
console.log('    · le logo Locamp apparaît en haut ;');
console.log('    · le reste de la page est inchangé — mêmes couleurs,');
console.log('      même mise en page.');
console.log('\n  RESTE À DÉCIDER — hors de ce script');
console.log('    Le cadre du document est limité à 64 % de la hauteur d\'écran');
console.log('    (max-height:64vh). Sur un téléphone, un contrat de plusieurs');
console.log('    pages se lit alors dans une fenêtre de dix lignes, avec deux');
console.log('    défilements imbriqués — celui de la page et celui du cadre.');
console.log('    C\'est le point de friction principal du parcours. Le corriger');
console.log('    demande de repenser la mise en page mobile, pas d\'ajuster une');
console.log('    valeur : à traiter à part.');
if (ESSAI) console.log('\n  Relancez sans --essai pour appliquer.');
console.log('');

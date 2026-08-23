#!/usr/bin/env node
/* ============================================================
   outils/messagerie-diffusion.js
   « À TOUS » ne disait pas combien
   ============================================================
   Cible : backend/public/app.js

   ── 1. LE BOUTON PRINCIPAL EST LE PLUS RISQUE ────────────────────
   Sur la page Messagerie, « Message a tous » est en vert plein et
   « Message rapide » en contour. Le vert plein designe l'action
   courante, celle vers laquelle l'oeil et la main vont d'eux-memes.

   Or ecrire a un resident se fait tous les jours, et diffuser a tout le
   camping quelques fois par an. Surtout, un message parti a 124
   personnes avec notification e-mail ne se rattrape pas.

   Les deux boutons echangent leur poids. Sur le tableau de bord, ou les
   deux sont deja en contour, rien ne change.

   ── 2. « TOUS » NE VEUT RIEN DIRE ────────────────────────────────
   La confirmation demande « Envoyer ce message a TOUS les residents
   actifs ? ». Sur un camping de deux residents et sur un camping de
   cent vingt-quatre, c'est la meme phrase — alors que ce n'est pas la
   meme decision.

   Le nombre est desormais charge a l'ouverture, affiche dans le
   panneau et repete dans la confirmation. « Envoyer a 124 residents »
   est une decision ; « envoyer a tous » est une formule.

   ── 3. DEUX NOMS POUR LA MEME ACTION ─────────────────────────────
   La meme fonction s'appelle « Prevenir un client » sur le tableau de
   bord et « Message rapide » sur la messagerie. « Message rapide » ne
   dit d'ailleurs pas a qui — c'est « rapide » par opposition a quoi ?

   Les deux ecrans disent maintenant « Message a un resident », en
   symetrie avec « Message a tous ».

   Usage :
     node outils/messagerie-diffusion.js --essai
     node outils/messagerie-diffusion.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'backend', 'public', 'app.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

if (!fs.existsSync(CIBLE)) {
  console.error('\n  \u2717 backend/public/app.js introuvable. Lancez depuis la racine du projet.\n');
  process.exit(1);
}

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('nbDestinataires') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

const edits = [];

/* ── 1. Les deux boutons echangent leur poids ─────────────────────── */
edits.push([
  'hierarchie des boutons',
  `        <button class="btn btn-ghost" data-act="messageRapide">Message rapide</button>
        <button class="btn btn-primary" data-act="messageGroupe">Message à tous</button>`,
  `        \${/* Le vert plein va a l'action courante. Ecrire a un resident se fait
             tous les jours ; diffuser a tout le camping quelques fois par an, et
             ne se rattrape pas. */ ''}
        <button class="btn btn-ghost" data-act="messageGroupe">Message à tous</button>
        <button class="btn btn-primary" data-act="messageRapide">Message à un résident</button>`
]);

/* ── 2. Le nombre de destinataires ────────────────────────────────── */
edits.push([
  'ouverture du panneau de diffusion',
  `window.messageGroupe = () => {
  openDrawer(\`
    <h2>Message à tous les résidents</h2>
    <p class="muted" style="margin-top:4px">Envoyé sur le portail de chaque résident actif, avec notification e-mail.</p>
    <form id="f-groupe" style="margin-top:14px">
      <textarea name="corps" required rows="5" placeholder="Ex. : Coupure d'eau prévue mardi de 9h à 12h…" style="width:100%;resize:vertical"></textarea>
      <button class="btn btn-primary btn-block" style="margin-top:12px">Envoyer à tous</button>
    </form>\`);`,
  `window.messageGroupe = async () => {
  /* Combien de personnes exactement. « Tous » est une formule ; « 124 residents »
     est une decision — et c'est la meme phrase qui s'affiche sur un camping de
     deux et sur un camping de cent vingt-quatre. */
  let nbDestinataires = null;
  try {
    const { residents } = await api('/api/residents');
    nbDestinataires = (residents || []).filter((r) => r.actif !== false).length;
  } catch (e) { /* le compte manque, la diffusion reste possible */ }

  const combien = nbDestinataires == null
    ? 'chaque résident actif'
    : \`\${nbDestinataires} résident\${nbDestinataires > 1 ? 's' : ''} actif\${nbDestinataires > 1 ? 's' : ''}\`;

  openDrawer(\`
    <h2>Message à tous les résidents</h2>
    <p class="muted" style="margin-top:4px">Envoyé sur le portail de <strong>\${combien}</strong>, avec notification e-mail. Un message diffusé ne peut pas être rappelé.</p>
    <form id="f-groupe" style="margin-top:14px">
      <textarea name="corps" required rows="5" placeholder="Ex. : Coupure d'eau prévue mardi de 9h à 12h…" style="width:100%;resize:vertical"></textarea>
      <button class="btn btn-primary btn-block" style="margin-top:12px">\${nbDestinataires == null ? 'Envoyer à tous' : \`Envoyer à \${nbDestinataires} résident\${nbDestinataires > 1 ? 's' : ''}\`}</button>
    </form>\`);`
]);

edits.push([
  'confirmation',
  `    if (!await askConfirm('Envoyer ce message à TOUS les résidents actifs ?')) return;`,
  `    if (!await askConfirm(
      nbDestinataires == null
        ? 'Envoyer ce message à tous les résidents actifs ?\\n\\nIl ne pourra pas être rappelé.'
        : \`Envoyer ce message à \${nbDestinataires} résident\${nbDestinataires > 1 ? 's' : ''} ?\\n\\nChacun le recevra sur son portail et par e-mail. Il ne pourra pas être rappelé.\`,
      { titre: 'Diffusion à tout le camping', ok: 'Envoyer' })) return;`
]);

/* ── 3. Un seul nom pour une seule action ─────────────────────────── */
edits.push([
  'libelle du tableau de bord',
  `<button class="btn btn-ghost btn-sm" data-act="messageRapide">Prévenir un client</button>`,
  `<button class="btn btn-ghost btn-sm" data-act="messageRapide">Message à un résident</button>`
]);

edits.push([
  'titre du panneau',
  `    <h2>Message rapide</h2>`,
  `    <h2>Message à un résident</h2>`
]);

for (const [nom, ancien] of edits) {
  const n = src.split(ancien).length - 1;
  if (n !== 1) {
    console.error('\n  \u2717 ' + nom + ' : ' + n + ' occurrence(s), 1 attendue.');
    console.error('    Le fichier a change. Rien n\'a ete ecrit.\n');
    process.exit(1);
  }
}
for (const [, ancien, nouveau] of edits) src = src.split(ancien).join(nouveau);

try {
  new Function(src);
} catch (e) {
  console.error('\n  \u2717 Le resultat n\'est pas du JavaScript valide : ' + e.message);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!ESSAI) fs.writeFileSync(CIBLE, src, 'utf8');

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log('  Le bouton principal est le message individuel.');
console.log('  La diffusion annonce son nombre de destinataires.');
console.log('  « Message a un resident » sur les deux ecrans.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

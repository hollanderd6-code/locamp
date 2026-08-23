#!/usr/bin/env node
/* ============================================================
   outils/carte-allees-lisibles.js
   Les noms d'allées passaient sous les pastilles
   ============================================================
   Cibles : backend/public/app.js
            backend/public/styles.css

   ── LE DEFAUT ────────────────────────────────────────────────────
   Le plan se dessine en deux couches, dans cet ordre :

       <g class="layer-decor">   allees, arbres, batiments
       <g class="layer-pins">    les 124 pastilles

   En SVG, ce qui est dessine en dernier passe au-dessus. Les pastilles
   recouvrent donc les noms d'allees. Sur un camping dense, « ALLEE DES
   NOISETIERS », « ALLEE DES AUBEPINES » et « ALLEE DES SAULES »
   apparaissent hachees par les emplacements 84-88, 92-96 et 122 —
   illisibles.

   C'est l'information qui fait le lien entre le plan et la parole : on
   dit a un resident « vous etes allee des Noisetiers », pas « vous etes
   a la coordonnee 340, 210 ».

   ── LA CORRECTION ────────────────────────────────────────────────
   Une troisieme couche, posee apres les pastilles, ne portant QUE les
   libelles d'allees. Le trace des allees reste au fond, sous les
   pastilles — c'est bien lui qui doit passer dessous.

       <g class="layer-decor">   allees (trace seul), arbres, batiments
       <g class="layer-pins">    les pastilles
       <g class="layer-allees">  les noms d'allees

   La couche de libelles est transparente au clic (pointer-events:none).
   Sans cela, elle intercepterait la selection en mode edition : le
   libelle se pose au tiers de l'allee, donc juste au-dessus de sa zone
   de clic. La selection continue de passer par le trace, qui porte deja
   une ligne de touche de 26 px.

   Un halo blanc discret est ajoute sous le texte : la pastille qui
   passe dessous reste visible, mais ne mange plus les lettres.

   Usage :
     node outils/carte-allees-lisibles.js --essai
     node outils/carte-allees-lisibles.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const ESSAI  = process.argv.includes('--essai') || process.argv.includes('--dry');
const APP    = path.join(process.cwd(), 'backend', 'public', 'app.js');
const STYLES = path.join(process.cwd(), 'backend', 'public', 'styles.css');

for (const f of [APP, STYLES]) {
  if (!fs.existsSync(f)) {
    console.error('\n  \u2717 ' + f + ' introuvable. Lancez depuis la racine du projet.\n');
    process.exit(1);
  }
}

let app = fs.readFileSync(APP, 'utf8');
let css = fs.readFileSync(STYLES, 'utf8');

if (app.indexOf('layer-allees') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

const edits = [];

/* ── 1. Le libelle quitte le groupe de l'allee ────────────────────── */
edits.push([
  'retrait du libelle du decor',
  `      \${lib && allee ? \`<g transform="rotate(\${angle} \${mx} \${my})">
        <rect class="celem-allee-bg" x="\${mx - larg / 2}" y="\${my - 8}" width="\${larg}" height="16" rx="8"></rect>
        <text class="celem-allee" x="\${mx}" y="\${my}">\${esc(lib)}</text></g>\` : ''}
`,
  `      \${/* le libelle est dessine par dessinerLibelleAllee, dans une couche
            posee APRES les pastilles — sinon elles le recouvrent */ ''}
`
]);

/* ── 2. La fonction qui dessine les libelles seuls ────────────────── */
edits.push([
  'fonction de libelle',
  `/* ------------------------------- rendu ------------------------------- */`,
  `/* ------------------------------- rendu ------------------------------- */

/* Le nom d'une allee, sans son trace. Dessine dans une couche posee apres les
   pastilles : en SVG le dernier dessine passe au-dessus, et les pastilles
   hachaient les noms d'allees des zones denses. Rend une chaine vide pour
   tout ce qui n'est pas une allee nommee. */
function dessinerLibelleAllee(el) {
  const v = elemVals(el);
  const def = ELEM_DEFS[v.type] || {};
  if (def.forme !== 'ligne' || v.type !== 'allee') return '';
  const lib = v.libelle || def.lib || '';
  if (!lib) return '';

  const x2 = v.x2 ?? v.x + (def.long || 200), y2 = v.y2 ?? v.y;
  const mx = v.x + (x2 - v.x) * 0.32, my = v.y + (y2 - v.y) * 0.32;
  const angle = Math.atan2(y2 - v.y, x2 - v.x) * 180 / Math.PI;
  const larg = lib.length * 6.6 + 18;

  return \`<g transform="rotate(\${angle} \${mx} \${my})">
    <rect class="celem-allee-bg" x="\${mx - larg / 2}" y="\${my - 8}" width="\${larg}" height="16" rx="8"></rect>
    <text class="celem-allee" x="\${mx}" y="\${my}">\${esc(lib)}</text></g>\`;
}`
]);

/* ── 3. La couche, apres les pastilles ────────────────────────────── */
edits.push([
  'couche de libelles',
  `            <g class="layer-decor">\${decor}</g>
            <g class="layer-pins">\${pins}</g>`,
  `            <g class="layer-decor">\${decor}</g>
            <g class="layer-pins">\${pins}</g>
            <g class="layer-allees">\${alleeLibelles}</g>`
]);

/* ── 4. Le calcul, a cote de celui du decor ───────────────────────── */
edits.push([
  'calcul des libelles',
  `  const decor = st.elements.map((el) => dessinerElement(el, edit)).join('');`,
  `  const decor = st.elements.map((el) => dessinerElement(el, edit)).join('');
  const alleeLibelles = st.elements.map((el) => dessinerLibelleAllee(el)).join('');`
]);

for (const [nom, ancien] of edits) {
  const n = app.split(ancien).length - 1;
  if (n !== 1) {
    console.error('\n  \u2717 ' + nom + ' : ' + n + ' occurrence(s), 1 attendue.');
    console.error('    Le fichier a change. Rien n\'a ete ecrit.\n');
    process.exit(1);
  }
}
for (const [, ancien, nouveau] of edits) app = app.split(ancien).join(nouveau);

/* ── 5. Le style de la couche ─────────────────────────────────────── */
css += `

/* ── Carte : couche des noms d'allées ──
   Posée après les pastilles pour rester lisible. Transparente au clic :
   sinon elle intercepterait la sélection en mode édition, le libellé se
   plaçant au tiers de l'allée, juste au-dessus de sa zone de touche. */
.layer-allees{pointer-events:none}
.layer-allees .celem-allee-bg{fill:#F7F2E4;fill-opacity:.94}
`;

if (!ESSAI) {
  fs.writeFileSync(APP, app, 'utf8');
  fs.writeFileSync(STYLES, css, 'utf8');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log('  Les noms d\'allees passent au-dessus des pastilles.');
console.log('  Le trace des allees reste au fond, la selection est inchangee.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

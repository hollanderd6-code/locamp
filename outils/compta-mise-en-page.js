#!/usr/bin/env node
/* ============================================================
   outils/compta-mise-en-page.js
   L'écran Comptabilité : quatre cartes, une seule colonne
   ============================================================
   Cibles : backend/public/app.js
            backend/public/styles.css

   ── CE QUI N'ALLAIT PAS ──────────────────────────────────────────
   Quatre cartes empilées sur toute la largeur, chacune contenant deux
   ou trois champs. Sur un écran large, chaque carte occupe 1400 px de
   large pour un contenu qui en demande 500. On fait défiler beaucoup
   pour lire peu, et « Exports comptables » — la raison pour laquelle un
   comptable ouvre cette page en fin d'exercice — se trouve tout en bas.

   Les quatre cartes ne sont d'ailleurs pas de même nature :

     — TVA et Indexation sont des OPÉRATIONS, faites chaque mois ou
       chaque année, avec un résultat qui s'affiche ;
     — Comptes clients est un RÉGLAGE, posé une fois ;
     — Exports comptables est une SORTIE, deux dates et deux boutons.

   Les deux dernières tiennent largement côte à côte. C'est ce qui
   remonte les exports au-dessus de la ligne de flottaison.

   ── CE QUI EST FAIT ──────────────────────────────────────────────
   1. « Comptes clients » et « Exports comptables » passent sur deux
      colonnes, sous les deux opérations. Une seule colonne sous 900 px.
   2. Le texte d'attente « Choisir un mois puis « Calculer ». » est
      retiré : le champ mois et le bouton sont juste au-dessus et disent
      déjà quoi faire. Une consigne qui répète le bouton qu'elle
      désigne n'apprend rien et occupe la place du résultat.
   3. L'exercice en cours, aujourd'hui perdu à droite du titre en gris,
      devient lisible : c'est la donnée qui conditionne les exports.

   Rien n'est déplacé dans l'ordre logique de la page, aucun identifiant
   ne change : le JavaScript qui remplit #tva-resultat, #idx-zone,
   #cc-apercu et les champs d'export continue de fonctionner tel quel.

   Usage :
     node outils/compta-mise-en-page.js --essai
     node outils/compta-mise-en-page.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');
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

if (css.indexOf('.compta-duo') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

/* ── 1. L'exercice en cours, lisible ──────────────────────────────── */
const A1 = `    <div class="page-head"><div><div class="eyebrow">Comptabilité</div><h1>Compta & TVA</h1></div>
      <span class="muted">Exercice en cours : <strong>\${dfr(ex.debut)} → \${dfr(ex.fin)}</strong>\${dm !== 1 ? '' : ' (année civile)'}</span></div>`;

const N1 = `    <div class="page-head"><div><div class="eyebrow">Comptabilité</div><h1>Compta & TVA</h1></div>
      <div class="compta-exercice">Exercice en cours
        <strong>\${dfr(ex.debut)} → \${dfr(ex.fin)}</strong>\${dm !== 1 ? '' : '<span class="muted"> (année civile)</span>'}</div></div>`;

/* ── 2. La consigne qui repetait le bouton ────────────────────────── */
const A2 = `      <div id="tva-resultat" style="margin-top:12px"><p class="muted">Choisir un mois puis « Calculer ».</p></div>`;
const N2 = `      <div id="tva-resultat" style="margin-top:12px"></div>`;

/* ── 3. Les deux cartes courtes, cote a cote ──────────────────────── */
const A3 = `    <div class="card">
      <div class="card-actions"><h2>Comptes clients (auxiliaires)</h2></div>`;
const N3 = `    <div class="compta-duo">
    <div class="card">
      <div class="card-actions"><h2>Comptes clients (auxiliaires)</h2></div>`;

const A4 = `        <button class="btn btn-primary" data-act="exporterCompta" data-a1="fec">Export FEC</button>
        <button class="btn btn-ghost" data-act="exporterCompta" data-a1="csv">Écritures CSV</button>
      </div>
    </div>\`;`;
const N4 = `        <button class="btn btn-primary" data-act="exporterCompta" data-a1="fec">Export FEC</button>
        <button class="btn btn-ghost" data-act="exporterCompta" data-a1="csv">Écritures CSV</button>
      </div>
    </div>
    </div>\`;`;

const edits = [
  ['exercice en cours', A1, N1],
  ['consigne TVA', A2, N2],
  ['ouverture du duo', A3, N3],
  ['fermeture du duo', A4, N4]
];

for (const [nom, ancien] of edits) {
  const n = app.split(ancien).length - 1;
  if (n !== 1) {
    console.error('\n  \u2717 ' + nom + ' : ' + n + ' occurrence(s), 1 attendue.');
    console.error('    Le fichier a change. Rien n\'a ete ecrit.\n');
    process.exit(1);
  }
}
for (const [, ancien, nouveau] of edits) app = app.split(ancien).join(nouveau);

/* ── 4. Le style ──────────────────────────────────────────────────── */
css += `

/* ── Comptabilité ──
   Les deux cartes courtes de la page — réglage des comptes clients et
   exports — tiennent côte à côte. Empilées sur toute la largeur, elles
   repoussaient les exports sous la ligne de flottaison, alors que c'est
   ce qu'un comptable vient chercher en fin d'exercice. */
.compta-duo{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}
@media (max-width:900px){.compta-duo{grid-template-columns:1fr}}

/* L'exercice conditionne la période des exports : il ne peut pas être
   du gris de bas de page. */
.compta-exercice{font-size:13px;color:var(--muted);text-align:right;line-height:1.5}
.compta-exercice strong{display:block;font-size:15px;color:var(--ink);font-variant-numeric:tabular-nums}
@media (max-width:640px){.compta-exercice{text-align:left;margin-top:6px}}
`;

if (!ESSAI) {
  fs.writeFileSync(APP, app, 'utf8');
  fs.writeFileSync(STYLES, css, 'utf8');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log('  Comptes clients et Exports comptables : deux colonnes.');
console.log('  Consigne redondante retiree, exercice en cours lisible.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

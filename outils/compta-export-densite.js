#!/usr/bin/env node
/* ============================================================
   Comptabilité : la date d'export et la densité des cartes
   ============================================================
   Cible : backend/public/app.js
   Prérequis : outils/ecran-compta.js et outils/tiroir-facture.js appliqués.

   Se termine en code 1 au moindre motif introuvable, relit le disque
   après écriture.

   ── 1. UN FEC DATÉ D'UNE PÉRIODE QU'IL NE COUVRE PAS ─────────────
   La période d'export part par défaut sur l'exercice entier :

       Du 01/01/2026    Au 31/12/2026

   Le 24 août, cet export contient les écritures jusqu'au 24 août — et
   le fichier s'appelle FEC_2026-12-31.txt. Le nom annonce un exercice
   complet, le contenu s'arrête en août.

   Ce n'est pas anodin : le FEC est le fichier qu'on remet à
   l'administration lors d'un contrôle. Un nom qui promet une période
   plus large que son contenu se retourne contre celui qui le fournit.

   La date de fin part désormais sur AUJOURD'HUI quand l'exercice est
   encore en cours, et sur la clôture quand il est terminé. Le champ
   reste libre : exporter jusqu'au 31/12 reste possible, mais devient
   un choix explicite.

   Un avertissement s'affiche si la date de fin est dans le futur —
   là où le nom du fichier et son contenu vont diverger.

   ── 2. LES CARTES OCCUPENT UNE PAGE POUR TROIS CHAMPS ────────────
   « TVA sur les encaissements » : un champ mois, un bouton, une phrase
   — dans une carte pleine largeur qui prend un tiers de l'écran. Le
   texte d'aide occupe autant de place que la fonction.

   « Indexation des loyers » : un titre « Campagnes passées » suivi de
   « Aucune campagne pour le moment ». Deux lignes de chrome pour dire
   qu'il n'y a rien.

   Les deux premières cartes passent côte à côte, comme les deux du
   bas le sont déjà — l'écran devient cohérent avec lui-même. Le titre
   « Campagnes passées » ne s'affiche que s'il y a des campagnes : un
   titre sur du vide est du bruit.

   Usage :
     node outils/compta-export-densite.js --essai
     node outils/compta-export-densite.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'backend', 'public', 'app.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

if (!fs.existsSync(CIBLE)) {
  console.error('\n  \u2717 backend/public/app.js introuvable. Lancez depuis la racine du dépôt.\n');
  process.exit(1);
}

let src = fs.readFileSync(CIBLE, 'utf8');
const tailleAvant = src.length;

if (src.indexOf('finExportDefaut') !== -1) {
  console.log('\n  Déjà appliqué — rien à faire.\n');
  process.exit(0);
}

const edits = [

  /* ── 1. La date de fin par défaut ──────────────────────────── */
  ['export : la date de fin s\'arrête à aujourd\'hui',
`  const ex = exerciceCourant(dm);
  const mois = new Date().toISOString().slice(0, 7);`,
`  const ex = exerciceCourant(dm);
  const mois = new Date().toISOString().slice(0, 7);

  /* La période d'export partait sur l'exercice ENTIER, donc sur une date de
     fin future tant que l'exercice n'est pas clos. Le fichier produit
     s'appelait alors FEC_2026-12-31.txt en contenant les écritures jusqu'à
     aujourd'hui : un nom qui annonce une période plus large que son contenu.
     Sur un fichier destiné à l'administration, c'est un écart qu'on ne veut
     pas avoir à expliquer.

     On s'arrête donc à aujourd'hui tant que l'exercice court, et à la clôture
     une fois qu'il est terminé. Le champ reste modifiable. */
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const finExportDefaut = ex.fin > aujourdhui ? aujourdhui : ex.fin;`],

  ['export : champ, avertissement et repère',
`      <p class="muted">Période par défaut : l'exercice en cours. Modifiable ci-dessous.</p>
      <div class="toolbar" style="margin-top:10px">
        <label style="margin:0">Du<input id="exp-debut" type="date" value="\${ex.debut}"></label>
        <label style="margin:0">Au<input id="exp-fin" type="date" value="\${ex.fin}"></label>`,
`      <p class="muted">Exercice en cours, arrêté à aujourd'hui\${ex.fin > aujourdhui ? \` — la clôture est prévue le \${dfr(ex.fin)}\` : ''}. Modifiable ci-dessous.</p>
      <div class="toolbar" style="margin-top:10px">
        <label style="margin:0">Du<input id="exp-debut" type="date" value="\${ex.debut}"></label>
        <label style="margin:0">Au<input id="exp-fin" type="date" value="\${finExportDefaut}"></label>`],

  ['export : avertir si la date de fin est future',
`  majApercuCompte();
  $('#cc-racine').addEventListener('input', majApercuCompte);`,
`  /* Une date de fin dans le futur produit un fichier dont le nom annonce
     une période que son contenu ne couvre pas. On ne l'interdit pas — on
     peut vouloir préparer un export — mais on le dit. */
  const majAvertExport = () => {
    const fin = $('#exp-fin')?.value;
    let z = $('#exp-avert');
    if (!z) {
      z = document.createElement('p');
      z.id = 'exp-avert';
      z.className = 'muted';
      z.style.cssText = 'margin:10px 0 0;font-size:13px';
      $('#exp-fin')?.closest('.toolbar')?.insertAdjacentElement('afterend', z);
    }
    if (fin && fin > aujourdhui) {
      z.innerHTML = '<span style="color:var(--laiton)">La date de fin est dans le futur : '
        + 'le fichier portera ce nom, mais s\\u2019arrêtera aux dernières écritures enregistrées.</span>';
    } else { z.textContent = ''; }
  };
  $('#exp-fin')?.addEventListener('change', majAvertExport);
  majAvertExport();

  majApercuCompte();
  $('#cc-racine').addEventListener('input', majApercuCompte);`],

  /* ── 2. La densité ─────────────────────────────────────────── */
  ['cartes TVA et Indexation côte à côte',
`\n    <div class="card">
      <div class="card-actions"><h2>TVA sur les encaissements</h2>`,
`\n    ${/* Les deux premières cartes prenaient chacune la largeur entière pour
         trois champs. Elles passent côte à côte dans .compta-duo — la même
         classe que les deux cartes du bas : l'écran devient cohérent avec
         lui-même, et le comportement mobile est déjà défini. */''}
    <div class="compta-duo" style="align-items:start">
    <div class="card">
      <div class="card-actions"><h2>TVA sur les encaissements</h2>`],

  ['fermeture de la grille des deux premières cartes',
`      <p class="muted">Revalorise tous les loyers d\\u2019un pourcentage`,
`      <p class="muted" style="font-size:13px">Revalorise tous les loyers d\\u2019un pourcentage`],
];

let total = 0;
for (const [nom, avant, apres] of edits) {
  const n = src.split(avant).length - 1;
  if (n !== 1) {
    console.error('\n  \u2717 ' + nom);
    console.error('      ' + n + ' occurrence(s), 1 attendue.');
    console.error('      Motif : ' + avant.split('\n')[0].trim().slice(0, 78));
    console.error('\n    AUCUNE écriture. Le fichier est intact.\n');
    process.exit(1);
  }
  src = src.split(avant).join(apres);
  console.log('  ok  ' + nom);
  total += 1;
}

/* La grille ouverte doit être refermée après la carte Indexation, juste
   avant la grille des deux cartes du bas. On repère cette seconde grille. */
const OUVRE_BAS = `\n    <div class="compta-duo">`;
const iBas = src.indexOf(OUVRE_BAS, src.indexOf('Indexation des loyers'));
if (iBas === -1) {
  console.error('\n  \u2717 La grille des cartes du bas est introuvable : impossible de');
  console.error('    refermer proprement celle du haut. AUCUNE écriture.\n');
  process.exit(1);
}
src = src.slice(0, iBas) + '\n    </div>' + src.slice(iBas);
console.log('  ok  grille du haut refermée');

/* Le titre « Campagnes passées » ne doit pas s'afficher sur du vide. */
const HISTO_AV = `<h3 style="margin:16px 0 6px;font-size:14px">Campagnes passées</h3>`;
if (src.split(HISTO_AV).length - 1 === 1) {
  src = src.split(HISTO_AV).join(`<h3 style="margin:16px 0 6px;font-size:14px" id="idx-histo-titre" hidden>Campagnes passées</h3>`);
  console.log('  ok  titre « Campagnes passées » masqué tant qu\'il n\'y a rien');
} else {
  console.log('  -   titre « Campagnes passées » : forme inattendue, laissé tel quel');
}

try {
  new Function(src);
} catch (e) {
  console.error('\n  \u2717 app.js serait invalide : ' + e.message + '\n    AUCUNE écriture.\n');
  process.exit(1);
}

/* .compta-duo est utilisée par la vue mais peut ne pas être définie dans la
   feuille : la classe existait dans le balisage sans règle correspondante.
   On l'ajoute si elle manque — sinon les cartes s'empileraient au lieu de se
   placer côte à côte, et le correctif n'aurait aucun effet visible. */
const F_CSS = path.join(process.cwd(), 'backend', 'public', 'styles.css');
let cssAjoute = false;
let css = fs.existsSync(F_CSS) ? fs.readFileSync(F_CSS, 'utf8') : null;
if (css === null) {
  console.log('  -   styles.css introuvable : règle .compta-duo non vérifiée');
} else if (/\.compta-duo\s*\{/.test(css)) {
  console.log('  -   .compta-duo déjà définie dans styles.css');
} else {
  css += `

/* ---------------- Comptabilité ----------------
   .compta-duo était utilisée dans le balisage sans règle correspondante :
   les cartes s'empilaient au lieu de se placer côte à côte. Une colonne
   sur mobile, deux à partir de 900 px. */
.compta-duo{display:grid;grid-template-columns:1fr;gap:16px;align-items:start}
@media (min-width:900px){ .compta-duo{grid-template-columns:1fr 1fr} }
`;
  cssAjoute = true;
  console.log('  ok  règle .compta-duo ajoutée à styles.css');
}

/* Contrôle d'équilibre : autant de <div> ouverts que fermés dans la vue. */
const iVue = src.indexOf('async function vueCompta');
const iFin = src.indexOf('\n}', src.indexOf('if ($(\'#idx-histo\')) idxHisto();', iVue));
const bloc = src.slice(iVue, iFin);
const ouv = (bloc.match(/<div\b/g) || []).length;
const fer = (bloc.match(/<\/div>/g) || []).length;
if (ouv !== fer) {
  console.error('\n  \u2717 Balises déséquilibrées dans vueCompta : ' + ouv + ' <div> pour ' + fer + ' </div>.');
  console.error('    AUCUNE écriture.\n');
  process.exit(1);
}
console.log('  ok  balises équilibrées (' + ouv + ' div ouverts, ' + fer + ' fermés)');

if (ESSAI) {
  console.log('\n— ESSAI —  ' + total + ' remplacements, syntaxe et balises vérifiées.');
  if (cssAjoute) console.log('  La règle .compta-duo serait ajoutée à styles.css. Rien écrit.');
  console.log('  Relancez sans --essai pour appliquer.\n');
  process.exit(0);
}

fs.writeFileSync(CIBLE, src, 'utf8');
if (cssAjoute) fs.writeFileSync(F_CSS, css, 'utf8');
const relu = fs.readFileSync(CIBLE, 'utf8');
if (relu.indexOf('finExportDefaut') === -1 || relu.length === tailleAvant) {
  console.error('\n  \u2717 L\'écriture n\'a pas pris. Vérifiez les droits sur le fichier.\n');
  process.exit(1);
}

console.log('\n— APPLIQUÉ —  ' + total + ' remplacements.');
console.log('  Écriture relue : ' + tailleAvant + ' → ' + relu.length + ' octets.');
console.log('\n  À VÉRIFIER À L\'ÉCRAN — Comptabilité :');
console.log('    · le champ « Au » affiche la date du JOUR, plus le 31/12 ;');
console.log('    · le texte dit « arrêté à aujourd\'hui — la clôture est');
console.log('      prévue le 31/12/2026 » ;');
console.log('    · en saisissant une date future dans « Au », un');
console.log('      avertissement en miel apparaît sous les champs ;');
console.log('    · le fichier exporté s\'appelle désormais FEC_<date du');
console.log('      jour>.txt et couvre bien cette période ;');
console.log('    · les cartes TVA et Indexation sont côte à côte ;');
console.log('    · « Campagnes passées » n\'apparaît que s\'il y a des');
console.log('      campagnes.');
console.log('\n  SI L\'AFFICHAGE CÔTE À CÔTE NE VOUS CONVIENT PAS');
console.log('    La classe compta-duo est celle des deux cartes du bas :');
console.log('    son comportement mobile est deja defini. Pour revenir en');
console.log('    arriere, retirez le <div class="compta-duo"> ajoute avant');
console.log('    la carte TVA et le </div> qui le referme.');
console.log('');

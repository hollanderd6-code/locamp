#!/usr/bin/env node
/* ============================================================
   Retirer les gestionnaires inline — étape 2, la dernière
   ============================================================
   Cible : backend/public/app.js
   Prérequis : outils/inline-handlers-1.js appliqué.

   L'étape 1 a converti 116 gestionnaires sur 137. Les 21 restants
   ne se convertissaient pas par une règle : chacun demandait une
   décision. Les voici, par famille.

   ── A. NAVIGATION (3) ────────────────────────────────────────────
   location.hash='#/signatures'  →  allerA('#/signatures')

   ── B. SUPPRIMER SA PROPRE LIGNE (4) ─────────────────────────────
   this.parentElement.remove()      →  retirerLigne()
   this.closest('.fac-ligne')...    →  retirerLigne('.fac-ligne')
   L'écouteur appelle la fonction avec `this` = l'élément cliqué :
   le comportement est identique, sans script dans le HTML.

   ── C. ONGLETS DE LA FICHE CAMPING (4) ───────────────────────────
   switchFicheTab('moyens');chargerMoyens()  →  ouvrirOngletParam('moyens')
   Deux appels enchaînés deviennent une fonction qui dit ce qu'elle
   fait. Ajouter un onglet se fera désormais à un seul endroit.

   ── D. ARGUMENTS QUI NE SONT PAS DU TEXTE (3) ────────────────────
   encaisserFacture('…','…',${reste})   ${reste} est un nombre
   idxAppliquer(${taux})                un nombre
   annulerRemise('…','…',${r.statut === 'encaissee'})   un booléen

   Un attribut HTML ne contient que du texte. Passer « 0 » là où la
   fonction attend 0 changerait son comportement : « 0 » est vrai en
   JavaScript, 0 est faux. On déclare donc explicitement quels
   arguments convertir :

       data-num="3"    le 3ᵉ argument est un nombre
       data-bool="3"   le 3ᵉ argument est un booléen

   ── E. LA VALEUR DU CHAMP (2) ────────────────────────────────────
   chargerReleve('${id}', this.value)  →  data-a2="@value"
   @value est remplacé au moment du clic par la valeur du champ.

   ── F. NE PAS DÉCLENCHER LA LIGNE (1) ────────────────────────────
   Un <td> avec event.stopPropagation() dans une ligne cliquable :
   devient data-stop, lu par l'écouteur.

   ── G. UN LIEN QUI N'EN EST PAS UN (1) ───────────────────────────
   <a href="#" onclick="voirDoc('…');return false">
   L'écouteur annule déjà l'action par défaut des liens : le
   `return false` n'a plus d'objet.

   ── H. OUVRIR UN ONGLET (1) ──────────────────────────────────────
   window.open('${url}','_blank') sur un bouton devient un vrai lien.
   Un lien est copiable, ouvrable au clavier, annonçable par un
   lecteur d'écran — ce qu'un bouton en JavaScript n'est pas.
   rel="noopener" : sans lui, la page ouverte peut manipuler la nôtre.

   ── I. LES DEUX EXPORTS COMPTABLES (2) ───────────────────────────
   L'URL était construite dans l'attribut, en lisant deux champs de
   formulaire. Devient exporterCompta('fec') / ('csv'), qui lit les
   champs elle-même — et peut enfin vérifier qu'ils sont remplis.

   ── APRÈS CE SCRIPT ──────────────────────────────────────────────
   Zéro gestionnaire inline. Le CSP peut alors retirer
   scriptSrcAttr: 'unsafe-inline' — le script le rappelle à la fin,
   avec la ligne exacte à changer dans server.js.

   Usage :
     node outils/inline-handlers-2.js --essai
     node outils/inline-handlers-2.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'backend', 'public', 'app.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

if (!fs.existsSync(CIBLE)) {
  console.error('\n  \u2717 backend/public/app.js introuvable.\n');
  process.exit(1);
}

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('data-act') === -1) {
  console.error('\n  \u2717 L\'étape 1 n\'a pas été appliquée.');
  console.error('    Lancez d\'abord : node outils/inline-handlers-1.js\n');
  process.exit(1);
}
if (src.indexOf('function allerA') !== -1) {
  console.log('\n  Déjà appliqué — rien à faire.\n');
  process.exit(0);
}

/* ── Les remplacements, un par un ─────────────────────────────── */
const R = [
  // A — navigation
  [`onclick="location.hash='#/signatures'" title=`,
   `data-act="allerA" data-a1="#/signatures" title=`],
  [`onclick="location.hash='#/signatures'"`,
   `data-act="allerA" data-a1="#/signatures"`],
  ['onclick="location.hash=\'#/residents/${r.id}\'"',
   'data-act="allerA" data-a1="#/residents/${r.id}"'],

  // B — supprimer sa propre ligne
  [`onclick="this.parentElement.remove()"`, `data-act="retirerLigne"`],
  [`onclick="this.closest('.fac-ligne').remove()"`, `data-act="retirerLigne" data-a1=".fac-ligne"`],

  // C — onglets de la fiche camping
  [`onclick="switchFicheTab('moyens');chargerMoyens()"`,  `data-act="ouvrirOngletParam" data-a1="moyens"`],
  [`onclick="switchFicheTab('journal');chargerJournal()"`, `data-act="ouvrirOngletParam" data-a1="journal"`],
  [`onclick="switchFicheTab('fiscal');chargerFiscal()"`,   `data-act="ouvrirOngletParam" data-a1="fiscal"`],
  [`onclick="switchFicheTab('rgpd');chargerRgpd()"`,       `data-act="ouvrirOngletParam" data-a1="rgpd"`],

  // D — arguments typés
  ['onclick="encaisserFacture(\'${f.id}\',\'${id}\',${reste})"',
   'data-act="encaisserFacture" data-a1="${f.id}" data-a2="${id}" data-a3="${reste}" data-num="3"'],
  ['onclick="idxAppliquer(${taux})"',
   'data-act="idxAppliquer" data-a1="${taux}" data-num="1"'],
  ['onclick="annulerRemise(\'${r.id}\',\'${esc(r.numero)}\',${r.statut === \'encaissee\'})"',
   'data-act="annulerRemise" data-a1="${r.id}" data-a2="${esc(r.numero)}" data-a3="${r.statut === \'encaissee\'}" data-bool="3"'],

  // E — la valeur du champ
  ['onchange="chargerReleve(\'${id}\', this.value)"',
   'data-act="chargerReleve" data-evt="change" data-a1="${id}" data-a2="@value"'],
  ['onchange="majTermeDoc(\'${d.id}\', this.value)"',
   'data-act="majTermeDoc" data-evt="change" data-a1="${d.id}" data-a2="@value"'],

  // F — ne pas déclencher la ligne
  [`<td onclick="event.stopPropagation()">`, `<td data-stop>`],

  // G — un lien qui n'en est pas un
  ['<a href="#" onclick="voirDoc(\'${d.id}\');return false">',
   '<a href="#" data-act="voirDoc" data-a1="${d.id}">'],

  // H — ouvrir un onglet : un vrai lien
  ['<button class="btn btn-primary btn-block" style="margin-top:18px" onclick="window.open(\'${url}\',\'_blank\')">Ouvrir le document signé</button>',
   '<a class="btn btn-primary btn-block" style="margin-top:18px" href="${url}" target="_blank" rel="noopener">Ouvrir le document signé</a>'],

  // I — les deux exports comptables
  [`onclick="telechargerExport('/api/compta/fec?debut=' + $('#exp-debut').value + '&fin=' + $('#exp-fin').value, 'FEC_' + $('#exp-fin').value + '.txt')"`,
   `data-act="exporterCompta" data-a1="fec"`],
  [`onclick="telechargerExport('/api/compta/export.csv?debut=' + $('#exp-debut').value + '&fin=' + $('#exp-fin').value, 'ecritures_' + $('#exp-debut').value + '_' + $('#exp-fin').value + '.csv')"`,
   `data-act="exporterCompta" data-a1="csv"`],
];

let faits = 0;
const rates = [];
for (const [avant, apres] of R) {
  const n = src.split(avant).length - 1;
  if (!n) { rates.push(avant.slice(0, 78)); continue; }
  src = src.split(avant).join(apres);
  faits += n;
}

if (rates.length) {
  console.error('\n  \u2717 ' + rates.length + ' motif(s) introuvable(s) — le fichier a changé :');
  rates.forEach((r) => console.error('      ' + r));
  console.error('\n    Rien n\'a été écrit.\n');
  process.exit(1);
}

/* ── Les fonctions d'appoint ──────────────────────────────────── */
const APPOINT = `
/* ---- Fonctions appelées par data-act ----------------------------
   Elles remplacent du code qui vivait dans des attributs HTML. */

/** Navigation interne. Remplace location.hash='…' écrit dans le HTML. */
function allerA(hash) { location.hash = hash; }

/** Retire la ligne à laquelle appartient le bouton.
    Appelée avec this = l'élément cliqué (voir l'écouteur).
    Sans sélecteur : le parent direct. Avec : le premier ancêtre qui
    correspond — pour une ligne de facture, par exemple. */
function retirerLigne(selecteur) {
  const cible = selecteur ? this.closest(selecteur) : this.parentElement;
  if (cible) cible.remove();
}

/** Onglets de la fiche camping : afficher l'onglet ET charger son
    contenu. C'étaient deux appels enchaînés dans le HTML, répétés
    quatre fois — ajouter un onglet demandait de ne pas oublier le
    second. Ici, un seul endroit. */
function ouvrirOngletParam(onglet) {
  switchFicheTab(onglet);
  const charge = {
    moyens: typeof chargerMoyens === 'function' ? chargerMoyens : null,
    journal: typeof chargerJournal === 'function' ? chargerJournal : null,
    fiscal: typeof chargerFiscal === 'function' ? chargerFiscal : null,
    rgpd: typeof chargerRgpd === 'function' ? chargerRgpd : null,
  }[onglet];
  if (charge) charge();
}

/** Exports comptables. L'URL était assemblée dans l'attribut onclick
    en lisant deux champs — donc sans pouvoir vérifier qu'ils sont
    remplis. Un export sur une période vide produisait un fichier vide
    sans rien dire. */
function exporterCompta(format) {
  const debut = ($('#exp-debut') || {}).value || '';
  const fin = ($('#exp-fin') || {}).value || '';
  if (!debut || !fin) {
    if (typeof toast === 'function') toast('Choisissez une date de début et une date de fin.');
    return;
  }
  if (debut > fin) {
    if (typeof toast === 'function') toast('La date de début est postérieure à la date de fin.');
    return;
  }
  const q = '?debut=' + encodeURIComponent(debut) + '&fin=' + encodeURIComponent(fin);
  if (format === 'fec') telechargerExport('/api/compta/fec' + q, 'FEC_' + fin + '.txt');
  else telechargerExport('/api/compta/export.csv' + q, 'ecritures_' + debut + '_' + fin + '.csv');
}
`;

/* ── L'écouteur apprend quatre choses de plus ─────────────────── */
const A_LIRE = `  function lireArgs(el) {
    const out = [];
    for (let i = 1; i <= 6; i++) {
      const v = el.getAttribute('data-a' + i);
      if (v === null) break;
      out.push(v);
    }
    return out;
  }`;

const N_LIRE = `  function lireArgs(el) {
    // Un attribut HTML ne contient que du texte. data-num et data-bool
    // disent quels arguments doivent redevenir un nombre ou un booléen :
    // passer « 0 » là où la fonction attend 0 inverserait un test, et
    // passer « false » là où elle attend false le rendrait vrai.
    const nums = (el.getAttribute('data-num') || '').split(',').filter(Boolean);
    const bools = (el.getAttribute('data-bool') || '').split(',').filter(Boolean);
    const out = [];
    for (let i = 1; i <= 6; i++) {
      let v = el.getAttribute('data-a' + i);
      if (v === null) break;
      // @value : la valeur du champ au moment du clic, et non au rendu.
      if (v === '@value') v = el.value;
      else if (nums.includes(String(i))) v = Number(v);
      else if (bools.includes(String(i))) v = (v === 'true' || v === '1');
      out.push(v);
    }
    return out;
  }`;

const A_CLIC = `  document.addEventListener('click', function (e) {
    const el = e.target.closest('[data-act]');
    if (!el) return;`;

const N_CLIC = `  document.addEventListener('click', function (e) {
    // data-stop : cet élément absorbe le clic, sans rien déclencher.
    // Sert aux cellules interactives dans une ligne elle-même cliquable.
    const stop = e.target.closest('[data-stop]');
    if (stop) { e.stopPropagation(); if (!stop.hasAttribute('data-act')) return; }

    const el = e.target.closest('[data-act]');
    if (!el) return;`;

for (const [a, n] of [[A_LIRE, N_LIRE], [A_CLIC, N_CLIC]]) {
  if (src.split(a).length - 1 !== 1) {
    console.error('\n  \u2717 L\'écouteur de l\'étape 1 n\'a pas la forme attendue.');
    console.error('    Rien n\'a été écrit.\n');
    process.exit(1);
  }
  src = src.split(a).join(n);
}

// Les fonctions d'appoint, juste après l'écouteur.
const FIN_ECOUTEUR = '})();\n';
const iEc = src.indexOf(FIN_ECOUTEUR, src.indexOf('Actions déclarées'));
if (iEc === -1) {
  console.error('\n  \u2717 Fin de l\'écouteur introuvable. Rien n\'a été écrit.\n');
  process.exit(1);
}
src = src.slice(0, iEc + FIN_ECOUTEUR.length) + APPOINT + src.slice(iEc + FIN_ECOUTEUR.length);

/* ── Contrôles ────────────────────────────────────────────────── */
try {
  new Function(src);
} catch (e) {
  console.error('\n  \u2717 app.js serait invalide : ' + e.message);
  console.error('    Rien n\'a été écrit.\n');
  process.exit(1);
}

// Décompte des gestionnaires RÉELS : les commentaires de ce fichier
// citent « onclick="…" » pour expliquer ce qui a été retiré — sans ce
// filtre, le script s'alarmerait de sa propre documentation.
let dansCommentaire = false;
const restants = [];
src.split('\n').forEach((li) => {
  // Un commentaire ouvert ET fermé sur la même ligne se retire d'abord :
  // sinon « /* … onclick="x()" … */ » passerait pour du code.
  const l = li.replace(/\/\*[\s\S]*?\*\//g, '');
  const o = l.lastIndexOf('/*'), f = l.lastIndexOf('*/'), etait = dansCommentaire;
  if (o !== -1 && o > f) dansCommentaire = true;
  else if (f !== -1 && f > o) dansCommentaire = false;
  if (etait || dansCommentaire || /^\s*\/\//.test(l) || /^\s*\*/.test(l)) return;
  const m = l.match(/\son(?:click|change|input|submit|blur|focus)\s*=\s*["']/g);
  if (m) m.forEach(() => restants.push(l.trim().slice(0, 90)));
});
const actions = new Set();
src.replace(/data-act="([^"]+)"/g, (t, n) => { actions.add(n); return t; });
const introuvables = [...actions].filter((n) => {
  const re = new RegExp('(?:^|\\n)\\s*(?:async\\s+)?function\\s+' + n + '\\b|window\\.' + n + '\\s*=|(?:const|let|var)\\s+' + n + '\\s*=');
  return !re.test(src);
});

if (introuvables.length) {
  console.error('\n  \u2717 Action sans fonction correspondante : ' + introuvables.join(', '));
  console.error('    Rien n\'a été écrit.\n');
  process.exit(1);
}

if (!ESSAI) fs.writeFileSync(CIBLE, src, 'utf8');

console.log('\n' + (ESSAI ? '— ESSAI, aucune écriture —' : '— APPLIQUÉ —'));
console.log('  Convertis ..................... ' + faits);
console.log('  Gestionnaires inline restants .. ' + restants.length);
console.log('  Actions déclarées .............. ' + actions.size + ', toutes reliées à une fonction');
console.log('  Syntaxe vérifiée.');

if (restants.length === 0) {
  console.log('\n  \u2713 PLUS AUCUN SCRIPT DANS LE HTML.');
  console.log('\n  Le CSP peut enfin se refermer. Dans backend/server.js :');
  console.log('\n      scriptSrc: ["\'self\'", "\'unsafe-inline\'", …]   ← retirer unsafe-inline');
  console.log('      scriptSrcAttr: ["\'unsafe-inline\'"],            ← remplacer par ["\'none\'"]');
  console.log('\n  Faites-le APRÈS avoir vérifié l\'application à l\'écran :');
  console.log('  si un gestionnaire avait été oublié, le durcissement le');
  console.log('  ferait échouer en silence.');
} else {
  console.log('\n  Il reste ' + restants.length + ' gestionnaire(s) : le CSP ne peut pas être durci.');
}

console.log('\n  À VÉRIFIER À L\'ÉCRAN — les 21 cas de cette étape :');
console.log('    · ligne de résident cliquable, bouton « Signatures »');
console.log('    · facture : bouton Encaisser (le montant doit être juste)');
console.log('    · fiche résident : lien « ouvrir » d\'un document');
console.log('    · relevé de compteur : changer l\'année dans la liste');
console.log('    · formulaires : bouton ✕ qui retire une ligne');
console.log('    · paramètres : onglets Moyens, Journal, Fiscal, RGPD');
console.log('    · indexation : bouton « Appliquer + x % »');
console.log('    · documents : changer la date de terme');
console.log('    · remises : bouton Annuler');
console.log('    · comptabilité : Export FEC et Export CSV, y compris');
console.log('      sans dates — un message doit apparaître');
console.log('    · signature : bouton « Ouvrir le document signé »');
if (ESSAI) console.log('\n  Relancez sans --essai pour appliquer.');
console.log('');

#!/usr/bin/env node
/* ============================================================
   Écran Administration
   ============================================================
   Cible : backend/public/app.js

   Se termine en code 1 au moindre motif introuvable, relit le disque
   après écriture.

   Ce script ne traite PAS la cause de la chaîne rompue — elle est en
   base, et db/00_diagnostic_chaine_fiscale.sql doit d'abord dire
   laquelle des trois causes s'applique. Il corrige ce que l'écran
   raconte, ce qui est déjà beaucoup : aujourd'hui il accuse.

   ── 1. L'ÉCRAN AFFIRME UNE FRAUDE QU'IL NE PEUT PAS ÉTABLIR ──────
       Une donnée fiscale a été modifiée ou supprimée hors du logiciel.
       Conserve cette information : elle doit être signalée en cas de
       contrôle.

   C'est une accusation, au présent, sans nuance — et elle tutoie.

   Or une chaîne rompue a trois causes possibles, et deux ne sont pas
   des fraudes : la formule de hachage a pu changer après coup (tous
   les enregistrements antérieurs deviennent alors invalides sans que
   les données aient bougé), ou une reprise technique a réécrit des
   lignes.

   Le texte dit maintenant ce qui est constaté — l'empreinte ne
   correspond plus — et ce qu'il faut faire pour savoir pourquoi.
   Une anomalie sur tous les enregistrements ne se lit pas comme une
   anomalie sur quatre : l'écran le signale.

   ── 2. « alteration », « Export fisc » ───────────────────────────
   Le type d'anomalie est affiché brut, tel qu'il sort de la base :
   « alteration », sans accent. Et le bouton d'export du journal
   s'appelle « Export fisc (CSV) » — une abréviation qui ne veut rien
   dire pour personne.

   ── 3. LE JOURNAL AFFICHE DES NOMS DE CODE ───────────────────────
       Facture   run_facturation

   « run_facturation » est le nom d'une fonction interne. Le journal
   d'activité est ce qu'on présente lors d'un contrôle : il doit être
   lisible par quelqu'un qui n'a jamais vu le code.

   ── 4. LA COLONNE DÉTAIL AFFICHE UN IDENTIFIANT TRONQUÉ ──────────
       8480df2d…

   Un identifiant coupé à huit caractères n'identifie rien et ne se
   copie pas. Il devient survolable pour lire la valeur entière.

   Usage :
     node outils/ecran-administration.js --essai
     node outils/ecran-administration.js
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

if (src.indexOf('LIBELLE_ANOMALIE') !== -1) {
  console.log('\n  Déjà appliqué — rien à faire.\n');
  process.exit(0);
}

const edits = [

  /* ── 1, 2 : ce que l'écran affirme ─────────────────────────── */
  ['anomalies : libellés lisibles et texte qui n\'accuse pas',
`              <ul class="list-tight">\${chaine.anomalies.slice(0, 10).map((a) => \`<li><span>N° \${a.seq} — \${esc(a.type)}</span><span class="muted">\${esc(a.message)}</span></li>\`).join('')}</ul>`,
`              <ul class="list-tight">\${chaine.anomalies.slice(0, 10).map((a) => \`<li><span>N° \${a.seq} — \${esc(LIBELLE_ANOMALIE[a.type] || a.type)}</span><span class="muted">\${esc(a.message)}</span></li>\`).join('')}</ul>
              \${chaine.anomalies.length > 10 ? \`<p class="muted" style="margin:6px 0 0">… et \${chaine.anomalies.length - 10} autre(s), soit \${chaine.anomalies.length} au total.</p>\` : ''}`],

  ['texte : constater sans accuser',
`              <p class="muted" style="margin:8px 0 0">Une donnée fiscale a été modifiée ou supprimée hors du logiciel. Conserve cette information : elle doit être signalée en cas de contrôle.</p>`,
`              \${/* L'ancien texte affirmait « une donnée a été modifiée hors du
                   logiciel » — une accusation que l'écran ne peut pas établir.
                   Une chaîne rompue a trois causes, et deux ne sont pas des
                   fraudes : un changement de la formule de hachage invalide
                   tous les enregistrements antérieurs sans que les données
                   aient bougé. On constate, on n'accuse pas. */''}
              <p class="muted" style="margin:8px 0 0;line-height:1.6">
                L'empreinte de ces enregistrements ne correspond plus à leur contenu.
                \${chaine.anomalies.length >= chaine.enregistrements
                  ? '<strong>Tous les enregistrements sont concernés</strong> — c\\'est le signe d\\'un changement technique dans le calcul des empreintes, pas d\\'une modification des données.'
                  : 'Trois causes sont possibles : une modification des données en base, une reprise technique, ou un changement dans le calcul des empreintes.'}
                Faites établir l'origine avant toute démarche : le diagnostic se fait en base
                (<code style="font-size:11px">db/00_diagnostic_chaine_fiscale.sql</code>).
                Conservez cette page : si l'origine est une modification des données,
                elle doit être signalée en cas de contrôle.
              </p>`],

  ['bouton : « Export fisc » écrit en entier',
   `>Export fisc (CSV)</button>`,
   `>Exporter le journal (CSV)</button>`],
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

/* ── Les tables de libellés ────────────────────────────────────── */
const TABLES = `
/** Types d'anomalie tels qu'ils sortent de la base, en français lisible.
    Ils étaient affichés bruts : « alteration », sans accent. Le tableau
    de conformité est ce qu'on présente lors d'un contrôle. */
const LIBELLE_ANOMALIE = {
  alteration: 'altération — le contenu ne correspond plus à son empreinte',
  chainage: 'chaînage rompu — l\\u2019empreinte précédente ne correspond pas',
  manquant: 'enregistrement manquant dans la séquence',
  doublon: 'numéro de séquence en double',
};

/** Noms d'opérations du journal d'activité. « run_facturation » est un nom
    de fonction interne : le journal doit se lire sans connaître le code. */
const LIBELLE_OPERATION = {
  run_facturation: 'Facturation mensuelle',
  create: 'Création',
  update: 'Modification',
  delete: 'Suppression',
  login: 'Connexion',
  logout: 'Déconnexion',
  export: 'Export',
  relance: 'Relance envoyée',
  cloture: 'Clôture fiscale',
  attribuer_comptes: 'Attribution des comptes clients',
  indexation: 'Indexation des loyers',
};
function libelleOperation(a) {
  if (!a) return '—';
  const l = LIBELLE_OPERATION[a];
  if (l) return l;
  /* Repli lisible plutôt que le nom brut : « maj_tarifs » → « Maj tarifs ». */
  const t = String(a).replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

`;

const ANCRE_T = '/* ---------- Comptabilité ---------- */';
if (src.split(ANCRE_T).length - 1 !== 1) {
  console.error('\n  \u2717 Point d\'ancrage des tables introuvable. AUCUNE écriture.\n');
  process.exit(1);
}
src = src.split(ANCRE_T).join(TABLES + ANCRE_T);
console.log('  ok  tables de libellés posées');

/* ── 3 et 4 : le journal ───────────────────────────────────────── */
/* Le serveur renvoie déjà action_lib, mais sa valeur est le nom de la
   fonction interne : « run_facturation ». On la traduit à l'affichage. */
const JOURNAL_AV = `<span class="muted">${esc(x.action_lib)}</span>`;
if (src.split(JOURNAL_AV).length - 1 === 1) {
  src = src.split(JOURNAL_AV).join(`<span class="muted">${esc(libelleOperation(x.action_lib))}</span>`);
  console.log('  ok  journal : opérations en clair');
} else {
  console.error('\n  \u2717 Colonne Opération du journal introuvable. AUCUNE écriture.\n');
  process.exit(1);
}

/* Le détail est tronqué par CSS : l'identifiant complet devient survolable. */
const DETAIL_AV = `<td class="muted" style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(resumeAudit(x))}</td>`;
if (src.split(DETAIL_AV).length - 1 === 1) {
  src = src.split(DETAIL_AV).join(
    `<td class="muted" style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(resumeAudit(x))}">${esc(resumeAudit(x))}</td>`);
  console.log('  ok  journal : détail complet au survol');
}

/* Un tutoiement, juste sous le tableau. */
const TU_AV = `dernières entrées affichées — affine les dates ou exporte en CSV pour tout voir.`;
if (src.split(TU_AV).length - 1 === 1) {
  src = src.split(TU_AV).join(`dernières entrées affichées — affinez les dates ou exportez en CSV pour tout voir.`);
  console.log('  ok  journal : vouvoiement');
}

try {
  new Function(src);
} catch (e) {
  console.error('\n  \u2717 app.js serait invalide : ' + e.message + '\n    AUCUNE écriture.\n');
  process.exit(1);
}
if (src.indexOf('Conserve cette information') !== -1) {
  console.error('\n  \u2717 L\'ancien texte accusatoire subsiste. AUCUNE écriture.\n');
  process.exit(1);
}

if (ESSAI) {
  console.log('\n— ESSAI —  ' + total + ' remplacements, syntaxe vérifiée. Rien écrit.');
  console.log('  Relancez sans --essai pour appliquer.\n');
  process.exit(0);
}

fs.writeFileSync(CIBLE, src, 'utf8');
const relu = fs.readFileSync(CIBLE, 'utf8');
if (relu.indexOf('LIBELLE_ANOMALIE') === -1 || relu.length === tailleAvant) {
  console.error('\n  \u2717 L\'écriture n\'a pas pris. Vérifiez les droits sur le fichier.\n');
  process.exit(1);
}

console.log('\n— APPLIQUÉ —  ' + total + ' remplacements.');
console.log('  Écriture relue : ' + tailleAvant + ' → ' + relu.length + ' octets.');
console.log('\n  À VÉRIFIER À L\'ÉCRAN — Administration :');
console.log('    · Conformité fiscale : les anomalies disent « altération —');
console.log('      le contenu ne correspond plus à son empreinte » ;');
console.log('    · le nombre total d\'anomalies est affiché, pas seulement');
console.log('      les dix premières ;');
console.log('    · le texte ne prétend plus qu\'une donnée « a été modifiée');
console.log('      hors du logiciel » — il constate et dit quoi faire ;');
console.log('    · Journal d\'activité : « run_facturation » devient');
console.log('      « Facturation mensuelle » ;');
console.log('    · le bouton dit « Exporter le journal (CSV) ».');
console.log('\n  \u26a0  LA CAUSE DE LA RUPTURE RESTE À ÉTABLIR');
console.log('    Ce script corrige ce que l\'écran RACONTE, pas ce qui s\'est');
console.log('    passé. La chaîne d\'inaltérabilité est une obligation légale');
console.log('    (art. 286-I-3° bis du CGI) : tant qu\'elle est rompue,');
console.log('    l\'attestation de conformité ne vaut rien.');
console.log('\n    Lancez db/00_diagnostic_chaine_fiscale.sql dans Supabase et');
console.log('    renvoyez-moi le résultat. Il distingue trois cas :');
console.log('      · toutes les lignes en anomalie → la formule de hachage a');
console.log('        changé, les données n\'ont pas bougé (le plus probable ici :');
console.log('        les anomalies commencent au n° 1 et se suivent) ;');
console.log('      · quelques lignes dispersées → des données ont été');
console.log('        modifiées en base ;');
console.log('      · des trous dans la séquence → des lignes supprimées.');
console.log('    Les trois n\'appellent pas du tout les mêmes suites.');
console.log('');

#!/usr/bin/env node
/* ============================================================
   Règlements : la référence devient obligatoire quand elle sert
   ============================================================
   Cible : backend/public/app.js
   Prérequis : outils/ecran-reglements.js appliqué.

   Se termine en code 1 au moindre motif introuvable, relit le disque
   après écriture.

   ── LE PROBLÈME ──────────────────────────────────────────────────
   Le champ « Référence » était facultatif pour tous les moyens. Un
   chèque enregistré sans son numéro, un virement sans son libellé :
   au rapprochement bancaire, la ligne du relevé ne peut plus être
   reliée à l'encaissement. Il faut alors rouvrir le carnet, ou
   appeler le résident.

   ── LA RÈGLE RETENUE, ET POURQUOI PAS UNE LISTE ──────────────────
   L'obligation suit le TYPE du moyen, tel qu'il est configuré dans
   Administration → Moyens de paiement :

       chèque    → obligatoire   le numéro du chèque
       virement  → obligatoire   le libellé vu sur le relevé
       ANCV      → obligatoire   le numéro du titre
       espèces   → facultatif    il n'y a rien à référencer
       carte     → facultatif    le TPE porte déjà sa trace
       autre     → facultatif    on ne sait pas ce que c'est

   Suivre le type et non une liste de codes écrite en dur a une
   conséquence utile : un moyen ajouté demain — « Chèque BNP », code
   maison — hérite de la règle du moment qu'il est typé « cheque ».
   Une liste de codes l'aurait oublié en silence.

   ── CE QUI CHANGE À L'ÉCRAN ──────────────────────────────────────
   L'étoile apparaît et disparaît selon le moyen choisi, le texte
   d'aide dit ce qu'on attend précisément — « n° du chèque » et non
   « n° chèque, n° titre ANCV, libellé virement… », qui obligeait à
   trier mentalement —, et la validation refuse un champ vide avec un
   message qui nomme le moyen.

   Le contrôle est refait à la soumission, pas seulement par
   l'attribut required : un moyen changé après la saisie de la
   référence ne doit pas passer entre les mailles.

   ── CE QUE JE N'AI PAS FAIT ──────────────────────────────────────
   Rien côté serveur. Le formulaire est le seul chemin de saisie
   aujourd'hui, mais l'API accepterait toujours un règlement sans
   référence. Si un import bancaire ou l'application mobile écrit un
   jour directement, la règle devra être portée dans
   routes/reglements.js — sinon elle sera contournée sans le vouloir.

   Usage :
     node outils/reference-obligatoire.js --essai
     node outils/reference-obligatoire.js
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

if (src.indexOf('REF_PAR_TYPE') !== -1) {
  console.log('\n  Déjà appliqué — rien à faire.\n');
  process.exit(0);
}
if (src.indexOf('doublonProbable') === -1) {
  console.error('\n  \u2717 Appliquez d\'abord outils/ecran-reglements.js.\n');
  process.exit(1);
}

const edits = [

  /* ── 1. La table des règles, avant la vue ──────────────────── */
  ['table des règles par type de moyen',
`/* ---------- Règlements ---------- */`,
`/* ---------- Règlements ---------- */

/** Ce qu'on attend comme référence, par TYPE de moyen de paiement.
    La règle suit le type configuré dans Administration, pas une liste de
    codes : un moyen ajouté demain (« Chèque BNP », code maison) hérite de
    la règle du moment qu'il est typé « cheque ». Une liste de codes
    l'aurait oublié en silence.

    obligatoire : sans cette référence, la ligne du relevé bancaire ne peut
    plus être reliée à l'encaissement au moment du rapprochement. */
const REF_PAR_TYPE = {
  cheque:   { requis: true,  aide: 'N° du chèque', exemple: 'ex. 7845213' },
  virement: { requis: true,  aide: 'Libellé du virement', exemple: 'tel qu\\u2019il apparaît sur le relevé' },
  ancv:     { requis: true,  aide: 'N° du titre ANCV', exemple: 'ex. 0123456789' },
  espece:   { requis: false, aide: 'Référence', exemple: 'facultatif — rien à référencer' },
  carte:    { requis: false, aide: 'Référence', exemple: 'facultatif — n° de ticket TPE' },
  stripe:   { requis: false, aide: 'Référence', exemple: 'facultatif' },
  autre:    { requis: false, aide: 'Référence', exemple: 'facultatif' },
};
/* Repli quand le moyen n'a pas de type connu : facultatif. Rendre
   obligatoire un champ dont on ne sait pas ce qu'il doit contenir
   bloquerait la saisie sans rien apprendre à personne. */
const REF_DEFAUT = { requis: false, aide: 'Référence', exemple: 'facultatif' };
function regleRef(type) { return REF_PAR_TYPE[String(type || '')] || REF_DEFAUT; }
`],

  /* ── 2. Le champ, piloté par le moyen choisi ───────────────── */
  ['champ Référence : étoile et aide selon le moyen',
`        <label>Référence<input name="reference" placeholder="n° chèque, n° titre ANCV, libellé virement…"></label>`,
`        \${/* L'ancien texte d'aide énumérait les trois cas — « n° chèque, n° titre
             ANCV, libellé virement… » — et laissait trier mentalement lequel
             s'applique. Le libellé suit maintenant le moyen choisi. */''}
        <label><span id="reg-ref-label">Référence</span><input name="reference" id="reg-ref"></label>`],

  /* ── 3. Le pilotage ────────────────────────────────────────── */
  ['pilotage du champ selon le moyen',
`  $('#f-reg').addEventListener('submit', async (e) => {`,
`  /* Le type du moyen, par code : c'est lui qui décide si la référence est
     obligatoire. moyens vient de /api/moyens-paiement ; sans configuration,
     les deux options de repli portent leur type dans leur valeur. */
  const typeParCode = {};
  moyens.forEach((m) => { typeParCode[m.code] = m.type; });
  if (!moyens.length) { typeParCode.espece = 'espece'; typeParCode.cheque = 'cheque'; }

  const majChampRef = () => {
    const champ = $('#reg-ref');
    const lab = $('#reg-ref-label');
    if (!champ || !lab) return;
    const code = $('#f-reg').mode?.value;
    const r = regleRef(typeParCode[code]);
    lab.innerHTML = esc(r.aide) + (r.requis ? ' *' : '');
    champ.placeholder = r.exemple;
    champ.required = r.requis;
  };
  $('#f-reg').mode?.addEventListener('change', majChampRef);
  majChampRef();

  $('#f-reg').addEventListener('submit', async (e) => {`],

  /* ── 4. Le contrôle à la validation ────────────────────────── */
  ['validation : refuser une référence manquante',
`    if (!body.resident_id) { toast('Choisissez le résident.', true); return; }
    if (!(body.montant > 0)) { toast('Le montant doit être supérieur à zéro.', true); return; }`,

`    if (!body.resident_id) { toast('Choisissez le résident.', true); return; }
    if (!(body.montant > 0)) { toast('Le montant doit être supérieur à zéro.', true); return; }

    /* Refait ici et pas seulement par l'attribut required : changer le moyen
       après avoir saisi la référence, ou l'inverse, ne doit pas passer entre
       les mailles. Sans référence, un chèque ou un virement est introuvable
       au rapprochement bancaire. */
    const regle = regleRef(typeParCode[body.mode]);
    if (regle.requis && !String(body.reference || '').trim()) {
      const nom = (mlib[body.mode] || body.mode || 'ce moyen').toLowerCase();
      toast(regle.aide + ' obligatoire pour un paiement par ' + nom
        + ' : sans elle, l\\u2019encaissement ne pourra pas être retrouvé au rapprochement bancaire.', true);
      $('#reg-ref')?.focus();
      return;
    }`],
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

try {
  new Function(src);
} catch (e) {
  console.error('\n  \u2717 app.js serait invalide : ' + e.message + '\n    AUCUNE écriture.\n');
  process.exit(1);
}
if (src.indexOf('placeholder="n° chèque, n° titre ANCV, libellé virement…"') !== -1) {
  console.error('\n  \u2717 L\'ancien texte d\'aide subsiste. AUCUNE écriture.\n');
  process.exit(1);
}

if (ESSAI) {
  console.log('\n— ESSAI —  ' + total + ' remplacements, syntaxe vérifiée. Rien écrit.');
  console.log('  Relancez sans --essai pour appliquer.\n');
  process.exit(0);
}

fs.writeFileSync(CIBLE, src, 'utf8');
const relu = fs.readFileSync(CIBLE, 'utf8');
if (relu.indexOf('REF_PAR_TYPE') === -1 || relu.length === tailleAvant) {
  console.error('\n  \u2717 L\'écriture n\'a pas pris. Vérifiez les droits sur le fichier.\n');
  process.exit(1);
}

console.log('\n— APPLIQUÉ —  ' + total + ' remplacements.');
console.log('  Écriture relue : ' + tailleAvant + ' → ' + relu.length + ' octets.');
console.log('\n  À VÉRIFIER À L\'ÉCRAN — Règlements, en changeant le moyen :');
console.log('    Espèces      → « Référence », pas d\'étoile, validation passe');
console.log('    Chèque       → « N° du chèque * », refuse si vide');
console.log('    Virement     → « Libellé du virement * », refuse si vide');
console.log('    ANCV         → « N° du titre ANCV * », refuse si vide');
console.log('    Carte (TPE)  → facultatif');
console.log('\n    Le libellé et l\'étoile doivent changer À CHAQUE fois que');
console.log('    vous changez de moyen, sans recharger la page.');
console.log('\n  SI UN MOYEN NE SE COMPORTE PAS COMME ATTENDU');
console.log('    C\'est son TYPE qui décide, pas son libellé. Administration →');
console.log('    Moyens de paiement : un moyen « Chèque BNP » typé « autre »');
console.log('    restera facultatif. Vérifiez la colonne Type.');
console.log('\n  RESTE À FAIRE — côté serveur');
console.log('    L\'API accepte toujours un règlement sans référence. Le');
console.log('    formulaire est le seul chemin de saisie aujourd\'hui, donc la');
console.log('    règle tient. Le jour où un import bancaire ou l\'application');
console.log('    mobile écrira directement, il faudra la porter dans');
console.log('    routes/reglements.js — sinon elle sera contournée sans');
console.log('    que personne ne le veuille.');
console.log('');

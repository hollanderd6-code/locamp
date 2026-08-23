#!/usr/bin/env node
/* ============================================================
   Écran Compteurs
   ============================================================
   Cible : backend/public/app.js

   Se termine en code 1 au moindre motif introuvable, et relit le
   disque après écriture.

   ── 1. UN PRIX ÉCRIT À L'ANGLAISE ────────────────────────────────
       Prix du kWh : 0.39 € TTC

   Un point décimal dans un montant, en français. Le fichier contient
   déjà eur() ligne 163, qui formate en fr-FR — il n'était simplement
   pas utilisé ici, contrairement au reste de l'application.

   eur() n'est pas repris tel quel : il arrondit à deux décimales, et
   un prix du kWh se saisit à quatre (le champ de Paramètres est en
   step="0.0001"). Un tarif de 0,3912 € deviendrait 0,39 € à
   l'affichage, soit un écart de 3 % sur la facture. Le formatage
   garde donc jusqu'à quatre décimales.

   ── 2. LA MISE EN PAGE SAUTE ENTRE LES DEUX ONGLETS ──────────────
   Onglet Électricité : le prix s'affiche en haut à droite, à côté de
   « Feuille de tournée ».
   Onglet Eau : ce bloc disparaît — <span> vide — et le bouton glisse
   vers la droite. L'information réapparaît ailleurs, en rouge, sous
   les onglets.

   Une même information à deux endroits selon l'onglet oblige à la
   chercher. Le prix manquant s'annonce désormais à la place du prix,
   et le bouton ne bouge plus.

   ── 3. UN AVERTISSEMENT PEINT COMME UNE ERREUR ───────────────────
       Prix du m³ non configuré — les relevés seront enregistrés mais
       aucune charge ne sera créée.

   En rouge, avec la classe form-error. Or rien n'a échoué : la phrase
   dit elle-même que les relevés sont enregistrés. Le rouge signale ce
   qui est cassé ; ici il faut signaler ce qui est incomplet.

   Passe en miel (--laiton), la couleur d'attention du design system,
   avec un fond très pâle pour rester lisible sans crier.

   ── 4. LE TEXTE D'AIDE DU CHAMP EST COUPÉ ────────────────────────
   Le champ affiche « index initi » : « index initial » ne tient pas
   dans les 110 px. Un texte d'aide tronqué au milieu d'un mot
   n'aide pas. Champ élargi à 132 px.

   ── 5. RIEN NE DIT COMBIEN DE COMPTEURS RESTENT À RELEVER ────────
   Vingt-deux lignes, presque toutes « jamais relevé ». La question
   d'un gestionnaire qui imprime sa feuille de tournée est « combien
   il m'en reste » — elle demandait de compter les badges à l'œil.

   Le compte s'affiche à côté des onglets, et distingue les compteurs
   jamais relevés de ceux relevés il y a plus d'un mois : ce ne sont
   pas les mêmes tournées.

   Usage :
     node outils/ecran-compteurs.js --essai
     node outils/ecran-compteurs.js
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

if (src.indexOf('cptRestants') !== -1) {
  console.log('\n  Déjà appliqué — rien à faire.\n');
  process.exit(0);
}

const edits = [

  /* ── 5. Le compte, calculé avant le rendu ────────────────── */
  ['compte des compteurs à relever',
`  const prixOk = d.prix != null && d.prix > 0;
  const U = d.unite;`,
`  const prixOk = d.prix != null && d.prix > 0;
  const U = d.unite;

  /* Combien de compteurs restent à relever. « Jamais relevé » et « relevé
     il y a plus d'un mois » ne sont pas la même tournée : le premier est un
     compteur à initialiser, le second un compteur en retard. */
  const ilYAUnMois = new Date(Date.now() - 31 * 86400000);
  const cptRestants = { jamais: 0, retard: 0, ok: 0 };
  d.emplacements.forEach((e) => {
    if (!e.dernier_releve) cptRestants.jamais += 1;
    else if (new Date(e.dernier_releve.date_releve) < ilYAUnMois) cptRestants.retard += 1;
    else cptRestants.ok += 1;
  });
  const cptResume = [
    cptRestants.jamais ? cptRestants.jamais + ' jamais relevé' + (cptRestants.jamais > 1 ? 's' : '') : '',
    cptRestants.retard ? cptRestants.retard + ' en retard' : '',
    cptRestants.ok ? cptRestants.ok + ' à jour' : '',
  ].filter(Boolean).join(' · ');

  /* Un prix se saisit à quatre décimales (Paramètres, step 0.0001) : eur()
     arrondirait à deux et afficherait 0,39 € pour 0,3912 €. */
  const prixTexte = Number(d.prix || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });`],

  /* ── 1 et 2. Le prix, au même endroit dans les deux onglets ─ */
  ['prix : virgule décimale, et plus de saut de mise en page',
`        <span class="muted">\${prixOk ? \`Prix du \${U} : <strong>\${Number(d.prix)} € TTC</strong> · TVA \${d.taux_tva} %\` : ''}</span>`,
`        <span class="muted">\${prixOk
          ? \`Prix du \${U} : <strong>\${prixTexte} € TTC</strong> · TVA \${d.taux_tva} %\`
          /* Le prix manquant s'annonce ICI, à la place du prix. Un <span> vide
             faisait glisser le bouton « Feuille de tournée » d'un onglet à
             l'autre, et l'information réapparaissait ailleurs. */
          : \`<span style="color:var(--laiton)">Prix du \${U} non configuré</span>\`}</span>`],

  /* ── 3. L'avertissement ─────────────────────────────────── */
  ['avertissement : miel plutôt que rouge',
`    \${prixOk ? '' : \`<p class="form-error" style="margin-bottom:14px">Prix du \${U} non configuré — les relevés seront enregistrés mais aucune charge ne sera créée. <a href="#/parametres">Configurer dans Paramètres → Énergie &amp; eau</a>.</p>\`}`,
`    \${prixOk ? '' : \`<p style="margin:0 0 14px;padding:11px 14px;border-radius:var(--r-s);
        background:var(--laiton-pale);border:1px solid rgba(185,138,60,.28);color:#7A5A22;font-size:13.5px;line-height:1.5">
        \u2014 Prix du \${U} non configuré. Les relevés sont bien enregistrés, mais aucune charge n\\u2019est créée sur les fiches résidents.
        <a href="#/parametres" style="color:inherit;font-weight:600">Renseigner le prix dans Paramètres → Énergie &amp; eau</a>.</p>\`}`],

  /* ── 5 bis. Le compte à côté des onglets ────────────────── */
  ['résumé affiché à côté des onglets',
`      <button class="fiche-tab \${t === 'eau' ? 'active' : ''}" data-act="switchCompteurType" data-a1="eau">Eau (m³)</button>
    </div>`,
`      <button class="fiche-tab \${t === 'eau' ? 'active' : ''}" data-act="switchCompteurType" data-a1="eau">Eau (m³)</button>
      \${cptResume ? \`<span class="muted" style="margin-left:14px;font-size:13px">\${cptResume}</span>\` : ''}
    </div>`],

  /* ── 4. Le champ trop étroit ────────────────────────────── */
  ['champ : « index initial » ne tient plus coupé',
   `style="width:110px;text-align:right"`,
   `style="width:132px;text-align:right"`],
];

let total = 0;
for (const [nom, avant, apres] of edits) {
  const n = src.split(avant).length - 1;
  if (n !== 1) {
    console.error('\n  \u2717 ' + nom);
    console.error('      ' + n + ' occurrence(s), 1 attendue.');
    console.error('      Motif : ' + avant.split('\n')[0].trim().slice(0, 80));
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

if (src.indexOf('${Number(d.prix)} € TTC') !== -1) {
  console.error('\n  \u2717 Le prix non formaté subsiste. AUCUNE écriture.\n');
  process.exit(1);
}

if (ESSAI) {
  console.log('\n— ESSAI —  ' + total + ' remplacements, syntaxe vérifiée. Rien écrit.');
  console.log('  Relancez sans --essai pour appliquer.\n');
  process.exit(0);
}

fs.writeFileSync(CIBLE, src, 'utf8');
const relu = fs.readFileSync(CIBLE, 'utf8');
if (relu.indexOf('cptRestants') === -1 || relu.length === tailleAvant) {
  console.error('\n  \u2717 L\'écriture n\'a pas pris. Vérifiez les droits sur le fichier.\n');
  process.exit(1);
}

console.log('\n— APPLIQUÉ —  ' + total + ' remplacements.');
console.log('  Syntaxe vérifiée, écriture relue : ' + tailleAvant + ' → ' + relu.length + ' octets.');
console.log('\n  À VÉRIFIER À L\'ÉCRAN — Compteurs :');
console.log('    · le prix s\'écrit « 0,39 € TTC », avec une virgule ;');
console.log('    · en basculant Électricité / Eau, le bouton « Feuille de');
console.log('      tournée » ne bouge plus, et le prix manquant s\'affiche');
console.log('      à la place du prix ;');
console.log('    · l\'avertissement du prix non configuré est en miel, plus');
console.log('      en rouge — rien n\'a échoué ;');
console.log('    · le champ affiche « index initial » en entier ;');
console.log('    · à côté des onglets : « 21 jamais relevés · 1 à jour ».');
console.log('\n  À REGARDER — un problème de DONNÉES, pas d\'affichage');
console.log('    La liste montre « 01 », puis « 1 », puis « 02 », « 03 »…');
console.log('    Deux emplacements différents portent le numéro 1, écrit');
console.log('    « 01 » pour l\'un et « 1 » pour l\'autre. Le tri numérique');
console.log('    les considère égaux, d\'où cet ordre qui semble cassé.');
console.log('    Aucun correctif d\'affichage ne réparera ça : sur le terrain,');
console.log('    personne ne saura lequel est lequel. À renommer dans');
console.log('    Emplacements, en choisissant une seule écriture.');
console.log('');

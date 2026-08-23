#!/usr/bin/env node
/* ============================================================
   Tiroir de facture : TVA, total, et un avertissement
   ============================================================
   Cible : backend/public/app.js
   Prérequis : outils/facturation-motifs.js appliqué (moisFr).

   Se termine en code 1 au moindre motif introuvable, relit le disque
   après écriture.

   ── 1. LA TVA ÉTAIT À 0 % PAR DÉFAUT ─────────────────────────────
   Chaque nouvelle ligne de facture naissait avec « TVA % : 0 ».

   Sur une facture française, 0 % n'est pas une absence de taux : c'est
   un régime particulier (exonération, autoliquidation) qui exige une
   mention légale sur le document. Le poser par défaut produit donc des
   factures non conformes, sans que rien ne le signale — et la personne
   qui saisit vite ne verra pas passer le champ.

   Le taux vient désormais de Paramètres → Facturation → « TVA loyer »,
   déjà saisi par le camping. Il reste modifiable ligne à ligne : une
   vente de gaz n'a pas le même taux qu'un loyer, mais partir du taux
   configuré est plus juste que partir de zéro.

   Une ligne ajoutée depuis le catalogue garde le taux de l'article :
   c'est l'information la plus précise disponible, elle a la priorité.

   Le champ porte maintenant l'origine du taux en infobulle — sinon
   personne ne sait d'où sort le nombre affiché.

   ── 2. AUCUN TOTAL AVANT DE VALIDER ──────────────────────────────
   Le tiroir enchaînait les lignes puis « Créer la facture », sans
   jamais afficher de montant. On validait une facture sans avoir vu
   ce qu'elle allait coûter au résident.

   Un récapitulatif HT / TVA / TTC s'affiche au-dessus du bouton, et se
   recalcule à chaque frappe. Le calcul reprend celui du serveur —
   total TTC de la ligne d'abord, HT déduit ensuite — pour que le
   montant affiché soit celui qui sera enregistré, au centime.

   ── 3. « GÉNÉRER LA FACTURATION DU MOIS » NE PRÉVIENT PAS ────────
   Deux boutons portent le même geste, avec deux conséquences :

     fiche résident → crée un BROUILLON, relisable, annulable
     cet écran      → crée des factures ÉMISES

   Émises veut dire : numérotées dans la séquence fiscale, inscrites
   dans la chaîne d'inaltérabilité (article 286-I-3° bis du CGI) — donc
   non supprimables, un avoir est le seul recours — et envoyées par
   e-mail aux résidents si l'envoi automatique est actif.

   Un clic engageait tout cela sans un mot. Une confirmation l'annonce,
   en nommant la période et en disant que l'e-mail part.

   Usage :
     node outils/tiroir-facture.js --essai
     node outils/tiroir-facture.js
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

if (src.indexOf('majTotauxFacture') !== -1) {
  console.log('\n  Déjà appliqué — rien à faire.\n');
  process.exit(0);
}
if (src.indexOf('function moisFr') === -1) {
  console.error('\n  \u2717 moisFr introuvable : appliquez d\'abord outils/facturation-motifs.js.\n');
  process.exit(1);
}

const edits = [

  /* ── 1. Le taux par défaut ─────────────────────────────────── */
  ['charger les paramètres du camping',
`  const [{ residents }, artRes] = await Promise.all([
    api('/api/residents'),
    api('/api/articles').catch(() => ({ articles: [] })),
  ]);`,
`  /* Le taux de TVA par défaut vient des paramètres du camping. Il était
     codé à 0, ce qui produit des factures non conformes : sur une facture
     française, 0 % est un régime particulier qui exige une mention légale,
     pas une absence de taux. */
  const [{ residents }, artRes, campRes] = await Promise.all([
    api('/api/residents'),
    api('/api/articles').catch(() => ({ articles: [] })),
    api('/api/camping'),
  ]);
  const tvaDefaut = Number(((campRes.camping || {}).parametres || {}).facturation?.tva_taux_loyer || 0);`],

  ['ligne : taux par défaut et origine annoncée',
`        <label >TVA %<input name="taux_tva" type="number" step="0.1" value="\${p.taux_tva ?? 0}"></label>`,
`        <label >TVA %<input name="taux_tva" type="number" step="0.1" value="\${p.taux_tva ?? tvaDefaut}"
          title="Taux par défaut repris de Paramètres → Facturation (TVA loyer : \${tvaDefaut} %). Modifiable pour cette ligne."></label>`],

  /* ── 2. Le récapitulatif ───────────────────────────────────── */
  ['récapitulatif au-dessus du bouton',
`      <div class="full"><button class="btn btn-primary btn-block">Créer la facture</button></div>
    </form>\`);`,
`      <div class="full" id="fac-totaux" style="margin-top:4px;padding:12px 14px;border-radius:var(--r-s);
        background:var(--sapin-pale);border:1px solid rgba(23,82,67,.16);font-size:13.5px;line-height:1.7"></div>
      <div class="full"><button class="btn btn-primary btn-block">Créer la facture</button></div>
    </form>\`);

  /* Le tiroir n'affichait aucun montant : on validait une facture sans
     avoir vu ce qu'elle allait coûter. Le calcul reprend celui du serveur
     (computeTotals) — total TTC de la ligne d'abord, HT déduit ensuite —
     pour que le montant affiché soit exactement celui qui sera enregistré.
     Arrondir le PU HT avant de multiplier ferait dériver les centimes. */
  window.majTotauxFacture = () => {
    const box = $('#fac-totaux');
    if (!box) return;
    let ht = 0, tva = 0, ttc = 0, lignes = 0;
    [...document.querySelectorAll('#fac-lignes .fac-ligne')].forEach((row) => {
      const val = (n) => row.querySelector('[name=' + n + ']')?.value;
      const q = Number(val('quantite') || 1);
      const pu = Number(val('pu_ttc'));
      const taux = Number(val('taux_tva') || 0);
      if (!Number.isFinite(pu) || !pu) return;
      const mTtc = Math.round(q * pu * 100) / 100;
      const mHt = Math.round((mTtc / (1 + taux / 100)) * 100) / 100;
      ht += mHt; tva += Math.round((mTtc - mHt) * 100) / 100; ttc += mTtc;
      lignes += 1;
    });
    if (!lignes) {
      box.innerHTML = '<span class="muted">Renseignez un prix pour voir le total.</span>';
      return;
    }
    box.innerHTML = '<div style="display:flex;justify-content:space-between"><span class="muted">Total HT</span>'
      + '<span>' + eur(Math.round(ht * 100) / 100) + '</span></div>'
      + '<div style="display:flex;justify-content:space-between"><span class="muted">TVA</span>'
      + '<span>' + eur(Math.round(tva * 100) / 100) + '</span></div>'
      + '<div style="display:flex;justify-content:space-between;margin-top:4px;padding-top:6px;'
      + 'border-top:1px solid rgba(23,82,67,.16);font-weight:700"><span>Total TTC</span>'
      + '<span>' + eur(Math.round(ttc * 100) / 100) + '</span></div>';
  };

  /* Délégation sur le tiroir : les lignes sont ajoutées et retirées après
     coup, un écouteur par champ serait à reposer à chaque fois. */
  $('#f-fac').addEventListener('input', majTotauxFacture);
  $('#f-fac').addEventListener('change', majTotauxFacture);
  $('#f-fac').addEventListener('click', () => setTimeout(majTotauxFacture, 0));
  majTotauxFacture();`],

  /* ── 3. L'avertissement avant émission ─────────────────────── */
  ['confirmation avant émission en masse',
`window.runFacturation = async () => {
  try {
    const periode = $('#fac-periode').value;`,
`window.runFacturation = async () => {
  try {
    const periode = $('#fac-periode').value;

    /* Ce bouton n'émet pas des brouillons, contrairement à celui d'une fiche
       résident : les factures sont numérotées dans la séquence fiscale,
       inscrites dans la chaîne d'inaltérabilité (art. 286-I-3° bis du CGI) —
       donc non supprimables, un avoir étant le seul recours — et envoyées par
       e-mail. Un clic engageait tout cela sans un mot. */
    if (!periode) { toast('Choisissez d\\u2019abord un mois.', true); return; }
    const ok = await askConfirm(
      'Facturer ' + moisFr(periode) + ' pour tous les résidents actifs ?\\n\\n'
      + 'Les factures sont émises définitivement : numérotées, inscrites dans la '
      + 'chaîne fiscale — elles ne pourront plus être supprimées, seulement '
      + 'annulées par un avoir — et envoyées par e-mail aux résidents.\\n\\n'
      + 'Pour relire avant d\\u2019émettre, passez par le bouton « Générer la facture '
      + 'du mois » d\\u2019une fiche résident : il crée un brouillon.'
    );
    if (!ok) return;`],
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

if (src.indexOf('value="${p.taux_tva ?? 0}"') !== -1) {
  console.error('\n  \u2717 La TVA à 0 par défaut subsiste. AUCUNE écriture.\n');
  process.exit(1);
}
if (!/askConfirm/.test(src)) {
  console.error('\n  \u2717 askConfirm introuvable. AUCUNE écriture.\n');
  process.exit(1);
}

if (ESSAI) {
  console.log('\n— ESSAI —  ' + total + ' remplacements, syntaxe vérifiée. Rien écrit.');
  console.log('  Relancez sans --essai pour appliquer.\n');
  process.exit(0);
}

fs.writeFileSync(CIBLE, src, 'utf8');
const relu = fs.readFileSync(CIBLE, 'utf8');
if (relu.indexOf('majTotauxFacture') === -1 || relu.length === tailleAvant) {
  console.error('\n  \u2717 L\'écriture n\'a pas pris. Vérifiez les droits sur le fichier.\n');
  process.exit(1);
}

console.log('\n— APPLIQUÉ —  ' + total + ' remplacements.');
console.log('  Écriture relue : ' + tailleAvant + ' → ' + relu.length + ' octets.');
console.log('\n  À VÉRIFIER À L\'ÉCRAN');
console.log('    Factures → Nouvelle facture :');
console.log('      · le champ TVA % affiche le taux de Paramètres, plus 0,');
console.log('        et son infobulle dit d\'où il vient ;');
console.log('      · « + Ajouter » depuis le catalogue garde le taux de');
console.log('        l\'article — il est plus précis que le taux général ;');
console.log('      · un récapitulatif HT / TVA / TTC apparaît au-dessus du');
console.log('        bouton et se met à jour à chaque frappe ;');
console.log('      · le total doit tomber exactement sur le TTC de la');
console.log('        facture créée, au centime.');
console.log('    Factures → Générer la facturation du mois :');
console.log('      · une confirmation nomme le mois et annonce que les');
console.log('        factures sont définitives et parties par e-mail ;');
console.log('      · sans mois choisi, elle refuse au lieu de ne rien faire.');
console.log('\n  UN RÉGLAGE À VÉRIFIER DE VOTRE CÔTÉ');
console.log('    Paramètres → Facturation → « TVA loyer » est à ' + '0' + ' % par');
console.log('    défaut dans le code. Si votre camping applique 10 % sur les');
console.log('    loyers, renseignez-le : c\'est désormais ce champ qui donne');
console.log('    le taux de toutes les nouvelles lignes.');
console.log('');

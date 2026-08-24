#!/usr/bin/env node
/* ============================================================
   Écran Impayés
   ============================================================
   Cible : backend/public/app.js

   Se termine en code 1 au moindre motif introuvable, relit le disque
   après écriture.

   ── 1. LE BOUTON ENVOIE DE VRAIS E-MAILS, SANS PRÉVENIR ──────────
   « Envoyer les relances » part au premier clic. Chaque relance est un
   e-mail à un résident, enregistré dans la table relances avec son
   niveau — donc la suivante sera une relance de niveau 2, puis 3. Rien
   ne se rattrape.

   Une confirmation annonce désormais combien de factures sont
   réellement concernées : les impayés EN RETARD, pas le total affiché
   en haut — qui inclut ce qui n'est pas encore échu.

   ── 2. LE COMPTE RENDU DISAIT UNE CHOSE FAUSSE ───────────────────
       Relances : 3 envoyée(s), 12 à échoir

   Le serveur incrémente `ignorees` pour DEUX raisons distinctes
   (relances.js, lignes 66 et 72) :

       f.jours_retard <= 0              la facture n'est pas échue
       relancée il y a moins de N jours le délai de courtoisie court

   Les appeler toutes « à échoir » laisse croire qu'aucune facture en
   retard n'a été omise, alors qu'une facture relancée hier est passée
   sous silence. Le compte rendu distingue les deux.

   ── 3. LES ÉCHECS D'ENVOI ÉTAIENT MUETS ──────────────────────────
   Le serveur renvoie `erreurs` — une adresse invalide, un envoi
   refusé — et l'écran n'en disait rien. Le gestionnaire croyait ses
   relances parties. Elles s'affichent maintenant, en alerte.

   ── 4. « TOTAL DÛ » MÊLE CE QUI EST EN RETARD ET CE QUI NE L'EST PAS
   Le premier chiffre de l'écran additionne les factures en retard ET
   celles qui ne sont pas encore échues. Un gestionnaire qui lit
   « Total dû : 12 400 € » croit voir son retard de paiement.

   Le montant reste — c'est bien la créance totale — mais la carte dit
   maintenant ce qu'elle contient, et le montant réellement en retard
   apparaît en dessous.

   ── 5. AUCUN NOMBRE DE FACTURES ──────────────────────────────────
   Trois factures impayées ou quarante-sept, ce n'est pas la même
   journée. Le compte s'affiche à côté du montant.

   ── 6. « Aucun impayé. 🎉 » ──────────────────────────────────────
   Un émoji dans un écran de recouvrement. Son dessin change d'un
   système à l'autre, il n'hérite pas de la couleur du texte, et un
   lecteur d'écran l'annonce « visage qui fait la fête ». La phrase
   suffit.

   Usage :
     node outils/ecran-impayes.js --essai
     node outils/ecran-impayes.js
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

if (src.indexOf('nbEnRetard') !== -1) {
  console.log('\n  Déjà appliqué — rien à faire.\n');
  process.exit(0);
}

const edits = [

  /* ── 1, 4, 5 : ce que l'écran annonce ──────────────────────── */
  ['compte des factures en retard',
`  const a = imp.aging;
  $('#main').innerHTML = \``,
`  const a = imp.aging;

  /* Ce qui est EN RETARD, distingué de ce qui est simplement dû. Le total
     additionnait les deux : un gestionnaire lisant « Total dû 12 400 € »
     croyait voir son retard de paiement. */
  const enRetard = imp.impayes.filter((f) => f.en_retard);
  const nbEnRetard = enRetard.length;
  const montantRetard = enRetard.reduce((s, f) => s + Number(f.reste || 0), 0);
  const nbTotal = imp.impayes.length;

  /* Le bouton de relance n'agit que sur les factures échues : le nombre
     annoncé avant l'envoi doit être celui-là, pas le total. */
  window._impayesEnRetard = nbEnRetard;

  $('#main').innerHTML = \``],

  ['cartes : dire ce que le montant contient',
`      <div class="kpi"><div class="v">\${eur(imp.total_du)}</div><div class="l">Total dû</div></div>
      <div class="kpi"><div class="v">\${eur(a.a_echoir)}</div><div class="l">À échoir (délai \${imp.delai} j)</div></div>`,
`      <div class="kpi"><div class="v">\${eur(imp.total_du)}</div><div class="l">Créance totale · \${nbTotal} facture\${nbTotal > 1 ? 's' : ''}<br><span class="muted" style="font-size:12px">dont \${eur(montantRetard)} en retard</span></div></div>
      <div class="kpi"><div class="v">\${eur(a.a_echoir)}</div><div class="l">Pas encore échu (délai \${imp.delai} j)</div></div>`],

  /* ── 6 : l'émoji ───────────────────────────────────────────── */
  ['état vide sans émoji',
   `'<tr><td colspan="4" class="muted">Aucun impayé. 🎉</td></tr>'`,
   `'<tr><td colspan="4" class="muted">Aucun impayé : toutes les factures de l\\u2019exercice sont réglées.</td></tr>'`],

  /* ── 1, 2, 3 : l'envoi ─────────────────────────────────────── */
  ['relances : confirmation et compte rendu exact',
`window.runRelancesBtn = async () => {
  try { const r = await api('/api/relances/run', { method: 'POST' }); toast(\`Relances : \${r.envoyees} envoyée(s), \${r.ignorees} à échoir\`); route(); }
  catch (e) { toast(e.message, true); }
};`,

`window.runRelancesBtn = async () => {
  /* Chaque relance est un e-mail réel, enregistré avec son niveau : la
     prochaine sera une relance de niveau 2, puis 3. Rien ne se rattrape,
     et le bouton partait au premier clic. */
  const n = window._impayesEnRetard || 0;
  if (!n) { toast('Aucune facture en retard : il n\\u2019y a rien à relancer.'); return; }

  const ok = await askConfirm(
    'Relancer ' + n + ' facture' + (n > 1 ? 's' : '') + ' en retard ?\\n\\n'
    + 'Un e-mail part vers chaque résident concerné. La relance est '
    + 'enregistrée : la prochaine sera de niveau supérieur.\\n\\n'
    + 'Les factures non échues, et celles déjà relancées ces derniers jours, '
    + 'sont laissées de côté.'
  );
  if (!ok) return;

  try {
    const r = await api('/api/relances/run', { method: 'POST' });

    /* Le serveur regroupe sous « ignorees » deux cas distincts : la facture
       n'est pas échue, ou elle a été relancée trop récemment. Les annoncer
       toutes comme « à échoir » laissait croire qu'aucune facture en retard
       n'avait été omise. On ne peut pas les départager depuis la réponse :
       on dit donc les deux raisons, plutôt qu'une seule qui serait fausse. */
    const parts = [r.envoyees + ' relance' + (r.envoyees > 1 ? 's' : '') + ' envoyée' + (r.envoyees > 1 ? 's' : '')];
    if (r.ignorees) parts.push(r.ignorees + ' laissée' + (r.ignorees > 1 ? 's' : '') + ' de côté (non échues ou déjà relancées)');

    /* Les échecs d'envoi — adresse invalide, refus du serveur de mail —
       n'étaient pas affichés : on croyait ses relances parties. */
    if (r.erreurs) {
      toast(parts.join(', ') + ' · ' + r.erreurs + ' envoi' + (r.erreurs > 1 ? 's ont' : ' a')
        + ' échoué : vérifiez les adresses e-mail de ces résidents.', true);
    } else {
      toast(parts.join(', ') + '.');
    }
    route();
  } catch (e) { toast(e.message, true); }
};`],
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
if (src.indexOf('Aucun impayé. 🎉') !== -1) {
  console.error('\n  \u2717 L\'émoji subsiste. AUCUNE écriture.\n');
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
if (relu.indexOf('nbEnRetard') === -1 || relu.length === tailleAvant) {
  console.error('\n  \u2717 L\'écriture n\'a pas pris. Vérifiez les droits sur le fichier.\n');
  process.exit(1);
}

console.log('\n— APPLIQUÉ —  ' + total + ' remplacements.');
console.log('  Écriture relue : ' + tailleAvant + ' → ' + relu.length + ' octets.');
console.log('\n  À VÉRIFIER À L\'ÉCRAN — Impayés :');
console.log('    · la première carte dit « Créance totale · N factures »');
console.log('      et, en dessous, le montant réellement en retard ;');
console.log('    · « Envoyer les relances » demande confirmation en');
console.log('      nommant le nombre de factures en retard ;');
console.log('    · sans facture en retard, il refuse au lieu d\'appeler');
console.log('      le serveur pour rien ;');
console.log('    · le compte rendu ne dit plus « à échoir » pour tout ce');
console.log('      qui a été omis, et signale les envois qui ont échoué ;');
console.log('    · l\'écran vide n\'a plus d\'émoji.');
console.log('\n  RESTE À DÉCIDER — deux manques vus sur cet écran');
console.log('    1. Aucune action par ligne : impossible de relancer UNE');
console.log('       facture précise, ou de noter un accord de paiement.');
console.log('       C\'est tout ou rien.');
console.log('    2. La liste n\'est pas triée par ancienneté de retard : la');
console.log('       facture la plus en retard n\'est pas forcément en haut,');
console.log('       alors que c\'est celle qu\'on traite en premier.');
console.log('');

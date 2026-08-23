#!/usr/bin/env node
/* ============================================================
   Écran Règlements
   ============================================================
   Cible : backend/public/app.js

   Se termine en code 1 au moindre motif introuvable, relit le disque
   après écriture.

   ── 1. UN PAIEMENT PEUT ÊTRE ATTRIBUÉ SANS QU'ON L'AIT CHOISI ────
   Le plus grave de cet écran.

       <select name="resident_id" required>
         ${residents.map(...)}     ← aucune option vide

   Un <select required> dont la première option porte déjà une valeur
   n'est jamais vide : le navigateur le considère rempli. Saisir un
   montant et valider sans toucher au sélecteur enregistre donc le
   paiement au nom du PREMIER résident de la liste — silencieusement,
   et avec lettrage automatique sur ses factures.

   Le tiroir « Nouvelle facture » fait l'inverse : il ouvre sur
   « — choisir — ». Le même formulaire, deux comportements, et c'est
   celui qui touche à l'argent encaissé qui est permissif.

   ── 2. RIEN NE DISTINGUE DEUX PAIEMENTS IDENTIQUES ───────────────
   La liste montre deux fois : 13/07/2026 · Marie Dupont · Espèces ·
   — · 500,00 €. Impossible de savoir s'il s'agit de deux versements
   réels ou d'une double saisie. Il n'y a ni heure, ni référence, ni
   numéro.

   Deux ajouts : l'heure de saisie apparaît au survol de la date, ce
   qui les sépare enfin ; et à la validation, un paiement identique le
   même jour pour le même résident demande confirmation. Elle ne bloque
   rien — deux versements de 500 € le même jour arrivent — mais elle
   force le regard.

   ── 3. LE MESSAGE CONTREDIT L'ÉCRAN ──────────────────────────────
       Aucun règlement en attente de remise (chèques, ANCV…).

   Or la remise R-2026-001 juste en dessous porte le moyen « Espèces ».
   Le message énumère en dur des moyens, alors que « se remet en
   banque » est une case à cocher par moyen dans Administration : un
   camping peut très bien y mettre les espèces — un bordereau de remise
   d'espèces existe. Le message nomme désormais les moyens réellement
   configurés comme remisables.

   ── 4. AUCUN TOTAL SUR LA LISTE ──────────────────────────────────
   La remise affiche 1 000,00 €, la liste des paiements qui la compose
   n'affiche rien. Un pied de tableau donne le total de la période.

   ── 5. « ENCAISSÉE ✓ » EST UN ÉTAT, PAS UNE ACTION ───────────────
   Le bouton porte le libellé d'un état, à côté d'un badge qui dit
   « remise ». On ne sait pas si l'on lit une information ou si l'on
   déclenche quelque chose — d'autant que le bouton ne s'affiche que
   sur les remises NON encaissées. Devient « Marquer encaissée ».

   ── 6. UN TUTOIEMENT ─────────────────────────────────────────────
   « configure-les dans Administration ».

   Usage :
     node outils/ecran-reglements.js --essai
     node outils/ecran-reglements.js
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

if (src.indexOf('doublonProbable') !== -1) {
  console.log('\n  Déjà appliqué — rien à faire.\n');
  process.exit(0);
}

const edits = [

  /* ── 1. Le sélecteur de résident ───────────────────────────── */
  ['résident : plus de choix par défaut',
`        <label>Résident *<select name="resident_id" required>\${residents.map((r) => \`<option value="\${r.id}">\${esc(rmap[r.id])}</option>\`).join('')}</select></label>`,
`        \${/* Sans option vide, un <select required> est considéré rempli par le
             navigateur : valider sans y toucher enregistrait le paiement au nom
             du PREMIER résident de la liste, avec lettrage automatique sur ses
             factures. Le tiroir « Nouvelle facture » ouvre bien sur « choisir ». */''}
        <label>Résident *<select name="resident_id" required>
          <option value="">— choisir —</option>
          \${residents.map((r) => \`<option value="\${r.id}">\${esc(rmap[r.id])}</option>\`).join('')}</select></label>`],

  /* ── 2. Distinguer deux paiements identiques ────────────────── */
  ['liste : heure de saisie et total',
`    <tbody>\${reglements.map((g) => \`
      <tr><td class="muted">\${dfr(g.date_reglement)}</td><td>\${esc(rmap[g.resident_id] || '—')}</td>
      <td class="muted">\${esc(mlib[g.mode] || g.mode)}</td><td class="muted">\${esc(g.reference || '—')}</td>
      <td class="right"><strong>\${eur(g.montant)}</strong></td></tr>\`).join('') || '<tr><td colspan="5" class="muted">Aucun règlement enregistré.</td></tr>'}</tbody></table></div>\`;`,

`    <tbody>\${reglements.map((g) => \`
      \${/* L'heure de saisie en infobulle : deux paiements de même date, même
           résident, même montant et sans référence étaient indistinguables —
           impossible de dire si c'était une double saisie. */''}
      <tr><td class="muted"\${g.created_at ? \` title="Saisi le \${new Date(g.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}"\` : ''}>\${dfr(g.date_reglement)}</td><td>\${esc(rmap[g.resident_id] || '—')}</td>
      <td class="muted">\${esc(mlib[g.mode] || g.mode)}</td><td class="muted">\${esc(g.reference || '—')}</td>
      <td class="right"><strong>\${eur(g.montant)}</strong></td></tr>\`).join('') || '<tr><td colspan="5" class="muted">Aucun règlement enregistré.</td></tr>'}</tbody>
    \${reglements.length ? \`<tfoot><tr><td colspan="4" class="right muted">Total encaissé — \${reglements.length} règlement\${reglements.length > 1 ? 's' : ''}</td>
      <td class="right"><strong>\${eur(reglements.reduce((s, g) => s + Number(g.montant || 0), 0))}</strong></td></tr></tfoot>\` : ''}</table></div>\`;`],

  ['validation : confirmer un paiement en double',
`  $('#f-reg').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    body.montant = Number(body.montant);
    try { await api('/api/reglements', { method: 'POST', body }); toast('Paiement enregistré et lettré'); route(); }
    catch (err) { toast(err.message, true); }
  });`,

`  $('#f-reg').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    body.montant = Number(body.montant);
    if (!body.resident_id) { toast('Choisissez le résident.', true); return; }
    if (!(body.montant > 0)) { toast('Le montant doit être supérieur à zéro.', true); return; }

    /* Un même montant, le même jour, pour le même résident : c'est peut-être
       deux versements réels, c'est peut-être une double saisie. On ne bloque
       pas — on force le regard, parce qu'après lettrage la correction demande
       d'annuler un règlement déjà imputé sur des factures. */
    const aujourdhui = new Date().toISOString().slice(0, 10);
    const doublonProbable = (reglements || []).some((g) =>
      g.resident_id === body.resident_id
      && String(g.date_reglement).slice(0, 10) === aujourdhui
      && Math.abs(Number(g.montant) - body.montant) < 0.005
      && String(g.mode) === String(body.mode));
    if (doublonProbable) {
      const ok = await askConfirm(
        'Un paiement de ' + eur(body.montant) + ' a déjà été enregistré aujourd\\u2019hui pour '
        + (rmap[body.resident_id] || 'ce résident') + ', avec le même moyen.\\n\\n'
        + 'S\\u2019agit-il bien d\\u2019un second versement ?'
      );
      if (!ok) return;
    }

    try { await api('/api/reglements', { method: 'POST', body }); toast('Paiement enregistré et lettré'); route(); }
    catch (err) { toast(err.message, true); }
  });`],

  /* ── 3. Le message qui contredit l'écran ───────────────────── */
  ['message d\'attente : nommer les moyens réellement remisables',
`      \${blocsAttente || '<div class="card"><p class="muted" style="margin:0">Aucun règlement en attente de remise (chèques, ANCV…).</p></div>'}`,
`      \${blocsAttente || \`<div class="card"><p class="muted" style="margin:0">Aucun règlement en attente de remise\${(() => {
        /* Le message énumérait « chèques, ANCV » en dur, alors que « se remet en
           banque » est une case à cocher par moyen dans Administration : un
           camping peut y mettre les espèces, et la remise R-2026-001 le prouve.
           On nomme donc ce qui est réellement configuré. */
        const noms = (moyens || []).filter((m) => m.remisable).map((m) => m.libelle);
        return noms.length ? ' (' + noms.join(', ') + ')' : '';
      })()}.</p></div>\`}`],

  /* ── 5. Le libellé du bouton ───────────────────────────────── */
  ['bouton : une action, pas un état',
   `data-act="encaisserRemise" data-a1="\${r.id}">Encaissée ✓</button>`,
   `data-act="encaisserRemise" data-a1="\${r.id}">Marquer encaissée</button>`],

  /* ── 6. Le tutoiement ──────────────────────────────────────── */
  ['vouvoiement : moyens par défaut',
   'Moyens de paiement par défaut — configure-les dans Administration.',
   'Moyens de paiement par défaut — configurez-les dans Administration.'],
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
if (src.indexOf('Encaissée ✓') !== -1) {
  console.error('\n  \u2717 Le libellé « Encaissée ✓ » subsiste. AUCUNE écriture.\n');
  process.exit(1);
}

if (ESSAI) {
  console.log('\n— ESSAI —  ' + total + ' remplacements, syntaxe vérifiée. Rien écrit.');
  console.log('  Relancez sans --essai pour appliquer.\n');
  process.exit(0);
}

fs.writeFileSync(CIBLE, src, 'utf8');
const relu = fs.readFileSync(CIBLE, 'utf8');
if (relu.indexOf('doublonProbable') === -1 || relu.length === tailleAvant) {
  console.error('\n  \u2717 L\'écriture n\'a pas pris. Vérifiez les droits sur le fichier.\n');
  process.exit(1);
}

console.log('\n— APPLIQUÉ —  ' + total + ' remplacements.');
console.log('  Écriture relue : ' + tailleAvant + ' → ' + relu.length + ' octets.');
console.log('\n  À VÉRIFIER À L\'ÉCRAN — Règlements :');
console.log('    · le sélecteur Résident ouvre sur « — choisir — » : valider');
console.log('      sans choisir doit refuser, plus attribuer le paiement au');
console.log('      premier résident de la liste ;');
console.log('    · saisissez 500 € en espèces pour Marie Dupont, puis');
console.log('      recommencez : une confirmation doit apparaître ;');
console.log('    · la liste affiche un total en pied, et l\'heure de saisie');
console.log('      au survol de la date ;');
console.log('    · le message d\'attente nomme vos moyens remisables, plus');
console.log('      « chèques, ANCV » en dur ;');
console.log('    · le bouton dit « Marquer encaissée ».');
console.log('\n  À VÉRIFIER DE VOTRE CÔTÉ — un réglage, pas un défaut');
console.log('    La remise R-2026-001 porte le moyen « Espèces ». C\'est donc');
console.log('    que « Se remet en banque » est coché sur Espèces dans');
console.log('    Administration → Moyens de paiement. Un bordereau de remise');
console.log('    d\'espèces existe, ce n\'est pas absurde — mais si ce n\'était');
console.log('    pas voulu, décochez-le : les espèces ne passeront plus par');
console.log('    l\'étape bordereau.');
console.log('\n  À REGARDER PLUS TARD — le champ Référence');
console.log('    Il est facultatif pour tous les moyens. Un chèque sans son');
console.log('    numéro et un virement sans libellé sont introuvables en');
console.log('    rapprochement bancaire. Le rendre obligatoire selon le moyen');
console.log('    demande de savoir lesquels chez vous : à trancher ensemble.');
console.log('');

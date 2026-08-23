#!/usr/bin/env node
/* ============================================================
   Signatures, vouvoiement, et cinq fausses pistes
   ============================================================
   Cible : backend/public/app.js

   Ce script ne fait qu'écrire ce fichier, se termine en code 1 au
   moindre motif introuvable, et relit le disque après écriture —
   la leçon du script groupé qui avait échoué en silence.

   ── 1. CINQ MESSAGES QUI ENVOIENT VERS DES FICHIERS INEXISTANTS ──
   Quand une table manque, l'écran affiche :

       Table « messages » absente — exécute la migration
       db/10_messages.sql dans Supabase.

   Or db/10_messages.sql n'existe pas. Ni db/09_prestations.sql, ni
   db/15_carte_elements.sql, ni db/16_moyens_paiement_remises.sql.
   Ces quatre noms renvoient à une numérotation qui n'a jamais été
   commitée — c'est le trou 07-11 rebouché hier depuis le schéma réel.

   Un message d'erreur qui donne un chemin faux est pire que pas de
   message : il envoie chercher un fichier qui n'existe pas. Les cinq
   pointent désormais vers les vraies migrations :

       messages, carte_elements  →  db/11_echanges_carte_suivi.sql
       prestations, moyens_paiement → db/07_catalogue_facturation.sql

   ── 2. LE TERME D'UN DOCUMENT ANNULÉ ─────────────────────────────
   La colonne « Terme » affiche un champ de date modifiable sur TOUS
   les documents, y compris annulés et refusés. Un document annulé n'a
   pas de terme : le modifier ne veut rien dire, et le badge « expiré »
   s'affiche dessus comme s'il y avait quelque chose à refaire.

   ── 3. « SIGNÉ LE » AFFICHE LES SECONDES ─────────────────────────
   toLocaleString('fr-FR') sans options donne « 23/08/2026 17:45:57 ».
   La seconde n'a aucune valeur ici, et elle allonge la colonne.

   Elle reste dans le dossier de preuve, où elle compte vraiment :
   c'est signatures_preuves.horodatage, pas cette colonne.

   ── 4. AUCUN FILTRE PAR STATUT ───────────────────────────────────
   La liste mélange brouillons, envoyés en attente, signés et annulés.
   La question qu'un gestionnaire se pose est « qu'est-ce qui attend
   une signature ? » — elle demandait de lire toute la table.

   Le filtre agit sur les lignes déjà rendues plutôt que de relancer
   une requête : la liste est courte, et le résultat est instantané.

   ── 5. LE TUTOIEMENT ─────────────────────────────────────────────
   Huit tournures au tutoiement dans une interface qui vouvoie partout
   ailleurs : « Tu en seras administrateur », « Importe ton contrat »,
   « Ajoute ton premier ». Le gestionnaire d'un camping n'est pas un
   copain.

   Usage :
     node outils/signatures-et-vouvoiement.js --essai
     node outils/signatures-et-vouvoiement.js
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

if (src.indexOf('filtrerSignatures') !== -1) {
  console.log('\n  Déjà appliqué — rien à faire.\n');
  process.exit(0);
}

/* [libellé, avant, après, nombre attendu] */
const edits = [

  /* ── 1. Les chemins de migration ─────────────────────────── */
  ['migration : messages (2 écrans)',
   'exécute la migration db/10_messages.sql dans Supabase.',
   'exécutez la migration db/11_echanges_carte_suivi.sql dans Supabase.', 2],

  ['migration : prestations',
   'exécute la migration db/09_prestations.sql dans Supabase.',
   'exécutez la migration db/07_catalogue_facturation.sql dans Supabase.', 1],

  ['migration : carte_elements',
   'exécute la migration db/15_carte_elements.sql.',
   'exécutez la migration db/11_echanges_carte_suivi.sql.', 1],

  ['migration : moyens_paiement',
   'exécute la migration db/16_moyens_paiement_remises.sql dans Supabase.',
   'exécutez la migration db/07_catalogue_facturation.sql dans Supabase.', 1],

  /* ── 2. Le terme d'un document annulé ────────────────────── */
  ['terme : rien à modifier sur un document annulé',
`          <td data-stop>\${(() => {
            const jr = d.date_fin ? Math.floor((new Date(d.date_fin) - new Date()) / 86400000) : null;`,
`          <td data-stop>\${d.statut === 'annule' || d.statut === 'refuse'
            /* Un document annulé ou refusé n'a pas de terme : proposer de le
               modifier n'a pas de sens, et le badge « expiré » y donnait
               l'impression qu'il restait quelque chose à refaire. */
            ? '<span class="muted">—</span>'
            : (() => {
            const jr = d.date_fin ? Math.floor((new Date(d.date_fin) - new Date()) / 86400000) : null;`, 1],

  /* ── 3. Les secondes ────────────────────────────────────── */
  ['« Signé le » sans les secondes',
   `<td class="muted">\${d.date_signature ? new Date(d.date_signature).toLocaleString('fr-FR') : '—'}</td>`,
   `<td class="muted">\${d.date_signature ? new Date(d.date_signature).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</td>`, 1],

  /* ── 4. Le filtre ───────────────────────────────────────── */
  ['filtre : le statut porté par la ligne',
`        <tr>
          <td><strong>\${esc(d.titre)}</strong><div class="muted">\${d.nb_pages || 1} page(s)</div></td>`,
`        <tr data-sig-statut="\${d.statut}">
          <td><strong>\${esc(d.titre)}</strong><div class="muted">\${d.nb_pages || 1} page(s)</div></td>`, 1],

  ['filtre : le sélecteur',
`      <button class="btn btn-primary" data-act="formDocSignature">Déposer un document</button>
    </div>`,
`      <div style="display:flex;align-items:center;gap:10px">
        <select id="sig-filtre" data-act="filtrerSignatures" data-evt="change" data-a1="@value"
                aria-label="Filtrer les documents par statut" style="width:auto">
          <option value="">Tous les statuts</option>
          <option value="envoye">En attente de signature</option>
          <option value="signe">Signés</option>
          <option value="brouillon">Brouillons</option>
          <option value="annule">Annulés</option>
          <option value="refuse">Refusés</option>
        </select>
        <button class="btn btn-primary" data-act="formDocSignature">Déposer un document</button>
      </div>
    </div>`, 1],

  /* ── 5. Le vouvoiement ──────────────────────────────────── */
  ['vouvoiement : nouvel espace camping',
   'Tu en seras administrateur.', 'Vous en serez administrateur.', 1],

  ['vouvoiement : messagerie vide',
   'ou que tu écris', 'ou que vous écrivez', 1],

  ['vouvoiement : modèles de contrat',
   'Importe ton contrat PDF ou crée un modèle vierge.',
   'Importez votre contrat PDF ou créez un modèle vierge.', 1],

  ['vouvoiement : import de contrat',
   'Dépose ton contrat PDF', 'Déposez votre contrat PDF', 1],

  ['vouvoiement : import de contrat (suite)',
   'Tu n\\u2019auras plus qu\\u2019à remplacer',
   'Vous n\\u2019aurez plus qu\\u2019à remplacer', 1],

  ['vouvoiement : dépôt de document',
   'Tu placeras ensuite les zones de signature sur le document.',
   'Vous placerez ensuite les zones de signature sur le document.', 1],

  ['vouvoiement : description des modèles',
   'le texte de ton contrat avec des variables',
   'le texte de votre contrat avec des variables', 1],

  ['vouvoiement : articles',
   'Aucun article. Ajoute ton premier ci-dessous.',
   'Aucun article. Ajoutez le premier ci-dessous.', 1],
];

let total = 0;
for (const [nom, avant, apres, attendu] of edits) {
  const n = src.split(avant).length - 1;
  if (n !== attendu) {
    console.error('\n  \u2717 ' + nom);
    console.error('      ' + n + ' occurrence(s), ' + attendu + ' attendue(s).');
    console.error('      Motif : ' + avant.split('\n')[0].slice(0, 80));
    console.error('\n    AUCUNE écriture. Le fichier est intact.\n');
    process.exit(1);
  }
  src = src.split(avant).join(apres);
  console.log('  ok  ' + nom + (n > 1 ? '  (' + n + ')' : ''));
  total += n;
}

/* ── La fonction du filtre, posée près des autres actions ──── */
const FONCTION = `
/** Filtre la liste des signatures par statut.
    Agit sur les lignes déjà rendues plutôt que de relancer une requête :
    la liste est courte, et le résultat est immédiat. Le compteur dit
    combien de lignes sont masquées — sinon un filtre actif se confond
    avec une liste vide. */
function filtrerSignatures(statut) {
  const lignes = document.querySelectorAll('#main tr[data-sig-statut]');
  let visibles = 0;
  lignes.forEach((tr) => {
    const ok = !statut || tr.getAttribute('data-sig-statut') === statut;
    tr.style.display = ok ? '' : 'none';
    if (ok) visibles += 1;
  });

  let info = document.getElementById('sig-filtre-info');
  if (!info) {
    const sel = document.getElementById('sig-filtre');
    if (!sel) return;
    info = document.createElement('span');
    info.id = 'sig-filtre-info';
    info.className = 'muted';
    info.style.fontSize = '13px';
    sel.insertAdjacentElement('afterend', info);
  }
  info.textContent = statut
    ? visibles + ' sur ' + lignes.length
    : '';
}

`;

const ANCRE_FN = '/* ---------- Signatures électroniques ---------- */';
if (src.split(ANCRE_FN).length - 1 !== 1) {
  console.error('\n  \u2717 Section « Signatures électroniques » introuvable. Aucune écriture.\n');
  process.exit(1);
}
src = src.split(ANCRE_FN).join(ANCRE_FN + FONCTION);

/* ── Contrôles avant écriture ─────────────────────────────── */
try {
  new Function(src);
} catch (e) {
  console.error('\n  \u2717 app.js serait invalide : ' + e.message);
  console.error('    AUCUNE écriture.\n');
  process.exit(1);
}

const restants = [];
['db/10_messages.sql', 'db/09_prestations.sql', 'db/15_carte_elements.sql', 'db/16_moyens_paiement_remises.sql']
  .forEach((f) => { if (src.indexOf(f) !== -1) restants.push(f); });
if (restants.length) {
  console.error('\n  \u2717 Chemins de migration inexistants encore présents : ' + restants.join(', '));
  console.error('    AUCUNE écriture.\n');
  process.exit(1);
}

if (ESSAI) {
  console.log('\n— ESSAI —  ' + total + ' remplacements, syntaxe vérifiée. Rien écrit.');
  console.log('  Relancez sans --essai pour appliquer.\n');
  process.exit(0);
}

fs.writeFileSync(CIBLE, src, 'utf8');

/* Relecture du disque : ne pas se contenter d'avoir cru écrire. */
const relu = fs.readFileSync(CIBLE, 'utf8');
if (relu.indexOf('filtrerSignatures') === -1 || relu.length === tailleAvant) {
  console.error('\n  \u2717 L\'écriture n\'a pas pris. Vérifiez les droits sur le fichier.\n');
  process.exit(1);
}

console.log('\n— APPLIQUÉ —');
console.log('  ' + total + ' remplacements. Syntaxe vérifiée, écriture relue sur le disque.');
console.log('  ' + tailleAvant + ' → ' + relu.length + ' octets.');
console.log('\n  À VÉRIFIER À L\'ÉCRAN — Signature électronique :');
console.log('    · le sélecteur « Tous les statuts » filtre la liste, et');
console.log('      affiche « 3 sur 12 » quand un filtre est actif ;');
console.log('    · « Signé le » n\'affiche plus les secondes ;');
console.log('    · un document annulé montre « — » dans Terme, plus un');
console.log('      champ de date modifiable ;');
console.log('    · les textes d\'aide vouvoient (nouvel espace camping,');
console.log('      import de contrat, dépôt de document, articles).');
console.log('');

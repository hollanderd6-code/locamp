#!/usr/bin/env node
/* ============================================================
   Facturation du mois : dire POURQUOI c'est ignoré
   ============================================================
   Cibles : backend/lib/facturation.js et backend/public/app.js

   Se termine en code 1 au moindre motif introuvable, relit le disque
   après écriture, et n'écrit qu'après avoir validé LES DEUX fichiers.

   ── LE PROBLÈME OBSERVÉ ──────────────────────────────────────────
   Un clic sur « Générer la facturation du mois » répond :

       Facturation 2026-08 : 0 créée(s), 2 ignorée(s)

   Et rien d'autre. Le gestionnaire ne sait pas s'il vient de rater
   une facturation ou si tout était déjà fait.

   ── CE QUE LE CODE COMPTE VRAIMENT ───────────────────────────────
   runFacturationMensuelle() incrémente le MÊME compteur `ignores`
   dans quatre situations qui n'ont rien à voir :

     1. le contrat commence après la fin de la période  → pas encore arrivé
     2. le contrat s'est terminé avant le début         → déjà parti
     3. une facture existe déjà pour cette période      → déjà facturé
     4. aucune ligne à facturer                         → RIEN N'EST CONFIGURÉ

   Les trois premières sont normales. La quatrième demande une action :
   ce résident n'a ni loyer sur sa fiche, ni modèle de facturation sur
   son emplacement. Il sera donc ignoré ce mois-ci, le mois prochain,
   et tous les suivants — sans que rien ne le signale. C'est du loyer
   qui n'est jamais facturé.

   Sur la capture, les 2 ignorés sont presque certainement le cas 3 :
   F-2026-00010 existe déjà pour 2026-08. Rien n'avait échoué — mais
   rien ne le disait non plus.

   ── CE QUE CE SCRIPT FAIT ────────────────────────────────────────
   Le lot renvoie désormais le détail par motif, et nomme les
   résidents du cas 4. Le message devient :

       Facturation août 2026 : aucune facture créée.
       2 déjà facturés.

   ou, quand il y a quelque chose à corriger :

       Facturation août 2026 : 3 factures créées.
       1 déjà facturé · 2 sans montant configuré

   et dans ce dernier cas une alerte séparée nomme les résidents
   concernés, parce que c'est la seule qui appelle une décision.

   ── AU PASSAGE : LA COLONNE PÉRIODE ──────────────────────────────
   La colonne affiche « 2026-08 » quand le sélecteur juste au-dessus
   écrit « août 2026 ». La même période, deux écritures, à trente
   pixels d'écart. periodeLabel() existe déjà côté serveur ; côté
   client rien ne le faisait.

   ── CE QUE JE N'AI PAS TOUCHÉ, ET QUI MÉRITE UNE DÉCISION ────────
   runFacturationResident() (bouton d'une fiche) crée un BROUILLON.
   runFacturationMensuelle() (ce bouton-ci) crée des factures ÉMISES,
   donc définitives : numérotées, entrées dans la chaîne fiscale,
   envoyées par e-mail au résident. Deux comportements pour la même
   opération. Émettre en masse sans relecture est un choix produit,
   pas un défaut — mais c'est un choix, et il n'est écrit nulle part.

   Usage :
     node outils/facturation-motifs.js --essai
     node outils/facturation-motifs.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const RACINE = process.cwd();
const F_LIB = path.join(RACINE, 'backend', 'lib', 'facturation.js');
const F_APP = path.join(RACINE, 'backend', 'public', 'app.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

for (const [f, q] of [[F_LIB, 'backend/lib/facturation.js'], [F_APP, 'backend/public/app.js']]) {
  if (!fs.existsSync(f)) {
    console.error('\n  \u2717 ' + q + ' introuvable. Lancez depuis la racine du dépôt.\n');
    process.exit(1);
  }
}

let lib = fs.readFileSync(F_LIB, 'utf8');
let app = fs.readFileSync(F_APP, 'utf8');
const tailleLib = lib.length, tailleApp = app.length;

if (lib.indexOf('res.motifs') !== -1) {
  console.log('\n  Déjà appliqué — rien à faire.\n');
  process.exit(0);
}

/* ══ 1. Le serveur compte par motif ═══════════════════════════ */
const editsLib = [

  ['lot : compteurs par motif',
`  const res = { periode, crees: 0, ignores: 0, erreurs: 0, factures: [] };
  for (const r of (residents || [])) {
    const c = parRes[r.id] || null;
    // hors période (entrée postérieure / départ antérieur) : rien à facturer
    if (c && c.date_debut && c.date_debut > end) { res.ignores++; continue; }
    if (c && c.date_fin && c.date_fin < start) { res.ignores++; continue; }

    const { data: existing } = await supabase.from('factures').select('id')
      .eq('camping_id', campingId).eq('resident_id', r.id).eq('periode', periode)
      .neq('statut', 'avoir').neq('statut', 'annulee').maybeSingle();
    if (existing) { res.ignores++; continue; }

    // Résout la config applicable (résident > modèle du logement) avant construction.
    r.facturation = resoudreFacturation(r, empMap[r.emplacement_id] || null, parametres);
    const lignes = buildLignes(c, r, periode, parametres);
    if (!lignes.length) { res.ignores++; continue; }`,

`  // « Ignoré » recouvrait quatre situations très différentes sous un seul
  // compteur : pas encore arrivé, déjà parti, déjà facturé, et rien de
  // configuré. Les trois premières sont normales ; la dernière est du loyer
  // qui ne sera JAMAIS facturé, silencieusement, tous les mois. On les sépare.
  const res = {
    periode, crees: 0, ignores: 0, erreurs: 0, factures: [],
    motifs: { non_arrives: 0, partis: 0, deja_facturees: 0, sans_montant: 0 },
    // Nommés : c'est le seul motif sur lequel le gestionnaire peut agir.
    sans_montant: [],
  };
  const ignorer = (motif) => { res.ignores++; res.motifs[motif]++; };

  for (const r of (residents || [])) {
    const c = parRes[r.id] || null;
    // hors période (entrée postérieure / départ antérieur) : rien à facturer
    if (c && c.date_debut && c.date_debut > end) { ignorer('non_arrives'); continue; }
    if (c && c.date_fin && c.date_fin < start) { ignorer('partis'); continue; }

    const { data: existing } = await supabase.from('factures').select('id')
      .eq('camping_id', campingId).eq('resident_id', r.id).eq('periode', periode)
      .neq('statut', 'avoir').neq('statut', 'annulee').maybeSingle();
    if (existing) { ignorer('deja_facturees'); continue; }

    // Résout la config applicable (résident > modèle du logement) avant construction.
    r.facturation = resoudreFacturation(r, empMap[r.emplacement_id] || null, parametres);
    const lignes = buildLignes(c, r, periode, parametres);
    if (!lignes.length) {
      ignorer('sans_montant');
      res.sans_montant.push({ id: r.id, nom: [r.prenom, r.nom].filter(Boolean).join(' ').trim() || null });
      continue;
    }`],

  /* Le nom du résident est nécessaire pour nommer les cas à corriger. */
  ['lot : charger le nom des résidents',
`  const { data: residents, error } = await supabase.from('residents')
    .select('id,foyer,facturation,emplacement_id').eq('camping_id', campingId).eq('actif', true);`,
`  // nom/prénom lus ici pour pouvoir NOMMER les résidents sans montant
  // configuré : un compteur seul n'aide pas à corriger.
  const { data: residents, error } = await supabase.from('residents')
    .select('id,nom,prenom,foyer,facturation,emplacement_id').eq('camping_id', campingId).eq('actif', true);`],
];

/* ══ 2. Le client dit ce qui s'est passé ══════════════════════ */
const editsApp = [

  ['message : le détail des motifs',
`    const r = await api('/api/factures/run-mensuel', { method: 'POST', body: { periode } });
    toast(\`Facturation \${r.periode} : \${r.crees} créée(s), \${r.ignores} ignorée(s)\`);
    route();`,
`    const r = await api('/api/factures/run-mensuel', { method: 'POST', body: { periode } });

    /* « 0 créée, 2 ignorée » n'apprend rien : le gestionnaire ne sait pas
       s'il a raté quelque chose ou si tout était déjà fait. On dit lequel. */
    const m = r.motifs || {};
    const details = [
      m.deja_facturees ? m.deja_facturees + ' déjà facturé' + (m.deja_facturees > 1 ? 's' : '') : '',
      m.non_arrives ? m.non_arrives + ' pas encore arrivé' + (m.non_arrives > 1 ? 's' : '') : '',
      m.partis ? m.partis + ' déjà parti' + (m.partis > 1 ? 's' : '') : '',
      m.sans_montant ? m.sans_montant + ' sans montant configuré' : '',
    ].filter(Boolean).join(' · ');

    const tete = r.crees
      ? r.crees + ' facture' + (r.crees > 1 ? 's' : '') + ' créée' + (r.crees > 1 ? 's' : '')
      : 'aucune facture créée';
    toast(\`Facturation \${moisFr(r.periode)} : \${tete}\${details ? '. ' + details + '.' : '.'}\`);

    /* Un résident sans loyer ni modèle de facturation sera ignoré ce mois-ci
       ET tous les suivants, sans que rien ne le signale : c'est du loyer qui
       ne rentre jamais. Le seul motif qui appelle une action est donc annoncé
       à part, et les résidents nommés. */
    const orphelins = r.sans_montant || [];
    if (orphelins.length) {
      const noms = orphelins.map((x) => x.nom).filter(Boolean);
      setTimeout(() => toast(
        (orphelins.length === 1 ? 'Aucun montant configuré pour ' : 'Aucun montant configuré pour ')
        + (noms.length ? noms.join(', ') : orphelins.length + ' résident(s)')
        + ' — ni loyer sur la fiche, ni modèle sur l\\u2019emplacement. Ils ne seront jamais facturés.',
        true), 600);
    }
    route();`],

  ['colonne Période en français',
   `<td class="muted">\${esc(f.periode || '—')}</td>`,
   `<td class="muted">\${f.periode ? esc(moisFr(f.periode)) : '—'}</td>`],

  ['moisFr : une période lisible',
`/* ---------- Factures ---------- */`,
`/* ---------- Factures ---------- */

/** « 2026-08 » → « août 2026 ». La colonne Période affichait la forme ISO
    alors que le sélecteur juste au-dessus écrit « août 2026 » : la même
    période, deux écritures, à trente pixels d'écart. */
const MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
function moisFr(p) {
  const m = String(p || '').match(/^(\\d{4})-(\\d{2})$/);
  if (!m) return String(p || '');
  return MOIS_FR[Number(m[2]) - 1] + ' ' + m[1];
}
`],
];

/* ══ Application ══════════════════════════════════════════════ */
function appliquer(src, edits, nom) {
  let n = 0;
  for (const [libelle, avant, apres] of edits) {
    const c = src.split(avant).length - 1;
    if (c !== 1) {
      console.error('\n  \u2717 ' + nom + ' — ' + libelle);
      console.error('      ' + c + ' occurrence(s), 1 attendue.');
      console.error('      Motif : ' + avant.split('\n')[0].trim().slice(0, 78));
      console.error('\n    AUCUN fichier écrit.\n');
      process.exit(1);
    }
    src = src.split(avant).join(apres);
    console.log('  ok  ' + nom + ' — ' + libelle);
    n += 1;
  }
  try {
    new Function(src);
  } catch (e) {
    console.error('\n  \u2717 ' + nom + ' serait invalide : ' + e.message);
    console.error('    AUCUN fichier écrit.\n');
    process.exit(1);
  }
  return { src, n };
}

// Les deux fichiers sont calculés et validés AVANT toute écriture : si le
// second échoue, le premier n'est pas laissé à moitié modifié.
const rLib = appliquer(lib, editsLib, 'facturation.js');
const rApp = appliquer(app, editsApp, 'app.js');

if (ESSAI) {
  console.log('\n— ESSAI —  ' + (rLib.n + rApp.n) + ' remplacements, syntaxe des deux fichiers vérifiée.');
  console.log('  Rien écrit. Relancez sans --essai pour appliquer.\n');
  process.exit(0);
}

fs.writeFileSync(F_LIB, rLib.src, 'utf8');
fs.writeFileSync(F_APP, rApp.src, 'utf8');

const reluLib = fs.readFileSync(F_LIB, 'utf8');
const reluApp = fs.readFileSync(F_APP, 'utf8');
if (reluLib.indexOf('res.motifs') === -1 || reluApp.indexOf('moisFr') === -1
    || reluLib.length === tailleLib || reluApp.length === tailleApp) {
  console.error('\n  \u2717 L\'écriture n\'a pas pris. Vérifiez les droits sur les fichiers.\n');
  process.exit(1);
}

console.log('\n— APPLIQUÉ —  ' + (rLib.n + rApp.n) + ' remplacements, écriture relue sur le disque.');
console.log('  facturation.js  ' + tailleLib + ' → ' + reluLib.length);
console.log('  app.js          ' + tailleApp + ' → ' + reluApp.length);
console.log('\n  À VÉRIFIER À L\'ÉCRAN — Factures :');
console.log('    · recliquez « Générer la facturation du mois » sur août :');
console.log('      le message doit dire « aucune facture créée. 2 déjà');
console.log('      facturés. » — et non plus « 0 créée(s), 2 ignorée(s) » ;');
console.log('    · la colonne Période affiche « août 2026 », comme le');
console.log('      sélecteur au-dessus ;');
console.log('    · si un résident actif n\'a ni loyer ni modèle, une seconde');
console.log('      alerte rouge le NOMME. C\'est le cas à corriger : sans');
console.log('      montant configuré, il ne sera jamais facturé.');
console.log('');

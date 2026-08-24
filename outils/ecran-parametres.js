#!/usr/bin/env node
/* ============================================================
   Écran Paramètres
   ============================================================
   Cible : backend/public/app.js

   Se termine en code 1 au moindre motif introuvable, relit le disque
   après écriture.

   ── 1. UN BLOC ENTIER ÉCRIT SANS ACCENTS ─────────────────────────
       Facturation electronique      Non connectee
       Plateforme agreee             la transmission reglementaire
       Reforme : reception obligatoire, emission/e-reporting

   Toute la carte de facturation électronique est écrite sans accents,
   au milieu d'une interface qui en porte partout ailleurs. Sur l'écran
   qui prépare une obligation légale, ça ne fait pas sérieux.

   Les VALEURS de statut — 'connecte', 'connectee' — ne sont pas
   touchées : ce sont des données échangées avec le serveur, les
   accentuer casserait la comparaison. Le script le vérifie avant
   d'écrire.

   ── 2. LE SIRET N'EST PAS VALIDÉ ─────────────────────────────────
   Le champ affiche 504537713 : neuf chiffres. C'est un SIREN, pas un
   SIRET — il en faut quatorze.

   Ce n'est pas cosmétique. Le SIRET est une mention obligatoire sur
   une facture (art. L441-9 du code de commerce), et c'est lui qui
   déclenche Factur-X : app.js ne propose les boutons « Factur-X » et
   « Envoyer à la PA » que si `r.siret` existe. Un SIRET tronqué
   produit des factures que la plateforme agréée rejettera.

   Le champ compte les chiffres à la saisie et le dit — sans bloquer :
   un camping en cours d'immatriculation doit pouvoir enregistrer le
   reste de sa fiche.

   ── 3. L'ENVOI AUTOMATIQUE EST ACTIF SANS EXPÉDITEUR ─────────────
   « Envoi auto de la facture : Activé » est la valeur par défaut
   (email_auto !== false), et « Expéditeur e-mail » est vide.

   Les factures partent donc avec l'expéditeur de repli du serveur —
   une adresse que le résident ne reconnaît pas, et qui atterrit en
   indésirable ou fait douter de la légitimité du message. Personne
   n'est prévenu.

   Un avertissement s'affiche quand l'envoi est actif sans expéditeur.

   ── 4. LA TVA À 0 % PAR DÉFAUT, ENCORE ───────────────────────────
   Le formulaire d'ajout au catalogue naît avec « TVA (%) : 0 ». Même
   défaut que le tiroir de facture, corrigé la semaine dernière : sur
   une facture française, 0 % est un régime particulier qui exige une
   mention légale.

   Le taux part maintenant de celui configuré juste au-dessus, dans
   Facturation.

   Usage :
     node outils/ecran-parametres.js --essai
     node outils/ecran-parametres.js
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

if (src.indexOf('majSiretInfo') !== -1) {
  console.log('\n  Déjà appliqué — rien à faire.\n');
  process.exit(0);
}

/* Combien de valeurs de statut existent AVANT : elles ne doivent pas bouger. */
const statutsAvant = (src.match(/'connecte'|'connectee'|=== 'connecte/g) || []).length;

/* ── 1. Les accents ────────────────────────────────────────────── */
const ACCENTS = [
  ['Facturation electronique', 'Facturation électronique'],
  ['facturation electronique', 'facturation électronique'],
  ['Plateforme agreee', 'Plateforme agréée'],
  ['plateforme agreee', 'plateforme agréée'],
  ['Non connectee<', 'Non connectée<'],
  ['Connectee &mdash;', 'Connectée &mdash;'],
  ['reglementaire', 'réglementaire'],
  ['Reforme :', 'Réforme :'],
  ['reception obligatoire', 'réception obligatoire'],
  ['emission/e-reporting', 'émission/e-reporting'],
  ["Deconnecter la plateforme agréée ?", "Déconnecter la plateforme agréée ?"],
  ["n'est pas reconnectee", "n'est pas reconnectée"],
  ["{ ok: 'Deconnecter', danger: true }", "{ ok: 'Déconnecter', danger: true }"],
  ["toast('Plateforme deconnectee')", "toast('Plateforme déconnectée')"],
];

let nAccents = 0;
for (const [avant, apres] of ACCENTS) {
  const n = src.split(avant).length - 1;
  if (!n) continue;
  src = src.split(avant).join(apres);
  nAccents += n;
}
console.log('  ok  accents rétablis : ' + nAccents + ' occurrence(s)');

const statutsApres = (src.match(/'connecte'|'connectee'|=== 'connecte/g) || []).length;
if (statutsAvant !== statutsApres) {
  console.error('\n  \u2717 Une valeur de statut a été modifiée (' + statutsAvant + ' → ' + statutsApres + ').');
  console.error('    Ces chaînes sont comparées au serveur : les accentuer casserait');
  console.error('    la détection de connexion. AUCUNE écriture.\n');
  process.exit(1);
}

/* ── 2, 3, 4 : les champs ──────────────────────────────────────── */
const edits = [

  ['SIRET : compter les chiffres',
`        <label>SIRET<input name="siret" value="\${esc(c.siret || '')}"></label>`,
`        <label>SIRET<input name="siret" id="cfg-siret" value="\${esc(c.siret || '')}" inputmode="numeric"
          placeholder="14 chiffres" title="Mention obligatoire sur vos factures (art. L441-9 du code de commerce). C'est aussi lui qui déclenche Factur-X.">
          <span id="cfg-siret-info" class="muted" style="display:block;font-size:12px;margin-top:3px"></span></label>`],

  ['envoi automatique : avertir si l\'expéditeur manque',
`        <label>Expéditeur e-mail<input name="email_exp" type="email" value="\${esc(fp.email || '')}"></label>`,
`        <label>Expéditeur e-mail<input name="email_exp" id="cfg-exp" type="email" value="\${esc(fp.email || '')}"
          placeholder="contact@votre-camping.fr"
          title="L'adresse qui apparaît comme expéditeur des factures. Sans elle, le serveur utilise une adresse de repli que vos résidents ne reconnaissent pas.">
          <span id="cfg-exp-info" class="muted" style="display:block;font-size:12px;margin-top:3px"></span></label>`],

  ['catalogue : TVA reprise des paramètres',
`  const fp = p.facturation || {};`,
`  const fp = (p.facturation) || {};
  /* Le formulaire du catalogue naissait avec « TVA : 0 » — même défaut que le
     tiroir de facture. Sur une facture française, 0 % est un régime
     particulier qui exige une mention légale, pas une absence de taux. */
  const tvaDefaut = Number(fp.tva_taux_loyer || 0);`],
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

/* Le champ TVA du catalogue : on ne connaît pas sa forme exacte, on la cherche. */
const TVA_CAT = `<label>TVA (%)<input name="taux_tva" type="number" step="0.1" value="0"></label>`;
if (src.split(TVA_CAT).length - 1 === 1) {
  src = src.split(TVA_CAT).join(
    `<label>TVA (%)<input name="taux_tva" type="number" step="0.1" value="\${tvaDefaut}"
          title="Taux repris de Facturation ci-dessus. Modifiable pour cet article."></label>`);
  console.log('  ok  catalogue : champ TVA initialisé au taux configuré');
} else {
  console.error('\n  \u2717 Champ TVA du catalogue introuvable. AUCUNE écriture.\n');
  process.exit(1);
}

/* ── Les deux contrôles vivants ────────────────────────────────── */
const CONTROLES = `
  /* Le SIRET compte quatorze chiffres. Le champ en affichait neuf — un SIREN —
     sans que rien ne le signale, alors que c'est une mention obligatoire des
     factures et le déclencheur de Factur-X. On informe sans bloquer : un
     camping en cours d'immatriculation doit pouvoir enregistrer le reste. */
  const majSiretInfo = () => {
    const ch = $('#cfg-siret'); const info = $('#cfg-siret-info');
    if (!ch || !info) return;
    const n = String(ch.value || '').replace(/\\D/g, '').length;
    if (!n) { info.textContent = ''; info.style.color = ''; return; }
    if (n === 14) { info.textContent = '14 chiffres — format valide.'; info.style.color = 'var(--sapin)'; return; }
    info.style.color = 'var(--laiton)';
    info.textContent = n === 9
      ? '9 chiffres : c\\u2019est un SIREN. Le SIRET en compte 14 (SIREN + 5 chiffres d\\u2019établissement). '
        + 'Sans SIRET complet, la facturation électronique sera refusée.'
      : n + ' chiffre' + (n > 1 ? 's' : '') + ' sur les 14 attendus.';
  };
  $('#cfg-siret')?.addEventListener('input', majSiretInfo);
  majSiretInfo();

  /* Envoi automatique actif sans expéditeur : les factures partent avec
     l'adresse de repli du serveur, que le résident ne reconnaît pas. */
  const majExpInfo = () => {
    const ch = $('#cfg-exp'); const info = $('#cfg-exp-info');
    if (!ch || !info) return;
    const auto = document.querySelector('[name="email_auto"]')?.value !== 'false';
    if (auto && !String(ch.value || '').trim()) {
      info.style.color = 'var(--laiton)';
      info.textContent = 'L\\u2019envoi automatique est actif mais aucun expéditeur n\\u2019est défini : '
        + 'vos factures partiront depuis une adresse que vos résidents ne reconnaîtront pas.';
    } else { info.textContent = ''; info.style.color = ''; }
  };
  $('#cfg-exp')?.addEventListener('input', majExpInfo);
  document.querySelector('[name="email_auto"]')?.addEventListener('change', majExpInfo);
  majExpInfo();
`;

/* Posés à la fin de la vue, après le rendu. On s'ancre sur le dernier
   addEventListener de la fonction de rendu des paramètres. */
const ANCRE = src.indexOf('if ($(\'#logo-file\')');
if (ANCRE === -1) {
  /* Repli : juste après l'insertion du HTML de la vue. */
  const a2 = src.indexOf('renderEfactureCard(');
  if (a2 === -1) {
    console.error('\n  \u2717 Impossible de situer la fin de la vue Paramètres. AUCUNE écriture.\n');
    process.exit(1);
  }
  const finLigne = src.indexOf('\n', src.indexOf(';', a2));
  src = src.slice(0, finLigne + 1) + CONTROLES + src.slice(finLigne + 1);
} else {
  src = src.slice(0, ANCRE) + CONTROLES + '\n  ' + src.slice(ANCRE);
}
console.log('  ok  contrôles SIRET et expéditeur posés');

try {
  new Function(src);
} catch (e) {
  console.error('\n  \u2717 app.js serait invalide : ' + e.message + '\n    AUCUNE écriture.\n');
  process.exit(1);
}

const restes = [];
['Facturation electronique', 'Non connectee', 'plateforme agreee', 'reglementaire', 'Reforme']
  .forEach((m) => { if (src.indexOf(m) !== -1) restes.push(m); });
if (restes.length) {
  console.error('\n  \u2717 Texte non accentué restant : ' + restes.join(', '));
  console.error('    AUCUNE écriture.\n');
  process.exit(1);
}

if (ESSAI) {
  console.log('\n— ESSAI —  ' + (total + nAccents) + ' modifications, syntaxe vérifiée. Rien écrit.');
  console.log('  Relancez sans --essai pour appliquer.\n');
  process.exit(0);
}

fs.writeFileSync(CIBLE, src, 'utf8');
const relu = fs.readFileSync(CIBLE, 'utf8');
if (relu.indexOf('majSiretInfo') === -1 || relu.length === tailleAvant) {
  console.error('\n  \u2717 L\'écriture n\'a pas pris. Vérifiez les droits sur le fichier.\n');
  process.exit(1);
}

console.log('\n— APPLIQUÉ —  ' + total + ' remplacements + ' + nAccents + ' accents.');
console.log('  Écriture relue : ' + tailleAvant + ' → ' + relu.length + ' octets.');
console.log('\n  À VÉRIFIER À L\'ÉCRAN — Paramètres :');
console.log('    · la carte de facturation électronique est accentuée ;');
console.log('    · le SIRET 504537713 affiche « 9 chiffres : c\'est un SIREN »,');
console.log('      en miel — sans empêcher l\'enregistrement ;');
console.log('    · un SIRET complet affiche « 14 chiffres — format valide » ;');
console.log('    · l\'expéditeur vide, avec envoi auto activé, affiche un');
console.log('      avertissement ;');
console.log('    · le champ TVA du catalogue part à 10, plus à 0.');
console.log('\n  DEUX POINTS À VÉRIFIER DE VOTRE CÔTÉ');
console.log('    1. Votre SIRET fait 9 chiffres. Les factures émises portent');
console.log('       donc un identifiant incomplet — mention obligatoire, et');
console.log('       la plateforme agréée les refusera. À compléter avec les');
console.log('       5 chiffres de l\'établissement.');
console.log('    2. Le prix du m³ d\'eau est vide alors que la TVA eau est');
console.log('       renseignée : les relevés d\'eau sont enregistrés mais ne');
console.log('       créent aucune charge. C\'est ce que signale déjà l\'écran');
console.log('       Compteurs.');
console.log('\n  RESTE À DÉCIDER');
console.log('    Six boutons « Enregistrer » distincts sur cette page, un par');
console.log('    section. Modifier la TVA loyer ET le prix du kWh demande deux');
console.log('    clics à deux endroits — et quitter la page en n\'en ayant');
console.log('    cliqué qu\'un perd l\'autre, sans un mot.');
console.log('');

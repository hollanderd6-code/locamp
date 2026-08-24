#!/usr/bin/env node
/* ============================================================
   Paramètres : ne plus perdre une modification en silence
   ============================================================
   Cible : backend/public/app.js
   Prérequis : outils/ecran-parametres.js appliqué.

   Se termine en code 1 au moindre motif introuvable, relit le disque
   après écriture.

   ── LA QUESTION POSÉE : FAUT-IL UN SEUL BOUTON ? ─────────────────
   Non. Les six sections sont six domaines indépendants, enregistrés
   par des appels distincts. Un bouton unique renverrait le SIRET, le
   logo et le catalogue à chaque changement de TVA — et une erreur sur
   une section ferait échouer les cinq autres.

   Le défaut n'est pas le nombre de boutons. C'est qu'une modification
   non enregistrée disparaît sans un mot : on change la TVA loyer, on
   descend régler le prix du kWh, on clique sur « Enregistrer
   l'énergie », on quitte — et la TVA est perdue. Rien ne l'a signalé.

   ── CE QUE FAIT CE SCRIPT ────────────────────────────────────────
   Chaque formulaire retient l'état de ses champs au chargement. Dès
   qu'un champ s'écarte de cet état :

     · son bouton d'enregistrement se teinte et affiche « • » ;
     · quitter la page, ou changer d'écran, demande confirmation.

   Le repère est posé sur le bouton de la section concernée, pas dans
   une barre globale : c'est là que le regard va, et c'est là qu'est
   le geste à faire.

   L'état est relevé APRÈS le rendu, sur les valeurs réellement
   présentes dans le DOM. Comparer aux données du serveur donnerait de
   fausses alertes : un champ vide côté serveur et un champ vide à
   l'écran ne sont pas toujours la même chaîne.

   ── CE QUI N'EST PAS COUVERT, ET POURQUOI ────────────────────────
   Le champ de fichier du logo n'est pas surveillé : un fichier choisi
   mais non téléversé ne se compare pas à un état initial, et le
   navigateur interdit d'en lire la valeur. Le bouton « Téléverser »
   reste le seul chemin.

   Usage :
     node outils/parametres-modifications.js --essai
     node outils/parametres-modifications.js
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

if (src.indexOf('surveillerModifs') !== -1) {
  console.log('\n  Déjà appliqué — rien à faire.\n');
  process.exit(0);
}
if (src.indexOf('majSiretInfo') === -1) {
  console.error('\n  \u2717 Appliquez d\'abord outils/ecran-parametres.js.\n');
  process.exit(1);
}

const SURVEILLANCE = `
  /* ---- Modifications non enregistrées ----------------------------
     Six sections, six boutons : c'est volontaire — ce sont six domaines
     indépendants, et un bouton unique renverrait tout à chaque fois.
     Le défaut était ailleurs : une modification non enregistrée
     disparaissait sans un mot.

     Chaque formulaire retient l'état de ses champs au chargement ; dès
     qu'un champ s'en écarte, son bouton le dit et quitter demande
     confirmation. */
  const surveillerModifs = () => {
    const formulaires = [...document.querySelectorAll('#main form')];
    if (!formulaires.length) return;

    /* L'empreinte est relevée sur le DOM, pas sur les données du serveur :
       un champ vide côté serveur et un champ vide à l'écran ne sont pas
       toujours la même chaîne, ce qui produirait de fausses alertes. */
    const empreinte = (f) => [...f.elements]
      .filter((el) => el.name && el.type !== 'file' && el.type !== 'submit' && el.type !== 'button')
      .map((el) => el.name + '=' + (el.type === 'checkbox' ? el.checked : el.value))
      .join('\\u0001');

    formulaires.forEach((f) => {
      f.dataset.etatInitial = empreinte(f);

      const majRepere = () => {
        const modifie = empreinte(f) !== f.dataset.etatInitial;
        f.dataset.modifie = modifie ? '1' : '';
        const btn = f.querySelector('button.btn-primary');
        if (!btn) return;
        if (!btn.dataset.libelle) btn.dataset.libelle = btn.textContent.trim();
        btn.textContent = modifie ? '\\u2022 ' + btn.dataset.libelle : btn.dataset.libelle;
        btn.style.boxShadow = modifie ? '0 0 0 3px rgba(185,138,60,.30)' : '';
        btn.title = modifie ? 'Modifications non enregistrées dans cette section.' : '';
      };

      f.addEventListener('input', majRepere);
      f.addEventListener('change', majRepere);
      /* Après un envoi réussi la vue est rechargée : l'empreinte repart de
         zéro. On remet quand même le repère à plat tout de suite, pour que
         le bouton ne reste pas marqué le temps de l'aller-retour réseau. */
      f.addEventListener('submit', () => {
        f.dataset.etatInitial = empreinte(f);
        f.dataset.modifie = '';
        majRepere();
      });
    });

    const sectionsModifiees = () => [...document.querySelectorAll('#main form[data-modifie="1"]')]
      .map((f) => (f.closest('.card')?.querySelector('h2')?.textContent || '').trim())
      .filter(Boolean);

    /* Fermeture d'onglet ou rechargement : le navigateur impose son propre
       texte, on ne peut que demander l'arrêt. */
    const avantFermeture = (e) => {
      if (!sectionsModifiees().length) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', avantFermeture);

    /* Navigation interne : là on peut nommer les sections concernées.
       En capture, pour intercepter le clic avant que le routeur ne parte. */
    const avantNavigation = async (e) => {
      const lien = e.target.closest?.('a[href^="#/"]');
      if (!lien) return;
      const noms = sectionsModifiees();
      if (!noms.length) return;
      e.preventDefault();
      e.stopPropagation();
      const liste = noms.map((n) => '\\u2022 ' + n).join('\\n');
      const ok = await askConfirm(
        'Quitter sans enregistrer ?\\n\\n'
        + 'Ces sections ont des modifications non enregistrées :\\n' + liste
        + '\\n\\nChaque section a son propre bouton « Enregistrer » : les '
        + 'modifications seront perdues.',
        { ok: 'Quitter sans enregistrer', danger: true }
      );
      if (!ok) return;
      document.removeEventListener('click', avantNavigation, true);
      window.removeEventListener('beforeunload', avantFermeture);
      location.hash = lien.getAttribute('href');
    };
    document.addEventListener('click', avantNavigation, true);

    /* La surveillance ne vaut que pour cet écran : en changeant de vue, on
       la retire, sinon elle avertirait sur des formulaires disparus. */
    const nettoyer = () => {
      if (location.hash.startsWith('#/parametres')) return;
      document.removeEventListener('click', avantNavigation, true);
      window.removeEventListener('beforeunload', avantFermeture);
      window.removeEventListener('hashchange', nettoyer);
    };
    window.addEventListener('hashchange', nettoyer);
  };
  surveillerModifs();
`;

/* On s'ancre après les contrôles posés par le script précédent. */
const ANCRE = '  majExpInfo();\n';
if (src.split(ANCRE).length - 1 !== 1) {
  console.error('\n  \u2717 Point d\'ancrage introuvable (majExpInfo).');
  console.error('    Le fichier a changé. AUCUNE écriture.\n');
  process.exit(1);
}
src = src.split(ANCRE).join(ANCRE + SURVEILLANCE);
console.log('  ok  surveillance des modifications posée');

try {
  new Function(src);
} catch (e) {
  console.error('\n  \u2717 app.js serait invalide : ' + e.message + '\n    AUCUNE écriture.\n');
  process.exit(1);
}
if (!/askConfirm/.test(src)) {
  console.error('\n  \u2717 askConfirm introuvable. AUCUNE écriture.\n');
  process.exit(1);
}

if (ESSAI) {
  console.log('\n— ESSAI —  syntaxe vérifiée. Rien écrit.');
  console.log('  Relancez sans --essai pour appliquer.\n');
  process.exit(0);
}

fs.writeFileSync(CIBLE, src, 'utf8');
const relu = fs.readFileSync(CIBLE, 'utf8');
if (relu.indexOf('surveillerModifs') === -1 || relu.length === tailleAvant) {
  console.error('\n  \u2717 L\'écriture n\'a pas pris. Vérifiez les droits sur le fichier.\n');
  process.exit(1);
}

console.log('\n— APPLIQUÉ —');
console.log('  Écriture relue : ' + tailleAvant + ' → ' + relu.length + ' octets.');
console.log('\n  LE TEST QUI COMPTE — Paramètres :');
console.log('    1. changez la TVA loyer de 10 à 20, sans enregistrer ;');
console.log('    2. le bouton « Enregistrer la facturation » se marque');
console.log('       d\'un point et prend un halo ;');
console.log('    3. cliquez sur « Tableau de bord » dans le menu :');
console.log('       une confirmation nomme la section concernée ;');
console.log('    4. « Annuler » vous laisse sur place, la modification');
console.log('       intacte.');
console.log('\n  AUTRES VÉRIFICATIONS');
console.log('    · enregistrer une section fait disparaître son repère ;');
console.log('    · quitter sans rien avoir modifié ne demande rien ;');
console.log('    · modifier deux sections les nomme toutes les deux ;');
console.log('    · une fois sur un autre écran, plus aucun avertissement');
console.log('      ne se déclenche.');
console.log('\n  NON COUVERT, VOLONTAIREMENT');
console.log('    Le champ de fichier du logo : un fichier choisi mais non');
console.log('    téléversé ne se compare à aucun état initial, et le');
console.log('    navigateur interdit d\'en lire la valeur.');
console.log('');

#!/usr/bin/env node
/* ============================================================
   outils/deconnexion-confirmation.js
   Se deconnecter : demander confirmation
   ============================================================
   Cible : backend/public/app.js

   ── CE QUI MANQUAIT ─────────────────────────────────────────────
   « Se deconnecter » partait au premier clic, sans un mot. Le bouton
   est en bas de la barre laterale, juste sous le nom de l'utilisateur
   et a cote de la cloche : un clic de travers renvoyait a l'ecran de
   connexion, en perdant la saisie en cours — une tournee de compteurs
   a moitie tapee, un message pas encore envoye.

   ── CE QUE FAIT CE CORRECTIF ────────────────────────────────────
   Une confirmation avant de deconnecter. Elle previent aussi quand le
   plan comporte des modifications non enregistrees — la meme garde qui
   existe deja quand on quitte la carte par la navigation, et qui ne
   jouait pas ici.

   Detail d'implementation : deux endroits attachent un ecouteur au
   bouton (le second, dans le module de notifications push, remplace le
   bouton pour desinscrire le jeton avant de partir). Les deux passent
   desormais par demanderDeconnexion, sinon la confirmation serait
   ignoree selon l'ordre de chargement.

   Usage :
     node outils/deconnexion-confirmation.js --essai
     node outils/deconnexion-confirmation.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'backend', 'public', 'app.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

function NOUVEAU_CODE() {
  /* Se deconnecter est irreversible pour la saisie en cours : on demande.
     window.logout est enveloppee plus loin par le module push (pour
     desinscrire le jeton) — on appelle donc toujours la version courante,
     jamais une reference capturee. */
  window.demanderDeconnexion = async () => {
    const carteSale = typeof carteState !== 'undefined' && carteState
      && carteState.mode === 'edit'
      && (carteState.dirty.size + carteState.dirtyElems.size) > 0;

    const ok = await askConfirm(
      carteSale
        ? 'Le plan comporte des modifications non enregistrées : elles seront perdues.\n\nSe déconnecter quand même ?'
        : 'Se déconnecter de Locamp ?',
      { titre: 'Déconnexion', ok: 'Se déconnecter', danger: !!carteSale }
    );
    if (!ok) return;
    (window.logout || logout)();
  };
}

if (!fs.existsSync(CIBLE)) echec('backend/public/app.js introuvable. Lancez depuis la racine du projet.');
let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('window.demanderDeconnexion') !== -1) {
  console.log('\n  La confirmation de deconnexion existe deja — rien a faire.\n');
  process.exit(0);
}
if (src.indexOf('window.askConfirm') === -1) echec('askConfirm est introuvable — la confirmation en depend.');

/* 1. La fonction, juste apres logout(). */
const ANCRE = 'async function boot() {';
if (src.split(ANCRE).length - 1 !== 1) echec('L\'ancre de boot() est introuvable ou dupliquee.');

const CODE = NOUVEAU_CODE.toString()
  .replace(/^function NOUVEAU_CODE\(\)\s*\{\r?\n/, '')
  .replace(/\}\s*$/, '')
  .replace(/^ {2}/gm, '');

src = src.replace(ANCRE, CODE.replace(/\s*$/, '\n') + '\n' + ANCRE);

/* 2. Les deux ecouteurs du bouton. */
const E1 = "$('#logout-btn').addEventListener('click', logout);";
const E1_NEUF = "$('#logout-btn').addEventListener('click', demanderDeconnexion);";
if (src.split(E1).length - 1 !== 1) echec('L\'ecouteur principal du bouton de deconnexion est introuvable.');
src = src.split(E1).join(E1_NEUF);

const E2 = "document.getElementById('logout-btn').addEventListener('click', window.logout);";
const E2_NEUF = "document.getElementById('logout-btn').addEventListener('click', window.demanderDeconnexion);";
if (src.split(E2).length - 1 !== 1) echec('L\'ecouteur pose par le module push est introuvable.');
src = src.split(E2).join(E2_NEUF);

try { new Function(src); }
catch (e) { echec('Le resultat n\'est pas du JavaScript valide — ' + e.message); }

for (const [quoi, aiguille] of [
  ['la confirmation', 'window.demanderDeconnexion'],
  ['l\'ecouteur principal', E1_NEUF],
  ['l\'ecouteur du module push', E2_NEUF],
  ['la garde du plan non enregistre', 'carteSale'],
]) if (src.indexOf(aiguille) === -1) echec(`Verification : ${quoi} est absent du resultat.`);

if (src.indexOf(E1) !== -1 || src.indexOf(E2) !== -1) echec('Un ancien ecouteur subsiste.');

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('window.demanderDeconnexion') === -1) echec('L\'ajout est absent apres ecriture.');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  « Se deconnecter » demande confirmation.');
console.log('  Si le plan a des modifications non enregistrees, la confirmation le dit.');
console.log('  Les deux ecouteurs du bouton passent par la meme confirmation.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

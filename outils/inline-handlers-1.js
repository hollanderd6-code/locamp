#!/usr/bin/env node
/* ============================================================
   Retirer les gestionnaires inline — étape 1
   ============================================================
   Cible : backend/public/app.js

   ── POURQUOI ─────────────────────────────────────────────────────
   Le front écrit 137 gestionnaires directement dans le HTML :

       onclick="voirDoc('${d.id}')"

   C'est ce qui oblige server.js à déclarer, dans la politique de
   sécurité du contenu :

       scriptSrc:     [... "'unsafe-inline'" ...]
       scriptSrcAttr: ["'unsafe-inline'"]

   Autrement dit : le navigateur a le droit d'exécuter n'importe quel
   script écrit dans la page. Le CSP est le filet qui rattrape une
   injection passée entre les mailles de l'échappement — ici le filet
   est troué par construction. Sur une application qui stocke des
   pièces d'identité et des coordonnées bancaires, c'est la seule
   faiblesse structurelle du front.

   Le reste du fichier est sain : aucune fonction dupliquée, esc()
   appelé 250 fois, et les rares interpolations non échappées sont
   des nombres.

   ── LA MÉTHODE ───────────────────────────────────────────────────
   Chaque gestionnaire devient une intention déclarée :

       onclick="voirDoc('${d.id}')"
       →  data-act="voirDoc" data-a1="${d.id}"

   Un seul écouteur, posé sur le document, lit l'intention et appelle
   la fonction. Un attribut par argument, plutôt qu'un JSON : les
   valeurs restent échappées exactement comme aujourd'hui, et un nom
   contenant une apostrophe ne casse rien.

   ── CE QUE CE SCRIPT NE TOUCHE PAS ───────────────────────────────
   Les 19 expressions complexes — plusieurs appels enchaînés, `this`,
   `event`, `location.hash=` — sont laissées en place et listées à la
   fin. Les convertir mécaniquement casserait des boutons ; elles
   demandent chacune une décision. Le CSP ne pourra être durci qu'une
   fois ces 19 traitées : ce script fait 86 % du chemin, pas 100 %.

   Usage :
     node outils/inline-handlers-1.js --essai
     node outils/inline-handlers-1.js
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

if (src.indexOf('data-act') !== -1) {
  console.log('\n  Déjà appliqué — rien à faire.\n');
  process.exit(0);
}

/* Découpe les arguments d'un appel au premier niveau : les virgules
   à l'intérieur d'une chaîne ou d'une interpolation ne comptent pas. */
function decouperArgs(s) {
  const out = [];
  let cur = '', prof = 0, quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      cur += c;
      if (c === quote && s[i - 1] !== '\\') quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; cur += c; continue; }
    if (c === '(' || c === '[' || c === '{') prof++;
    if (c === ')' || c === ']' || c === '}') prof--;
    if (c === ',' && prof === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const RE = /on(click|change|input|submit|blur|focus)\s*=\s*(["'])((?:(?!\2)[\s\S])*)\2/g;

const convertis = [];
const laisses = [];
const fonctions = new Set();

src = src.replace(RE, (tout, evt, q, code) => {
  const c = code.trim().replace(/;$/, '').trim();
  const m = c.match(/^([A-Za-z_$][\w$]*)\s*\(([\s\S]*)\)$/);

  // Pas un simple appel de fonction nommée : on laisse.
  if (!m) { laisses.push({ evt, code: c, raison: 'pas un appel simple' }); return tout; }

  const nom = m[1];
  const brut = m[2].trim();

  // `this`, `event`, appels enchaînés, opérateurs : on laisse.
  if (/\bthis\b|\bevent\b|=>|;/.test(c)) {
    laisses.push({ evt, code: c, raison: 'utilise this/event ou enchaîne' });
    return tout;
  }

  const args = brut ? decouperArgs(brut) : [];

  // Un argument doit être une chaîne littérale (éventuellement avec
  // interpolation). Un nombre ou un booléen arriverait en chaîne côté
  // écouteur et changerait le comportement : on ne prend pas le risque.
  const valeurs = [];
  for (const a of args) {
    const s = a.match(/^'([\s\S]*)'$/) || a.match(/^"([\s\S]*)"$/) || a.match(/^`([\s\S]*)`$/);
    if (!s) { valeurs.push(null); break; }
    valeurs.push(s[1]);
  }
  if (valeurs.length !== args.length || valeurs.includes(null)) {
    laisses.push({ evt, code: c, raison: 'argument non littéral' });
    return tout;
  }

  fonctions.add(nom);
  convertis.push({ evt, nom, args: valeurs.length });

  let out = 'data-act="' + nom + '"';
  if (evt !== 'click') out += ' data-evt="' + evt + '"';
  valeurs.forEach((v, i) => { out += ' data-a' + (i + 1) + '="' + v + '"'; });
  return out;
});

/* ── L'écouteur unique ────────────────────────────────────────── */
const ECOUTEUR = `
/* ============================================================
   Actions déclarées — un seul écouteur pour toute l'application
   ============================================================
   Le HTML ne contient plus « onclick="voirDoc('…')" » mais
   « data-act="voirDoc" data-a1="…" ». Un écouteur posé sur le
   document lit l'intention et appelle la fonction.

   Ce n'est pas une préférence de style : tant qu'un attribut
   onclick existe dans la page, la politique de sécurité doit
   autoriser 'unsafe-inline', et n'est donc plus un filet contre
   l'injection de script. C'est ce que ce mécanisme permet de
   retirer.

   Ajouter une action : écrire la fonction, poser data-act sur le
   bouton. Rien à enregistrer.
   ============================================================ */
(function () {
  function lireArgs(el) {
    const out = [];
    for (let i = 1; i <= 6; i++) {
      const v = el.getAttribute('data-a' + i);
      if (v === null) break;
      out.push(v);
    }
    return out;
  }

  function executer(el, evt) {
    const nom = el.getAttribute('data-act');
    const fn = window[nom];
    if (typeof fn !== 'function') {
      // Un bouton qui ne fait rien en silence est pire qu'une erreur :
      // on le dit, pour que ça se voie en test et pas en production.
      console.error('[action] fonction introuvable : ' + nom, el);
      return;
    }
    try { fn.apply(el, lireArgs(el)); }
    catch (e) { console.error('[action] ' + nom, e); }
  }

  document.addEventListener('click', function (e) {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    // Les éléments qui déclarent un autre événement ne réagissent pas au clic.
    if (el.getAttribute('data-evt')) return;
    if (el.tagName === 'A' && el.getAttribute('href')) e.preventDefault();
    executer(el, e);
  });

  // change / input / submit : même mécanisme, en capture pour attraper
  // les éléments créés après coup.
  ['change', 'input', 'submit'].forEach(function (type) {
    document.addEventListener(type, function (e) {
      const el = e.target.closest('[data-act][data-evt="' + type + '"]');
      if (!el) return;
      if (type === 'submit') e.preventDefault();
      executer(el, e);
    }, true);
  });
})();
`;

// L'écouteur se place en tête : il doit exister avant tout rendu.
const iEntete = src.indexOf('\n', src.lastIndexOf('*/', src.indexOf('\n\n')));
src = (iEntete > 0 && iEntete < 2000)
  ? src.slice(0, iEntete + 1) + ECOUTEUR + src.slice(iEntete + 1)
  : ECOUTEUR + src;

/* ── Contrôles ────────────────────────────────────────────────── */
// Chaque fonction appelée doit exister dans le fichier.
const introuvables = [...fonctions].filter((n) => {
  const re = new RegExp('(?:^|\\n)\\s*(?:async\\s+)?function\\s+' + n + '\\b|window\\.' + n + '\\s*=|(?:const|let|var)\\s+' + n + '\\s*=');
  return !re.test(src);
});

try {
  new Function(src);
} catch (e) {
  console.error('\n  \u2717 app.js serait invalide : ' + e.message);
  console.error('    Rien n\'a été écrit.\n');
  process.exit(1);
}

if (introuvables.length) {
  console.error('\n  \u2717 ' + introuvables.length + ' fonction(s) appelée(s) mais introuvable(s) :');
  introuvables.forEach((n) => console.error('      ' + n));
  console.error('    Le bouton serait mort. Rien n\'a été écrit.\n');
  process.exit(1);
}

if (!ESSAI) fs.writeFileSync(CIBLE, src, 'utf8');

const restants = (src.match(/\son(?:click|change|input|submit|blur|focus)\s*=/g) || []).length;

console.log('\n' + (ESSAI ? '— ESSAI, aucune écriture —' : '— APPLIQUÉ —'));
console.log('  Convertis .................. ' + convertis.length);
console.log('  Laissés en place ........... ' + laisses.length);
console.log('  Fonctions concernées ....... ' + fonctions.size + ', toutes trouvées dans le fichier');
console.log('  Gestionnaires inline restants ' + restants);
console.log('\n  Syntaxe vérifiée.');

if (laisses.length) {
  console.log('\n  À TRAITER À LA MAIN — ces ' + laisses.length + ' cas ne se convertissent pas');
  console.log('  mécaniquement sans risquer de casser le bouton :\n');
  const parRaison = {};
  laisses.forEach((l) => { (parRaison[l.raison] = parRaison[l.raison] || []).push(l.code); });
  for (const [r, liste] of Object.entries(parRaison)) {
    console.log('    ' + r + ' (' + liste.length + ')');
    liste.forEach((c) => console.log('        ' + c.slice(0, 88)));
  }
  console.log('\n  Tant qu\'il en reste un seul, le CSP doit garder');
  console.log('  scriptSrcAttr: unsafe-inline. C\'est l\'étape 2.');
}

console.log('\n  À VÉRIFIER À L\'ÉCRAN — parcourez et cliquez :');
console.log('    fiche résident (onglets), factures (PDF, avoir, encaisser),');
console.log('    carte (outils d\'édition), messagerie, impayés (relancer),');
console.log('    paramètres (moyens de paiement, utilisateurs).');
console.log('  Un bouton qui ne répond plus écrit « [action] fonction');
console.log('  introuvable » dans la console : rien n\'échoue en silence.');
if (ESSAI) console.log('\n  Relancez sans --essai pour appliquer.');
console.log('');

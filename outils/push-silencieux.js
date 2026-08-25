#!/usr/bin/env node
/* ============================================================
   outils/push-silencieux.js
   Les messages de débogage des notifications quittent l'écran
   ============================================================
   Cibles : backend/public/portail/portail.js
            backend/public/app.js

   ── CE QU'ON VOYAIT ──────────────────────────────────────────────
   Au lancement de l'application, un message « PUSH · … » s'affichait.
   Sa source :

       const dbg = (m, err) => { try { toast('PUSH · ' + m, !!err); }
                                 catch {} console.log('[push] ' + m); };

   La fonction sert a suivre l'enregistrement du jeton FCM, en trois
   etapes annoncees : « 1/3 permission », « 2/3 demande du jeton »,
   « 3/3 jeton obtenu ». Utile pendant la mise au point sur un appareil
   reel, ou la console n'est pas a portee — et restee en production.

   Un utilisateur n'a rien a faire de ces etapes. Pire : le mot « PUSH »
   suivi d'un jargon technique, au premier lancement, donne l'impression
   d'une application inachevee, au moment precis ou elle doit inspirer
   confiance.

   ── CE QUI EST FAIT ──────────────────────────────────────────────
   Le toast disparait, la trace console reste : le diagnostic ne se perd
   pas, il retourne la ou il appartient.

   Et il reste RAPPELABLE. Une fois sur l'appareil d'un client, sans
   Mac ni cable, la console n'est pas toujours accessible — c'est
   justement ce qui avait motive ces toasts. Ils se rallument donc a la
   demande :

       localStorage.setItem('locamp_debug_push', '1')

   Puis on relance l'application. Retirer la cle les eteint. Un outil de
   diagnostic qu'on peut rallumer vaut mieux qu'un outil supprime, qu'il
   faudrait reecrire au prochain incident.

   Les erreurs suivent la meme regle : un echec d'enregistrement push
   n'empeche pas d'utiliser l'application, et ne merite donc pas
   d'alarmer. Le serveur, lui, sait deja qu'aucun jeton n'est arrive.

   Usage :
     node outils/push-silencieux.js --essai
     node outils/push-silencieux.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');
const PORTAIL = path.join(process.cwd(), 'backend', 'public', 'portail', 'portail.js');
const APP = path.join(process.cwd(), 'backend', 'public', 'app.js');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

/* On repere la ligne par sa forme, sans presumer des espaces ni des
   guillemets : c'est ce qui a fait echouer plusieurs scripts. */
const MOTIF = /const dbg = \([^)]*\) =>\s*\{[^}]*toast\(\s*['"]PUSH[^;]*;\s*console\.log\([^;]*\);\s*\};?/;

const NOUVEAU = `const dbg = (m, err) => {
    /* Ces messages suivaient l'enregistrement du jeton FCM a l'ecran, pour
       pouvoir diagnostiquer sur un appareil reel. Ils n'ont rien a dire a un
       utilisateur — et « PUSH · 2/3 demande du jeton » au premier lancement
       donne l'impression d'une application inachevee.

       La trace reste dans la console, et le toast se rallume a la demande :
       localStorage.setItem('locamp_debug_push', '1'), puis relancer. Un outil
       de diagnostic rappelable vaut mieux qu'un outil supprime. */
    try {
      if (localStorage.getItem('locamp_debug_push') === '1') toast('PUSH · ' + m, !!err);
    } catch { /* ignore */ }
    console.log('[push] ' + m);
  };`;

const cibles = [];
for (const [nom, f] of [['portail.js', PORTAIL], ['app.js', APP]]) {
  if (!fs.existsSync(f)) echec(f + ' introuvable. Lancez depuis la racine du depot.');
  cibles.push([nom, f, fs.readFileSync(f, 'utf8')]);
}

if (cibles.every(([, , s]) => s.indexOf('locamp_debug_push') !== -1)) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

const resultats = [];
for (const c of cibles) {
  const [nom, , src] = c;
  if (src.indexOf('locamp_debug_push') !== -1) { resultats.push(nom + ' : deja fait'); continue; }
  const m = src.match(MOTIF);
  if (!m) { resultats.push(nom + ' : \u26a0 fonction dbg introuvable, inchange'); continue; }
  c[2] = src.replace(MOTIF, NOUVEAU);
  resultats.push(nom + ' : corrige');
}

for (const [nom, , src] of cibles) {
  try { new Function(src); }
  catch (e) { echec(nom + ' : le resultat n\'est pas du JavaScript valide — ' + e.message); }
}

if (!resultats.some((r) => r.indexOf('corrige') !== -1)) {
  echec('Aucune fonction dbg trouvee. Le code a change — envoyez-moi les lignes autour de « const dbg ».');
}

if (!ESSAI) {
  for (const [, f, src] of cibles) fs.writeFileSync(f, src, 'utf8');
  for (const [nom, f, ] of cibles) {
    const relu = fs.readFileSync(f, 'utf8');
    if (relu.indexOf('toast(\'PUSH · ' ) !== -1 && relu.indexOf('locamp_debug_push') === -1) {
      echec(nom + ' : le toast subsiste apres ecriture.');
    }
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
resultats.forEach((r) => console.log('  ' + r));
console.log('\n  Les etapes push ne s\'affichent plus, la trace console reste.');
console.log('  Pour les rallumer sur un appareil, depuis la console du site :');
console.log('    localStorage.setItem(\'locamp_debug_push\', \'1\')\n');
console.log('  Aucune reconstruction : les applications chargent le site en direct.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

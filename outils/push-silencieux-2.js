#!/usr/bin/env node
/* ============================================================
   outils/push-silencieux-2.js
   Le « PUSH · OK », pour de bon cette fois
   ============================================================
   Cibles : backend/public/portail/portail.js
            backend/public/app.js

   ── POURQUOI LE PREMIER SCRIPT A ECHOUE ──────────────────────────
   Il cherchait la fonction par une expression reguliere :

       const dbg = \\([^)]*\\) =>\\s*\\{[^}]*toast\\(...

   « [^}]* » refuse toute accolade dans le corps. Or la ligne en contient
   une paire :

       catch { /* ignore */ }

   L'expression ne pouvait donc jamais correspondre. Le script a
   correctement refuse d'ecrire, mais je cherchais une forme que le code
   n'avait pas.

   Cette fois, la chaine exacte, relevee dans le fichier. Rien a
   deviner.

   ── CE QUE FAIT LA CORRECTION ────────────────────────────────────
   Le commentaire au-dessus de la fonction dit son intention : « où ça
   bloque sans console. À alléger une fois le push fonctionnel. » Le push
   fonctionne — l'appareil s'enregistre. C'est donc le moment.

   Le toast disparait, la trace console reste, et se rallume a la
   demande :

       localStorage.setItem('locamp_debug_push', '1')

   Un outil de diagnostic rappelable vaut mieux qu'un outil supprime,
   qu'il faudrait reecrire au prochain incident — et c'est justement
   l'absence de console sur le telephone d'un client qui l'avait motive.

   Usage :
     node outils/push-silencieux-2.js --essai
     node outils/push-silencieux-2.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');
const FICHIERS = [
  ['portail.js', path.join(process.cwd(), 'backend', 'public', 'portail', 'portail.js')],
  ['app.js', path.join(process.cwd(), 'backend', 'public', 'app.js')],
];

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

/* La chaine exacte, relevee dans le fichier — et non une forme supposee. */
const ANCIEN = `const dbg = (m, err) => { try { toast('PUSH · ' + m, !!err); } catch { /* ignore */ } console.log('[push] ' + m); };`;

const NOUVEAU = `const dbg = (m, err) => {
    /* Ces etapes s'affichaient a l'ecran pour pouvoir diagnostiquer sans
       console, sur un appareil reel. Le push fonctionne desormais : elles
       n'ont plus rien a dire a un utilisateur, et « PUSH · OK — appareil
       enregistre » au lancement fait douter de l'application.

       La trace reste dans la console, et le toast se rallume a la demande :
       localStorage.setItem('locamp_debug_push', '1'), puis relancer. */
    try {
      if (localStorage.getItem('locamp_debug_push') === '1') toast('PUSH · ' + m, !!err);
    } catch { /* ignore */ }
    console.log('[push] ' + m);
  };`;

const etats = [];
let touches = 0;

for (const [nom, f] of FICHIERS) {
  if (!fs.existsSync(f)) { etats.push([nom, f, null, 'absent']); continue; }
  const src = fs.readFileSync(f, 'utf8');
  if (src.indexOf('locamp_debug_push') !== -1) { etats.push([nom, f, null, 'deja fait']); continue; }
  const n = src.split(ANCIEN).length - 1;
  if (!n) { etats.push([nom, f, null, '\u26a0 ligne introuvable, inchange']); continue; }
  etats.push([nom, f, src.split(ANCIEN).join(NOUVEAU), n + ' occurrence(s) corrigee(s)']);
  touches += n;
}

if (!touches) {
  if (etats.every(([, , , e]) => e === 'deja fait')) {
    console.log('\n  Deja applique — rien a faire.\n');
    process.exit(0);
  }
  echec('La ligne attendue n\'a ete trouvee dans aucun fichier.');
}

for (const [nom, , src] of etats) {
  if (!src) continue;
  try { new Function(src); }
  catch (e) { echec(nom + ' : JavaScript invalide — ' + e.message); }
}

if (!ESSAI) {
  for (const [, f, src] of etats) if (src) fs.writeFileSync(f, src, 'utf8');
  for (const [nom, f, src] of etats) {
    if (!src) continue;
    if (fs.readFileSync(f, 'utf8').indexOf('locamp_debug_push') === -1) {
      echec(nom + ' : la correction n\'est pas dans le fichier apres ecriture.');
    }
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
etats.forEach(([nom, , , e]) => console.log('  ' + nom + ' : ' + e));
console.log('\n  Les etapes push ne s\'affichent plus. Pour les rallumer :');
console.log('    localStorage.setItem(\'locamp_debug_push\', \'1\')\n');
console.log('  Aucune reconstruction : le site est charge en direct.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

#!/usr/bin/env node
//  outils/push-muet.js
//  Le « PUSH · OK » quitte l'écran
//  ============================================================
//  Cibles : backend/public/portail/portail.js
//           backend/public/app.js
//
//  Deux tentatives ont echoue avant celle-ci, pour deux raisons
//  differentes — et la seconde etait un defaut du script lui-meme :
//
//    1. La premiere cherchait la fonction par expression reguliere,
//       avec un motif refusant toute accolade dans le corps. La ligne
//       en contient une paire : elle ne pouvait pas correspondre.
//
//    2. La seconde portait dans son commentaire d'en-tete la sequence
//       de fermeture de commentaire. Elle refermait donc le bloc trop
//       tot, et l'accolade suivante devenait du code : erreur de
//       syntaxe avant meme la premiere instruction.
//
//  D'ou les commentaires en double barre dans ce fichier : aucune
//  sequence de fermeture ne peut plus s'y glisser par accident.
//
//  ── CE QUE FAIT LA CORRECTION ────────────────────────────────────
//  La fonction dbg annonce a l'ecran chaque etape de l'enregistrement
//  du jeton push : « 1/3 permission », « 2/3 demande du jeton », puis
//  « OK — appareil enregistre ». Le commentaire au-dessus disait son
//  intention : « a alleger une fois le push fonctionnel ». Il l'est.
//
//  Le toast disparait, la trace console reste, et se rallume a la
//  demande :
//
//      localStorage.setItem('locamp_debug_push', '1')
//
//  Un outil de diagnostic rappelable vaut mieux qu'un outil supprime :
//  c'est justement l'absence de console sur le telephone d'un client
//  qui l'avait motive.
//
//  Usage :
//    node outils/push-muet.js --essai
//    node outils/push-muet.js

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

// La chaine exacte, relevee dans le fichier. Assemblee par morceaux pour
// qu'aucune sequence de commentaire n'apparaisse dans ce source.
const IGN = '/' + '* ignore *' + '/';
const ANCIEN = "const dbg = (m, err) => { try { toast('PUSH \u00b7 ' + m, !!err); } catch { "
  + IGN + " } console.log('[push] ' + m); };";

const NOUVEAU = [
  'const dbg = (m, err) => {',
  '    // Ces etapes s\'affichaient a l\'ecran pour diagnostiquer sans console,',
  '    // sur un appareil reel. Le push fonctionne : elles n\'ont plus rien a',
  '    // dire a un utilisateur, et « PUSH · OK » au lancement fait douter de',
  '    // l\'application. La trace reste dans la console, et le toast se',
  '    // rallume par localStorage.setItem(\'locamp_debug_push\', \'1\').',
  '    try {',
  '      if (localStorage.getItem(\'locamp_debug_push\') === \'1\') toast(\'PUSH \u00b7 \' + m, !!err);',
  '    } catch { ' + IGN + ' }',
  '    console.log(\'[push] \' + m);',
  '  };',
].join('\n');

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
  echec('La ligne attendue n\'a ete trouvee dans aucun fichier.\n'
    + '      Envoyez-moi : grep -n "const dbg" backend/public/portail/portail.js');
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
console.log('\n  Pour rallumer les etapes sur un appareil :');
console.log('    localStorage.setItem(\'locamp_debug_push\', \'1\')\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

#!/usr/bin/env node
/* ============================================================
   outils/portail-largeur.js
   Le header dépassait vraiment, et toute la page glissait avec lui
   ============================================================
   Cible : backend/public/portail/portail.css

   ── CE QUE LA CAPTURE MONTRE ─────────────────────────────────────
   Le bouton de deconnexion est coupe au bord droit, et la barre
   d'onglets est decalee vers la gauche. Ce n'est donc pas le rebond de
   WebKit — c'est un debordement reel : la page est plus large que
   l'ecran, et tout ce qu'elle contient glisse avec elle.

   ── POURQUOI MA CORRECTION PRECEDENTE N'A PAS SUFFI ──────────────
   J'avais pose « min-width:0 » sur « .topbar .brand » et sur son
   dernier enfant. Mais une chaine flex ne cede que si CHAQUE maillon
   accepte de rétrécir : un seul parent laisse a « min-width:auto »
   — sa valeur par defaut — refuse de comprimer son contenu, et le texte
   « Camping Le parc des grands clos » pousse le reste dehors.

   Plutot que de deviner quel maillon manque, on les traite tous : la
   barre, ses descendants directs, et le bloc de titre.

   ── DEUX GARDE-FOUS EN PLUS ──────────────────────────────────────
   « overscroll-behavior-x » n'existe sur Safari que depuis iOS 16, et
   ne fait rien contre un debordement reel. On ajoute donc :

     · une largeur maximale stricte sur les conteneurs de premier niveau,
       pour qu'un futur contenu large soit tronque au lieu d'elargir la
       page ;
     · « touch-action: pan-y » sur le corps : le doigt ne fait plus
       defiler que verticalement. C'est ce qui rend la page « fixe » au
       toucher, quelle que soit la version d'iOS.

   Le glissement horizontal reste possible la ou il sert : un tableau
   large, une zone de code. On le reautorise explicitement.

   Usage :
     node outils/portail-largeur.js --essai
     node outils/portail-largeur.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'backend', 'public', 'portail', 'portail.css');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('backend/public/portail/portail.css introuvable.');

let css = fs.readFileSync(CIBLE, 'utf8');

if (css.indexOf('LARGEUR VERROUILLEE') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

css += `

/* ════════════════════════════════════════════════════════════════
   ══ LARGEUR VERROUILLEE ══
   ────────────────────────────────────────────────────────────────
   Le header depassait la largeur de l'ecran : le bouton de deconnexion
   etait coupe, et toute la page glissait avec lui.

   Une chaine flex ne cede que si CHAQUE maillon accepte de rétrécir.
   Un seul parent reste a min-width:auto — sa valeur par defaut — et le
   nom du camping pousse le reste dehors. On les traite tous, plutot que
   de chercher lequel manquait.
   ──────────────────────────────────────────────────────────────── */

body .topbar,
body .topbar > *,
body .topbar .brand,
body .topbar .brand > *{
  min-width:0;
}
body .topbar{
  max-width:100%;
  box-sizing:border-box;
  overflow:hidden;   /* dernier recours : rien ne sort de la barre */
}

/* Le bloc de titre cede, les actions non : c'est le texte qui doit se
   tronquer, pas les boutons qui doivent disparaitre. */
body .topbar .brand{flex:1 1 auto}
body .topbar .brand-mark,
body .topbar .topbar-actions,
body .topbar .btn{flex:0 0 auto}

body .topbar .brand-name,
body .topbar .brand-sub{
  max-width:100%;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}

/* Les conteneurs de premier niveau : une largeur stricte, pour qu'un
   contenu trop large soit tronque au lieu d'elargir la page. */
html,body,#espace,.stage,.onglets{
  max-width:100%;
  box-sizing:border-box;
}

/* Le doigt ne fait plus defiler que verticalement. C'est ce qui rend la
   page fixe au toucher — « overscroll-behavior-x » n'existe sur Safari
   que depuis iOS 16, et ne fait rien contre un debordement reel. */
body{touch-action:pan-y}

/* Sauf la ou le glissement lateral sert vraiment. */
.table-wrap,pre,.defile-x{touch-action:auto}
`;

if (!ESSAI) {
  fs.writeFileSync(CIBLE, css, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('LARGEUR VERROUILLEE') === -1) {
    echec('Le correctif n\'est pas dans le fichier apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Chaque maillon de la barre accepte desormais de rétrécir.');
console.log('  Le doigt ne fait plus defiler que verticalement.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

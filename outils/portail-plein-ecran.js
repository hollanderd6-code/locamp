#!/usr/bin/env node
/* ============================================================
   outils/portail-plein-ecran.js
   Le portail dans une application native, sans barre du navigateur
   ============================================================
   Cible : backend/public/portail/portail.css

   ── CE QUE L'INSPECTION A ETABLI ─────────────────────────────────
   Depuis le webview iOS :

       url      https://locamp.onrender.com/portail/
       feuilles marque.css, portail.css, Google Fonts  (3)
       cartes   rgb(255, 255, 255)

   Tout charge, tout s'applique. Le CSS n'etait donc pas en cause : ce
   qu'on voyait est le rendu reel d'une page en plein ecran.

   ── 1. LE CONTENU SOUS LA BARRE D'ETAT ───────────────────────────
   Sur Android, l'application est un habillage Chrome : le navigateur
   reserve lui-meme la place de l'heure et de la batterie. Sur iOS,
   WKWebView occupe l'ecran entier, encoche comprise — « Bonjour
   Charles » se retrouve collee sous 09:12.

   Le portail declare bien « viewport-fit=cover », ce qui rend les
   variables env() disponibles, mais aucune regle ne s'en servait. On
   ajoute donc la reserve en haut de la barre, et en bas de la barre
   d'onglets pour l'indicateur d'accueil.

   ── 2. LES PAGES QUI GLISSENT ────────────────────────────────────
   « overflow-x:hidden » empeche un contenu de depasser, mais pas le
   REBOND de WebKit : sur iOS, le document lui-meme se laisse tirer
   lateralement, meme sans rien qui depasse. C'est ce caoutchouc qu'on
   percevait comme « pas fixe ».

   La reponse est « overscroll-behavior-x: none » sur le document. On la
   pose partout, non seulement sur iOS : Chrome l'honore aussi, et ce
   comportement n'a de sens nulle part dans une application.

   ── POURQUOI CORRIGER DANS LE SITE, ET NON DANS L'APPLICATION ────
   Les deux applications chargent le site en direct. Une correction ici
   part avec le prochain deploiement Render, sans repasser par Xcode ni
   par le Play Store. Une correction dans le projet natif aurait demande
   deux publications a chaque retouche.

   Usage :
     node outils/portail-plein-ecran.js --essai
     node outils/portail-plein-ecran.js
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

if (!fs.existsSync(CIBLE)) {
  echec('backend/public/portail/portail.css introuvable. Lancez depuis la racine du depot.');
}

let css = fs.readFileSync(CIBLE, 'utf8');

if (css.indexOf('PLEIN ECRAN NATIF') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

css += `

/* ════════════════════════════════════════════════════════════════
   ══ PLEIN ECRAN NATIF ══
   ────────────────────────────────────────────────────────────────
   Dans les applications iOS et Android, la page occupe tout l'ecran :
   pas de barre de navigateur pour reserver la place de l'heure, de
   l'encoche ou de l'indicateur d'accueil. C'est a la page de le faire.

   Sur le web ordinaire, env(safe-area-inset-*) vaut zero : ces regles
   n'ont donc aucun effet dans un navigateur de bureau.
   ──────────────────────────────────────────────────────────────── */

/* La barre haute descend sous la barre d'etat. Le padding s'ajoute a
   celui deja pose, au lieu de le remplacer : sur un ecran sans encoche,
   l'espacement d'origine est conserve. */
.topbar{
  padding-top:calc(14px + env(safe-area-inset-top));
  padding-left:calc(16px + env(safe-area-inset-left));
  padding-right:calc(16px + env(safe-area-inset-right));
}

/* Un fond opaque derriere l'encoche : sans lui, le contenu defile
   visiblement sous l'heure. */
.topbar{background:var(--creme,#FDFBF7)}

/* La barre d'onglets remonte au-dessus de l'indicateur d'accueil. */
.onglets{
  padding-bottom:calc(6px + env(safe-area-inset-bottom));
}
/* Et le contenu cesse de finir dessous. */
#espace{
  padding-bottom:calc(76px + env(safe-area-inset-bottom));
}

/* Le rebond lateral de WebKit : « overflow-x:hidden » empeche un
   contenu de depasser, pas le document de se laisser tirer. C'est ce
   caoutchouc qu'on prenait pour une page mal fixee. */
html,body{
  overscroll-behavior-x:none;
  /* Le rebond vertical reste : il signale la fin de liste, et son
     absence donne une impression de page bloquee. */
}

/* Une selection de texte au glissement, dans une application, ressemble
   a une erreur de manipulation. On la garde la ou elle sert : les
   montants, les numeros de facture, les messages. */
.topbar,.onglets{
  -webkit-user-select:none;user-select:none;
  -webkit-touch-callout:none;
}
`;

if (!ESSAI) {
  fs.writeFileSync(CIBLE, css, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('PLEIN ECRAN NATIF') === -1) {
    echec('Le correctif n\'est pas dans le fichier apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Barre haute et barre d\'onglets respectent les zones sures.');
console.log('  Le rebond lateral est supprime, le vertical conserve.\n');
console.log('  Aucune reconstruction necessaire : les deux applications');
console.log('  chargent le site en direct. Un deploiement Render suffit,');
console.log('  puis un simple retour a l\'application.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

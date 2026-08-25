#!/usr/bin/env node
/* ============================================================
   outils/launchscreen-android.js
   L'écran de lancement Android, et une couleur qui ne collait pas
   ============================================================
   Cibles : backend/public/manifest.json
            backend/public/portail/manifest.json

   ── COMMENT UNE TWA FABRIQUE SON ECRAN DE LANCEMENT ──────────────
   Contrairement a iOS, ou l'image est embarquee dans l'application,
   une TWA n'emporte aucun visuel. Bubblewrap compose l'ecran de
   lancement au moment du « build », a partir de deux valeurs du
   manifeste WEB :

       background_color   la couleur de la surface
       icons[512]         le dessin, centre

   C'est tout. Pas de texte, pas de mise en page : l'ecran de lancement
   Android sera donc l'icone sur un fond uni, et non la composition avec
   « LOCAMP » que porte le splash iOS. On ne peut pas y mettre davantage
   sans quitter la TWA.

   ── L'INCOHERENCE ────────────────────────────────────────────────
   Le manifeste de la gestion declare :

       "background_color": "#F6F3EC"     creme
       "theme_color":      "#0F231D"     nuit

   L'icone de la gestion est vert fonce a lettre doree. Sur fond creme,
   elle apparait comme une vignette sombre posee au milieu d'un ecran
   clair — puis l'application s'ouvre en vert fonce. Deux couleurs se
   succedent la ou l'on attend une continuite.

   Le splash iOS que vous avez dessine part du fond vert fonce : c'est
   la bonne intention. On l'applique donc au manifeste.

   Le portail garde son fond clair, qui s'accorde a son icone beige et a
   la couleur de sa page.

   ── UN EFFET DE BORD VOULU ───────────────────────────────────────
   background_color sert aussi a l'application installee depuis le
   navigateur, et a la couleur de fond que le navigateur peint avant le
   premier pixel de la page. Les deux gagnent la meme continuite.

   Usage :
     node outils/launchscreen-android.js --essai
     node outils/launchscreen-android.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');
const P = (...a) => path.join(process.cwd(), 'backend', 'public', ...a);
const GESTION = P('manifest.json');
const PORTAIL = P('portail', 'manifest.json');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

for (const f of [GESTION, PORTAIL]) {
  if (!fs.existsSync(f)) echec(f + ' introuvable. Lancez depuis la racine du depot.');
}

const g = JSON.parse(fs.readFileSync(GESTION, 'utf8'));
const p = JSON.parse(fs.readFileSync(PORTAIL, 'utf8'));

const avant = { g: g.background_color, p: p.background_color };

/* La gestion : fond nuit, comme son icone et comme sa barre laterale.
   L'ecran de lancement enchaine alors sans rupture sur l'application. */
g.background_color = '#0F231D';
g.theme_color = '#0F231D';

/* Le portail : fond ivoire, comme son icone et comme ses pages. */
p.background_color = '#F4EFE4';
p.theme_color = '#0F231D';   // la barre d'etat reste sombre : texte clair lisible

if (avant.g === g.background_color && avant.p === p.background_color) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

if (!ESSAI) {
  fs.writeFileSync(GESTION, JSON.stringify(g, null, 2) + '\n', 'utf8');
  fs.writeFileSync(PORTAIL, JSON.stringify(p, null, 2) + '\n', 'utf8');
  const rg = JSON.parse(fs.readFileSync(GESTION, 'utf8'));
  if (rg.background_color !== '#0F231D') echec('Le manifeste de gestion n\'a pas ete modifie.');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  gestion  background_color  ' + avant.g + '  →  #0F231D');
console.log('  portail  background_color  ' + avant.p + '  →  #F4EFE4\n');
console.log('  Ensuite, dans CET ordre :');
console.log('    1. git push, et attendre le deploiement Render');
console.log('    2. bubblewrap update  (il relit le manifeste en ligne)');
console.log('    3. bubblewrap build\n');
console.log('  L\'etape 2 est celle qu\'on oublie : sans elle, le bundle');
console.log('  garde l\'ancienne couleur et l\'ancienne icone.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

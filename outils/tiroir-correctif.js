#!/usr/bin/env node
/* ============================================================
   outils/tiroir-correctif.js
   Correctif : le menu s'écoulait hors du tiroir
   ============================================================
   Cible : backend/public/styles.css

   ── LE SYMPTOME ──────────────────────────────────────────────────
   Sur mobile, le tiroir s'ouvre : l'enseigne, les deux selecteurs et le
   filet sont la, puis un grand vide. Aucune entree de menu.

   Un indice sur la capture : un court trait dore a mi-hauteur, a DROITE
   du tiroir, en dehors. C'est le marqueur de l'element actif
   (.nav a.active::before). Le menu n'etait donc pas absent — il etait
   ailleurs.

   ── LA CAUSE ─────────────────────────────────────────────────────
   L'ancien montage mobile contient :

       .nav-open .sidebar{flex-wrap:wrap}     /* deux classes */

   et mon bloc posait :

       .sidebar{flex-wrap:nowrap}             /* une classe */

   Deux classes l'emportent sur une, quelle que soit la position dans le
   fichier : arriver en fin de feuille ne suffit pas. A l'ouverture, la
   barre repassait donc en flex-wrap:wrap. Avec une direction en colonne
   et une hauteur bornee a 100dvh, le menu n'avait plus la place de
   suivre : il s'ecoulait en SECONDE COLONNE, a droite, hors du tiroir —
   ou overflow:hidden le masquait entierement.

   La lecon est de methode : mes regles de refonte comptaient sur l'ordre
   du fichier, alors que la feuille qu'elles remplacent utilise des
   selecteurs a deux classes. L'ordre ne tranche qu'a specificite egale.

   ── LE CORRECTIF ─────────────────────────────────────────────────
   Les regles de mise en page du tiroir sont reecrites avec .nav-open en
   tete, donc a la meme specificite que celles qu'elles remplacent — et
   posees apres. Aucune valeur de design ne change.

   Usage :
     node outils/tiroir-correctif.js --essai
     node outils/tiroir-correctif.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'backend', 'public', 'styles.css');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('backend/public/styles.css introuvable. Lancez depuis la racine du projet.');

let css = fs.readFileSync(CIBLE, 'utf8');

if (css.indexOf('══ TIROIR : SPECIFICITE') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}
if (css.indexOf('══ ENVELOPPE') === -1) echec('Appliquez d\'abord outils/enveloppe-locamp.js.');

css += `

/* ════════════════════════════════════════════════════════════════
   ══ TIROIR : SPECIFICITE ══
   ────────────────────────────────────────────────────────────────
   L'ancien montage mobile pose « .nav-open .sidebar{flex-wrap:wrap} » —
   deux classes. Le bloc ENVELOPPE ci-dessus repond par « .sidebar{...} »,
   une seule : il perd, et arriver plus loin dans la feuille n'y change
   rien. L'ordre ne tranche qu'a specificite egale.

   Consequence observee : a l'ouverture, la barre repassait en wrap et le
   menu s'ecoulait en seconde colonne, hors du tiroir, masque par
   overflow:hidden. Le tiroir paraissait vide.

   Ces regles reprennent donc le meme selecteur a deux classes. Aucune
   valeur de design ne change ici.
   ──────────────────────────────────────────────────────────────── */
@media (max-width:880px){

  .nav-open .sidebar{
    flex-direction:column;
    flex-wrap:nowrap;
    align-items:stretch;
    align-content:stretch;
    row-gap:0;
    column-gap:0;
    height:100dvh;
    transform:translateX(0);
    visibility:visible;
  }

  /* Le menu occupe la hauteur restante et defile en lui-meme : c'est ce qui
     permet aux treize entrees et aux trois intertitres de tenir, et au pied
     de rester ancre en bas. */
  .nav-open .nav{
    display:flex;
    flex-direction:column;
    flex:1 1 auto;
    min-height:0;
    width:auto;
    max-height:none;
    overflow-y:auto;
    margin-top:18px;
    padding:0;
    border-top:none;
  }

  .nav-open .sidebar-head{display:flex;flex-direction:column;flex:0 0 auto}
  .nav-open .sidebar-foot{display:flex;flex-direction:row;align-items:center;
    flex:0 0 auto;width:auto;margin-top:12px}
  .nav-open .camping-switch{flex:0 0 auto;width:100%;max-width:none}
  .nav-open .brand-side{flex:0 0 auto}
  .nav-open .nav a.active::before{display:block}
}
`;

if (!ESSAI) {
  fs.writeFileSync(CIBLE, css, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('══ TIROIR : SPECIFICITE') === -1) {
    echec('Le correctif n\'est pas dans le fichier apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Le tiroir garde sa colonne unique a l\'ouverture.');
console.log('  Le menu defile en lui-meme, le pied reste ancre.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

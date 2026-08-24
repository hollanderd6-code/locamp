#!/usr/bin/env node
/* ============================================================
   outils/portail-mobile.js
   Quatre défauts sur mobile, dont un que j'ai créé
   ============================================================
   Cibles : backend/public/portail/index.html
            backend/public/portail/portail.css

   ── 1. LE HEADER ENORME : MA FAUTE ───────────────────────────────
   En refondant l'enveloppe de la gestion, j'ai fait de « .brand-name »
   une ENSEIGNE dans marque.css :

       font-family:Fraunces; letter-spacing:.14em;
       text-transform:uppercase

   C'est juste pour « LOCAMP » dans une barre laterale. Mais le portail
   reutilise cette meme classe pour la salutation :

       <div class="brand-name" id="hello">Bonjour</div>

   « Bonjour Charles » est donc devenu « B O N J O U R  C H A R L E S »,
   en capitales espacees, sur deux lignes. Une salutation n'est pas une
   enseigne : elle se lit, elle ne s'affiche pas.

   Le portail reprend donc la main sur #hello — casse basse, sans
   interlettrage, taille normale.

   ── 2. LES PAGES COUPEES A DROITE ────────────────────────────────
   Consequence directe : le titre demesure, plus le bouton « Se
   deconnecter » en texte plein, plus l'actualisation et la cloche,
   depassent la largeur de l'ecran. Le header force alors une largeur
   superieure au viewport, et TOUTE la page se decale — d'ou l'impression
   que chaque page est coupee.

   On corrige la cause : le header s'adapte, le nom du camping se
   tronque a l'ellipse, et « Se deconnecter » devient une icone sous
   560 px. On pose aussi un garde-fou « overflow-x:hidden » : si un
   contenu large reapparait un jour, la page ne glissera plus.

   ── 3. LES PAGES QUI GLISSENT ────────────────────────────────────
   Meme cause. Le garde-fou la traite definitivement.

   ── 4. LA BARRE D'ONGLETS INVISIBLE ──────────────────────────────
   Elle est en « position:fixed », mais placee dans #espace. Sur iOS,
   un ancetre qui porte un filtre, une transformation ou un
   « backdrop-filter » cree un nouveau contexte : le « fixed » s'y
   ancre au lieu du viewport, et la barre retombe en bas du document.

   Plutot que de chercher lequel des ancetres est en cause, on deplace
   la barre en fin de <body> au chargement : plus aucun ancetre, donc
   plus rien qui puisse casser l'ancrage. Un DOM leger vaut mieux qu'un
   diagnostic fragile.

   Usage :
     node outils/portail-mobile.js --essai
     node outils/portail-mobile.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');
const P = (f) => path.join(process.cwd(), 'backend', 'public', 'portail', f);
const INDEX = P('index.html'), CSS = P('portail.css');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

for (const f of [INDEX, CSS]) {
  if (!fs.existsSync(f)) echec(f + ' introuvable. Lancez depuis la racine du projet.');
}

let index = fs.readFileSync(INDEX, 'utf8');
let css = fs.readFileSync(CSS, 'utf8');

if (css.indexOf('MOBILE DU PORTAIL') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

/* ── 1. « Se deconnecter » recoit une icone, pour pouvoir se passer du mot ── */
const A_OUT = `      <button class="btn btn-ghost btn-sm" id="btn-logout">Se déconnecter</button>`;
const N_OUT = `      <button class="btn btn-ghost btn-sm" id="btn-logout" title="Se déconnecter" aria-label="Se déconnecter">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>
        <span>Se déconnecter</span>
      </button>`;

if (index.split(A_OUT).length - 1 !== 1) echec('index.html : bouton de deconnexion introuvable.');
index = index.split(A_OUT).join(N_OUT);

/* ── 2. Sortir la barre d'onglets de tout ancetre ─────────────────── */
const A_JS = `  var CLE = 'locamp_portail_onglet';
  var barre = document.getElementById('onglets');
  if (!barre) return;`;

const N_JS = `  var CLE = 'locamp_portail_onglet';
  var barre = document.getElementById('onglets');
  if (!barre) return;

  /* « position:fixed » s'ancre au premier ancetre qui porte un filtre, une
     transformation ou un backdrop-filter — pas au viewport. Sur iOS la barre
     retombait donc en bas du document, visible seulement en fin de defilement.
     La deplacer en fin de <body> supprime la question : plus d'ancetre. */
  if (barre.parentNode !== document.body) document.body.appendChild(barre);`;

if (index.split(A_JS).length - 1 !== 1) {
  echec('index.html : script des onglets introuvable. Appliquez d\'abord portail-onglets.js.');
}
index = index.split(A_JS).join(N_JS);

/* ── 3. Le style ─────────────────────────────────────────────────── */
css += `

/* ════════════════════════════════════════════════════════════════
   ══ MOBILE DU PORTAIL ══
   ────────────────────────────────────────────────────────────────
   Quatre defauts d'une meme famille : un titre trop grand faisait
   deborder le header, le header faisait glisser la page, et la page
   qui glissait masquait le reste.
   ──────────────────────────────────────────────────────────────── */

/* Une salutation n'est pas une enseigne. « .brand-name » est devenue une
   enseigne pour la barre laterale de la gestion — capitales, interlettrage
   large ; appliquee a « Bonjour Charles », elle donnait un titre demesure
   sur deux lignes. Le portail reprend la main sur cette instance. */
.topbar #hello{
  font-family:"Fraunces",serif;
  font-size:19px;font-weight:600;
  letter-spacing:-.01em;text-transform:none;
  line-height:1.2;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* Garde-fou : plus rien ne fait glisser la page lateralement, meme si un
   contenu trop large reapparait un jour. */
html,body{max-width:100%;overflow-x:hidden}

.topbar{
  display:flex;align-items:center;gap:12px;
  /* min-width:0 sur le conteneur souple : sans lui, un texte long refuse de
     se tronquer et pousse le reste hors de l'ecran. C'est l'origine du
     debordement. */
  }
.topbar .brand{flex:1 1 auto;min-width:0}
.topbar .brand > div:last-child{min-width:0}
.topbar .brand-sub{
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  font-size:12.5px;line-height:1.35}
.topbar .brand-mark{width:38px;height:38px;flex:none}
.topbar-actions{flex:none;display:flex;align-items:center;gap:7px}

#btn-logout{display:inline-flex;align-items:center;gap:7px}

@media (max-width:560px){
  /* Le mot « Se deconnecter » vaut trois boutons de large pour une action
     faite une fois par session : l'icone suffit. */
  #btn-logout span{display:none}
  #btn-logout{width:36px;height:36px;padding:0;justify-content:center}
  .btn-actualiser{width:36px;height:36px;padding:0;justify-content:center}
  .topbar{gap:9px;padding-left:14px;padding-right:14px}
  .topbar #hello{font-size:17px}
  .topbar .brand{gap:10px}
  .topbar .brand-mark{width:34px;height:34px}
}
`;

if (!ESSAI) {
  fs.writeFileSync(INDEX, index, 'utf8');
  fs.writeFileSync(CSS, css, 'utf8');
  const ri = fs.readFileSync(INDEX, 'utf8'), rc = fs.readFileSync(CSS, 'utf8');
  if (ri.indexOf('appendChild(barre)') === -1 || rc.indexOf('MOBILE DU PORTAIL') === -1) {
    echec('Un fichier n\'a pas ete modifie.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  #hello reprend une casse normale : le header retrouve sa taille.');
console.log('  Le nom du camping se tronque, « Se deconnecter » devient une icone.');
console.log('  Garde-fou overflow-x : la page ne glisse plus.');
console.log('  La barre d\'onglets passe en fin de <body> : le fixed tient.\n');
console.log('  La cause etait dans marque.css, ou j\'avais fait de .brand-name');
console.log('  une enseigne pour la gestion sans voir que le portail s\'en sert');
console.log('  pour la salutation.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

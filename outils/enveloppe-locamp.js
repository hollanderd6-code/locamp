#!/usr/bin/env node
/* ============================================================
   outils/enveloppe-locamp.js
   Le logo, la barre latérale, et le mobile repris à zéro
   ============================================================
   Cibles : backend/public/logo.svg
            backend/public/marque.css
            backend/public/styles.css
            backend/public/index.html
            backend/public/app.js

   La palette et les caracteres ne changent pas : nuit, laiton, ivoire,
   Fraunces et Inter tiennent deja. Ce script ne touche qu'au cadre.

   ── 1. LE LOGO ───────────────────────────────────────────────────
   L'ancien empilait quatre idees dans 64 px : un « L » en Fraunces,
   trois chevrons, deux cadres imbriques, deux degrades. A 28 px — la
   taille reelle dans l'en-tete mobile — tout se referme en tache.

   Le nouveau garde une lettre et un filet. C'est le registre de
   l'hotellerie : rien a dechiffrer, lisible jusqu'a 18 px.

   ── 2. LA BARRE LATERALE ─────────────────────────────────────────
   Elle superposait un degrade radial dore, un degrade lineaire et une
   ombre portee de 24 px. Trois effets qui se disputent la meme surface.
   Reste un aplat et un filet d'or a 14 % : un seul effet.

   Elle passe de 232 a 252 px, et l'element survole ne se decale plus de
   trois pixels vers la droite — le texte ne bouge plus, seule la
   surface s'eclaire. Un decalage au survol se paie a chaque passage de
   souris.

   Le pied affiche desormais l'initiale et le role. « Se deconnecter »
   en pleine largeur occupait la place d'un element de menu pour une
   action faite une fois par jour : il devient une icone.

   ── 3. LE MOBILE ─────────────────────────────────────────────────
   C'etait le point faible du produit. La barre laterale se repliait en
   accordeon : display:contents, six valeurs d'ordre, flex-wrap, et le
   menu s'ouvrait AU-DESSUS de la page en poussant le contenu vers le
   bas. Deux selecteurs a 50 % cote a cote, illisibles.

   Desormais une barre haute de 58 px qui ne bouge jamais, et un tiroir
   qui glisse par-dessus avec un voile. Le contenu reste en place. Les
   cibles passent a 48 px.

   Le bouton menu quitte la barre laterale pour la barre haute — dans le
   tiroir, il serait hors ecran une fois celui-ci ferme. Celui de la
   barre laterale devient la croix de fermeture.

   Usage :
     node outils/enveloppe-locamp.js --essai
     node outils/enveloppe-locamp.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');
const P = (...a) => path.join(process.cwd(), 'backend', 'public', ...a);
const LOGO = P('logo.svg'), MARQUE = P('marque.css'), STYLES = P('styles.css');
const INDEX = P('index.html'), APP = P('app.js');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

for (const f of [LOGO, MARQUE, STYLES, INDEX, APP]) {
  if (!fs.existsSync(f)) echec(f + ' introuvable. Lancez depuis la racine du projet.');
}

let marque = fs.readFileSync(MARQUE, 'utf8');
let styles = fs.readFileSync(STYLES, 'utf8');
let index  = fs.readFileSync(INDEX, 'utf8');
let app    = fs.readFileSync(APP, 'utf8');

if (styles.indexOf('/* ══ ENVELOPPE') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

/* ════════════ 1. LE LOGO ════════════ */
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Locamp">
  <!-- Une lettre, un filet. L'ancienne marque portait aussi trois chevrons et
       un second cadre : a 28 px, la taille de l'en-tete mobile, ils se
       refermaient en tache. -->
  <defs>
    <linearGradient id="lcOr" x1="0" y1="0" x2=".35" y2="1">
      <stop offset="0" stop-color="#EBD49A"/><stop offset=".45" stop-color="#C9A24E"/><stop offset="1" stop-color="#A07C33"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="15" fill="#0F231D"/>
  <rect x="8" y="8" width="48" height="48" rx="10" fill="none" stroke="#B98A3C" stroke-width=".9" opacity=".45"/>
  <text x="32" y="45.5" text-anchor="middle" font-family="Fraunces,Georgia,'Times New Roman',serif" font-size="36" font-weight="500" fill="url(#lcOr)">L</text>
</svg>
`;

/* ════════════ 2. LA MARQUE ════════════ */
const A_MARQUE = `.brand{display:flex;align-items:center;gap:13px}
.brand-mark{width:44px;height:44px;flex:none;line-height:0;
  border-radius:13px;overflow:hidden;
  box-shadow:0 3px 10px rgba(15,35,29,.30), inset 0 1px 0 rgba(255,255,255,.10)}
.brand-mark svg,
.brand-mark img{width:100%;height:100%;display:block}
.brand-name{font-family:"Fraunces",serif;font-size:21px;font-weight:700;letter-spacing:-.01em}
.brand-sub{font-size:12.5px;color:var(--brume);margin-top:1px}`;

const N_MARQUE = `.brand{display:flex;align-items:center;gap:13px}
.brand-mark{width:44px;height:44px;flex:none;line-height:0;
  border-radius:13px;overflow:hidden;
  box-shadow:0 3px 10px rgba(15,35,29,.30), inset 0 1px 0 rgba(255,255,255,.10)}
.brand-mark svg,
.brand-mark img{width:100%;height:100%;display:block}

/* Le nom se lit desormais lettre a lettre : LOCAMP espace, pas « Locamp »
   serre. C'est ce qui distingue une enseigne d'un titre de paragraphe — et le
   seul endroit du produit ou l'on peut se le permettre. */
.brand-name{font-family:"Fraunces",serif;font-size:18px;font-weight:600;
  letter-spacing:.14em;line-height:1.15;text-transform:uppercase}
.brand-sub{font-size:12.5px;color:var(--brume);margin-top:1px}

/* La ligne sous l'enseigne, dans la barre laterale : « GESTION » cote
   exploitant, « MON ESPACE » cote locataire. Deux portes du meme produit. */
.brand-role{font-size:9.5px;font-weight:600;letter-spacing:.15em;
  text-transform:uppercase;color:#6F8378;margin-top:3px}`;

if (marque.split(A_MARQUE).length - 1 !== 1) echec('marque.css : bloc de marque introuvable.');
marque = marque.split(A_MARQUE).join(N_MARQUE);
marque = marque.replace('  --laiton:#B98A3C;', '  --laiton:#B98A3C;\n  --or-clair:#C9A24E;    /* le laiton sur fond nuit, ou #B98A3C manque de corps */');

/* ════════════ 3. LES STYLES ════════════ */
const CSS = `

/* ════════════════════════════════════════════════════════════════
   ══ ENVELOPPE ══  la barre laterale, et le tiroir sur mobile
   ════════════════════════════════════════════════════════════════
   Ces regles arrivent en fin de feuille et l'emportent donc sur les
   precedentes a specificite egale. Elles remplacent l'accordeon mobile
   (display:contents + six ordres + flex-wrap) par un tiroir.
   ──────────────────────────────────────────────────────────────── */

/* ---------- Grand ecran ---------- */
@media (min-width:881px){
  .app{grid-template-columns:252px 1fr}
}

/* Un aplat et un filet, la ou trois effets se superposaient : degrade
   radial dore, degrade lineaire, et une ombre portee de 24 px. */
.sidebar{
  background:linear-gradient(180deg,#10251F 0%,#0B1A15 100%);
  border-right:1px solid rgba(185,138,60,.14);
  box-shadow:none;
  padding:26px 14px 16px;
}
.sidebar-head{gap:0}

.brand-side{display:flex;align-items:center;gap:12px;padding:0 4px}
.brand-side .brand-mark{width:38px;height:38px;border-radius:11px}
.brand-side .brand-name{color:#EFE9DC;font-size:17px}

/* Le filet qui separe l'enseigne du reste : il s'eteint vers la droite,
   ce qui evite de couper la barre en deux parts egales. */
.sidebar-head::after{content:"";display:block;height:1px;margin:20px 2px 18px;
  background:linear-gradient(90deg,rgba(185,138,60,.34),rgba(185,138,60,.06))}

.camping-switch select{background-color:#17332B;border-color:rgba(255,255,255,.10);
  border-radius:9px;font-size:13px;padding:10px 34px 10px 12px}
.camping-switch select:hover{background-color:#1C3B32;border-color:rgba(255,255,255,.18)}
/* L'exercice n'est pas du meme ordre que le camping : il se lit, il ne
   s'affiche pas. Sans aplat, il cesse de rivaliser avec lui. */
#exercice-switch select{background-color:transparent;border-color:rgba(255,255,255,.07);
  color:#93A69C;font-weight:500;font-size:12.5px;padding:8px 34px 8px 12px}

.nav{gap:1px;margin-top:20px;padding:0 2px 0 0}
.nav-grp{font-size:9.5px;letter-spacing:.17em;color:#5E7268;padding:20px 12px 9px}
.nav-grp:first-child{padding-top:0}

/* Le survol ne decale plus le texte de trois pixels : seule la surface
   s'eclaire. Un mouvement a chaque passage de souris se remarque. */
.nav a{gap:11px;padding:10px 12px;border-radius:9px;color:#9FB3A9;font-size:13.5px;
  transition:background .15s, color .15s}
.nav a:hover{background:rgba(255,255,255,.05);color:#EAF0EC;padding-left:12px}
.nav a.active{background:rgba(185,138,60,.11);color:#fff}
.nav a.active::before{background:var(--or-clair);width:2px;top:7px;bottom:7px}
.nav-ic{width:17px;height:17px;opacity:.72}
.nav a.active .nav-ic{color:var(--or-clair);opacity:1}

/* Les deux compteurs existaient dans le HTML sans aucun style : ils
   s'affichaient en texte nu contre le libelle. */
#nav-msg-badge,#nav-imp-badge{margin-left:auto;flex:none;
  font-size:10.5px;font-weight:700;line-height:1;border-radius:99px;
  min-width:18px;height:18px;padding:0 5px;
  display:inline-flex;align-items:center;justify-content:center}
#nav-msg-badge{background:var(--or-clair);color:#0F231D}
#nav-imp-badge{background:var(--rouge);color:#fff}
#nav-msg-badge.hidden,#nav-imp-badge.hidden{display:none}
.nav a>span:first-of-type{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}

/* Le pied : l'initiale et le role, et « Se deconnecter » ramene a une
   icone. En pleine largeur, cette action faite une fois par jour occupait
   la place d'une entree de menu. */
.sidebar-foot{flex-direction:row;align-items:center;gap:10px;
  padding-top:14px;margin-top:14px;border-top:1px solid rgba(255,255,255,.08)}
.sidebar-foot .user-ini{width:30px;height:30px;flex:none;border-radius:50%;
  background:#1B3A31;border:1px solid rgba(185,138,60,.30);
  display:flex;align-items:center;justify-content:center;
  font-family:"Fraunces",serif;font-size:13px;font-weight:600;color:var(--or-clair)}
.sidebar-foot .user-bloc{flex:1;min-width:0}
.user-name{display:block;font-size:12.5px;font-weight:600;color:#D8E3DD;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.user-role{font-size:10.5px;color:#6F8378}
.sidebar-foot .btn-ghost{flex:none;width:30px;height:30px;padding:0;
  display:flex;align-items:center;justify-content:center;border-radius:8px;
  border-color:rgba(255,255,255,.10)}
.sidebar-foot .btn-ghost span{display:none}

/* ---------- La barre haute : mobile seulement ---------- */
.topbar{display:none}
.nav-veil{display:none}

@media (max-width:880px){

  /* L'ancien montage : la barre laterale devenait un bandeau qui poussait
     le contenu vers le bas a l'ouverture. On le defait entierement. */
  .app{grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr)}
  .sidebar-head{display:flex}

  .topbar{display:flex;align-items:center;gap:12px;
    position:sticky;top:0;z-index:44;height:58px;flex:none;
    padding:0 14px;padding-top:env(safe-area-inset-top);
    box-sizing:content-box;
    background:var(--nuit);border-bottom:1px solid rgba(185,138,60,.16)}
  .topbar-burger{flex:none;width:38px;height:38px;border:none;border-radius:10px;
    background:rgba(255,255,255,.06);color:#E4EDE8;
    display:flex;align-items:center;justify-content:center;cursor:pointer}
  .topbar-burger:active{background:rgba(255,255,255,.12)}
  .topbar-titre{flex:1;min-width:0}
  .topbar-titre .brand-name{color:#EFE9DC;font-size:15px}
  /* Le camping actif se lit ici : dans le tiroir, il faudrait l'ouvrir pour
     savoir sur quel etablissement on travaille. */
  .topbar-ctx{font-size:10px;color:#7C8F85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .topbar-ini{flex:none;width:34px;height:34px;border-radius:50%;
    background:#1B3A31;border:1px solid rgba(185,138,60,.30);
    display:flex;align-items:center;justify-content:center;
    font-family:"Fraunces",serif;font-size:12px;font-weight:600;color:var(--or-clair)}

  /* Le tiroir. position:fixed et non sticky : il doit couvrir la page, pas
     s'inserer dedans. */
  .sidebar{position:fixed;top:0;bottom:0;left:0;z-index:60;
    width:min(292px,84vw);height:100dvh;
    flex-direction:column;flex-wrap:nowrap;align-items:stretch;
    padding:20px 14px calc(16px + env(safe-area-inset-bottom));
    padding-top:max(20px, env(safe-area-inset-top));
    overflow:hidden;
    border-right:1px solid rgba(185,138,60,.18);
    box-shadow:14px 0 40px rgba(0,0,0,.40);
    transform:translateX(-101%);
    transition:transform .26s var(--ease);
    visibility:hidden}
  .nav-open .sidebar{transform:translateX(0);visibility:visible}

  .nav-veil{display:block;position:fixed;inset:0;z-index:55;
    background:rgba(11,26,21,.50);backdrop-filter:blur(2px);
    opacity:0;visibility:hidden;transition:opacity .22s;border:none;padding:0}
  .nav-open .nav-veil{opacity:1;visibility:visible}
  .nav-open{overflow:hidden}

  /* Dans le tiroir, le bouton du haut ferme : celui qui ouvre vit dans la
     barre haute, sinon il partirait hors ecran avec le tiroir. */
  .sidebar .nav-burger{display:flex;align-items:center;justify-content:center;
    position:absolute;top:max(22px, calc(env(safe-area-inset-top) + 2px));right:14px;
    width:32px;height:32px;border:none;border-radius:9px;
    background:rgba(255,255,255,.06);color:#A8BBB2;font-size:0;cursor:pointer;z-index:2}
  .sidebar .nav-burger::before{content:"\\00d7";font-size:20px;line-height:1}

  .brand-side{order:0;flex:none;padding-right:44px}
  .brand-side .brand-mark{width:36px;height:36px}
  .brand-side .brand-name{font-size:16px}
  .sidebar-head::after{margin:16px 0}

  .camping-switch{order:0;flex:none;width:100%;max-width:none}
  .camping-switch select{font-size:14px;padding:12px 34px 12px 13px;border-radius:10px}
  #exercice-switch select{font-size:13.5px;padding:11px 34px 11px 13px}
  #camping-switch{margin-bottom:7px}

  /* Le menu est toujours la, il n'a plus a etre deplie. */
  .nav{display:flex;order:0;width:auto;flex:1 1 auto;min-height:0;
    max-height:none;overflow-y:auto;margin-top:18px;padding:0;border-top:none;gap:2px}
  .nav a{padding:14px 13px;font-size:15px;border-radius:10px;min-height:48px}
  .nav a.active::before{display:block}
  .nav-ic{width:19px;height:19px}
  .nav-grp{padding:18px 13px 8px}
  .nav-grp:first-child{padding-top:0}

  .sidebar-foot{display:flex;order:0;width:auto;flex:none;margin-top:12px}
  #nav-msg-badge,#nav-imp-badge{min-width:20px;height:20px;font-size:11px;padding:0 6px}
}

@media (prefers-reduced-motion:reduce){
  .sidebar,.nav-veil{transition:none}
}
`;

styles += CSS;

/* ════════════ 4. LE HTML ════════════ */
const A_HTML = `<div id="app" class="app hidden">
  <aside class="sidebar">
    <button id="nav-burger" class="nav-burger" aria-label="Menu">☰</button>

    <div class="sidebar-head">
      <a href="#/dashboard" class="brand brand-side" title="Retour au tableau de bord">
        <div class="brand-mark"><img src="/logo.svg" alt="" width="64" height="64"></div>
        <div class="brand-name">Locamp</div>
      </a>`;

const N_HTML = `<div id="app" class="app hidden">

  <!-- Barre haute, mobile uniquement. Le bouton qui ouvre le menu vit ICI :
       place dans le tiroir, il partirait hors ecran une fois celui-ci ferme. -->
  <header class="topbar">
    <button id="topbar-burger" class="topbar-burger" aria-label="Ouvrir le menu" aria-expanded="false">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
    </button>
    <div class="topbar-titre">
      <div class="brand-name">Locamp</div>
      <div class="topbar-ctx" id="topbar-ctx"></div>
    </div>
    <div class="topbar-ini" id="topbar-ini" aria-hidden="true"></div>
  </header>
  <button class="nav-veil" id="nav-veil" aria-label="Fermer le menu" tabindex="-1"></button>

  <aside class="sidebar">
    <button id="nav-burger" class="nav-burger" aria-label="Fermer le menu">☰</button>

    <div class="sidebar-head">
      <a href="#/dashboard" class="brand brand-side" title="Retour au tableau de bord">
        <div class="brand-mark"><img src="/logo.svg" alt="" width="64" height="64"></div>
        <div>
          <div class="brand-name">Locamp</div>
          <div class="brand-role">Gestion</div>
        </div>
      </a>`;

const A_FOOT = `    <div class="sidebar-foot">
      <span id="user-name" class="user-name"></span>
      <button id="logout-btn" class="btn btn-ghost btn-sm">Se déconnecter</button>
    </div>`;

const N_FOOT = `    <div class="sidebar-foot">
      <div class="user-ini" id="user-ini" aria-hidden="true"></div>
      <div class="user-bloc">
        <span id="user-name" class="user-name"></span>
        <div class="user-role" id="user-role"></div>
      </div>
      <button id="logout-btn" class="btn btn-ghost btn-sm" title="Se déconnecter" aria-label="Se déconnecter">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>
        <span>Se déconnecter</span>
      </button>
    </div>`;

for (const [nom, a] of [['entete', A_HTML], ['pied', A_FOOT]]) {
  if (index.split(a).length - 1 !== 1) echec('index.html : ' + nom + ' introuvable.');
}
index = index.split(A_HTML).join(N_HTML).split(A_FOOT).join(N_FOOT);

/* ════════════ 5. LE COMPORTEMENT ════════════ */
const A_JS = `document.getElementById('nav-burger')?.addEventListener('click', () => document.body.classList.toggle('nav-open'));
document.querySelectorAll('.nav a').forEach((a) => a.addEventListener('click', () => document.body.classList.remove('nav-open')));`;

const N_JS = `/* Le tiroir : un bouton l'ouvre depuis la barre haute, trois choses le
   ferment — la croix, le voile, et la touche Echap. Un panneau qui recouvre
   la page doit pouvoir se fermer sans viser. */
function fermerMenu() {
  document.body.classList.remove('nav-open');
  document.getElementById('topbar-burger')?.setAttribute('aria-expanded', 'false');
}
function ouvrirMenu() {
  document.body.classList.add('nav-open');
  document.getElementById('topbar-burger')?.setAttribute('aria-expanded', 'true');
}
document.getElementById('topbar-burger')?.addEventListener('click', () =>
  document.body.classList.contains('nav-open') ? fermerMenu() : ouvrirMenu());
document.getElementById('nav-burger')?.addEventListener('click', fermerMenu);
document.getElementById('nav-veil')?.addEventListener('click', fermerMenu);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('nav-open')) fermerMenu();
});
document.querySelectorAll('.nav a').forEach((a) => a.addEventListener('click', fermerMenu));

/* L'initiale, le role, et le camping actif dans la barre haute : sur mobile,
   il faudrait sinon ouvrir le tiroir pour savoir ou l'on travaille. */
function majEnveloppe() {
  const nom = (document.getElementById('user-name')?.textContent || '').trim();
  const ini = nom ? nom.split(/[\\s.]+/).filter(Boolean).slice(0, 2)
    .map((m) => m[0].toUpperCase()).join('') : '';
  const poser = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  poser('user-ini', ini);
  poser('topbar-ini', ini);
  poser('user-role', window.MES_DROITS && MES_DROITS.admin ? 'Administrateur' : 'Gestionnaire');

  const camping = document.getElementById('camping-select');
  const exercice = document.getElementById('exercice-select');
  const bouts = [];
  if (camping && camping.selectedOptions[0]) bouts.push(camping.selectedOptions[0].textContent.trim());
  if (exercice && exercice.selectedOptions[0]) bouts.push(exercice.selectedOptions[0].textContent.trim());
  poser('topbar-ctx', bouts.join(' · '));
}
document.getElementById('camping-select')?.addEventListener('change', majEnveloppe);
document.getElementById('exercice-select')?.addEventListener('change', majEnveloppe);
/* Le nom d'utilisateur et les selecteurs sont remplis apres coup, a des
   moments differents : on observe plutot que de deviner le bon instant. */
new MutationObserver(majEnveloppe).observe(document.querySelector('.sidebar'),
  { childList: true, subtree: true, characterData: true });
setTimeout(majEnveloppe, 600);`;

if (app.split(A_JS).length - 1 !== 1) echec('app.js : bloc du menu mobile introuvable.');
app = app.split(A_JS).join(N_JS);

try { new Function(app); }
catch (e) { echec('app.js : le resultat n\'est pas du JavaScript valide — ' + e.message); }

/* ════════════ ECRITURE ════════════ */
if (!ESSAI) {
  fs.writeFileSync(LOGO, LOGO_SVG, 'utf8');
  fs.writeFileSync(MARQUE, marque, 'utf8');
  fs.writeFileSync(STYLES, styles, 'utf8');
  fs.writeFileSync(INDEX, index, 'utf8');
  fs.writeFileSync(APP, app, 'utf8');

  const ok = fs.readFileSync(STYLES, 'utf8').indexOf('══ ENVELOPPE') !== -1
          && fs.readFileSync(INDEX, 'utf8').indexOf('topbar-burger') !== -1
          && fs.readFileSync(APP, 'utf8').indexOf('fermerMenu') !== -1;
  if (!ok) echec('Verification apres ecriture : un fichier n\'a pas ete modifie.');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  logo.svg      monogramme, une lettre et un filet');
console.log('  marque.css    enseigne lettree, jeton --or-clair');
console.log('  styles.css    barre a 252 px, un seul effet, survol sans decalage');
console.log('  index.html    barre haute mobile, initiale, contexte du camping');
console.log('  app.js        tiroir : croix, voile et Echap le ferment\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

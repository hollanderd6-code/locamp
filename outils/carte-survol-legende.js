#!/usr/bin/env node
/* ============================================================
   outils/carte-survol-legende.js
   Ce que dit une pastille avant qu'on clique dessus
   ============================================================
   Cibles : backend/public/app.js
            backend/public/styles.css
   Prerequis : outils/carte-recherche.js applique.

   ── DEUX DEFAUTS QUI SE REPONDENT ────────────────────────────────

   1. UNE PASTILLE NE DIT RIEN AVANT LE CLIC.
      Un cercle de couleur et un numero. Pour savoir qui occupe le 87,
      il faut cliquer, lire, fermer. Repete douze fois pour faire le tour
      d'une allee, c'est douze allers-retours. L'occupant est pourtant
      deja charge : l'API le renvoie avec chaque emplacement.

   2. LA LEGENDE EST SOUS LE PLAN.
      Elle explique cinq couleurs, et n'apparait qu'apres avoir fait
      defiler tout le plan. On voit donc les couleurs longtemps avant de
      savoir ce qu'elles disent. Une legende posee apres ce qu'elle
      explique arrive trop tard.

   ── CE QUI EST FAIT ──────────────────────────────────────────────
   Le survol affiche une infobulle : numero, occupant, statut. Elle suit
   le curseur, reste dans le cadre, et disparait des qu'on sort. Sur
   ecran tactile elle ne se declenche pas — le toucher ouvre la fiche,
   qui dit tout : une infobulle qui s'accroche au doigt gene plus qu'elle
   n'aide.

   La legende remonte au-dessus du plan, sur la meme ligne que la
   recherche. Elle y tient : cinq pastilles et cinq mots.

   Les emplacements sans position remontent avec elle, et deviennent un
   bouton qui ouvre le mode edition. L'ancien message, gris, sous le
   plan, disait d'y passer sans y mener.

   Usage :
     node outils/carte-survol-legende.js --essai
     node outils/carte-survol-legende.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const ESSAI  = process.argv.includes('--essai') || process.argv.includes('--dry');
const APP    = path.join(process.cwd(), 'backend', 'public', 'app.js');
const STYLES = path.join(process.cwd(), 'backend', 'public', 'styles.css');

for (const f of [APP, STYLES]) {
  if (!fs.existsSync(f)) {
    console.error('\n  \u2717 ' + f + ' introuvable. Lancez depuis la racine du projet.\n');
    process.exit(1);
  }
}

let app = fs.readFileSync(APP, 'utf8');
let css = fs.readFileSync(STYLES, 'utf8');

if (app.indexOf('carteInfobulle') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}
if (app.indexOf('filtrerCarte') === -1) {
  console.error('\n  \u2717 Appliquez d\'abord outils/carte-recherche.js.\n');
  process.exit(1);
}

const edits = [];

/* ── 1. La pastille porte de quoi renseigner l'infobulle ──────────── */
edits.push([
  'donnees de survol',
  `      data-cherche="\${esc(sansAccents(\`\${e.numero} \${occ}\`))}">`,
  `      data-cherche="\${esc(sansAccents(\`\${e.numero} \${occ}\`))}"
      data-num="\${esc(e.numero)}" data-occ="\${esc(occ.trim())}"
      data-etat="\${esc(libelleEtat(e))}">`
]);

/* ── 2. Le libelle d'etat, deduit comme la couleur ────────────────── */
edits.push([
  'libelle d\'etat',
  `/* --------------------- recherche sur le plan --------------------- */`,
  `/* Le mot qui accompagne la couleur. Meme deduction que carteColor : les
   deux doivent dire la meme chose, sinon l'infobulle contredit la pastille. */
function libelleEtat(e) {
  if (e.resident && carteState.enRetard.has(e.resident.id)) return 'impayé';
  return LABELS[statutReel(e)] || statutReel(e);
}

/* --------------------- recherche sur le plan --------------------- */`
]);

/* ── 3. Legende et emplacements sans position, au-dessus du plan ──── */
edits.push([
  'barre du haut',
  `    \${edit ? '' : \`<div class="map-search">
      <input id="map-q" type="search" placeholder="Numéro ou nom de l'occupant" autocomplete="off"
        aria-label="Rechercher un emplacement">
      <span class="muted" id="map-q-info">\${st.emplacements.length} emplacements — cliquer une pastille pour ouvrir la fiche</span>
    </div>\`}`,
  `    \${edit ? '' : \`<div class="map-search">
      <input id="map-q" type="search" placeholder="Numéro ou nom de l'occupant" autocomplete="off"
        aria-label="Rechercher un emplacement">
      <span class="muted" id="map-q-info">\${st.emplacements.length} emplacements — cliquer une pastille pour ouvrir la fiche</span>
    </div>
    <div class="map-bar">
      <div class="map-legend">
        <span><span class="dot" style="background:\${STATUT_COLOR.libre}"></span>Libre</span>
        <span><span class="dot" style="background:\${STATUT_COLOR.occupe}"></span>Occupé</span>
        <span><span class="dot" style="background:\${STATUT_COLOR.impaye}"></span>Impayé</span>
        <span><span class="dot" style="background:\${STATUT_COLOR.reserve}"></span>Réservé</span>
        <span><span class="dot" style="background:\${STATUT_COLOR.indisponible}"></span>Indisponible</span>
      </div>
      \${unplaced.length ? \`<button class="btn btn-ghost btn-sm" data-act="toggleCarteEdit"
        title="\${esc(unplaced.map((e) => e.numero).join(', '))}">
        \${unplaced.length} sans position — les placer</button>\` : ''}
    </div>\`}`
]);

/* ── 4. L'ancienne legende et l'ancien message quittent le bas ────── */
edits.push([
  'ancienne legende',
  `          <div class="map-legend">
            <span><span class="dot" style="background:\${STATUT_COLOR.libre}"></span>Libre</span>
            <span><span class="dot" style="background:\${STATUT_COLOR.occupe}"></span>Occupé</span>
            <span><span class="dot" style="background:\${STATUT_COLOR.impaye}"></span>Impayé</span>
            <span><span class="dot" style="background:\${STATUT_COLOR.reserve}"></span>Réservé</span>
            <span><span class="dot" style="background:\${STATUT_COLOR.indisponible}"></span>Indisponible</span>
          </div>
        </div>
        \${!edit && unplaced.length ? \`<p class="muted" style="margin-top:12px">Sans position : \${unplaced.map((e) => esc(e.numero)).join(', ')} — passer en mode édition pour les placer.</p>\` : ''}`,
  `          \${edit ? \`<div class="map-legend">
            <span><span class="dot" style="background:\${STATUT_COLOR.libre}"></span>Libre</span>
            <span><span class="dot" style="background:\${STATUT_COLOR.occupe}"></span>Occupé</span>
            <span><span class="dot" style="background:\${STATUT_COLOR.impaye}"></span>Impayé</span>
            <span><span class="dot" style="background:\${STATUT_COLOR.reserve}"></span>Réservé</span>
            <span><span class="dot" style="background:\${STATUT_COLOR.indisponible}"></span>Indisponible</span>
          </div>\` : ''}
          <div class="map-tip" id="map-tip" aria-hidden="true"></div>
        </div>`
]);

/* ── 5. Le survol ─────────────────────────────────────────────────── */
edits.push([
  'branchement du survol',
  `  const champ = $('#map-q');
  if (champ) {`,
  `  carteInfobulle();

  const champ = $('#map-q');
  if (champ) {`
]);

edits.push([
  'fonction d\'infobulle',
  `/* --------------------- panneau de propriétés --------------------- */`,
  `/* L'infobulle de survol. L'occupant est deja charge — le clic ne devrait pas
   etre le seul moyen de savoir qui habite le 87.

   Rien sur ecran tactile : le toucher ouvre la fiche, qui dit tout, et une
   infobulle accrochee au doigt masque ce qu'on regarde. */
function carteInfobulle() {
  const wrap = document.querySelector('.map-wrap');
  const tip  = $('#map-tip');
  if (!wrap || !tip || carteState.mode === 'edit') return;
  if (!window.matchMedia || !window.matchMedia('(hover: hover)').matches) return;

  const cacher = () => { tip.classList.remove('on'); };

  wrap.addEventListener('mousemove', (ev) => {
    const pin = ev.target.closest?.('.pin');
    if (!pin) { cacher(); return; }

    const num = pin.dataset.num || '';
    const occ = pin.dataset.occ || '';
    tip.innerHTML = \`<strong>\${esc(num)}</strong>\${occ ? ' · ' + esc(occ) : ''}\`
      + \`<span class="map-tip-etat">\${esc(pin.dataset.etat || '')}</span>\`;
    tip.classList.add('on');

    /* Ancree dans le cadre, pas dans la page : le plan defile, l'infobulle
       doit rester avec lui. Et elle bascule a gauche pres du bord droit,
       sinon elle sortirait du cadre sur la derniere colonne. */
    const r = wrap.getBoundingClientRect();
    const x = ev.clientX - r.left, y = ev.clientY - r.top;
    const large = tip.offsetWidth || 160;
    tip.style.left = (x + large + 24 > r.width ? x - large - 14 : x + 14) + 'px';
    tip.style.top  = Math.max(4, y - 38) + 'px';
  });

  wrap.addEventListener('mouseleave', cacher);
}

/* --------------------- panneau de propriétés --------------------- */`
]);

for (const [nom, ancien] of edits) {
  const n = app.split(ancien).length - 1;
  if (n !== 1) {
    console.error('\n  \u2717 ' + nom + ' : ' + n + ' occurrence(s), 1 attendue.');
    console.error('    Le fichier a change. Rien n\'a ete ecrit.\n');
    process.exit(1);
  }
}
for (const [, ancien, nouveau] of edits) app = app.split(ancien).join(nouveau);

try {
  new Function(app);
} catch (e) {
  console.error('\n  \u2717 Le resultat n\'est pas du JavaScript valide : ' + e.message);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

css += `

/* ── Carte : légende en tête et infobulle de survol ── */
.map-bar{display:flex;align-items:center;justify-content:space-between;gap:14px;
  flex-wrap:wrap;margin-bottom:10px}

/* Le cadre ancre l'infobulle : le plan défile, elle doit suivre avec lui. */
.map-wrap{position:relative}
.map-tip{position:absolute;z-index:5;pointer-events:none;opacity:0;transition:opacity .1s;
  background:#20221F;color:#fff;font-size:12.5px;line-height:1.45;white-space:nowrap;
  padding:7px 11px;border-radius:9px;box-shadow:0 8px 22px rgba(32,34,31,.26)}
.map-tip.on{opacity:1}
.map-tip strong{font-weight:700}
.map-tip-etat{display:block;font-size:11px;opacity:.72;text-transform:lowercase}
`;

if (!ESSAI) {
  fs.writeFileSync(APP, app, 'utf8');
  fs.writeFileSync(STYLES, css, 'utf8');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log('  Survol : numero, occupant, statut. Rien sur tactile.');
console.log('  Legende au-dessus du plan, avec les emplacements sans position.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

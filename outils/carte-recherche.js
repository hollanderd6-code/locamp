#!/usr/bin/env node
/* ============================================================
   outils/carte-recherche.js
   Trouver un emplacement sans balayer 124 pastilles
   ============================================================
   Cibles : backend/public/app.js
            backend/public/styles.css

   ── LE BESOIN ────────────────────────────────────────────────────
   Le plan porte 124 pastilles de 26 px, numerotees dans un ordre qui
   suit le terrain et non les chiffres. Pour trouver le 87, on balaie a
   l'oeil. C'est pourtant le geste le plus frequent a l'accueil.

   ── CE QUE LA RECHERCHE COUVRE ───────────────────────────────────
   Le numero, mais aussi le NOM DE L'OCCUPANT. A l'accueil la question
   arrive rarement sous forme de numero : c'est « ou est monsieur
   Berthier ? ». La donnee est deja chargee — l'API renvoie le resident
   rattache a chaque emplacement — il aurait ete dommage de ne pas s'en
   servir.

   La saisie ignore accents et casse : « bertier » ne trouve pas
   « Berthier », mais « BERTHIER » et « berthier » oui.

   ── COMMENT L'AFFICHAGE REAGIT ───────────────────────────────────
   On n'efface pas ce qui ne correspond pas : on l'estompe. Un
   emplacement se comprend par ses voisins et son allee — sortir les
   autres du plan ferait perdre le repere qu'on cherche justement. Les
   pastilles trouvees gardent leur couleur et prennent un anneau ambre.

   Le rendu ne passe PAS par un nouveau dessin du plan. Chaque frappe
   redessinerait 124 pastilles et tout le decor ; on se contente de
   poser des classes sur le SVG deja en place. La recherche reste fluide
   sur un vieux poste d'accueil.

   Echap efface. Le champ n'existe qu'en mode consultation : en mode
   edition, estomper les pastilles gênerait le placement.

   Usage :
     node outils/carte-recherche.js --essai
     node outils/carte-recherche.js
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

if (app.indexOf('filtrerCarte') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

const edits = [];

/* ── 1. Chaque pastille porte de quoi etre trouvee ────────────────── */
edits.push([
  'donnee de recherche sur la pastille',
  `    return \`<g class="pin\${sel}" data-id="\${e.id}" data-kind="emp" transform="translate(\${x},\${y})">
      <circle r="13" fill="\${carteColor(e)}"></circle><text>\${esc(e.numero)}</text></g>\`;`,
  `    /* Numero et occupant, normalises une fois au rendu : la recherche n'a
       plus qu'a comparer des chaines, sans retraiter 124 fiches par frappe. */
    const occ = e.resident ? \`\${e.resident.prenom || ''} \${e.resident.nom || ''}\` : '';
    return \`<g class="pin\${sel}" data-id="\${e.id}" data-kind="emp" transform="translate(\${x},\${y})"
      data-cherche="\${esc(sansAccents(\`\${e.numero} \${occ}\`))}">
      <circle r="13" fill="\${carteColor(e)}"></circle><text>\${esc(e.numero)}</text></g>\`;`
]);

/* ── 2. Le champ, a cote du compte d'emplacements ─────────────────── */
edits.push([
  'barre de recherche',
  `    \${edit ? '' : \`<span class="muted">\${st.emplacements.length} emplacements — cliquer une pastille pour ouvrir la fiche</span>\`}`,
  `    \${edit ? '' : \`<div class="map-search">
      <input id="map-q" type="search" placeholder="Numéro ou nom de l'occupant" autocomplete="off"
        aria-label="Rechercher un emplacement">
      <span class="muted" id="map-q-info">\${st.emplacements.length} emplacements — cliquer une pastille pour ouvrir la fiche</span>
    </div>\`}`
]);

/* ── 3. La normalisation et le filtre ─────────────────────────────── */
edits.push([
  'fonctions de recherche',
  `/* --------------------- panneau de propriétés --------------------- */`,
  `/* --------------------- recherche sur le plan --------------------- */

/* Minuscules sans accents : « BERTHIER », « Berthier » et « berthier »
   doivent se valoir. Sur le numero c'est sans effet, sur les noms c'est
   ce qui fait la difference entre trouver et ne pas trouver. */
function sansAccents(s) {
  return String(s || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().trim();
}

/* On pose des classes sur le SVG en place plutot que de redessiner : un
   nouveau rendu par frappe recalculerait 124 pastilles et tout le decor. */
function filtrerCarte(q) {
  const svg  = document.querySelector('.map-svg');
  const info = $('#map-q-info');
  if (!svg) return;

  const terme = sansAccents(q);
  const pins = svg.querySelectorAll('.pin');

  if (!terme) {
    svg.classList.remove('filtre');
    pins.forEach((p) => p.classList.remove('trouve'));
    if (info) info.textContent = \`\${pins.length} emplacements — cliquer une pastille pour ouvrir la fiche\`;
    return;
  }

  let n = 0;
  pins.forEach((p) => {
    const ok = (p.dataset.cherche || '').includes(terme);
    p.classList.toggle('trouve', ok);
    if (ok) n += 1;
  });
  svg.classList.add('filtre');

  if (info) {
    info.textContent = n === 0
      ? \`Aucun emplacement ne correspond à « \${q.trim()} »\`
      : n === 1 ? '1 emplacement trouvé' : \`\${n} emplacements trouvés\`;
  }
}

/* --------------------- panneau de propriétés --------------------- */`
]);

/* ── 4. Brancher le champ apres le rendu ──────────────────────────── */
edits.push([
  'branchement',
  `  wireCarte();
  renderProps();`,
  `  wireCarte();
  renderProps();

  const champ = $('#map-q');
  if (champ) {
    champ.addEventListener('input', () => filtrerCarte(champ.value));
    champ.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { champ.value = ''; filtrerCarte(''); }
    });
  }`
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

/* ── 5. Le style ──────────────────────────────────────────────────── */
css += `

/* ── Carte : recherche ──
   Ce qui ne correspond pas est estompé, pas retiré : un emplacement se
   comprend par ses voisins et son allée. Sortir le reste du plan ferait
   perdre le repère qu'on est venu chercher. */
.map-search{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px}
.map-search input{width:260px;max-width:100%;padding:8px 12px;border:1px solid var(--border);
  border-radius:10px;font-family:inherit;font-size:13px;background:#fff}
.map-search input:focus{outline:none;border-color:var(--pg);box-shadow:0 0 0 3px rgba(30,92,74,.12)}
@media (max-width:560px){.map-search input{width:100%}}

.map-svg.filtre .pin{opacity:.16;transition:opacity .12s}
.map-svg.filtre .pin.trouve{opacity:1}
.map-svg.filtre .pin.trouve circle{stroke:#C98B2D;stroke-width:3.5}
`;

if (!ESSAI) {
  fs.writeFileSync(APP, app, 'utf8');
  fs.writeFileSync(STYLES, css, 'utf8');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log('  Recherche par numero ET par nom d\'occupant.');
console.log('  Les pastilles non trouvees sont estompees, pas retirees.');
console.log('  Aucun nouveau rendu du plan a la frappe.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

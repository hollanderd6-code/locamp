#!/usr/bin/env node
/* ============================================================
   outils/emplacement-modifiable.js
   Modifier un emplacement existant (type, statut, loyer, secteur…)
   ============================================================
   Cible : backend/public/app.js

   ── CE QUI MANQUAIT ─────────────────────────────────────────────
   Le tiroir d'un emplacement (ficheEmplacement) est en lecture
   seule : numero, type, statut, loyer, resident, factures. Aucun
   bouton n'y mene a un formulaire. Le seul formulaire d'emplacement
   du produit est celui de la creation, et son champ « Type » est un
   select a quatre valeurs figees dans le code :

       mobil-home · chalet · caravane · parcelle nue

   Un camping qui nomme ses lots « MH 2 chambres Haut de gamme » ne
   peut donc ni les saisir a la creation, ni les corriger apres coup :
   il faut passer par du SQL. La route existe pourtant depuis le
   depart — PUT /api/emplacements/:id accepte numero, secteur, type,
   statut, loyer_base, periodicite, coord_x, coord_y. C'est l'ecran
   qui manque, pas le serveur.

   ── CE QUE FAIT CE CORRECTIF ────────────────────────────────────
   1. Un bouton « Modifier » dans le tiroir de l'emplacement.
   2. Un formulaire d'edition prerempli, qui enregistre via la route
      existante. Aucune modification du backend.
   3. Le champ Type devient un texte libre avec suggestions (datalist)
      alimente par les types deja presents dans le camping, plus les
      quatre valeurs d'origine. C'est du texte libre en base
      (emplacements.type) : la liste propose, elle n'impose pas.
      Le formulaire de creation utilise la meme liste.

   Le statut reste saisissable, mais le plan continue d'afficher
   « occupe » des qu'un resident habite l'emplacement (statutReel) :
   c'est une consequence, pas une saisie. Le formulaire le dit.

   Usage :
     node outils/emplacement-modifiable.js --essai
     node outils/emplacement-modifiable.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'backend', 'public', 'app.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

/* Le code ajoute est ecrit ici comme une vraie fonction, puis
   transforme en texte : on evite d'echapper a la main chaque
   accent grave et chaque ${} du HTML genere. */
function AJOUTS() {
  /* ---------- Types d'emplacement : une liste ouverte ----------
     emplacements.type est du texte libre en base. Les quatre valeurs
     du formulaire de creation etaient figees dans le code — on propose
     desormais ce qui existe deja dans le camping, sans interdire
     d'ecrire autre chose. */
  const TYPES_EMP_BASE = ['mobil-home', 'chalet', 'caravane', 'parcelle nue'];

  async function typesEmplacement() {
    try {
      const { emplacements } = await api('/api/emplacements');
      const vus = (emplacements || []).map((e) => String(e.type || '').trim()).filter(Boolean);
      return [...new Set([...vus, ...TYPES_EMP_BASE])]
        .sort((a, b) => a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' }));
    } catch (_) {
      /* La liste n'est qu'une aide a la saisie : sans elle, le champ
         reste utilisable. */
      return TYPES_EMP_BASE;
    }
  }

  function datalistTypesEmp(types) {
    return `<datalist id="liste-types-emp">${types
      .map((t) => `<option value="${esc(t)}"></option>`).join('')}</datalist>`;
  }

  /* ---------- Modifier un emplacement existant ---------- */
  window.modifierEmplacement = async (id) => {
    let e; let types;
    try {
      [{ emplacement: e }, types] = await Promise.all([
        api('/api/emplacements/' + id), typesEmplacement(),
      ]);
    } catch (err) { toast(err.message, true); return; }

    const STATUTS = [['libre', 'libre'], ['occupe', 'occupé'],
      ['reserve', 'réservé'], ['indisponible', 'indisponible (travaux…)']];
    const val = (v) => (v == null ? '' : String(v));

    openDrawer(`
      <h2>Modifier l'emplacement ${esc(e.numero)}</h2>
      <p class="muted" style="margin-top:4px">Le résident rattaché et ses contrats ne sont pas touchés.</p>
      <form id="f-emp-edit" class="form-grid" style="margin-top:14px">
        <label>Numéro *<input name="numero" required value="${esc(e.numero)}"></label>
        <label>Secteur<input name="secteur" value="${esc(val(e.secteur))}"></label>
        <label class="full">Type
          <input name="type" list="liste-types-emp" autocomplete="off"
                 value="${esc(val(e.type))}" placeholder="MH 2 chambres, chalet, parcelle nue…">
        </label>
        ${datalistTypesEmp(types)}
        <label>Statut
          <select name="statut">${STATUTS.map(([k, lbl]) =>
            `<option value="${k}"${e.statut === k ? ' selected' : ''}>${lbl}</option>`).join('')}</select>
        </label>
        <label>Loyer de base TTC (€)<input name="loyer_base" type="number" step="0.01" value="${val(e.loyer_base)}"></label>
        <label>Coord. X (carte)<input name="coord_x" type="number" step="1" value="${val(e.coord_x)}"></label>
        <label>Coord. Y (carte)<input name="coord_y" type="number" step="1" value="${val(e.coord_y)}"></label>
        <div class="full"><button class="btn btn-primary btn-block">Enregistrer</button></div>
      </form>
      <p class="muted" style="margin-top:12px;font-size:12.5px">Un emplacement où habite un résident reste affiché « occupé » sur le plan, quel que soit le statut choisi ici.</p>`);

    $('#f-emp-edit').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      /* Un champ vide efface la valeur (null) au lieu d'envoyer une
         chaine vide : c'est la seule facon de retirer un secteur ou un
         type saisi par erreur. */
      const body = {};
      for (const k of ['numero', 'secteur', 'type', 'statut']) {
        const v = String(f.get(k) ?? '').trim();
        body[k] = v === '' ? null : v;
      }
      if (!body.numero) { toast('Le numéro est obligatoire', true); return; }
      if (!body.statut) delete body.statut;
      for (const k of ['loyer_base', 'coord_x', 'coord_y']) {
        const v = String(f.get(k) ?? '').trim();
        body[k] = v === '' ? null : Number(v);
      }
      try {
        await api('/api/emplacements/' + id, { method: 'PUT', body });
        closeDrawer();
        toast(`Emplacement ${body.numero} enregistré`);
        if (typeof carteState !== 'undefined' && carteState) carteState = null;
        route();
      } catch (err) { toast(err.message, true); }
    });
  };
}

if (!fs.existsSync(CIBLE)) echec('backend/public/app.js introuvable. Lancez depuis la racine du projet.');

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('modifierEmplacement') !== -1) {
  console.log('\n  Le formulaire de modification est deja present — rien a faire.\n');
  process.exit(0);
}

function unique(aiguille, quoi) {
  const n = src.split(aiguille).length - 1;
  if (n !== 1) echec(`${quoi} : ${n} occurrence(s) trouvee(s) au lieu d'une. app.js a change.`);
}

/* 1. Bouton « Modifier » dans le tiroir de l'emplacement. */
const A_ANCIEN = '    <h2>Emplacement ${esc(e.numero)}</h2>';
const A_NOUVEAU = '    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px">'
  + '\n      <h2>Emplacement ${esc(e.numero)}</h2>'
  + '\n      <button class="btn btn-ghost btn-sm" data-act="modifierEmplacement" data-a1="${e.id}">Modifier</button>'
  + '\n    </div>';
unique(A_ANCIEN, 'Titre du tiroir emplacement');
src = src.split(A_ANCIEN).join(A_NOUVEAU);

/* 2. Le select figé du formulaire de création devient la liste ouverte. */
const B_ANCIEN = '      <label>Type<select name="type"><option value="">—</option><option>mobil-home</option>'
  + '<option>chalet</option><option>caravane</option><option>parcelle nue</option></select></label>';
const B_NOUVEAU = '      <label class="full">Type'
  + '\n        <input name="type" list="liste-types-emp" autocomplete="off" placeholder="MH 2 chambres, chalet, parcelle nue…">'
  + '\n      </label>'
  + '\n      ${datalistTypesEmp(types)}';
unique(B_ANCIEN, 'Champ Type du formulaire de creation');
src = src.split(B_ANCIEN).join(B_NOUVEAU);

/* 3. …ce qui demande d'attendre la liste : la fonction devient async. */
const C_ANCIEN = 'window.formEmplacement = () => {\n  openDrawer(`';
const C_NOUVEAU = 'window.formEmplacement = async () => {\n  const types = await typesEmplacement();\n  openDrawer(`';
unique(C_ANCIEN, 'Ouverture de formEmplacement');
src = src.split(C_ANCIEN).join(C_NOUVEAU);

/* 4. Le code ajouté, en fin de fichier. */
const AJOUT = AJOUTS.toString()
  .replace(/^function AJOUTS\(\)\s*\{\r?\n/, '')
  .replace(/\}\s*$/, '')
  .replace(/^ {2}/gm, '');

src = src.replace(/\s*$/, '\n')
  + '\n/* ============================================================\n'
  + '   Emplacements : modification d\'un emplacement existant\n'
  + '   (ajoute par outils/emplacement-modifiable.js)\n'
  + '   ============================================================ */\n'
  + AJOUT.replace(/\s*$/, '\n');

try { new Function(src); }
catch (e) { echec('Le resultat n\'est pas du JavaScript valide — ' + e.message); }

for (const [quoi, aiguille] of [
  ['le bouton Modifier', 'data-act="modifierEmplacement"'],
  ['la fonction modifierEmplacement', 'window.modifierEmplacement'],
  ['la liste ouverte des types', 'liste-types-emp'],
  ['la lecture des types existants', 'async function typesEmplacement'],
]) if (src.indexOf(aiguille) === -1) echec(`Verification : ${quoi} est absent du resultat.`);

if (src.indexOf('<option>parcelle nue</option>') !== -1) echec('Le select fige des types subsiste.');

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  const relu = fs.readFileSync(CIBLE, 'utf8');
  if (relu.indexOf('window.modifierEmplacement') === -1) echec('L\'ajout est absent apres ecriture.');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Tiroir emplacement : bouton « Modifier ».');
console.log('  Formulaire d\'edition : numero, secteur, type, statut, loyer, coordonnees.');
console.log('  Type : texte libre avec suggestions (types deja utilises + les quatre d\'origine).');
console.log('  Aucun changement backend — PUT /api/emplacements/:id existait deja.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

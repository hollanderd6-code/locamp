#!/usr/bin/env node
/* ============================================================
   outils/ecrans-mobile.js
   Les ecrans refaits, utilisables sur telephone
   ============================================================
   Cibles : backend/public/app.js  et  backend/public/styles.css

   ── LE PROBLEME ─────────────────────────────────────────────────
   Les ecrans repris (tableau de bord, emplacements, factures,
   contrats, reglements, impayes, messagerie, residents) ont ete
   dessines en largeur de bureau. Trois structures ne tiennent pas sur
   un telephone :

   1. Le bandeau de quatre chiffres sur une seule ligne : a 390 px de
      large, chaque colonne fait 90 px, les montants debordent et
      « IMPAYES 454,3… » est coupe net.
   2. Liste + fiche cote a cote : 380 px de liste plus la fiche
      depassent la fenetre. La colonne de droite de chaque ligne
      (« Libre », « Impaye ») disparait hors ecran.
   3. Les lignes dont l'action est a droite : « Relancer » et « Detail »
      sortent de l'ecran, donc l'action est inatteignable — c'est le
      plus grave, on ne peut plus travailler.

   ── LE CORRECTIF ────────────────────────────────────────────────
   Aucune modification du rendu bureau. On pose des classes sur les
   structures existantes (les styles en ligne restent la reference
   bureau) et on ajoute UN bloc @media (max-width:880px) — la meme
   rupture que le reste de styles.css — qui les reorganise :

   · bandeau de chiffres -> grille 2 x 2
   · liste + fiche -> empilees, liste en haut, hauteur bornee a 46 vh
     pour que la fiche reste accessible sans defiler longtemps
   · lignes a action -> l'action passe sous le texte, alignee dessous
   · colonnes du tableau de bord -> pleine largeur

   Les regles portent !important parce qu'elles doivent battre des
   styles en ligne : c'est la seule facon de garder le rendu bureau
   intact sans reecrire les huit ecrans.

   La fiche recoit overflow-x:auto : les tableaux internes a colonnes
   fixes (postes d'une facture, factures d'un debiteur) restent lisibles
   par glissement lateral au lieu d'etre tronques.

   Usage :
     node outils/ecrans-mobile.js --essai
     node outils/ecrans-mobile.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const APP = path.join(process.cwd(), 'backend', 'public', 'app.js');
const CSS = path.join(process.cwd(), 'backend', 'public', 'styles.css');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

for (const f of [APP, CSS]) if (!fs.existsSync(f)) echec(`${f} introuvable. Lancez depuis la racine du projet.`);

let app = fs.readFileSync(APP, 'utf8');
let css = fs.readFileSync(CSS, 'utf8');

const MARQUE = '/* ==== Ecrans liste + fiche sur telephone';
if (css.indexOf(MARQUE) !== -1 || app.indexOf('class="card bandeau"') !== -1) {
  console.log('\n  Les ecrans sont deja adaptes au telephone — rien a faire.\n');
  process.exit(0);
}

/* Chaque entree : [ce qu'on cherche, ce qu'on ecrit, combien de fois exactement].
   Le compte est verifie avant d'ecrire : si app.js a change, on s'arrete. */
const EDITS = [
  // Bandeaux de chiffres (residents, impayes, compteurs, tableau de bord, fiche debiteur)
  ['class="card" style="display:flex;padding:0;margin-bottom:14px"',
    'class="card bandeau" style="display:flex;padding:0;margin-bottom:14px"', 3],
  ['class="card" style="display:flex;padding:0;margin-bottom:16px"',
    'class="card bandeau" style="display:flex;padding:0;margin-bottom:16px"', 1],
  ['class="card" style="display:flex;padding:0"',
    'class="card bandeau" style="display:flex;padding:0"', 1],

  // Conteneurs liste + fiche
  ['class="card" style="padding:0;overflow:hidden;display:flex;align-items:stretch;min-height:560px"',
    'class="card duo" style="padding:0;overflow:hidden;display:flex;align-items:stretch;min-height:560px"', 3],
  ['class="card" style="padding:0;overflow:hidden;display:flex;align-items:stretch;min-height:520px"',
    'class="card duo" style="padding:0;overflow:hidden;display:flex;align-items:stretch;min-height:520px"', 2],
  ['class="card" style="padding:0;overflow:hidden;display:flex;align-items:stretch;height:620px"',
    'class="card duo" style="padding:0;overflow:hidden;display:flex;align-items:stretch;height:620px"', 1],

  // Colonne de gauche (la liste) et panneau de droite (la fiche)
  ['style="width:380px;flex:none;border-right:1px solid var(--hairline);display:flex;flex-direction:column;min-width:0"',
    'class="duo-liste" style="width:380px;flex:none;border-right:1px solid var(--hairline);display:flex;flex-direction:column;min-width:0"', 6],
  ['style="flex:1;min-width:0;background:var(--ivoire)"',
    'class="duo-fiche" style="flex:1;min-width:0;background:var(--ivoire)"', 5],
  ['style="flex:1;min-width:0;background:var(--ivoire);display:flex;flex-direction:column;min-height:0"',
    'class="duo-fiche" style="flex:1;min-width:0;background:var(--ivoire);display:flex;flex-direction:column;min-height:0"', 1],

  // Les deux colonnes du tableau de bord
  ['class="card" style="flex:1.35;min-width:420px;padding:0;overflow:hidden"',
    'class="card duo-col" style="flex:1.35;min-width:420px;padding:0;overflow:hidden"', 1],
  ['<div style="flex:1;min-width:300px;display:flex;flex-direction:column;gap:16px">',
    '<div class="duo-col" style="flex:1;min-width:300px;display:flex;flex-direction:column;gap:16px">', 1],

  // La ligne « A traiter » : son action doit rester atteignable
  ['<div style="display:flex;align-items:center;gap:12px;padding:0 18px;height:66px;\n                      border-bottom:1px solid var(--hairline)">',
    '<div class="ligne-act" style="display:flex;align-items:center;gap:12px;padding:0 18px;height:66px;\n                      border-bottom:1px solid var(--hairline)">', 1],
];

for (const [cherche, , attendu] of EDITS) {
  const n = app.split(cherche).length - 1;
  if (n !== attendu) {
    echec(`Motif trouve ${n} fois au lieu de ${attendu} — app.js a change :\n    ${cherche.slice(0, 90)}…`);
  }
}
for (const [cherche, remplace] of EDITS) app = app.split(cherche).join(remplace);

try { new Function(app); }
catch (e) { echec('app.js resultant n\'est pas du JavaScript valide — ' + e.message); }

const REGLES = `
${MARQUE} =====================================
   Ces ecrans sont ecrits avec des styles en ligne, calibres pour le
   bureau. Les regles ci-dessous les reorganisent sous 880 px et
   portent donc !important : c'est ce qui permet de ne pas dupliquer
   huit mises en page.
   ============================================================ */
@media (max-width:880px){
  /* Bandeaux de chiffres : quatre colonnes ne tiennent pas. Grille 2 x 2,
     et on refait les separateurs — les bordures gauche viennent du style
     en ligne et n'ont plus de sens ici. */
  .bandeau{display:grid !important;grid-template-columns:1fr 1fr !important}
  .bandeau>div{border-left:0 !important;border-top:1px solid var(--hairline) !important;
    padding:12px 14px !important;min-width:0 !important}
  .bandeau>div:nth-child(1),.bandeau>div:nth-child(2){border-top:0 !important}
  .bandeau>div:nth-child(even){border-left:1px solid var(--hairline) !important}

  /* Liste + fiche : empilees. La liste garde une hauteur bornee, sinon
     il faudrait defiler 58 lignes avant d'atteindre la fiche. */
  .duo{flex-direction:column !important;min-height:0 !important;height:auto !important}
  .duo-liste{width:auto !important;flex:none !important;border-right:0 !important;
    border-bottom:1px solid var(--hairline) !important}
  .duo-liste>div:last-child{max-height:46vh !important;overflow:auto !important}
  /* Les lignes des tableaux internes ont une hauteur fixe, calibree pour
     du texte sur une seule ligne. En colonne etroite le libelle passe a
     la ligne et se faisait couper : la hauteur devient un minimum. */
  .duo-fiche div[style*="display:grid"]{height:auto !important;min-height:46px !important;
    padding-top:10px !important;padding-bottom:10px !important}
  /* Les tableaux a trois colonnes et plus (postes d'une facture, factures
     d'un debiteur) ne rentrent pas dans une colonne de telephone. Plutot
     que d'ecraser la derniere colonne — le montant, justement celle qu'on
     vient lire — on laisse la carte glisser lateralement. Les tableaux a
     deux colonnes, eux, tiennent : ils ne sont pas concernes. */
  .duo-fiche{overflow-x:auto !important}
  .duo-fiche .card{overflow-x:auto !important}
  .duo-fiche div[style*="grid-template-columns:1fr 68px"],
  .duo-fiche div[style*="grid-template-columns:1fr 130px"],
  .duo-fiche div[style*="grid-template-columns:1fr 110px 96px"]{min-width:420px !important}

  /* Colonnes du tableau de bord : pleine largeur, l'une sous l'autre. */
  .duo-col{min-width:0 !important;flex:1 1 100% !important}

  /* Une ligne dont l'action ne tient plus a droite la passe dessous,
     alignee sous le texte. Une action hors ecran est une action perdue. */
  .ligne-act{height:auto !important;flex-wrap:wrap !important;
    padding-top:12px !important;padding-bottom:12px !important}
  .ligne-act>div:last-child{flex-basis:100% !important;padding-left:19px !important}
}
`;

css = css.replace(/\s*$/, '\n') + REGLES;

/* ---- Verifications ---- */
for (const [quoi, aiguille, ou] of [
  ['les bandeaux', 'class="card bandeau"', app],
  ['les conteneurs liste + fiche', 'class="card duo"', app],
  ['la colonne liste', 'class="duo-liste"', app],
  ['le panneau fiche', 'class="duo-fiche"', app],
  ['les colonnes du tableau de bord', 'class="card duo-col"', app],
  ['la ligne a action', 'class="ligne-act"', app],
  ['le bloc mobile', '.duo-liste>div:last-child', css],
  ['la grille du bandeau', '.bandeau{display:grid', css],
]) if (ou.indexOf(aiguille) === -1) echec(`Verification : ${quoi} est absent du resultat.`);

if (app.split('class="card bandeau"').length - 1 !== 5) echec('Le compte des bandeaux est faux.');
if (app.split('class="duo-liste"').length - 1 !== 6) echec('Le compte des colonnes liste est faux.');
if (app.split('class="duo-fiche"').length - 1 !== 6) echec('Le compte des panneaux fiche est faux.');
/* Le bloc ajoute doit etre equilibre. */
if ((REGLES.match(/\{/g) || []).length !== (REGLES.match(/\}/g) || []).length) {
  echec('Accolades desequilibrees dans le bloc CSS ajoute.');
}

if (!ESSAI) {
  fs.writeFileSync(APP, app, 'utf8');
  fs.writeFileSync(CSS, css, 'utf8');
  if (fs.readFileSync(APP, 'utf8').indexOf('class="card duo"') === -1
    || fs.readFileSync(CSS, 'utf8').indexOf(MARQUE) === -1) {
    echec('L\'ajout est absent apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  app.js : classes posees sur 5 bandeaux, 6 listes, 6 fiches, 2 colonnes, 1 ligne a action.');
console.log('  styles.css : un bloc @media (max-width:880px) ajoute en fin de fichier.');
console.log('  Rendu bureau inchange — les styles en ligne restent la reference.');
console.log('');
console.log('  Sur telephone : bandeau en 2 x 2, liste au-dessus de la fiche,');
console.log('  actions sous le texte, tableaux internes accessibles par glissement.');
console.log('');
console.log('  Pour l\'app gestion, reembarquez le front :');
console.log('    cd mobile/gestion && npm run build:www && npx cap sync android');
console.log('    cd android && ./gradlew installDebug\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

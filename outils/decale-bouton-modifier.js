#!/usr/bin/env node
/* outils/decale-bouton-modifier.js
   Le bouton « Modifier » du tiroir emplacement passait sous la croix
   de fermeture. On reserve la place de la croix a droite du titre. */
const fs = require('fs');
const path = require('path');
const CIBLE = path.join(process.cwd(), 'backend', 'public', 'app.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

const ANCIEN = 'display:flex;align-items:baseline;justify-content:space-between;gap:12px">\n      <h2>Emplacement ${esc(e.numero)}</h2>';
const NOUVEAU = 'display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding-right:44px">\n      <h2>Emplacement ${esc(e.numero)}</h2>';

if (!fs.existsSync(CIBLE)) { console.error('\n  \u2717 backend/public/app.js introuvable. Lancez depuis la racine du projet.\n'); process.exit(1); }
let src = fs.readFileSync(CIBLE, 'utf8');

if (src.includes(NOUVEAU)) { console.log('\n  Deja decale — rien a faire.\n'); process.exit(0); }
const n = src.split(ANCIEN).length - 1;
if (n !== 1) { console.error(`\n  \u2717 ${n} occurrence(s) au lieu d'une. Rien n'a ete ecrit.\n`); process.exit(1); }

src = src.split(ANCIEN).join(NOUVEAU);
try { new Function(src); } catch (e) { console.error('\n  \u2717 JavaScript invalide — ' + e.message + '\n'); process.exit(1); }

if (!ESSAI) fs.writeFileSync(CIBLE, src, 'utf8');
console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log('  Titre du tiroir emplacement : 44px reserves a droite pour la croix.\n');

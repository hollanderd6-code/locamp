#!/usr/bin/env node
/* outils/cloche-espacement.js
   La cloche et le mot « Notifications » etaient collees : le <span>
   qui les enveloppe n'avait aucun espacement. Il devient une boite
   flex avec un gap. */
const fs = require('fs');
const path = require('path');
const CIBLE = path.join(process.cwd(), 'backend', 'public', 'app.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

const ANCIEN = "btn.innerHTML = '<span style=\"font-size:18px\">";
const NOUVEAU = "btn.innerHTML = '<span style=\"font-size:18px;display:inline-flex;align-items:center;gap:8px\">";

if (!fs.existsSync(CIBLE)) { console.error('\n  \u2717 backend/public/app.js introuvable. Lancez depuis la racine du projet.\n'); process.exit(1); }
let src = fs.readFileSync(CIBLE, 'utf8');

if (src.includes(NOUVEAU)) { console.log('\n  Deja espace — rien a faire.\n'); process.exit(0); }
const n = src.split(ANCIEN).length - 1;
if (n !== 1) { console.error(`\n  \u2717 ${n} occurrence(s) au lieu d'une. Rien n'a ete ecrit.\n`); process.exit(1); }

src = src.split(ANCIEN).join(NOUVEAU);
try { new Function(src); } catch (e) { console.error('\n  \u2717 JavaScript invalide — ' + e.message + '\n'); process.exit(1); }

if (!ESSAI) fs.writeFileSync(CIBLE, src, 'utf8');
console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log('  Cloche de notifications : 8 px entre l\'icone et le libelle.\n');

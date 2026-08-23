#!/usr/bin/env node
/* ============================================================
   outils/legende-conformite.js
   Deux lettres que personne ne pouvait deviner
   ============================================================
   Cibles : backend/public/app.js
            backend/public/styles.css

   ── LE DEFAUT ────────────────────────────────────────────────────
   La colonne « Conformite » de la liste des residents affiche deux
   pastilles, « A » et « C », vertes, orange ou rouges.

   Chacune porte une infobulle precise — « Assurance expiree le
   12/03/2026 », « Contrat non signe — jusqu'au 31/12/2026 ». Le travail
   est fait, mais il ne se voit qu'au survol.

   Consequences : sur mobile, ou le survol n'existe pas, les deux lettres
   restent definitivement muettes. Et meme sur ordinateur, il faut avoir
   l'idee de survoler pour decouvrir qu'il y a quelque chose a lire.

   Un indicateur qu'on doit interroger pour comprendre qu'il informe
   n'informe qu'une fois qu'on le connait deja.

   ── CE QUI EST FAIT ──────────────────────────────────────────────
   La cle passe dans l'en-tete de colonne : « A assurance · C contrat »,
   en petit, sous le titre. C'est l'endroit ou l'oeil arrive avant de lire
   les pastilles.

   Une ligne de legende sous le tableau donne les trois couleurs. Elle
   distingue ce que le code couleur seul ne dit pas : orange vaut
   « expire bientot », rouge vaut « manquante ou expiree » — deux etats
   qui n'appellent pas la meme urgence.

   Les infobulles restent : elles portent la date, que la legende ne
   peut pas donner.

   Usage :
     node outils/legende-conformite.js --essai
     node outils/legende-conformite.js
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

if (app.indexOf('conf-legende') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

const ANCIEN = `    <div class="card"><table><thead><tr><th>Nom</th><th>Contact</th><th>Emplacement</th><th>Conformité</th><th class="right">Solde</th></tr></thead>
    <tbody id="res-body"></tbody></table></div>\`;`;

const NOUVEAU = `    <div class="card"><table><thead><tr><th>Nom</th><th>Contact</th><th>Emplacement</th>
      <th>Conformité<span class="conf-cle">A assurance · C contrat</span></th>
      <th class="right">Solde</th></tr></thead>
    <tbody id="res-body"></tbody></table>
    <div class="conf-legende">
      <span><i style="background:var(--vert,#3f7d4e)"></i>à jour</span>
      <span><i style="background:var(--orange,#c07a1f)"></i>expire bientôt</span>
      <span><i style="background:var(--rouge,#b03a2e)"></i>manquante ou expirée</span>
      <span class="conf-legende-note">Survolez une pastille pour la date.</span>
    </div></div>\`;`;

const n = app.split(ANCIEN).length - 1;
if (n !== 1) {
  console.error('\n  \u2717 ' + n + ' occurrence(s) du tableau, 1 attendue.');
  console.error('    Le fichier a change. Rien n\'a ete ecrit.\n');
  process.exit(1);
}

app = app.split(ANCIEN).join(NOUVEAU);

try {
  new Function(app);
} catch (e) {
  console.error('\n  \u2717 Le resultat n\'est pas du JavaScript valide : ' + e.message);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

css += `

/* ── Colonne « Conformité » : la clé des deux lettres ──
   Les infobulles portaient toute l'information, mais seulement au survol —
   inexistant sur mobile, et invisible tant qu'on n'a pas l'idée d'essayer. */
.conf-cle{display:block;font-size:10px;font-weight:400;letter-spacing:.02em;
  text-transform:none;color:var(--muted);margin-top:2px}

.conf-legende{display:flex;align-items:center;gap:16px;flex-wrap:wrap;
  padding:11px 4px 2px;font-size:12px;color:var(--muted)}
.conf-legende i{display:inline-block;width:9px;height:9px;border-radius:50%;
  margin-right:6px;vertical-align:-1px}
.conf-legende-note{margin-left:auto;font-size:11.5px;opacity:.8}
@media (max-width:640px){
  /* Sans survol, la note n'a plus d'objet. */
  .conf-legende-note{display:none}
  .conf-legende{gap:12px}
}
`;

if (!ESSAI) {
  fs.writeFileSync(APP, app, 'utf8');
  fs.writeFileSync(STYLES, css, 'utf8');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log('  « A assurance · C contrat » sous l\'en-tete de colonne.');
console.log('  Les trois couleurs expliquees sous le tableau.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

#!/usr/bin/env node
/* ============================================================
   outils/portail-rgpd-replie.js
   « Mes données personnelles » cesse d'occuper une carte entière
   ============================================================
   Cibles : backend/public/portail/index.html
            backend/public/portail/portail.css
   Prerequis : outils/portail-onglets.js applique.

   ── LE DEFAUT ────────────────────────────────────────────────────
   Le bloc « Mes données personnelles » occupe une carte de plein
   format — titre, surtitre, deux paragraphes, un bouton — au meme rang
   visuel que les factures et le dossier.

   Or c'est une fonction qu'un resident utilise une fois dans sa vie, et
   la plupart jamais. Lui donner le meme poids qu'a ses factures dit au
   lecteur que tout se vaut : c'est ce qui use un ecran.

   ── POURQUOI ON NE LA SUPPRIME PAS ───────────────────────────────
   Les articles 15 et 20 du RGPD donnent un droit d'acces et de
   portabilite. Une application qui traite des donnees personnelles doit
   offrir ce chemin, et Google Play le verifie. On la replie, on ne
   l'enleve pas — et « replier » ne veut pas dire cacher : le titre reste
   lisible et se touche.

   ── CE QUI EST FAIT ──────────────────────────────────────────────
   Le bloc devient un <details> : une ligne discrete en bas de l'onglet
   Documents, qui s'ouvre au toucher sur le texte complet et son bouton.

   Un <details> plutot qu'un panneau maison : il fonctionne sans
   JavaScript, se plie au clavier, et les lecteurs d'ecran l'annoncent
   comme depliable. Une mecanique ecrite a la main aurait demande tout
   cela en plus.

   Le contenu n'est pas touche — meme texte, meme bouton, meme
   identifiant #btn-mes-donnees, donc portail.js continue de fonctionner
   sans modification.

   Usage :
     node outils/portail-rgpd-replie.js --essai
     node outils/portail-rgpd-replie.js
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

if (index.indexOf('class="repli"') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

/* Deux formes possibles selon que portail-onglets.js a deja pose l'id. */
const CORPS = `      <div class="card-head"><div class="eyebrow">Vos droits</div><h2>Mes données personnelles</h2></div>
      <p class="note">Vous pouvez à tout moment obtenir une copie de l'ensemble des données que le camping détient sur vous (articles 15 et 20 du RGPD).</p>
      <button class="btn btn-ghost btn-sm" id="btn-mes-donnees" style="margin-top:10px">Télécharger mes données</button>
      <p class="note" style="margin-top:10px">Pour rectifier une information ou demander l'effacement de vos données, contactez l'accueil du camping. Les factures et encaissements sont conservés au titre des obligations légales de comptabilité.</p>
    </section>`;

const NOUVEAU = `      <!-- Replie : un droit qu'on exerce une fois dans sa vie n'a pas le meme
           poids que ses factures. Un <details> plutot qu'un panneau maison —
           il fonctionne sans JavaScript, se plie au clavier, et les lecteurs
           d'ecran l'annoncent comme depliable. -->
      <details class="repli">
        <summary>
          <span>Mes données personnelles</span>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
        </summary>
        <div class="repli-corps">
          <p class="note">Vous pouvez à tout moment obtenir une copie de l'ensemble des données que le camping détient sur vous (articles 15 et 20 du RGPD).</p>
          <button class="btn btn-ghost btn-sm" id="btn-mes-donnees" style="margin-top:10px">Télécharger mes données</button>
          <p class="note" style="margin-top:10px">Pour rectifier une information ou demander l'effacement de vos données, contactez l'accueil du camping. Les factures et encaissements sont conservés au titre des obligations légales de comptabilité.</p>
        </div>
      </details>
    </section>`;

if (index.split(CORPS).length - 1 !== 1) echec('index.html : bloc « Mes données personnelles » introuvable.');
index = index.split(CORPS).join(NOUVEAU);

/* La carte devient une simple enveloppe : plus de titre, plus de fond. */
const A_SEC1 = `    <section class="card" id="sec-rgpd">`;
const A_SEC2 = `    <!-- Mes données personnelles (RGPD) -->
    <section class="card">`;
const N_SEC = `    <!-- Mes données personnelles (RGPD) -->
    <section class="card carte-nue" id="sec-rgpd">`;

if (index.split(A_SEC1).length - 1 === 1) {
  index = index.split(A_SEC1).join(`    <section class="card carte-nue" id="sec-rgpd">`);
} else if (index.split(A_SEC2).length - 1 === 1) {
  index = index.split(A_SEC2).join(N_SEC);
} else {
  echec('index.html : ouverture de la section RGPD introuvable.');
}

css += `

/* ════════════════════════════════════════════════════════════════
   ══ BLOC REPLIABLE ══
   ────────────────────────────────────────────────────────────────
   « Mes données personnelles » occupait une carte de plein format,
   au meme rang que les factures, pour une fonction utilisee une fois
   dans une vie. Donner le meme poids a tout dit au lecteur que rien ne
   compte : c'est ce qui use un ecran.

   Replie, pas cache — le droit d'acces des articles 15 et 20 doit
   rester atteignable, et Google Play le verifie.
   ──────────────────────────────────────────────────────────────── */

/* L'enveloppe n'a plus a se donner l'allure d'une carte. */
.carte-nue{background:none;border:none;box-shadow:none;padding:0}
/* En dernier dans l'onglet Documents, apres le dossier. */
body[data-onglet="documents"] #sec-rgpd{order:9}

.repli{border:1px solid var(--hairline);border-radius:12px;background:#fff}
.repli summary{
  display:flex;align-items:center;justify-content:space-between;gap:10px;
  padding:13px 15px;cursor:pointer;list-style:none;
  font-size:13.5px;font-weight:600;color:var(--brume);
  /* 44 px : la hauteur au-dessous de laquelle un doigt vise mal. */
  min-height:44px;box-sizing:border-box}
.repli summary::-webkit-details-marker{display:none}
.repli summary:hover{color:var(--sapin)}
.repli summary svg{flex:none;opacity:.55;transition:transform .18s}
.repli[open] summary{color:var(--sapin);border-bottom:1px solid var(--hairline)}
.repli[open] summary svg{transform:rotate(180deg)}
.repli-corps{padding:14px 15px 16px}
.repli-corps .note:first-child{margin-top:0}

@media (prefers-reduced-motion:reduce){ .repli summary svg{transition:none} }
`;

if (!ESSAI) {
  fs.writeFileSync(INDEX, index, 'utf8');
  fs.writeFileSync(CSS, css, 'utf8');
  const ri = fs.readFileSync(INDEX, 'utf8'), rc = fs.readFileSync(CSS, 'utf8');
  if (ri.indexOf('class="repli"') === -1 || rc.indexOf('BLOC REPLIABLE') === -1) {
    echec('Un fichier n\'a pas ete modifie.');
  }
  if (ri.indexOf('btn-mes-donnees') === -1) {
    echec('Le bouton #btn-mes-donnees a disparu — portail.js en depend.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  « Mes données personnelles » : une ligne repliable, en fin d\'onglet.');
console.log('  Contenu et #btn-mes-donnees inchanges — portail.js n\'est pas touche.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

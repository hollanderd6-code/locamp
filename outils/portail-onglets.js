#!/usr/bin/env node
/* ============================================================
   outils/portail-onglets.js
   Le portail cesse d'être un long tunnel
   ============================================================
   Cibles : backend/public/portail/index.html
            backend/public/portail/portail.css

   ── LE DEFAUT ────────────────────────────────────────────────────
   Sept sections empilees sur une seule page : solde, sejours a venir,
   factures, messages, documents a signer, donnees personnelles,
   documents. Un resident qui veut son solde fait defiler ; celui qui
   repond a un message aussi, plus loin.

   Ce portail est surtout consulte au telephone. Une page unique de sept
   blocs y devient un couloir : on ne sait pas ce qu'il y a en bas, et on
   ne le decouvre qu'en le parcourant.

   ── CE QUI EST FAIT ──────────────────────────────────────────────
   Quatre onglets en bas d'ecran, a la maniere d'une application :

       Solde  ·  Factures  ·  Messages  ·  Documents

   Le regroupement suit ce que le resident vient chercher, pas l'ordre
   dans lequel les sections ont ete ecrites :

     Solde      le solde, et les sejours en preparation — ce qui va
                arriver sur la prochaine facture appartient au meme
                regard que ce qui est du.
     Factures   les factures.
     Messages   le fil d'echange.
     Documents  le dossier, les documents a signer, et l'export RGPD.

   L'onglet Documents porte un compteur quand un document attend une
   signature : c'est la seule chose ici qui bloque le camping, et elle
   etait enterree sous les messages.

   ── DEUX PRECAUTIONS DE MISE EN OEUVRE ───────────────────────────

   1. ON NE TOUCHE PAS A « hidden ». portail.js masque deja certaines
      sections selon les donnees — les sejours quand il n'y en a pas, les
      documents a signer quand il n'y en a aucun. L'affichage par onglet
      passe donc par un attribut sur le body, et chaque regle est ecrite
      « :not(.hidden) » : une section vide reste invisible meme dans son
      onglet. Sans cette precaution, changer d'onglet ferait reapparaitre
      des blocs vides.

   2. L'ECRAN DE SIGNATURE RESTE HORS ONGLETS. C'est une tache, pas une
      rubrique : quand il s'ouvre, il occupe seul l'ecran et la barre
      disparait. On ne quitte pas une signature en cours par megarde.

   ── CE QUI N'EST PAS FAIT ICI ────────────────────────────────────
   Le champ de message reste une ligne unique, et le pied promet toujours
   des paiements chiffres alors qu'aucun paiement n'a lieu. Deux points
   distincts, traites separement.

   Usage :
     node outils/portail-onglets.js --essai
     node outils/portail-onglets.js
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

if (index.indexOf('portail-onglets') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

const edits = [];

/* ── 1. Les sections sans identifiant en recoivent un ─────────────── */
edits.push(['section factures',
`    <!-- Factures -->
    <section class="card">
      <div class="card-head"><div class="eyebrow">Mes paiements</div><h2>Factures</h2></div>`,
`    <!-- Factures -->
    <section class="card" id="sec-factures">
      <div class="card-head"><div class="eyebrow">Mes paiements</div><h2>Factures</h2></div>`]);

edits.push(['section messages',
`    <!-- Messages -->
    <section class="card">
      <div class="card-head"><div class="eyebrow">Échanger avec le camping</div><h2>Messages</h2></div>`,
`    <!-- Messages -->
    <section class="card" id="sec-messages">
      <div class="card-head"><div class="eyebrow">Échanger avec le camping</div><h2>Messages</h2></div>`]);

edits.push(['section donnees personnelles',
`    <!-- Mes données personnelles (RGPD) -->
    <section class="card">`,
`    <!-- Mes données personnelles (RGPD) -->
    <section class="card" id="sec-rgpd">`]);

edits.push(['section documents',
`    <!-- Documents -->
    <section class="card">
      <div class="card-head"><div class="eyebrow">Mon dossier</div><h2>Documents</h2></div>`,
`    <!-- Documents -->
    <section class="card" id="sec-docs">
      <div class="card-head"><div class="eyebrow">Mon dossier</div><h2>Documents</h2></div>`]);

/* ── 2. La barre, et le comportement ─────────────────────────────── */
edits.push(['barre d\'onglets',
`  </main>
  <footer class="footy">Espace sécurisé — vos documents et paiements sont chiffrés.</footer>
</div>`,
`  </main>
  <footer class="footy">Espace sécurisé — vos documents et paiements sont chiffrés.</footer>

  <!-- portail-onglets : quatre rubriques en bas d'ecran, a la maniere d'une
       application. Les sept sections empilees formaient un couloir dont on ne
       voyait pas la fin. -->
  <nav class="onglets" id="onglets" aria-label="Rubriques">
    <button data-ong="solde" aria-current="page">
      <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7.5h18v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/><path d="M3 7.5 6 4h12l3 3.5"/><path d="M15.5 13.5h2.5"/></svg>
      <span>Solde</span>
    </button>
    <button data-ong="factures">
      <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2.5h9l4 4v15H6z"/><path d="M15 2.5v4h4"/><path d="M9 12h7"/><path d="M9 16h7"/></svg>
      <span>Factures</span>
    </button>
    <button data-ong="messages">
      <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-8 8H4l2.2-2.8A8 8 0 1 1 21 12z"/></svg>
      <span>Messages</span>
    </button>
    <button data-ong="documents">
      <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6.5A1.5 1.5 0 0 1 5.5 5H9l2 2.5h7.5A1.5 1.5 0 0 1 20 9v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z"/></svg>
      <span>Documents</span>
      <em id="ong-signer" class="hidden"></em>
    </button>
  </nav>
</div>`]);

for (const [nom, ancien] of edits) {
  const n = index.split(ancien).length - 1;
  if (n !== 1) echec('index.html : ' + nom + ' — ' + n + ' occurrence(s), 1 attendue.');
}
for (const [, ancien, nouveau] of edits) index = index.split(ancien).join(nouveau);

/* ── 3. Le script, juste avant la fermeture ──────────────────────── */
const A_JS = `<script src="/portail/portail.js"></script>`;
const N_JS = `<script src="/portail/portail.js"></script>

<script>
/* ---- Les onglets du portail ----
   L'affichage passe par un attribut sur <body> et non par la classe
   « hidden » : portail.js s'en sert deja pour masquer les sections vides, et
   les deux mecaniques doivent pouvoir coexister sans se marcher dessus. */
(function () {
  var CLE = 'locamp_portail_onglet';
  var barre = document.getElementById('onglets');
  if (!barre) return;

  function aller(nom) {
    document.body.setAttribute('data-onglet', nom);
    barre.querySelectorAll('button').forEach(function (b) {
      var actif = b.dataset.ong === nom;
      b.classList.toggle('actif', actif);
      if (actif) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    try { localStorage.setItem(CLE, nom); } catch (e) {}
    /* On revient en haut : changer de rubrique en gardant la position de
       defilement de la precedente donne l'impression d'un ecran casse. */
    window.scrollTo(0, 0);
  }

  barre.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-ong]');
    if (b) aller(b.dataset.ong);
  });

  var depart = 'solde';
  try { depart = localStorage.getItem(CLE) || 'solde'; } catch (e) {}
  if (!barre.querySelector('[data-ong="' + depart + '"]')) depart = 'solde';
  aller(depart);

  /* Un document a signer est la seule chose ici qui bloque le camping. Il
     etait enterre sous les messages : l'onglet le signale desormais.
     On observe plutot que de deviner quand portail.js remplit la liste. */
  function majSigner() {
    var liste = document.getElementById('liste-signer');
    var pastille = document.getElementById('ong-signer');
    if (!liste || !pastille) return;
    var n = liste.querySelectorAll('[data-doc-id], .doc-signer, li, .row').length;
    if (!n && liste.children.length && !liste.querySelector('p.note')) n = liste.children.length;
    pastille.textContent = n > 9 ? '9+' : n;
    pastille.classList.toggle('hidden', !n);
  }
  var cible = document.getElementById('liste-signer');
  if (cible) {
    new MutationObserver(majSigner).observe(cible, { childList: true, subtree: true });
    setTimeout(majSigner, 900);
  }

  /* L'ecran de signature est une tache, pas une rubrique : il occupe seul
     l'ecran, et la barre s'efface pour qu'on n'en sorte pas par megarde. */
  var sig = document.getElementById('sec-signature');
  if (sig) {
    new MutationObserver(function () {
      document.body.classList.toggle('en-signature', !sig.classList.contains('hidden'));
    }).observe(sig, { attributes: true, attributeFilter: ['class'] });
  }
})();
</script>`;

if (index.split(A_JS).length - 1 !== 1) echec('index.html : appel a portail.js introuvable.');
index = index.split(A_JS).join(N_JS);

/* ── 4. Le style ─────────────────────────────────────────────────── */
css += `

/* ════════════════════════════════════════════════════════════════
   ══ ONGLETS DU PORTAIL ══
   ────────────────────────────────────────────────────────────────
   Chaque regle d'affichage porte « :not(.hidden) » : portail.js masque
   les sections vides — sejours a venir, documents a signer — et changer
   d'onglet ne doit pas les faire reapparaitre vides.
   ──────────────────────────────────────────────────────────────── */

body[data-onglet] .content > section{display:none}

body[data-onglet="solde"] #hero-solde:not(.hidden),
body[data-onglet="solde"] #sec-sejours:not(.hidden),
body[data-onglet="factures"] #sec-factures:not(.hidden),
body[data-onglet="messages"] #sec-messages:not(.hidden),
body[data-onglet="documents"] #sec-docs:not(.hidden),
body[data-onglet="documents"] #sec-signer:not(.hidden),
body[data-onglet="documents"] #sec-rgpd:not(.hidden){display:block}

/* Dans l'onglet Documents, ce qui attend une signature passe devant le
   dossier : c'est la seule chose qui reclame une action. */
body[data-onglet="documents"] #sec-signer{order:-1}
body[data-onglet="documents"] .content{display:flex;flex-direction:column}

/* La signature occupe seule l'ecran, quel que soit l'onglet. */
body.en-signature .content > section{display:none}
body.en-signature #sec-signature:not(.hidden){display:block}
body.en-signature .onglets{display:none}
body.en-signature .footy{display:none}

.onglets{
  position:fixed;left:0;right:0;bottom:0;z-index:50;
  display:grid;grid-template-columns:repeat(4,1fr);
  background:rgba(255,255,255,.94);
  backdrop-filter:blur(12px);
  border-top:1px solid var(--hairline);
  padding-bottom:env(safe-area-inset-bottom);
  /* Centre sur grand ecran : une barre de 1400 px de large pour quatre
     rubriques serait absurde. */
  margin:0 auto;max-width:none}
@media (min-width:900px){
  .onglets{max-width:620px;border:1px solid var(--hairline);
    border-radius:16px 16px 0 0;box-shadow:var(--shadow-m)}
}

.onglets button{
  position:relative;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;
  min-height:58px;padding:9px 4px calc(9px + env(safe-area-inset-bottom, 0px) * 0);
  border:none;background:none;cursor:pointer;
  font-family:inherit;font-size:11px;font-weight:600;letter-spacing:.01em;
  color:var(--brume);
  -webkit-tap-highlight-color:transparent}
.onglets button svg{opacity:.62;transition:opacity .15s}
.onglets button.actif{color:var(--sapin)}
.onglets button.actif svg{opacity:1}
/* Un filet en haut de l'onglet actif : sur quatre rubriques, la couleur
   seule ne suffit pas a distinguer laquelle est ouverte. */
.onglets button.actif::before{content:"";position:absolute;top:0;left:22%;right:22%;
  height:2px;border-radius:0 0 2px 2px;background:var(--sapin)}

/* Le compteur de documents a signer. */
.onglets em{position:absolute;top:6px;left:calc(50% + 9px);
  min-width:17px;height:17px;padding:0 4px;border-radius:99px;
  background:var(--rouge);color:#fff;
  font-size:10px;font-weight:700;font-style:normal;line-height:17px;text-align:center}
.onglets em.hidden{display:none}

/* La barre recouvre le bas de la page : le dernier element doit pouvoir
   remonter au-dessus d'elle. */
body[data-onglet] .content{padding-bottom:calc(78px + env(safe-area-inset-bottom))}
body[data-onglet] .footy{margin-bottom:calc(70px + env(safe-area-inset-bottom))}
`;

if (!ESSAI) {
  fs.writeFileSync(INDEX, index, 'utf8');
  fs.writeFileSync(CSS, css, 'utf8');
  const ri = fs.readFileSync(INDEX, 'utf8'), rc = fs.readFileSync(CSS, 'utf8');
  if (ri.indexOf('portail-onglets') === -1 || rc.indexOf('ONGLETS DU PORTAIL') === -1) {
    echec('Un fichier n\'a pas ete modifie.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Quatre onglets : Solde · Factures · Messages · Documents.');
console.log('  Compteur sur Documents quand une signature attend.');
console.log('  L\'ecran de signature occupe seul l\'ecran.\n');
console.log('  Les sections vides restent masquees : chaque regle porte');
console.log('  « :not(.hidden) », que portail.js continue de piloter.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

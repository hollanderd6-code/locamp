#!/usr/bin/env node
/* ============================================================
   outils/portail-messages.js
   Écrire plus d'une ligne, et savoir qu'on a du courrier
   ============================================================
   Cibles : backend/public/portail/index.html
            backend/public/portail/portail.css
            backend/public/portail/portail.js
   Prerequis : outils/portail-onglets.js applique.

   ── 1. LE CHAMP D'UNE SEULE LIGNE ────────────────────────────────
   Le formulaire de message est un <input> :

       <input id="msg-corps" placeholder="Écrire un message…" required>

   Une ligne, sans retour possible. Un resident qui veut expliquer une
   fuite d'eau, poser trois questions ou decrire une panne ecrit dans une
   fente ou il ne voit que la fin de sa phrase. Beaucoup renoncent et
   telephonent — ce que le portail est cense eviter.

   Il devient un <textarea> de deux lignes qui grandit jusqu'a six a
   mesure qu'on ecrit, puis defile. Grandir sans limite pousserait le fil
   de discussion hors de l'ecran.

   Le bouton passe SOUS le champ, et non a cote : cote a cote, un champ
   qui grandit deforme le bouton ou le repousse.

   ENTREE FAIT UN RETOUR A LA LIGNE. C'est le sens attendu dans un
   textarea, et sur telephone la touche « entree » du clavier virtuel ne
   doit pas envoyer un message a moitie ecrit. Cmd+Entree (ou
   Ctrl+Entree) envoie, pour qui travaille au clavier.

   ── 2. LE COMPTEUR DE NON-LUS ────────────────────────────────────
   Le portail possede DEJA un systeme de notifications complet : une
   cloche, un compteur, une liste typee, /notifications/compteur et
   /notifications/tout-lu. Construire un second comptage de messages non
   lus creerait deux verites qui divergeraient au premier decalage.

   L'onglet Messages lit donc la liste existante et compte celles de type
   « nouveau_message » non lues. Une seule source.

   Le compteur s'efface quand on ouvre l'onglet : c'est le sens d'un
   non-lu — il disparait a la lecture, pas a une action separee. Les
   notifications correspondantes sont marquees lues cote serveur, ce qui
   met aussi la cloche a jour.

   Usage :
     node outils/portail-messages.js --essai
     node outils/portail-messages.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');
const P = (f) => path.join(process.cwd(), 'backend', 'public', 'portail', f);
const INDEX = P('index.html'), CSS = P('portail.css'), JS = P('portail.js');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

for (const f of [INDEX, CSS, JS]) {
  if (!fs.existsSync(f)) echec(f + ' introuvable. Lancez depuis la racine du projet.');
}

let index = fs.readFileSync(INDEX, 'utf8');
let css = fs.readFileSync(CSS, 'utf8');
let js = fs.readFileSync(JS, 'utf8');

if (index.indexOf('msg-corps" rows') !== -1 || css.indexOf('MESSAGES DU PORTAIL') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}
if (index.indexOf('portail-onglets') === -1) {
  echec('Appliquez d\'abord outils/portail-onglets.js.');
}

/* ── 1. Le champ ─────────────────────────────────────────────────── */
const A_CHAMP = `      <form id="form-msg" class="msg-form">
        <input id="msg-corps" placeholder="Écrire un message…" required>
        <button class="btn btn-primary" id="btn-msg">Envoyer</button>
      </form>`;

const N_CHAMP = `      <form id="form-msg" class="msg-form">
        <textarea id="msg-corps" rows="2" placeholder="Écrire un message…" required
          aria-label="Votre message"></textarea>
        <div class="msg-form-pied">
          <span class="msg-astuce">Entrée pour aller à la ligne</span>
          <button class="btn btn-primary" id="btn-msg">Envoyer</button>
        </div>
      </form>`;

if (index.split(A_CHAMP).length - 1 !== 1) echec('index.html : formulaire de message introuvable.');
index = index.split(A_CHAMP).join(N_CHAMP);

/* ── 2. La pastille sur l'onglet ─────────────────────────────────── */
const A_ONG = `      <span>Messages</span>
    </button>`;
const N_ONG = `      <span>Messages</span>
      <em id="ong-messages" class="hidden"></em>
    </button>`;

if (index.split(A_ONG).length - 1 !== 1) echec('index.html : onglet Messages introuvable.');
index = index.split(A_ONG).join(N_ONG);

/* ── 3. Le comportement ──────────────────────────────────────────── */
const A_JS = `/* ---------- messages ---------- */
$('#form-msg').addEventListener('submit', async (e) => {`;

const N_JS = `/* ---------- messages ---------- */

/* Le champ grandit jusqu'a six lignes, puis defile : sans plafond, un long
   message pousserait le fil de discussion hors de l'ecran. */
(function () {
  const t = $('#msg-corps');
  if (!t) return;
  const MAX = 6;
  function ajuster() {
    t.style.height = 'auto';
    const ligne = parseFloat(getComputedStyle(t).lineHeight) || 22;
    const bords = t.offsetHeight - t.clientHeight;
    t.style.height = Math.min(t.scrollHeight, ligne * MAX + bords) + 'px';
  }
  t.addEventListener('input', ajuster);
  /* Entree va a la ligne — c'est le sens attendu, et sur telephone la touche
     du clavier virtuel ne doit pas envoyer un message a moitie ecrit.
     Cmd+Entree envoie, pour qui travaille au clavier. */
  t.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      $('#form-msg').requestSubmit ? $('#form-msg').requestSubmit() : $('#btn-msg').click();
    }
  });
  window._msgAjuster = ajuster;
})();

/* Le compteur de l'onglet Messages.

   Il lit la liste de notifications DEJA en place plutot que de compter les
   messages lui-meme : deux comptages separes divergeraient au premier
   decalage, et la cloche du portail dirait autre chose que l'onglet. */
async function majOngletMessages() {
  const pastille = document.getElementById('ong-messages');
  if (!pastille || !RTOKEN) return;
  try {
    const { notifications } = await api('/api/portail/notifications');
    const n = (notifications || []).filter((x) => !x.lu && x.type === 'nouveau_message').length;
    pastille.textContent = n > 9 ? '9+' : n;
    pastille.classList.toggle('hidden', !n);
    window._msgNonLus = (notifications || []).filter((x) => !x.lu && x.type === 'nouveau_message');
  } catch (e) { /* silencieux : un compteur absent vaut mieux qu'une erreur */ }
}

/* Ouvrir l'onglet vaut lecture : un non-lu disparait quand on le lit, pas
   apres une action separee. On marque cote serveur, ce qui met aussi la
   cloche a jour. */
async function marquerMessagesLus() {
  const liste = window._msgNonLus || [];
  if (!liste.length) return;
  window._msgNonLus = [];
  document.getElementById('ong-messages')?.classList.add('hidden');
  for (const n of liste) {
    try { await api(\`/api/portail/notifications/\${n.id}/lu\`, { method: 'POST' }); } catch (e) {}
  }
}

document.getElementById('onglets')?.addEventListener('click', (e) => {
  if (e.target.closest('[data-ong="messages"]')) setTimeout(marquerMessagesLus, 250);
});

$('#form-msg').addEventListener('submit', async (e) => {`;

if (js.split(A_JS).length - 1 !== 1) echec('portail.js : bloc des messages introuvable.');
js = js.split(A_JS).join(N_JS);

/* Remettre le champ a sa taille apres envoi, et rafraichir le compteur. */
const A_VIDE = `    input.value = '';
    const { messages } = await api('/api/portail/messages');
    renderMessages(messages || []);`;
const N_VIDE = `    input.value = '';
    if (window._msgAjuster) window._msgAjuster();
    const { messages } = await api('/api/portail/messages');
    renderMessages(messages || []);`;

if (js.split(A_VIDE).length - 1 !== 1) echec('portail.js : vidage du champ introuvable.');
js = js.split(A_VIDE).join(N_VIDE);

/* Le compteur se met a jour au chargement de l'espace. */
const A_REND = `  // messages
  renderMessages(msgs.messages || []);`;
const N_REND = `  // messages
  renderMessages(msgs.messages || []);
  majOngletMessages();`;

if (js.split(A_REND).length - 1 !== 1) echec('portail.js : appel a renderMessages introuvable.');
js = js.split(A_REND).join(N_REND);

try { new Function(js); }
catch (e) { echec('portail.js : le resultat n\'est pas du JavaScript valide — ' + e.message); }

/* ── 4. Le style ─────────────────────────────────────────────────── */
css += `

/* ════════════════════════════════════════════════════════════════
   ══ MESSAGES DU PORTAIL ══
   ────────────────────────────────────────────────────────────────
   Le champ etait un <input> d'une ligne : impossible d'y ecrire trois
   phrases sans perdre le debut de vue. Le bouton passe SOUS le champ —
   cote a cote, un champ qui grandit deforme le bouton ou le repousse.
   ──────────────────────────────────────────────────────────────── */

.msg-form{display:flex;flex-direction:column;gap:9px;align-items:stretch}

#msg-corps{
  width:100%;min-height:56px;resize:none;overflow-y:auto;
  font-family:inherit;font-size:15px;line-height:1.5;
  padding:11px 13px;border:1px solid var(--hairline);border-radius:12px;
  background:#fff;color:inherit;
  /* 16 px minimum sur iOS, faute de quoi Safari zoome a la mise au point
     et l'utilisateur se retrouve avec une page agrandie. */
  }
@media (max-width:820px){ #msg-corps{font-size:16px} }
#msg-corps:focus{outline:none;border-color:var(--sapin);
  box-shadow:0 0 0 3px rgba(23,82,67,.10)}
#msg-corps::placeholder{color:var(--brume)}

.msg-form-pied{display:flex;align-items:center;justify-content:space-between;gap:12px}
.msg-astuce{font-size:11.5px;color:var(--brume)}
/* Sur telephone, l'astuce clavier n'a pas d'objet. */
@media (max-width:600px){ .msg-astuce{display:none} }
.msg-form-pied .btn{margin-left:auto}

/* Le compteur de l'onglet Messages, meme forme que celui des documents. */
.onglets em{position:absolute;top:6px;left:calc(50% + 9px);
  min-width:17px;height:17px;padding:0 4px;border-radius:99px;
  background:var(--rouge);color:#fff;
  font-size:10px;font-weight:700;font-style:normal;line-height:17px;text-align:center}
.onglets em.hidden{display:none}
`;

if (!ESSAI) {
  fs.writeFileSync(INDEX, index, 'utf8');
  fs.writeFileSync(CSS, css, 'utf8');
  fs.writeFileSync(JS, js, 'utf8');
  const ok = fs.readFileSync(INDEX, 'utf8').indexOf('msg-corps" rows') !== -1
          && fs.readFileSync(CSS, 'utf8').indexOf('MESSAGES DU PORTAIL') !== -1
          && fs.readFileSync(JS, 'utf8').indexOf('majOngletMessages') !== -1;
  if (!ok) echec('Un fichier n\'a pas ete modifie.');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Champ de message : deux lignes, jusqu\'a six, puis defile.');
console.log('  Entree va a la ligne ; Cmd+Entree envoie.');
console.log('  Compteur sur l\'onglet Messages, lu depuis les notifications.\n');
console.log('  Le compteur s\'efface a l\'ouverture de l\'onglet, et met la');
console.log('  cloche a jour : une seule source, pas deux comptages.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

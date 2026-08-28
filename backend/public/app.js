/* ============ Locamp — front admin (vanilla JS, hash routing) ============ */

/* ============================================================
   Actions déclarées — un seul écouteur pour toute l'application
   ============================================================
   Le HTML ne contient plus « onclick="voirDoc('…')" » mais
   « data-act="voirDoc" data-a1="…" ». Un écouteur posé sur le
   document lit l'intention et appelle la fonction.

   Ce n'est pas une préférence de style : tant qu'un attribut
   onclick existe dans la page, la politique de sécurité doit
   autoriser 'unsafe-inline', et n'est donc plus un filet contre
   l'injection de script. C'est ce que ce mécanisme permet de
   retirer.

   Ajouter une action : écrire la fonction, poser data-act sur le
   bouton. Rien à enregistrer.
   ============================================================ */
(function () {
  function lireArgs(el) {
    // Un attribut HTML ne contient que du texte. data-num et data-bool
    // disent quels arguments doivent redevenir un nombre ou un booléen :
    // passer « 0 » là où la fonction attend 0 inverserait un test, et
    // passer « false » là où elle attend false le rendrait vrai.
    const nums = (el.getAttribute('data-num') || '').split(',').filter(Boolean);
    const bools = (el.getAttribute('data-bool') || '').split(',').filter(Boolean);
    const out = [];
    for (let i = 1; i <= 6; i++) {
      let v = el.getAttribute('data-a' + i);
      if (v === null) break;
      // @value : la valeur du champ au moment du clic, et non au rendu.
      if (v === '@value') v = el.value;
      else if (nums.includes(String(i))) v = Number(v);
      else if (bools.includes(String(i))) v = (v === 'true' || v === '1');
      out.push(v);
    }
    return out;
  }

  function executer(el, evt) {
    const nom = el.getAttribute('data-act');
    const fn = window[nom];
    if (typeof fn !== 'function') {
      // Un bouton qui ne fait rien en silence est pire qu'une erreur :
      // on le dit, pour que ça se voie en test et pas en production.
      console.error('[action] fonction introuvable : ' + nom, el);
      return;
    }
    try { fn.apply(el, lireArgs(el)); }
    catch (e) { console.error('[action] ' + nom, e); }
  }

  document.addEventListener('click', function (e) {
    // data-stop : cet élément absorbe le clic, sans rien déclencher.
    // Sert aux cellules interactives dans une ligne elle-même cliquable.
    const stop = e.target.closest('[data-stop]');
    if (stop) { e.stopPropagation(); if (!stop.hasAttribute('data-act')) return; }

    const el = e.target.closest('[data-act]');
    if (!el) return;
    // Les éléments qui déclarent un autre événement ne réagissent pas au clic.
    if (el.getAttribute('data-evt')) return;
    if (el.tagName === 'A' && el.getAttribute('href')) e.preventDefault();
    executer(el, e);
  });

  // change / input / submit : même mécanisme, en capture pour attraper
  // les éléments créés après coup.
  ['change', 'input', 'submit'].forEach(function (type) {
    document.addEventListener(type, function (e) {
      const el = e.target.closest('[data-act][data-evt="' + type + '"]');
      if (!el) return;
      if (type === 'submit') e.preventDefault();
      executer(el, e);
    }, true);
  });
})();

/* ---- Fonctions appelées par data-act ----------------------------
   Elles remplacent du code qui vivait dans des attributs HTML. */

/** Navigation interne. Remplace location.hash='…' écrit dans le HTML. */
function allerA(hash) { location.hash = hash; }

/** Retire la ligne à laquelle appartient le bouton.
    Appelée avec this = l'élément cliqué (voir l'écouteur).
    Sans sélecteur : le parent direct. Avec : le premier ancêtre qui
    correspond — pour une ligne de facture, par exemple. */
function retirerLigne(selecteur) {
  const cible = selecteur ? this.closest(selecteur) : this.parentElement;
  if (cible) cible.remove();
}

/** Onglets de la fiche camping : afficher l'onglet ET charger son
    contenu. C'étaient deux appels enchaînés dans le HTML, répétés
    quatre fois — ajouter un onglet demandait de ne pas oublier le
    second. Ici, un seul endroit. */
function ouvrirOngletParam(onglet) {
  switchFicheTab(onglet);
  const charge = {
    moyens: typeof chargerMoyens === 'function' ? chargerMoyens : null,
    journal: typeof chargerJournal === 'function' ? chargerJournal : null,
    fiscal: typeof chargerFiscal === 'function' ? chargerFiscal : null,
    rgpd: typeof chargerRgpd === 'function' ? chargerRgpd : null,
  }[onglet];
  if (charge) charge();
}

/** Exports comptables. L'URL était assemblée dans l'attribut onclick
    en lisant deux champs — donc sans pouvoir vérifier qu'ils sont
    remplis. Un export sur une période vide produisait un fichier vide
    sans rien dire. */
function exporterCompta(format) {
  const debut = ($('#exp-debut') || {}).value || '';
  const fin = ($('#exp-fin') || {}).value || '';
  if (!debut || !fin) {
    if (typeof toast === 'function') toast('Choisissez une date de début et une date de fin.');
    return;
  }
  if (debut > fin) {
    if (typeof toast === 'function') toast('La date de début est postérieure à la date de fin.');
    return;
  }
  const q = '?debut=' + encodeURIComponent(debut) + '&fin=' + encodeURIComponent(fin);
  if (format === 'fec') telechargerExport('/api/compta/fec' + q, 'FEC_' + fin + '.txt');
  else telechargerExport('/api/compta/export.csv' + q, 'ecritures_' + debut + '_' + fin + '.csv');
}
const API = window.LOCAMP_API || '';   // '' en web (relatif) ; URL Render absolue en app mobile
let TOKEN = localStorage.getItem('lc_token') || null;
let CAMPINGS = [];
let ACTIVE_CAMPING = localStorage.getItem('lc_camping') || null;
let ACTIVE_EXERCICE = null;                 // annee de debut de l'exercice affiche (global)
let EX_DM = 1;                              // mois de debut d'exercice (parametres.exercice_debut_mois)
let USER = null;
let MES_DROITS = {};

/* ---------- utilitaires ---------- */
const MOIS_FR = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
// Ajoute n mois à une date ISO (clamp fin de mois : 31/01 -> 28/02)
function addMoisISO(iso, n) {
  if (!iso) return iso;
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const total = (m - 1) + n;
  const ny = y + Math.floor(total / 12), nm = (total % 12 + 12) % 12;
  const last = new Date(ny, nm + 1, 0).getDate();
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}
function addMoisPeriode(p, n) { return p ? addMoisISO(p + '-01', n).slice(0, 7) : p; }
// Décale les noms de mois français dans un libellé ("juillet 2026" -> "août 2026")
function shiftMoisTexte(txt, n) {
  if (!txt) return txt;
  return txt.replace(new RegExp(`(${MOIS_FR.join('|')})(\\s+)(\\d{4})`, 'gi'), (all, mois, sp, annee) => {
    const i = MOIS_FR.indexOf(mois.toLowerCase());
    if (i < 0) return all;
    const total = i + n;
    const ny = Number(annee) + Math.floor(total / 12);
    const nm = (total % 12 + 12) % 12;
    return MOIS_FR[nm] + sp + ny;
  });
}
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const eur = (n) => Number(n || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

/* ==================== Boîtes de dialogue (remplacent confirm/prompt natifs) ==================== */
/* askConfirm / askPrompt / askMois renvoient une Promise. Usage : if (!await askConfirm('…')) return; */
function _modalBase(innerHtml, { onMount, onSubmit } = {}) {
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.className = 'ask-overlay';
    ov.innerHTML = `<div class="ask-box" role="dialog" aria-modal="true">${innerHtml}</div>`;
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add('in'));

    const close = (val) => {
      ov.classList.remove('in');
      setTimeout(() => ov.remove(), 160);
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(null);
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
        const ok = ov.querySelector('[data-ask-ok]');
        if (ok) { e.preventDefault(); ok.click(); }
      }
    };
    document.addEventListener('keydown', onKey);
    ov.addEventListener('click', (e) => { if (e.target === ov) close(null); });
    ov.querySelector('[data-ask-cancel]')?.addEventListener('click', () => close(null));
    ov.querySelector('[data-ask-ok]')?.addEventListener('click', () => close(onSubmit ? onSubmit(ov) : true));
    if (onMount) onMount(ov, close);
  });
}

window.askConfirm = (message, { titre = 'Confirmation', ok = 'Confirmer', danger = false } = {}) =>
  _modalBase(`
    <h3 class="ask-titre">${esc(titre)}</h3>
    <p class="ask-msg">${esc(message).replace(/\n/g, '<br>')}</p>
    <div class="ask-actions">
      <button class="btn btn-ghost" data-ask-cancel>Annuler</button>
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ask-ok>${esc(ok)}</button>
    </div>`, { onSubmit: () => true, onMount: (ov) => ov.querySelector('[data-ask-ok]')?.focus() })
    .then((v) => v === true);

window.askPrompt = (message, valeur = '', { titre = '', ok = 'Valider', placeholder = '' } = {}) =>
  _modalBase(`
    ${titre ? `<h3 class="ask-titre">${esc(titre)}</h3>` : ''}
    <p class="ask-msg">${esc(message).replace(/\n/g, '<br>')}</p>
    <input class="ask-input" data-ask-input value="${esc(valeur)}" placeholder="${esc(placeholder)}">
    <div class="ask-actions">
      <button class="btn btn-ghost" data-ask-cancel>Annuler</button>
      <button class="btn btn-primary" data-ask-ok>${esc(ok)}</button>
    </div>`, {
    onSubmit: (ov) => ov.querySelector('[data-ask-input]').value,
    onMount: (ov) => { const i = ov.querySelector('[data-ask-input]'); i.focus(); i.select(); },
  });

/* Sélecteur de mois — affiche « juillet 2026 », renvoie « 2026-07 ». */
window.askMois = (defaut = new Date().toISOString().slice(0, 7),
  { titre = 'Période à facturer', ok = 'Générer' } = {}) => {
  const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const [dy, dm] = defaut.split('-').map(Number);
  const annees = [];
  for (let a = dy - 2; a <= dy + 1; a++) annees.push(a);
  return _modalBase(`
    <h3 class="ask-titre">${esc(titre)}</h3>
    <div class="ask-mois">
      <select data-ask-m>${MOIS.map((n, i) =>
    `<option value="${i + 1}" ${i + 1 === dm ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <select data-ask-y>${annees.map((a) =>
    `<option value="${a}" ${a === dy ? 'selected' : ''}>${a}</option>`).join('')}</select>
    </div>
    <div class="ask-actions">
      <button class="btn btn-ghost" data-ask-cancel>Annuler</button>
      <button class="btn btn-primary" data-ask-ok>${esc(ok)}</button>
    </div>`, {
    onSubmit: (ov) => `${ov.querySelector('[data-ask-y]').value}-`
      + String(ov.querySelector('[data-ask-m]').value).padStart(2, '0'),
    onMount: (ov) => ov.querySelector('[data-ask-m]')?.focus(),
  });
};

(function injecterStylesAsk() {
  const css = `
  .ask-overlay{position:fixed;inset:0;z-index:10000;background:rgba(15,35,29,.42);
    display:flex;align-items:center;justify-content:center;padding:18px;
    opacity:0;transition:opacity .16s ease}
  .ask-overlay.in{opacity:1}
  .ask-box{background:#fff;border-radius:16px;max-width:420px;width:100%;
    padding:24px;box-shadow:0 24px 70px rgba(0,0,0,.28);
    transform:translateY(8px) scale(.98);transition:transform .16s cubic-bezier(.3,.9,.3,1)}
  .ask-overlay.in .ask-box{transform:none}
  .ask-titre{font-family:"Fraunces",serif;font-size:18px;font-weight:600;margin:0 0 8px;color:#14283F}
  .ask-msg{font-size:14.5px;line-height:1.55;color:#4A5A54;margin:0 0 18px;white-space:normal}
  .ask-input{width:100%;font:15px/1.4 "Inter",sans-serif;padding:11px 13px;margin-bottom:18px;
    border:1px solid #E7E1D4;border-radius:10px;background:#fff}
  .ask-input:focus{outline:none;border-color:#175243;box-shadow:0 0 0 3px rgba(23,82,67,.13)}
  .ask-mois{display:flex;gap:10px;margin-bottom:18px}
  .ask-mois select{flex:1;font:15px/1.4 "Inter",sans-serif;padding:11px 13px;
    border:1px solid #E7E1D4;border-radius:10px;background:#fff;cursor:pointer}
  .ask-actions{display:flex;gap:10px;justify-content:flex-end}
  .ask-actions .btn{min-width:104px}
  .btn-danger{background:#A8402A;color:#F7EDE9}
  .btn-danger:hover{background:#B94A32}
  @media (max-width:520px){.ask-actions{flex-direction:column-reverse}.ask-actions .btn{width:100%}}`;
  const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
})();

const dfr = (d) => d ? new Date(d).toLocaleDateString('fr-FR') : '—';

/* Libellés lisibles : jamais de code technique à l'écran. */
const STATUT_LIB = {
  emise: 'émise', partielle: 'partiellement réglée', reglee: 'réglée', en_retard: 'en retard',
  avoir: 'avoir', annulee: 'annulée', brouillon: 'brouillon',
  libre: 'libre', occupe: 'occupé', reserve: 'réservé', indisponible: 'indisponible',
  actif: 'actif', inactif: 'inactif', signe: 'signé', emis: 'émis',
  remise: 'remise', encaissee: 'encaissée',
};
const lib = (s) => STATUT_LIB[s] || String(s || '').replace(/_/g, ' ');

function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (err ? ' err' : '');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.add('hidden'), 3500);
}

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (!(opts.body instanceof FormData) && opts.body) headers['Content-Type'] = 'application/json';
  if (TOKEN) headers['Authorization'] = 'Bearer ' + TOKEN;
  if (ACTIVE_CAMPING) headers['x-camping-id'] = ACTIVE_CAMPING;
  const r = await fetch(API + path, { ...opts, headers, body: opts.body instanceof FormData ? opts.body : (opts.body ? JSON.stringify(opts.body) : undefined) });
  if (r.status === 401) { logout(); throw new Error('Session expirée'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Erreur serveur');
  return data;
}

/* ---------- session ---------- */
function logout() {
  TOKEN = null; USER = null; localStorage.removeItem('lc_token');
  $('#app').classList.add('hidden'); $('#login-screen').classList.remove('hidden');
}

async function boot() {
  if (!TOKEN) { $('#login-screen').classList.remove('hidden'); return; }
  try {
    const me = await api('/api/auth/me');
    USER = me.user; CAMPINGS = me.campings || [];
    try { const d = await api('/api/admin/mes-droits'); MES_DROITS = d.droits || {}; }
    catch { MES_DROITS = {}; }
    if (!ACTIVE_CAMPING && me.activeCampingId) ACTIVE_CAMPING = me.activeCampingId;
    startApp();
  } catch { logout(); }
}

function startApp() {
  $('#login-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#user-name').textContent = `${USER.prenom || ''} ${USER.nom || ''}`.trim() || USER.email;
  renderCampingSwitch();
  initExerciceSelector();
  const navAdmin = $('#nav-admin');
  if (navAdmin) navAdmin.classList.toggle('hidden', !MES_DROITS.admin);
  if (!location.hash) location.hash = '#/dashboard';
  route();
}

// Sélecteur d'espace : toujours visible (les noms viennent de /api/auth/me).
// Changer d'espace recharge tout — aucune donnée d'un camping ne persiste sur l'autre.
function renderCampingSwitch() {
  const sel = $('#camping-select');
  if (!sel) return;
  if (!CAMPINGS.length) { $('#camping-switch').classList.add('hidden'); return; }

  const actif = CAMPINGS.find((c) => c.camping_id === ACTIVE_CAMPING) ? ACTIVE_CAMPING : CAMPINGS[0].camping_id;
  ACTIVE_CAMPING = actif;
  localStorage.setItem('lc_camping', ACTIVE_CAMPING);

  sel.innerHTML = CAMPINGS.map((c) => `<option value="${c.camping_id}">${esc(c.nom || 'Camping')}</option>`).join('')
    + '<option value="__new__">+ Nouvel espace camping…</option>';
  sel.value = ACTIVE_CAMPING;
  sel.onchange = () => {
    if (sel.value === '__new__') { sel.value = ACTIVE_CAMPING; formNouveauCamping(); return; }
    changerCamping(sel.value);
  };
  $('#camping-switch').classList.remove('hidden');
}

/* ---------- Exercice fiscal global (bascule d'annee) ---------- */
function exBornesAn(year, dm) {
  dm = Math.min(Math.max(Number(dm || 1), 1), 12);
  const debut = `${year}-${String(dm).padStart(2, '0')}-01`;
  const finYear = dm === 1 ? year : year + 1;
  const finMonth = dm === 1 ? 12 : dm - 1;
  const fd = new Date(finYear, finMonth, 0);
  const fin = `${fd.getFullYear()}-${String(fd.getMonth() + 1).padStart(2, '0')}-${String(fd.getDate()).padStart(2, '0')}`;
  return { debut, fin };
}
function exLabelAn(year, dm) {
  dm = Math.min(Math.max(Number(dm || 1), 1), 12);
  return dm === 1 ? String(year) : `${year}/${String((year + 1) % 100).padStart(2, '0')}`;
}
function exAnCourant(dm) {
  dm = Math.min(Math.max(Number(dm || 1), 1), 12);
  const now = new Date();
  let y = now.getFullYear();
  if (now.getMonth() + 1 < dm) y -= 1;
  return y;
}
function exerciceActif() {
  const y = Number(ACTIVE_EXERCICE) || exAnCourant(EX_DM);
  return { year: y, label: exLabelAn(y, EX_DM), ...exBornesAn(y, EX_DM) };
}
function exQS() { const e = exerciceActif(); return `?debut=${e.debut}&fin=${e.fin}`; }
function exQSand() { const e = exerciceActif(); return `&debut=${e.debut}&fin=${e.fin}`; }
async function initExerciceSelector() {
  try {
    const { camping } = await api('/api/camping');
    EX_DM = Math.min(Math.max(Number((camping && camping.parametres && camping.parametres.exercice_debut_mois) || 1), 1), 12);
  } catch (_) { EX_DM = 1; }
  const cur = exAnCourant(EX_DM);
  if (!ACTIVE_EXERCICE) ACTIVE_EXERCICE = cur;
  const sel = document.getElementById('exercice-select');
  const wrap = document.getElementById('exercice-switch');
  if (!sel || !wrap) return;
  const annees = [];
  for (let a = cur + 1; a >= cur - 5; a--) annees.push(a);
  sel.innerHTML = annees.map((a) =>
    `<option value="${a}">Exercice ${exLabelAn(a, EX_DM)}</option>`).join('');
  sel.value = String(ACTIVE_EXERCICE);
  sel.onchange = () => { ACTIVE_EXERCICE = Number(sel.value); route(); };
  wrap.classList.remove('hidden');
}

// Bascule d'espace : on repart du tableau de bord, état local vidé.
async function changerCamping(id) {
  if (id === ACTIVE_CAMPING) return;
  ACTIVE_CAMPING = id;
  localStorage.setItem('lc_camping', ACTIVE_CAMPING);
  carteState = null;
  // les droits sont propres à chaque camping : on les recharge avant d'afficher
  try { const d = await api('/api/admin/mes-droits'); MES_DROITS = d.droits || {}; }
  catch { MES_DROITS = {}; }
  const navAdmin = $('#nav-admin');
  if (navAdmin) navAdmin.classList.toggle('hidden', !MES_DROITS.admin);
  const c = CAMPINGS.find((x) => x.camping_id === id);
  location.hash = '#/dashboard';
  route();
  toast(`Espace : ${c?.nom || 'camping'}`);
}

window.formNouveauCamping = () => {
  openDrawer(`
    <h2>Nouvel espace camping</h2>
    <p class="muted" style="margin-top:4px">Un espace séparé, avec ses propres résidents, emplacements et factures. Vous en serez administrateur.</p>
    <form id="f-newcamp" class="form-grid" style="margin-top:14px">
      <label class="full">Nom *<input name="nom" required placeholder="Camping des Princes"></label>
      <label class="full">Raison sociale<input name="raison_sociale"></label>
      <label>SIRET<input name="siret"></label>
      <label>N° TVA<input name="tva"></label>
      <label class="full">Adresse<input name="adresse"></label>
      <label>E-mail<input name="email" type="email"></label>
      <label>Téléphone<input name="telephone"></label>
      <div class="full"><button class="btn btn-primary btn-block">Créer l'espace</button></div>
    </form>`);
  $('#f-newcamp').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    for (const k in body) if (!body[k]) delete body[k];
    try {
      const { camping } = await api('/api/camping', { method: 'POST', body });
      const me = await api('/api/auth/me');
      CAMPINGS = me.campings || [];
      closeDrawer();
      ACTIVE_CAMPING = camping.id;
      localStorage.setItem('lc_camping', ACTIVE_CAMPING);
      renderCampingSwitch();
      location.hash = '#/parametres';
      route();
      toast(`Espace « ${camping.nom} » créé — complète son identité`);
    } catch (err) { toast(err.message, true); }
  });
};


$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#login-btn'); btn.disabled = true;
  $('#login-error').classList.add('hidden');
  try {
    const data = await api('/api/auth/login', { method: 'POST', body: { email: $('#login-email').value, password: $('#login-password').value } });
    TOKEN = data.token; localStorage.setItem('lc_token', TOKEN);
    if (data.campings?.length) { ACTIVE_CAMPING = data.campings[0].camping_id; localStorage.setItem('lc_camping', ACTIVE_CAMPING); }
    await boot();
  } catch (err) {
    const el = $('#login-error'); el.textContent = err.message; el.classList.remove('hidden');
  } finally { btn.disabled = false; }
});
$('#logout-btn').addEventListener('click', logout);
// menu mobile
/* Le tiroir : un bouton l'ouvre depuis la barre haute, trois choses le
   ferment — la croix, le voile, et la touche Echap. Un panneau qui recouvre
   la page doit pouvoir se fermer sans viser. */
function fermerMenu() {
  document.body.classList.remove('nav-open');
  document.getElementById('topbar-burger')?.setAttribute('aria-expanded', 'false');
}
function ouvrirMenu() {
  document.body.classList.add('nav-open');
  document.getElementById('topbar-burger')?.setAttribute('aria-expanded', 'true');
}
document.getElementById('topbar-burger')?.addEventListener('click', () =>
  document.body.classList.contains('nav-open') ? fermerMenu() : ouvrirMenu());
document.getElementById('nav-burger')?.addEventListener('click', fermerMenu);
document.getElementById('nav-veil')?.addEventListener('click', fermerMenu);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('nav-open')) fermerMenu();
});
document.querySelectorAll('.nav a').forEach((a) => a.addEventListener('click', fermerMenu));

/* L'initiale, le role, et le camping actif dans la barre haute : sur mobile,
   il faudrait sinon ouvrir le tiroir pour savoir ou l'on travaille. */
let _majEnCours = false;
function majEnveloppe() {
  /* Garde de reentrance : la fonction ecrit dans le DOM, et c'est une
     mutation du DOM qui la declenche. Sans ce verrou, elargir la portee de
     l'observateur d'un cran suffit a figer la page — c'est arrive. */
  if (_majEnCours) return;
  _majEnCours = true;
  try { _majEnveloppe(); } finally { _majEnCours = false; }
}
function _majEnveloppe() {
  const nom = (document.getElementById('user-name')?.textContent || '').trim();
  const ini = nom ? nom.split(/[\s.]+/).filter(Boolean).slice(0, 2)
    .map((m) => m[0].toUpperCase()).join('') : '';
  const poser = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  poser('user-ini', ini);
  poser('topbar-ini', ini);
  poser('user-role', window.MES_DROITS && MES_DROITS.admin ? 'Administrateur' : 'Gestionnaire');

  const camping = document.getElementById('camping-select');
  const exercice = document.getElementById('exercice-select');
  const bouts = [];
  if (camping && camping.selectedOptions[0]) bouts.push(camping.selectedOptions[0].textContent.trim());
  if (exercice && exercice.selectedOptions[0]) bouts.push(exercice.selectedOptions[0].textContent.trim());
  poser('topbar-ctx', bouts.join(' · '));
}
document.getElementById('camping-select')?.addEventListener('change', majEnveloppe);
document.getElementById('exercice-select')?.addEventListener('change', majEnveloppe);
/* Le nom d'utilisateur et les selecteurs sont remplis apres coup, a des
   moments differents : on observe plutot que de deviner le bon instant. */
/* On observe #user-name SEUL : c'est le seul element rempli par ailleurs que
   majEnveloppe ne touche pas. Surveiller toute la barre laterale revenait a
   s'ecouter soi-meme, puisque #user-ini et #user-role y vivent aussi. */
const _cibleObs = document.getElementById('user-name');
if (_cibleObs) {
  new MutationObserver(majEnveloppe).observe(_cibleObs,
    { childList: true, subtree: true, characterData: true });
}
setTimeout(majEnveloppe, 600);

/* ---------- drawer ---------- */
function openDrawer(html) { $('#drawer-content').innerHTML = html; $('#drawer').classList.remove('hidden'); }
function closeDrawer() { $('#drawer').classList.add('hidden'); }
window.closeDrawer = closeDrawer;

/* ---------- routing ---------- */
// pdf.js (CDN) pour l'éditeur de zones de signature
function chargerPdfJs() {
  if (window.pdfjsLib) return Promise.resolve();
  return new Promise((ok, ko) => {
    const sc = document.createElement('script');
    sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    sc.onload = () => {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      ok();
    };
    sc.onerror = ko;
    document.head.appendChild(sc);
  });
}

const routes = { dashboard: vueDashboard, carte: vueCarte, residents: vueResidents, emplacements: vueEmplacements, contrats: vueContrats, factures: vueFactures, reglements: vueReglements, impayes: vueImpayes, compteurs: vueCompteurs, messagerie: vueMessagerie, compta: vueCompta, signatures: vueSignatures, parametres: vueParametres, administration: vueAdministration };
let _hashPrec = location.hash;
function route() {
  const raw = (location.hash.replace('#/', '') || 'dashboard').split('?')[0];
  const [name, param] = raw.split('/');
  // on quitte la carte alors que des modifications ne sont pas enregistrées ?
  if (name !== 'carte' && carteState && carteState.mode === 'edit'
      && (carteState.dirty.size + carteState.dirtyElems.size) > 0) {
    // eslint-disable-next-line no-alert -- garde de navigation : doit rester synchrone
    if (!confirm('Le plan comporte des modifications non enregistrées. Quitter sans enregistrer ?')) {
      location.hash = '#/carte';
      return;
    }
    carteState = null;
  }
  _hashPrec = location.hash;
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === name));
  ($('#main').innerHTML = '<p class="muted">Chargement…</p>');
  const fn = (name === 'residents' && param) ? () => vueFicheClient(param) : (routes[name] || vueDashboard);
  fn().catch((e) => { $('#main').innerHTML = `<p class="form-error">${esc(e.message)}</p>`; });
  majBadgeMessagerie();
  majBadgeImpayes();
}

async function majBadgeImpayes() {
  try {
    const { impayes } = await api('/api/relances/impayes' + (typeof exQS === 'function' ? exQS() : ''));
    const b = $('#nav-imp-badge');
    if (!b) return;
    const n = (impayes || []).length;
    b.textContent = n;
    b.classList.toggle('hidden', !n);
  } catch { /* pas de badge en cas d'erreur */ }
}

async function majBadgeMessagerie() {
  try {
    const { total } = await api('/api/messages/non-lus');
    const b = $('#nav-msg-badge');
    if (!b) return;
    b.textContent = total;
    b.classList.toggle('hidden', !total);
  } catch { /* table absente ou erreur : pas de badge */ }
}
window.addEventListener('hashchange', route);

/* ================= VUES ================= */

async function vueDashboard() {
  const [d, imp, presRes, msgRes, { residents }, echRes] = await Promise.all([
    api('/api/dashboard' + exQS()),
    api('/api/relances/impayes' + exQS()).catch(() => null),
    api('/api/prestations?statut=en_cours').catch(() => ({ prestations: [] })),
    api('/api/messages/non-lus').catch(() => ({ total: 0 })),
    api('/api/residents').catch(() => ({ residents: [] })),
    api('/api/echeances?horizon=60').catch(() => ({ echeances: [] })),
  ]);
  const echeances = (echRes.echeances || []);
  const st = d.factures_mois.par_statut || {};
  const rmap = {}; residents.forEach((r) => { rmap[r.id] = `${r.prenom || ''} ${r.nom}`.trim(); });
  const aFacturer = (presRes.prestations || []).filter((p) => p.type !== 'caution')
    .reduce((s, p) => s + Number(p.montant_ttc), 0);
  const enRetard = imp ? imp.impayes.filter((f) => f.en_retard) : [];

  $('#main').innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">Vue d'ensemble</div><h1>Tableau de bord</h1></div>
      <div class="toolbar">
        <button class="btn btn-ghost btn-sm" data-act="messageRapide">Message à un résident</button>
        <button class="btn btn-ghost btn-sm" data-act="messageGroupe">Message à tous</button>
        ${enRetard.length ? `<button class="btn btn-primary btn-sm" data-act="relancerImpayes">Relancer ${enRetard.length} retard${enRetard.length > 1 ? 's' : ''}</button>` : ''}
      </div>
    </div>

    <div class="kpis">
      <div class="kpi"><div class="v">${d.occupation.occupes}<span class="u">/${d.occupation.total}</span></div>
        <div class="l">Emplacements occupés · ${d.occupation.taux} %</div></div>
      <div class="kpi"><div class="v">${eur(d.ca_mois)}</div><div class="l">CA facturé ce mois</div></div>
      <div class="kpi ${d.impayes.total_du > 0 ? 'bad' : ''}"><div class="v">${eur(d.impayes.total_du)}</div>
        <div class="l">Impayés · ${d.impayes.nombre} facture${d.impayes.nombre > 1 ? 's' : ''}</div></div>
      <div class="kpi ${aFacturer > 0 ? 'warn' : ''}"><div class="v">${eur(aFacturer)}</div>
        <div class="l">Prestations à facturer</div></div>
    </div>

    <div class="alertes">
      ${msgRes.total ? `<a href="#/messagerie" class="alerte warn"><strong>${msgRes.total}</strong> message${msgRes.total > 1 ? 's' : ''} non lu${msgRes.total > 1 ? 's' : ''}</a>` : ''}
      ${d.alertes.documents_expirant ? `<span class="alerte warn"><strong>${d.alertes.documents_expirant}</strong> document${d.alertes.documents_expirant > 1 ? 's' : ''} à renouveler sous 30 jours</span>` : ''}
      ${d.alertes.contrats_a_renouveler.length ? `<span class="alerte"><strong>${d.alertes.contrats_a_renouveler.length}</strong> contrat${d.alertes.contrats_a_renouveler.length > 1 ? 's' : ''} arrivant à échéance</span>` : ''}
      ${!msgRes.total && !d.alertes.documents_expirant && !d.alertes.contrats_a_renouveler.length ? '<span class="alerte ok">Rien à signaler aujourd\u2019hui</span>' : ''}
    </div>

    ${imp && enRetard.length ? `
    <div class="card">
      <h2>Factures en retard</h2>
      <table style="margin-top:8px"><thead><tr><th>Facture</th><th>Résident</th><th class="right">Reste dû</th><th class="right">Retard</th><th></th></tr></thead>
      <tbody>${enRetard.slice(0, 8).map((f) => `
        <tr>
          <td><strong>${esc(f.numero)}</strong></td>
          <td data-l="Résident">${f.resident_id ? `<a href="#/residents/${f.resident_id}" style="color:inherit">${esc(rmap[f.resident_id] || '—')}</a>` : '—'}</td>
          <td class="right" data-l="Reste dû">${eur(f.reste)}</td>
          <td class="right" data-l="Retard"><span class="badge en_retard">${f.jours_retard} j</span></td>
          <td class="right">${f.resident_id ? `<button class="btn btn-ghost btn-sm" data-act="ouvrirConversation" data-a1="${f.resident_id}">Écrire</button>` : ''}</td>
        </tr>`).join('')}</tbody></table>
      ${enRetard.length > 8 ? `<p class="muted" style="margin-top:8px"><a href="#/impayes">Voir les ${enRetard.length} impayés →</a></p>` : ''}
    </div>` : ''}

    ${echeances.length ? `
    <div class="card">
      <div class="card-actions"><h2>Échéances — assurances &amp; contrats</h2>
        <button class="btn btn-ghost btn-sm" data-act="echRappels" title="Notifie le staff et écrit aux résidents concernés (paliers 60/30/7/0 j, jamais deux fois le même rappel)">Envoyer les rappels</button></div>
      <table style="margin-top:8px"><thead><tr><th>Type</th><th>Résident</th><th>Échéance</th><th>Statut</th><th></th></tr></thead>
      <tbody>${echeances.slice(0, 10).map((x) => `
        <tr>
          <td>${x.type === 'assurance' ? 'Assurance' : x.type === 'document' ? `Doc. ${esc((x.titre || '').slice(0, 28))}${!x.signe ? ' <span class="muted">(non signé)</span>' : ''}` : `Contrat ${esc(x.contrat_numero || '')}`}</td>
          <td data-l="Résident">${x.resident_id ? `<a href="#/residents/${x.resident_id}" style="color:inherit">${esc(x.resident_nom)}</a>` : esc(x.resident_nom)}</td>
          <td data-l="Échéance">${x.echeance ? dfr(x.echeance) : '—'}</td>
          <td data-l="Statut">${x.statut === 'manquante' ? '<span class="badge en_retard">aucune attestation</span>'
            : x.statut === 'expiree' ? '<span class="badge en_retard">expirée</span>'
            : `<span class="badge ${x.jours_restants <= 7 ? 'partielle' : 'emise'}">dans ${x.jours_restants} j</span>`}</td>
          <td class="right">${x.type === 'contrat'
            ? `<button class="btn btn-ghost btn-sm" data-act="renouvelerContrat" data-a1="${x.contrat_id}" title="Duplique le contrat pour la période suivante puis l\u2019envoie en signature">Renouveler</button>`
            : x.type === 'document'
            ? `<button class="btn btn-ghost btn-sm" data-act="allerA" data-a1="#/signatures" title="Déposer la nouvelle version à signer">Voir / refaire</button>`
            : (x.resident_id ? `<button class="btn btn-ghost btn-sm" data-act="ouvrirConversation" data-a1="${x.resident_id}">Écrire</button>` : '')}</td>
        </tr>`).join('')}</tbody></table>
      ${echeances.length > 10 ? `<p class="muted" style="margin-top:8px">${echeances.length - 10} autre(s) échéance(s) — affinez depuis les fiches résidents.</p>` : ''}
    </div>` : ''}

    <div class="card">
      <h2>Ce mois-ci</h2>
      <div class="stats">
        <div class="stat"><span class="k">Factures émises</span><span class="v">${d.factures_mois.total}</span></div>
        ${Object.entries(st).map(([k, v]) => `<div class="stat"><span class="k">${esc(lib(k))}</span><span class="v">${v}</span></div>`).join('')}
      </div>
      ${Object.keys(d.encaissements_mois).length ? `
        <h2 style="margin-top:20px">Encaissements</h2>
        <div class="stats">
          ${Object.entries(d.encaissements_mois).map(([k, v]) => `<div class="stat"><span class="k">${esc(lib(k))}</span><span class="v">${eur(v)}</span></div>`).join('')}
        </div>` : ''}
    </div>`;
}

window.echRappels = async () => {
  if (!await askConfirm('Envoyer les rappels d\u2019échéance dus (assurances et contrats) ?\nLe staff est notifié et les résidents concernés reçoivent un e-mail. Un même rappel n\u2019est jamais envoyé deux fois.', { titre: 'Rappels d\u2019échéances', ok: 'Envoyer' })) return;
  try {
    const r = await api('/api/echeances/rappels', { method: 'POST' });
    toast(r.rappels_envoyes ? `${r.rappels_envoyes} rappel(s) envoyé(s)` : 'Aucun rappel à envoyer (déjà tous notifiés)');
  } catch (e) { toast(e.message || 'Erreur', true); }
};

window.renouvelerContrat = async (id) => {
  if (!await askConfirm('Créer le contrat de la période suivante (mêmes conditions, dates décalées d\u2019un an) puis préparer son envoi en signature ?', { titre: 'Renouveler le contrat', ok: 'Renouveler' })) return;
  try {
    const { contrat } = await api(`/api/contrats/${id}/renouveler`, { method: 'POST' });
    toast(`Contrat ${contrat.numero} créé`);
    await contratVersSignature(contrat.id);
  } catch (e) { toast(e.message || 'Erreur', true); }
};

window.contratVersSignature = async (id) => {
  try {
    const { document: doc } = await api(`/api/contrats/${id}/envoyer-signature`, { method: 'POST' });
    toast('Contrat prêt — placez la zone de signature puis envoyez');
    editeurZones(doc.id);
  } catch (e) { toast(e.message || 'Erreur', true); }
};

window.relancerImpayes = async () => {
  if (!await askConfirm('Envoyer un rappel par e-mail à tous les clients en retard de paiement ?')) return;
  try {
    const r = await api('/api/relances/run', { method: 'POST' });
    toast(`Relances : ${r.envoyees} envoyée(s), ${r.ignorees} ignorée(s) (à échoir ou déjà relancées récemment)`);
    route();
  } catch (e) { toast(e.message, true); }
};

/* --- messages rapides & groupés --- */
window.messageGroupe = async () => {
  /* Combien de personnes exactement. « Tous » est une formule ; « 124 residents »
     est une decision — et c'est la meme phrase qui s'affiche sur un camping de
     deux et sur un camping de cent vingt-quatre. */
  let nbDestinataires = null;
  try {
    const { residents } = await api('/api/residents');
    nbDestinataires = (residents || []).filter((r) => r.actif !== false).length;
  } catch (e) { /* le compte manque, la diffusion reste possible */ }

  const combien = nbDestinataires == null
    ? 'chaque résident actif'
    : `${nbDestinataires} résident${nbDestinataires > 1 ? 's' : ''} actif${nbDestinataires > 1 ? 's' : ''}`;

  openDrawer(`
    <h2>Message à tous les résidents</h2>
    <p class="muted" style="margin-top:4px">Envoyé sur le portail de <strong>${combien}</strong>, avec notification e-mail. Un message diffusé ne peut pas être rappelé.</p>
    <form id="f-groupe" style="margin-top:14px">
      <textarea name="corps" required rows="5" placeholder="Ex. : Coupure d'eau prévue mardi de 9h à 12h…" style="width:100%;resize:vertical"></textarea>
      <button class="btn btn-primary btn-block" style="margin-top:12px">${nbDestinataires == null ? 'Envoyer à tous' : `Envoyer à ${nbDestinataires} résident${nbDestinataires > 1 ? 's' : ''}`}</button>
    </form>`);
  $('#f-groupe').addEventListener('submit', async (e) => {
    e.preventDefault();
    const corps = e.target.corps.value.trim();
    if (!corps) return;
    if (!await askConfirm(
      nbDestinataires == null
        ? 'Envoyer ce message à tous les résidents actifs ?\n\nIl ne pourra pas être rappelé.'
        : `Envoyer ce message à ${nbDestinataires} résident${nbDestinataires > 1 ? 's' : ''} ?\n\nChacun le recevra sur son portail et par e-mail. Il ne pourra pas être rappelé.`,
      { titre: 'Diffusion à tout le camping', ok: 'Envoyer' })) return;
    try {
      const r = await api('/api/messages/groupe', { method: 'POST', body: { corps } });
      closeDrawer(); toast(`Message envoyé à ${r.destinataires} résident(s)`);
    } catch (err) { toast(err.message, true); }
  });
};

window.messageRapide = async (presetResidentId) => {
  const { residents } = await api('/api/residents');
  const actifs = residents.filter((r) => r.actif !== false);
  const MODELES = {
    colis: 'Bonjour, un colis est arrivé pour vous à l\u2019accueil. Vous pouvez venir le récupérer aux horaires d\u2019ouverture.',
    courrier: 'Bonjour, du courrier vous attend à l\u2019accueil.',
    visite: 'Bonjour, merci de passer à l\u2019accueil quand vous aurez un moment.',
    libre: '',
  };
  openDrawer(`
    <h2>Message à un résident</h2>
    <form id="f-rapide" class="form-grid" style="margin-top:14px">
      <label class="full">Résident *
        <select name="resident_id" required>
          <option value="">— choisir —</option>
          ${actifs.map((r) => `<option value="${r.id}"${r.id === presetResidentId ? ' selected' : ''}>${esc(r.prenom || '')} ${esc(r.nom)}</option>`).join('')}
        </select></label>
      <label class="full">Modèle
        <select id="modele-rapide">
          <option value="colis">📦 Colis à l'accueil</option>
          <option value="courrier">✉️ Courrier à l'accueil</option>
          <option value="visite">🛎 Passer à l'accueil</option>
          <option value="libre">Message libre</option>
        </select></label>
      <div class="full"><textarea name="corps" required rows="4" style="width:100%;resize:vertical">${MODELES.colis}</textarea></div>
      <div class="full"><button class="btn btn-primary btn-block">Envoyer</button></div>
    </form>`);
  $('#modele-rapide').addEventListener('change', (e) => {
    $('#f-rapide').corps.value = MODELES[e.target.value] ?? '';
  });
  $('#f-rapide').addEventListener('submit', async (e) => {
    e.preventDefault();
    const resident_id = e.target.resident_id.value;
    const corps = e.target.corps.value.trim();
    if (!resident_id || !corps) return;
    try {
      await api('/api/messages', { method: 'POST', body: { resident_id, corps } });
      closeDrawer(); toast('Message envoyé (portail + e-mail)');
    } catch (err) { toast(err.message, true); }
  });
};

/* ---------- Carte du camping (plan réel : emplacements + décor) ---------- */
const STATUT_COLOR = { libre: '#1E5C4A', occupe: '#2C5282', reserve: '#C98B2D', indisponible: '#8A8A8A', impaye: '#B3492F' };
const CARTE_W = 1000, CARTE_H = 620, CARTE_PAD = 20;
const SNAP = 10;                       // aimantation à la grille
let carteState = null;

const ELEM_DEFS = {
  accueil:    { lib: 'Accueil',      grp: 'Bâtiments', forme: 'bati', w: 120, h: 76, fill: '#1F5A49', fg: '#F4EFE4', icone: 'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' },
  sanitaires: { lib: 'Sanitaires',   grp: 'Bâtiments', forme: 'bati', w: 96,  h: 64, fill: '#3D5A99', fg: '#EEF2FA', icone: 'M7 3v6m0 0a3 3 0 0 0 6 0M7 9H4m13-6v18M4 9v12' },
  piscine:    { lib: 'Piscine',      grp: 'Bâtiments', forme: 'bati', w: 140, h: 86, fill: '#2E86A8', fg: '#EAF6FA', icone: 'M2 16c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2M2 20c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2' },
  restaurant: { lib: 'Restaurant',   grp: 'Bâtiments', forme: 'bati', w: 106, h: 70, fill: '#A0522D', fg: '#FBF0E6', icone: 'M5 3v8m0 0v10M3 3v5a2 2 0 0 0 4 0V3M15 3c-1 3-1 5 0 7v11' },
  laverie:    { lib: 'Laverie',      grp: 'Bâtiments', forme: 'bati', w: 90,  h: 62, fill: '#6B5B95', fg: '#F2EDF8', icone: 'M4 3h16v18H4zM12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8' },
  aire_jeux:  { lib: 'Aire de jeux', grp: 'Bâtiments', forme: 'bati', w: 106, h: 70, fill: '#C98B2D', fg: '#FDF6E7', icone: 'M4 20V6l16 14V6M4 6h16' },
  local:      { lib: 'Local',        grp: 'Bâtiments', forme: 'bati', w: 86,  h: 60, fill: '#6E6E66', fg: '#F2F2EE', icone: 'M4 8h16v12H4zM4 8l8-5 8 5' },
  parking:    { lib: 'Parking',      grp: 'Bâtiments', forme: 'bati', w: 116, h: 76, fill: '#4A5A55', fg: '#EEF2F0', icone: 'M8 20V5h4a4 4 0 0 1 0 8H8' },
  allee:      { lib: 'Allée',        grp: 'Tracés',    forme: 'ligne', long: 260 },
  barriere:   { lib: 'Barrière',     grp: 'Tracés',    forme: 'ligne', long: 180 },
  zone:       { lib: 'Zone',         grp: 'Surfaces',  forme: 'zone', w: 210, h: 150, fill: '#CFE0D5' },
  eau:        { lib: 'Plan d’eau',   grp: 'Surfaces',  forme: 'zone', w: 180, h: 120, fill: '#AFD4E4' },
  arbre:      { lib: 'Arbre',        grp: 'Décor',     forme: 'arbre' },
  texte:      { lib: 'Texte',        grp: 'Décor',     forme: 'texte' },
};

const snap = (v) => Math.round(v / SNAP) * SNAP;
const carteClamp = (v, min, max) => Math.max(min, Math.min(max, v));

window.imprimerCarte = () => {
  const svg = document.querySelector('.map-svg');
  if (!svg) { toast('Ouvre la carte avant d\u2019imprimer', true); return; }
  const legend = document.querySelector('.map-legend');
  const nom = (CAMPINGS.find((c) => c.camping_id === ACTIVE_CAMPING) || {}).nom || 'Camping';
  const dateStr = new Date().toLocaleDateString('fr-FR');
  const w = window.open('', '_blank', 'width=1200,height=850');
  if (!w) { toast('Autorise les pop-ups pour imprimer le plan', true); return; }
  w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Plan \u2014 ${esc(nom)}</title>
    <style>
      @page{size:A4 landscape;margin:8mm}
      *{box-sizing:border-box}
      body{margin:0;padding:14px;font-family:system-ui,-apple-system,sans-serif;color:#2b2b26}
      .hd{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px}
      .hd h1{font-size:17px;margin:0}
      .hd .dt{font-size:12px;color:#777}
      svg{width:100%;height:auto;border:1px solid #e3ddcf;border-radius:8px}
      .legend{display:flex;gap:18px;flex-wrap:wrap;font-size:12px;margin-top:12px;color:#444}
      .legend>span{display:inline-flex;align-items:center}
      .legend .dot{display:inline-block;width:11px;height:11px;border-radius:50%;margin-right:6px}
      @media print{body{padding:0}.legend{margin-top:8px}}
    </style></head><body>
    <div class="hd"><h1>${esc(nom)} \u2014 plan du camping</h1><span class="dt">${dateStr}</span></div>
    ${svg.outerHTML}
    ${legend ? `<div class="legend">${legend.innerHTML}</div>` : ''}
  </body></html>`);
  w.document.close();
  const go = () => { try { w.focus(); w.print(); } catch (_) { /* ignore */ } };
  const img = w.document.querySelector('svg image');
  if (img) {
    let done = false; const once = () => { if (done) return; done = true; go(); };
    img.addEventListener('load', once); img.addEventListener('error', once);
    setTimeout(once, 1500);
  } else {
    w.onload = go;
  }
};

async function vueCarte() {
  const [{ emplacements }, imp, elemRes] = await Promise.all([
    api('/api/emplacements/carte'),
    api('/api/relances/impayes'),
    api('/api/carte-elements').catch(() => ({ elements: [], migration_manquante: true })),
  ]);
  const enRetard = new Set();
  for (const f of imp.impayes || []) if (f.en_retard) enRetard.add(f.resident_id);

  const num = (v) => (v == null ? null : Number(v));
  carteState = {
    emplacements: emplacements.map((e) => ({ ...e, coord_x: num(e.coord_x), coord_y: num(e.coord_y) })),
    elements: (elemRes.elements || []).map((el) => ({
      ...el, x: Number(el.x), y: Number(el.y),
      largeur: num(el.largeur), hauteur: num(el.hauteur), x2: num(el.x2), y2: num(el.y2),
    })),
    migrationManquante: !!elemRes.migration_manquante,
    enRetard,
    mode: 'view',
    dirty: new Map(),
    dirtyElems: new Map(),
    selected: null,
    drag: null,
  };
  renderCarte();
}

/* Le statut reel d'un emplacement.

   La colonne « statut » ne se met pas a jour toute seule : personne ne la
   passe a « occupe » quand un resident arrive. S'y fier affichait un camping
   complet comme entierement libre. Un emplacement est occupe parce qu'un
   resident y habite — c'est une consequence, pas une saisie.

   Les deux etats qui ne se deduisent de rien (travaux, reservation a venir)
   restent saisis a la main et sont respectes, mais jamais au point de nier
   un resident present. */
function statutReel(e) {
  if (e.resident) return 'occupe';
  if (e.statut === 'indisponible' || e.statut === 'reserve') return e.statut;
  return 'libre';
}

function carteColor(e) {
  if (e.resident && carteState.enRetard.has(e.resident.id)) return STATUT_COLOR.impaye;
  return STATUT_COLOR[statutReel(e)] || '#999';
}
function carteCoords(e) {
  if (carteState.dirty.has(e.id)) return carteState.dirty.get(e.id);
  return e.coord_x == null || e.coord_y == null ? null : { coord_x: e.coord_x, coord_y: e.coord_y };
}
function elemVals(el) {
  const d = carteState.dirtyElems.get(el.id);
  return d ? { ...el, ...d } : el;
}
const nbModifs = () => carteState.dirty.size + carteState.dirtyElems.size;

/* ------------------------------- rendu ------------------------------- */

/* Le nom d'une allee, sans son trace. Dessine dans une couche posee apres les
   pastilles : en SVG le dernier dessine passe au-dessus, et les pastilles
   hachaient les noms d'allees des zones denses. Rend une chaine vide pour
   tout ce qui n'est pas une allee nommee. */
function dessinerLibelleAllee(el) {
  const v = elemVals(el);
  const def = ELEM_DEFS[v.type] || {};
  if (def.forme !== 'ligne' || v.type !== 'allee') return '';
  const lib = v.libelle || def.lib || '';
  if (!lib) return '';

  const x2 = v.x2 ?? v.x + (def.long || 200), y2 = v.y2 ?? v.y;
  const mx = v.x + (x2 - v.x) * 0.32, my = v.y + (y2 - v.y) * 0.32;
  const angle = Math.atan2(y2 - v.y, x2 - v.x) * 180 / Math.PI;
  const larg = lib.length * 6.6 + 18;

  return `<g transform="rotate(${angle} ${mx} ${my})">
    <rect class="celem-allee-bg" x="${mx - larg / 2}" y="${my - 8}" width="${larg}" height="16" rx="8"></rect>
    <text class="celem-allee" x="${mx}" y="${my}">${esc(lib)}</text></g>`;
}

function dessinerElement(el, edit) {
  const v = elemVals(el);
  const def = ELEM_DEFS[v.type] || {};
  const sel = carteState.selected?.kind === 'elem' && carteState.selected.id === v.id;
  const cls = `celem${sel ? ' selected' : ''}`;
  const lib = v.libelle || def.lib || '';

  if (def.forme === 'ligne') {
    const x2 = v.x2 ?? v.x + (def.long || 200), y2 = v.y2 ?? v.y;
    const allee = v.type === 'allee';
    const mx = v.x + (x2 - v.x) * 0.32, my = v.y + (y2 - v.y) * 0.32;
    const angle = Math.atan2(y2 - v.y, x2 - v.x) * 180 / Math.PI;
    const larg = lib.length * 6.6 + 18;
    return `<g class="${cls}" data-id="${v.id}" data-kind="elem">
      <line class="hit" x1="${v.x}" y1="${v.y}" x2="${x2}" y2="${y2}" stroke="transparent" stroke-width="26"></line>
      <line x1="${v.x}" y1="${v.y}" x2="${x2}" y2="${y2}" stroke="${allee ? '#E4DCC8' : '#8A8A7E'}"
        stroke-width="${allee ? 22 : 4}" stroke-linecap="round" ${allee ? '' : 'stroke-dasharray="9 7"'}></line>
      ${allee ? `<line x1="${v.x}" y1="${v.y}" x2="${x2}" y2="${y2}" stroke="#F7F2E4" stroke-width="16" stroke-linecap="round"></line>` : ''}
      ${/* le libelle est dessine par dessinerLibelleAllee, dans une couche
            posee APRES les pastilles — sinon elles le recouvrent */ ''}
      ${edit && sel ? `<circle class="handle" data-h="a" cx="${v.x}" cy="${v.y}" r="7"></circle>
                       <circle class="handle" data-h="b" cx="${x2}" cy="${y2}" r="7"></circle>` : ''}
    </g>`;
  }

  if (def.forme === 'arbre') {
    return `<g class="${cls}" data-id="${v.id}" data-kind="elem" transform="translate(${v.x},${v.y})">
      <circle class="hit" r="18" fill="transparent"></circle>
      <circle cx="0" cy="-4" r="13" fill="#5B8C63" opacity=".92"></circle>
      <circle cx="-7" cy="2" r="9" fill="#4E7C56" opacity=".9"></circle>
      <circle cx="7" cy="2" r="9" fill="#6B9E72" opacity=".9"></circle>
      <rect x="-2" y="6" width="4" height="9" rx="1.5" fill="#7A5C3E"></rect>
    </g>`;
  }

  if (def.forme === 'texte') {
    return `<g class="${cls}" data-id="${v.id}" data-kind="elem" transform="translate(${v.x},${v.y})">
      <text class="celem-libre">${esc(lib || 'Texte')}</text>
    </g>`;
  }

  const w = v.largeur ?? def.w ?? 100, h = v.hauteur ?? def.h ?? 70;
  const zone = def.forme === 'zone';
  const fill = v.couleur || def.fill || '#ccc';
  return `<g class="${cls}" data-id="${v.id}" data-kind="elem" transform="translate(${v.x},${v.y})">
    <rect x="0" y="0" width="${w}" height="${h}" rx="${zone ? 22 : 10}" fill="${fill}"
      ${zone ? 'opacity=".55" stroke="#9FB8A8" stroke-dasharray="7 6"' : 'stroke="rgba(255,255,255,.35)"'} stroke-width="1.5"></rect>
    ${!zone && def.icone ? `<path d="${def.icone}" transform="translate(${w / 2 - 12}, ${h / 2 - 21})"
      fill="none" stroke="${def.fg}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" opacity=".9"></path>` : ''}
    <text class="celem-lib" x="${w / 2}" y="${zone ? h / 2 : h / 2 + 20}" fill="${zone ? '#3E5A4B' : def.fg}">${esc(lib)}</text>
    ${edit && sel ? `<circle class="handle" data-h="size" cx="${w}" cy="${h}" r="7"></circle>` : ''}
  </g>`;
}

function renderCarte() {
  const st = carteState;
  const edit = st.mode === 'edit';
  const placed = [], unplaced = [];
  st.emplacements.forEach((e) => (carteCoords(e) ? placed : unplaced).push(e));

  const decor = st.elements.map((el) => dessinerElement(el, edit)).join('');
  const alleeLibelles = st.elements.map((el) => dessinerLibelleAllee(el)).join('');
  const pins = placed.map((e) => {
    const c = carteCoords(e);
    const x = carteClamp(c.coord_x, CARTE_PAD, CARTE_W - CARTE_PAD);
    const y = carteClamp(c.coord_y, CARTE_PAD, CARTE_H - CARTE_PAD);
    const sel = st.selected?.kind === 'emp' && st.selected.id === e.id ? ' selected' : '';
    /* Numero et occupant, normalises une fois au rendu : la recherche n'a
       plus qu'a comparer des chaines, sans retraiter 124 fiches par frappe. */
    const occ = e.resident ? `${e.resident.prenom || ''} ${e.resident.nom || ''}` : '';
    return `<g class="pin${sel}" data-id="${e.id}" data-kind="emp" transform="translate(${x},${y})"
      data-cherche="${esc(sansAccents(`${e.numero} ${occ}`))}"
      data-num="${esc(e.numero)}" data-occ="${esc(occ.trim())}"
      data-etat="${esc(libelleEtat(e))}">
      <circle r="13" fill="${carteColor(e)}"></circle><text>${esc(e.numero)}</text></g>`;
  }).join('');

  const n = nbModifs();
  const groupes = {};
  Object.entries(ELEM_DEFS).forEach(([k, d]) => { (groupes[d.grp] ||= []).push([k, d]); });

  $('#main').innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">Plan interactif</div><h1>Carte du camping</h1></div>
      ${edit ? `<div class="map-tools">
          <span class="map-dirty ${n ? '' : 'hidden'}">${n} modif.</span>
          <button class="btn btn-ghost btn-sm" data-act="imprimerCarte">Imprimer</button>
          <button class="btn btn-ghost btn-sm" data-act="cancelCarteEdit">Annuler</button>
          <button class="btn btn-primary btn-sm" data-act="saveCarte" ${n ? '' : 'disabled'}>Enregistrer le plan</button>
        </div>`
        : `<div class="map-tools">
          <button class="btn btn-ghost btn-sm" data-act="imprimerCarte">Imprimer</button>
          <button class="btn btn-primary btn-sm" data-act="toggleCarteEdit">Éditer le plan</button>
        </div>`}
    </div>
    ${st.migrationManquante && edit ? '<p class="form-error" style="margin-bottom:12px">Table « carte_elements » absente — exécutez la migration db/11_echanges_carte_suivi.sql.</p>' : ''}
    ${edit ? '' : `<div class="map-search">
      <input id="map-q" type="search" placeholder="Numéro ou nom de l'occupant" autocomplete="off"
        aria-label="Rechercher un emplacement">
      <span class="muted" id="map-q-info">${st.emplacements.length} emplacements — cliquer une pastille pour ouvrir la fiche</span>
    </div>
    <div class="map-bar">
      <div class="map-legend">
        <span><span class="dot" style="background:${STATUT_COLOR.libre}"></span>Libre</span>
        <span><span class="dot" style="background:${STATUT_COLOR.occupe}"></span>Occupé</span>
        <span><span class="dot" style="background:${STATUT_COLOR.impaye}"></span>Impayé</span>
        <span><span class="dot" style="background:${STATUT_COLOR.reserve}"></span>Réservé</span>
        <span><span class="dot" style="background:${STATUT_COLOR.indisponible}"></span>Indisponible</span>
      </div>
      ${unplaced.length ? `<button class="btn btn-ghost btn-sm" data-act="toggleCarteEdit"
        title="${esc(unplaced.map((e) => e.numero).join(', '))}">
        ${unplaced.length} sans position — les placer</button>` : ''}
    </div>`}

    <div class="${edit ? 'map-edit-layout' : ''}">
      <div>
        <div class="map-wrap${edit ? ' editing' : ''}">
          <svg class="map-svg" viewBox="0 0 ${CARTE_W} ${CARTE_H}" role="img" aria-label="Plan du camping">
            <g class="layer-decor">${decor}</g>
            <g class="layer-pins">${pins}</g>
            <g class="layer-allees">${alleeLibelles}</g>
          </svg>
          ${edit ? `<div class="map-legend">
            <span><span class="dot" style="background:${STATUT_COLOR.libre}"></span>Libre</span>
            <span><span class="dot" style="background:${STATUT_COLOR.occupe}"></span>Occupé</span>
            <span><span class="dot" style="background:${STATUT_COLOR.impaye}"></span>Impayé</span>
            <span><span class="dot" style="background:${STATUT_COLOR.reserve}"></span>Réservé</span>
            <span><span class="dot" style="background:${STATUT_COLOR.indisponible}"></span>Indisponible</span>
          </div>` : ''}
          <div class="map-tip" id="map-tip" aria-hidden="true"></div>
        </div>
      </div>

      ${edit ? `<aside class="map-panel">
        <div id="map-props"></div>
        <div class="map-panel-sec">
          <h3>Ajouter</h3>
          ${Object.entries(groupes).map(([g, items]) => `
            <div class="map-grp">${esc(g)}</div>
            <div class="map-chips">${items.map(([k, d]) => `<button class="map-chip" data-act="ajouterElement" data-a1="${k}">${esc(d.lib)}</button>`).join('')}</div>`).join('')}
        </div>
        ${unplaced.length ? `<div class="map-panel-sec">
          <h3>Emplacements à placer <span class="map-count">${unplaced.length}</span></h3>
          <div class="map-chips">${unplaced.map((e) => `<button class="map-chip" data-act="placeEmplacement" data-a1="${e.id}">${esc(e.numero)}</button>`).join('')}</div>
        </div>` : ''}
        <p class="map-aide">Glissez pour déplacer · poignée dorée pour redimensionner · <kbd>Suppr</kbd> pour retirer · <kbd>Échap</kbd> pour désélectionner. Aimantation automatique.</p>
      </aside>` : ''}
    </div>`;

  wireCarte();
  renderProps();

  carteInfobulle();

  const champ = $('#map-q');
  if (champ) {
    champ.addEventListener('input', () => filtrerCarte(champ.value));
    champ.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { champ.value = ''; filtrerCarte(''); }
    });
  }
}

/* Le mot qui accompagne la couleur. Meme deduction que carteColor : les
   deux doivent dire la meme chose, sinon l'infobulle contredit la pastille. */
function libelleEtat(e) {
  if (e.resident && carteState.enRetard.has(e.resident.id)) return 'impayé';
  /* lib() lit STATUT_LIB, la table des libelles du fichier. L'infobulle
     doit nommer l'etat comme le reste du produit — et il n'existe qu'une
     table, meme si j'en avais invente une seconde sous un autre nom. */
  return lib(statutReel(e));
}

/* --------------------- recherche sur le plan --------------------- */

/* Minuscules sans accents : « BERTHIER », « Berthier » et « berthier »
   doivent se valoir. Sur le numero c'est sans effet, sur les noms c'est
   ce qui fait la difference entre trouver et ne pas trouver. */
function sansAccents(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
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
    if (info) info.textContent = `${pins.length} emplacements — cliquer une pastille pour ouvrir la fiche`;
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
      ? `Aucun emplacement ne correspond à « ${q.trim()} »`
      : n === 1 ? '1 emplacement trouvé' : `${n} emplacements trouvés`;
  }
}

/* L'infobulle de survol. L'occupant est deja charge — le clic ne devrait pas
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
    tip.innerHTML = `<strong>${esc(num)}</strong>${occ ? ' · ' + esc(occ) : ''}`
      + `<span class="map-tip-etat">${esc(pin.dataset.etat || '')}</span>`;
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

/* --------------------- panneau de propriétés --------------------- */

function renderProps() {
  const box = $('#map-props');
  if (!box) return;
  const st = carteState;
  const s = st.selected;

  if (!s) {
    box.innerHTML = `<div class="map-panel-sec map-empty">Sélectionnez un élément du plan pour le modifier.</div>`;
    return;
  }

  if (s.kind === 'emp') {
    const e = st.emplacements.find((x) => x.id === s.id);
    box.innerHTML = `<div class="map-panel-sec">
      <h3>Emplacement ${esc(e.numero)}</h3>
      <p class="muted" style="margin:0 0 10px">${esc(e.secteur || '')} ${e.type ? '· ' + esc(e.type) : ''}</p>
      <button class="btn btn-ghost btn-sm btn-block" data-act="retirerSelection">Retirer du plan</button>
    </div>`;
    return;
  }

  const el = st.elements.find((x) => x.id === s.id);
  if (!el) { box.innerHTML = ''; return; }
  const v = elemVals(el);
  const def = ELEM_DEFS[v.type] || {};
  box.innerHTML = `<div class="map-panel-sec">
    <h3>${esc(def.lib || v.type)}</h3>
    <label style="margin-bottom:10px">Nom affiché
      <input id="prop-lib" value="${esc(v.libelle || '')}" placeholder="${esc(def.lib || '')}"></label>
    ${def.forme === 'bati' || def.forme === 'zone' ? `
      <div style="display:flex;gap:8px">
        <label>Largeur<input id="prop-w" type="number" step="10" value="${Math.round(v.largeur ?? def.w)}"></label>
        <label>Hauteur<input id="prop-h" type="number" step="10" value="${Math.round(v.hauteur ?? def.h)}"></label>
      </div>` : ''}
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn btn-ghost btn-sm" style="flex:1" data-act="dupliquerElement">Dupliquer</button>
      <button class="btn btn-ghost btn-sm" style="flex:1" data-act="supprimerElement">Supprimer</button>
    </div>
  </div>`;

  const maj = (patch) => {
    const prev = st.dirtyElems.get(el.id) || {};
    st.dirtyElems.set(el.id, { ...prev, ...patch });
    redessinerDecor();
    majOutils();
  };
  $('#prop-lib').addEventListener('input', (e) => maj({ libelle: e.target.value }));
  $('#prop-w')?.addEventListener('input', (e) => maj({ largeur: Math.max(40, Number(e.target.value) || 40) }));
  $('#prop-h')?.addEventListener('input', (e) => maj({ hauteur: Math.max(30, Number(e.target.value) || 30) }));
}

function majOutils() {
  const n = nbModifs();
  const badge = document.querySelector('.map-dirty');
  const save = document.querySelector('.map-tools .btn-primary');
  if (badge) { badge.textContent = n + ' modif.'; badge.classList.toggle('hidden', !n); }
  if (save) save.disabled = !n;
}

// redessine la couche décor SANS toucher au nœud en cours de glisser
function redessinerDecor() {
  const layer = document.querySelector('.layer-decor');
  if (!layer) return;
  layer.innerHTML = carteState.elements.map((el) => dessinerElement(el, carteState.mode === 'edit')).join('');
  wireDecor();
}

/* ---------------------------- interactions ---------------------------- */

function svgPoint(svg, evt) {
  const pt = svg.createSVGPoint();
  pt.x = evt.clientX; pt.y = evt.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function wireCarte() {
  const st = carteState;
  const svg = document.querySelector('.map-svg');
  if (!svg) return;

  if (st.mode !== 'edit') {
    svg.querySelectorAll('.pin').forEach((g) => g.addEventListener('click', () => ficheEmplacement(g.dataset.id)));
    return;
  }

  // clic dans le vide -> désélection
  svg.addEventListener('pointerdown', (e) => {
    if (e.target === svg && st.selected) { st.selected = null; renderCarte(); }
  });

  // pastilles
  svg.querySelectorAll('.pin').forEach((g) => attacherDrag(g, svg));
  wireDecor();

  // clavier : Suppr / Échap
  if (!window._carteKeys) {
    window._carteKeys = (e) => {
      if (!carteState || carteState.mode !== 'edit' || !carteState.selected) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      if (e.key === 'Escape') { carteState.selected = null; renderCarte(); }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (carteState.selected.kind === 'elem') supprimerElement();
        else retirerSelection();
      }
    };
    document.addEventListener('keydown', window._carteKeys);
  }
}

function wireDecor() {
  const svg = document.querySelector('.map-svg');
  if (!svg || carteState.mode !== 'edit') return;
  svg.querySelectorAll('.celem').forEach((g) => attacherDrag(g, svg));
  svg.querySelectorAll('.handle').forEach((h) => attacherHandle(h, svg));
}

// Glisser : on modifie le nœud DOM en place, sans jamais re-render pendant le drag.
function attacherDrag(g, svg) {
  if (g._wired) return;
  g._wired = true;
  const st = carteState;
  const id = g.dataset.id;
  const kind = g.dataset.kind;

  g.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('handle')) return;
    e.preventDefault();
    const p = svgPoint(svg, e);
    const base = kind === 'elem'
      ? elemVals(st.elements.find((x) => x.id === id))
      : (carteCoords(st.emplacements.find((x) => x.id === id)) || { coord_x: p.x, coord_y: p.y });
    const ox = kind === 'elem' ? p.x - base.x : p.x - base.coord_x;
    const oy = kind === 'elem' ? p.y - base.y : p.y - base.coord_y;
    st.drag = { kind, id, moved: false, ox, oy, base, node: g };
    g.classList.add('dragging');
    try { g.setPointerCapture(e.pointerId); } catch (_) {}
  });

  g.addEventListener('pointermove', (e) => {
    const d = st.drag;
    if (!d || d.id !== id || d.node !== g) return;
    const p = svgPoint(svg, e);
    d.moved = true;

    if (kind === 'emp') {
      const x = snap(carteClamp(p.x - d.ox, CARTE_PAD, CARTE_W - CARTE_PAD));
      const y = snap(carteClamp(p.y - d.oy, CARTE_PAD, CARTE_H - CARTE_PAD));
      g.setAttribute('transform', `translate(${x},${y})`);
      d.next = { coord_x: x, coord_y: y };
      return;
    }

    const b = d.base;
    const nx = snap(carteClamp(p.x - d.ox, -10, CARTE_W - 20));
    const ny = snap(carteClamp(p.y - d.oy, -10, CARTE_H - 20));
    const patch = { x: nx, y: ny };
    const def = ELEM_DEFS[b.type] || {};
    if (def.forme === 'ligne') {
      const x2 = b.x2 ?? b.x + (def.long || 200), y2 = b.y2 ?? b.y;
      patch.x2 = Math.round(x2 + (nx - b.x));
      patch.y2 = Math.round(y2 + (ny - b.y));
      // les lignes ne sont pas en translate() : on décale le groupe visuellement
      g.setAttribute('transform', `translate(${nx - b.x},${ny - b.y})`);
    } else {
      g.setAttribute('transform', `translate(${nx},${ny})`);
    }
    d.next = patch;
  });

  const fin = (e) => {
    const d = st.drag;
    if (!d || d.id !== id || d.node !== g) return;
    st.drag = null;
    g.classList.remove('dragging');
    try { g.releasePointerCapture(e.pointerId); } catch (_) {}

    if (d.moved && d.next) {
      if (kind === 'emp') st.dirty.set(id, d.next);
      else st.dirtyElems.set(id, { ...(st.dirtyElems.get(id) || {}), ...d.next });
      st.selected = { kind, id };
      renderCarte();           // re-render UNE FOIS, après le drag
    } else {
      st.selected = { kind, id };
      renderCarte();
    }
  };
  g.addEventListener('pointerup', fin);
  g.addEventListener('pointercancel', fin);
}

function attacherHandle(h, svg) {
  if (h._wired) return;
  h._wired = true;
  const st = carteState;
  const g = h.closest('.celem');
  const id = g.dataset.id;
  const mode = h.dataset.h;

  h.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    st.drag = { kind: 'handle', id, mode, base: elemVals(st.elements.find((x) => x.id === id)) };
    try { h.setPointerCapture(e.pointerId); } catch (_) {}
  });

  h.addEventListener('pointermove', (e) => {
    const d = st.drag;
    if (d?.kind !== 'handle' || d.id !== id) return;
    const p = svgPoint(svg, e);
    const b = d.base;
    const prev = st.dirtyElems.get(id) || {};
    if (mode === 'size') {
      st.dirtyElems.set(id, { ...prev,
        largeur: Math.max(40, snap(p.x - b.x)), hauteur: Math.max(30, snap(p.y - b.y)) });
    } else if (mode === 'a') {
      st.dirtyElems.set(id, { ...prev, x: snap(carteClamp(p.x, 0, CARTE_W)), y: snap(carteClamp(p.y, 0, CARTE_H)) });
    } else {
      st.dirtyElems.set(id, { ...prev, x2: snap(carteClamp(p.x, 0, CARTE_W)), y2: snap(carteClamp(p.y, 0, CARTE_H)) });
    }
    d.moved = true;
    redessinerDecor();
  });

  const fin = (e) => {
    const d = st.drag;
    if (d?.kind !== 'handle') return;
    st.drag = null;
    try { h.releasePointerCapture(e.pointerId); } catch (_) {}
    if (d.moved) { majOutils(); renderProps(); }
  };
  h.addEventListener('pointerup', fin);
  h.addEventListener('pointercancel', fin);
}

/* ------------------------------ actions ------------------------------ */

window.toggleCarteEdit = () => {
  carteState.mode = 'edit';
  renderCarte();
};

window.cancelCarteEdit = async () => {
  if (nbModifs() && !await askConfirm('Abandonner les modifications non enregistrées ?')) return;
  vueCarte();
};

window.placeEmplacement = (id) => {
  const st = carteState;
  const off = (st.dirty.size % 8) * 30;
  st.dirty.set(id, { coord_x: snap(80 + off), coord_y: snap(80 + off) });
  st.selected = { kind: 'emp', id };
  renderCarte();
};

window.retirerSelection = () => {
  const st = carteState;
  if (st.selected?.kind !== 'emp') return;
  st.dirty.set(st.selected.id, null);
  st.selected = null;
  renderCarte();
};

window.ajouterElement = async (type) => {
  const def = ELEM_DEFS[type];
  const body = { type, libelle: def.lib, x: 140, y: 140 };
  if (def.forme === 'ligne') { body.x2 = 140 + (def.long || 200); body.y2 = 140; }
  if (def.forme === 'bati' || def.forme === 'zone') { body.largeur = def.w; body.hauteur = def.h; }
  try {
    const { element } = await api('/api/carte-elements', { method: 'POST', body });
    const num = (v) => (v == null ? null : Number(v));
    carteState.elements.push({ ...element, x: Number(element.x), y: Number(element.y),
      largeur: num(element.largeur), hauteur: num(element.hauteur), x2: num(element.x2), y2: num(element.y2) });
    carteState.selected = { kind: 'elem', id: element.id };
    renderCarte();
    toast(`${def.lib} ajouté — glisse-le à sa place`);
  } catch (e) { toast(e.message, true); }
};

window.dupliquerElement = async () => {
  const st = carteState;
  if (st.selected?.kind !== 'elem') return;
  const v = elemVals(st.elements.find((x) => x.id === st.selected.id));
  const body = { type: v.type, libelle: v.libelle, x: v.x + 30, y: v.y + 30,
    largeur: v.largeur, hauteur: v.hauteur, couleur: v.couleur };
  if (v.x2 != null) { body.x2 = v.x2 + 30; body.y2 = v.y2 + 30; }
  try {
    const { element } = await api('/api/carte-elements', { method: 'POST', body });
    const num = (n) => (n == null ? null : Number(n));
    st.elements.push({ ...element, x: Number(element.x), y: Number(element.y),
      largeur: num(element.largeur), hauteur: num(element.hauteur), x2: num(element.x2), y2: num(element.y2) });
    st.selected = { kind: 'elem', id: element.id };
    renderCarte();
    toast('Élément dupliqué');
  } catch (e) { toast(e.message, true); }
};

window.supprimerElement = async () => {
  const st = carteState;
  if (st.selected?.kind !== 'elem') return;
  const el = st.elements.find((x) => x.id === st.selected.id);
  const nom = elemVals(el).libelle || ELEM_DEFS[el.type]?.lib || 'cet élément';
  if (!await askConfirm(`Supprimer « ${nom} » du plan ?`)) return;
  try {
    await api(`/api/carte-elements/${el.id}`, { method: 'DELETE' });
    st.elements = st.elements.filter((x) => x.id !== el.id);
    st.dirtyElems.delete(el.id);
    st.selected = null;
    renderCarte();
    toast('Élément supprimé');
  } catch (e) { toast(e.message, true); }
};

window.saveCarte = async () => {
  const st = carteState;
  if (!nbModifs()) return;
  try {
    if (st.dirty.size) {
      const positions = [...st.dirty.entries()].map(([id, v]) => ({
        id, coord_x: v ? v.coord_x : null, coord_y: v ? v.coord_y : null }));
      await api('/api/emplacements/positions', { method: 'PUT', body: { positions } });
      positions.forEach(({ id, coord_x, coord_y }) => {
        const e = st.emplacements.find((x) => x.id === id);
        if (e) { e.coord_x = coord_x; e.coord_y = coord_y; }
      });
    }
    if (st.dirtyElems.size) {
      const elements = [...st.dirtyElems.entries()].map(([id, v]) => ({ id, ...v }));
      await api('/api/carte-elements/batch', { method: 'PUT', body: { elements } });
      elements.forEach((e) => {
        const el = st.elements.find((x) => x.id === e.id);
        if (el) Object.assign(el, e);
      });
    }
    st.dirty.clear(); st.dirtyElems.clear();
    toast('Plan enregistré');
    renderCarte();
  } catch (err) { toast(err.message, true); }
};

window.ficheEmplacement = async (id) => {
  const { emplacement: e, residents } = await api('/api/emplacements/' + id);
  const r = residents[0];
  let facturesHtml = '';
  if (r) {
    const { factures } = await api('/api/factures?resident_id=' + r.id + exQSand());
    const dues = factures.filter((f) => ['emise', 'partielle', 'en_retard'].includes(f.statut));
    facturesHtml = `<h2 style="margin-top:18px">Factures en cours</h2>
      ${dues.length ? `<ul class="list-tight">${dues.map((f) => `<li><span>${esc(f.numero)} <span class="badge ${f.statut}">${lib(f.statut)}</span></span><span>${eur(f.total_ttc - f.montant_regle)}</span></li>`).join('')}</ul>` : '<p class="muted">Aucune facture en attente.</p>'}`;
  }
  openDrawer(`
    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding-right:44px">
      <h2>Emplacement ${esc(e.numero)}</h2>
      <button class="btn btn-ghost btn-sm" data-act="modifierEmplacement" data-a1="${e.id}">Modifier</button>
    </div>
    <p class="muted">${esc(e.secteur || '')} ${e.type ? '· ' + esc(e.type) : ''} · <span class="badge ${e.statut}">${lib(e.statut)}</span></p>
    <ul class="list-tight">
      <li><span>Loyer de base</span><span>${eur(e.loyer_base)}</span></li>
    </ul>
    ${r ? `<h2 style="margin-top:18px">Résident</h2>
      <ul class="list-tight">
        <li><span>${esc(r.prenom || '')} ${esc(r.nom)}</span><span class="fiche-solde ${Number(r.solde) < 0 ? 'neg' : 'pos'}"></span></li>
        ${r.email ? `<li><span>E-mail</span><span>${esc(r.email)}</span></li>` : ''}
        ${r.telephone ? `<li><span>Téléphone</span><span>${esc(r.telephone)}</span></li>` : ''}
      </ul>${facturesHtml}` : '<p class="muted" style="margin-top:14px">Aucun résident rattaché.</p>'}
  `);
};

/* ---------- Résidents ---------- */
/* ---------- Residents : liste dense, etats en mots ----------
   L'etat de l'ecran (filtre, recherche) vit ici : on revient sur le
   meme filtre apres un aller-retour vers une fiche. */
let RES_FILTRE = 'tous';
let RES_Q = '';
let RES_CACHE = { residents: [], empNum: {} };

const RES_J = 86400000;
const resJours = (d) => (d ? Math.floor((new Date(d) - new Date()) / RES_J) : null);

/* L'ambre des avertissements : c'est la couleur de texte deja utilisee
   par l'avis « prix non configure » des compteurs. Le laiton de marque
   reste un accent, il ne dit jamais un etat. */
const RES_AMBRE = '#7A5A22';

function resAssurance(r) {
  if (!r.assurance_expire_le) return { txt: 'Manquante', col: 'var(--rouge)', ko: true };
  const j = resJours(r.assurance_expire_le);
  if (j < 0) return { txt: 'Expirée le ' + dfr(r.assurance_expire_le), col: 'var(--rouge)', ko: true };
  if (j <= 60) return { txt: `Expire dans ${j} j`, col: RES_AMBRE, ko: true };
  return { txt: 'À jour', col: 'var(--brume)', ko: false };
}

function resContrat(r) {
  const c = r.contrat;
  if (!c) return { txt: 'Aucun contrat', col: 'var(--rouge)', ko: true };
  if (!c.date_fin) {
    return c.signe
      ? { txt: 'Sans échéance', col: 'var(--brume)', ko: false }
      : { txt: 'Non signé', col: RES_AMBRE, ko: true };
  }
  const j = resJours(c.date_fin);
  if (j < 0) return { txt: 'Expiré le ' + dfr(c.date_fin), col: 'var(--rouge)', ko: true };
  if (!c.signe) return { txt: 'Non signé · fin ' + dfr(c.date_fin), col: RES_AMBRE, ko: true };
  if (j <= 30) return { txt: `Fin dans ${j} j`, col: RES_AMBRE, ko: true };
  return { txt: 'Jusqu\u2019au ' + dfr(c.date_fin), col: 'var(--brume)', ko: false };
}

const resDu = (r) => Number(r.solde || 0) > 0.005;

const RES_FILTRES = [
  ['tous', 'Tous', () => true],
  ['renouveler', 'À renouveler', (r) => r.actif !== false && resContrat(r).ko],
  ['impayes', 'Impayés', (r) => resDu(r)],
  ['pieces', 'Pièces manquantes', (r) => r.actif !== false && resAssurance(r).ko],
  ['inactifs', 'Inactifs', (r) => r.actif === false],
];

function resVisibles() {
  const f = (RES_FILTRES.find((x) => x[0] === RES_FILTRE) || RES_FILTRES[0])[2];
  const q = RES_Q.trim().toLowerCase();
  return RES_CACHE.residents.filter((r) => {
    if (!f(r)) return false;
    if (!q) return true;
    const emp = r.emplacement_id ? (RES_CACHE.empNum[r.emplacement_id] || '') : '';
    return `${r.nom || ''} ${r.prenom || ''} ${r.email || ''} ${r.telephone || ''} ${r.compte_comptable || ''} ${emp}`
      .toLowerCase().includes(q);
  });
}

function resLigne(r) {
  const ct = resContrat(r);
  const as = resAssurance(r);
  const emp = r.emplacement_id ? RES_CACHE.empNum[r.emplacement_id] : null;
  const du = resDu(r);
  return `
    <tr class="row-click" data-act="allerA" data-a1="#/residents/${r.id}">
      <td style="padding:9px 12px">
        <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:230px">
          ${esc(r.prenom || '')} ${esc(r.nom)}${r.actif === false ? ' <span class="badge indisponible">inactif</span>' : ''}</div>
        <div class="muted" style="font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:230px">
          ${esc(r.email || r.telephone || '—')}</div>
      </td>
      <td data-l="Empl." style="padding:9px 12px">${emp ? `<strong>${esc(emp)}</strong>` : '<span class="muted">—</span>'}</td>
      <td data-l="Contrat" style="padding:9px 12px;font-size:13px;color:${ct.col}">${ct.txt}</td>
      <td data-l="Assurance" style="padding:9px 12px;font-size:13px;color:${as.col}">${as.txt}</td>
      <td class="right" data-l="Solde" style="padding:9px 12px;font-variant-numeric:tabular-nums;
          ${du ? 'color:var(--rouge);font-weight:600' : ''}">${du || Number(r.solde || 0) < -0.005 ? eur(r.solde) : '—'}</td>
    </tr>`;
}

function majListeResidents() {
  const body = $('#res-body');
  if (!body) return;
  const v = resVisibles();
  body.innerHTML = v.length ? v.map(resLigne).join('')
    : `<tr><td colspan="5" class="muted" style="padding:18px">Aucun résident ne correspond${RES_FILTRE === 'tous' && !RES_Q ? '. Créer le premier avec « Nouveau résident ».' : '.'}</td></tr>`;
  const c = $('#res-compte');
  if (c) c.textContent = v.length + (v.length > 1 ? ' résidents affichés' : ' résident affiché');
}

window.filtrerResidents = (k) => {
  RES_FILTRE = k;
  const box = $('#res-puces');
  if (box) {
    box.querySelectorAll('[data-a1]').forEach((b) => {
      const on = b.getAttribute('data-a1') === k;
      b.style.background = on ? 'var(--nuit)' : 'transparent';
      b.style.color = on ? 'var(--ivoire)' : '#5D6E66';
      b.style.borderColor = on ? 'var(--nuit)' : 'var(--hairline)';
      b.style.fontWeight = on ? '600' : '400';
    });
  }
  majListeResidents();
};
window.chercherResidents = (v) => { RES_Q = v; majListeResidents(); };

async function vueResidents() {
  const [{ residents }, { emplacements }] = await Promise.all([
    api('/api/residents'), api('/api/emplacements'),
  ]);
  const empNum = {};
  (emplacements || []).forEach((e) => { empNum[e.id] = e.numero + (e.secteur ? ' · ' + e.secteur : ''); });
  RES_CACHE = { residents: residents || [], empNum };

  const actifs = RES_CACHE.residents.filter((r) => r.actif !== false);
  const compte = (k) => RES_CACHE.residents.filter((RES_FILTRES.find((x) => x[0] === k) || RES_FILTRES[0])[2]).length;
  const duTotal = RES_CACHE.residents.reduce((s, r) => s + (resDu(r) ? Number(r.solde) : 0), 0);

  const chiffres = [
    { k: 'Résidents actifs', v: String(actifs.length), n: RES_CACHE.residents.length - actifs.length
      ? `${RES_CACHE.residents.length - actifs.length} inactif${RES_CACHE.residents.length - actifs.length > 1 ? 's' : ''}` : 'aucun inactif', col: '' },
    { k: 'Dû total', v: duTotal > 0.005 ? eur(duTotal) : '—',
      n: `${compte('impayes')} résident${compte('impayes') > 1 ? 's' : ''} débiteur${compte('impayes') > 1 ? 's' : ''}`,
      col: duTotal > 0.005 ? 'var(--rouge)' : '' },
    { k: 'À renouveler', v: String(compte('renouveler')), n: 'contrat échu, non signé ou sous 30 j', col: compte('renouveler') ? RES_AMBRE : '' },
    { k: 'Pièces manquantes', v: String(compte('pieces')), n: 'assurance absente ou expirée', col: compte('pieces') ? RES_AMBRE : '' },
  ];

  const puces = RES_FILTRES.map(([k, l]) => {
    const on = k === RES_FILTRE;
    return `<button data-act="filtrerResidents" data-a1="${k}"
      style="padding:5px 12px;border-radius:20px;font-size:13px;cursor:pointer;font-family:inherit;
             border:1px solid ${on ? 'var(--nuit)' : 'var(--hairline)'};
             background:${on ? 'var(--nuit)' : 'transparent'};color:${on ? 'var(--ivoire)' : '#5D6E66'};
             font-weight:${on ? '600' : '400'}">${l} ${compte(k)}</button>`;
  }).join('');

  /* Largeur bornee : au-dela, l'oeil ne relie plus un nom a son solde. */
  $('#main').innerHTML = `
    <div style="max-width:1180px">
      <div class="page-head"><div><h1>Résidents</h1>
        <div class="muted" style="font-size:13.5px;margin-top:4px">
          ${actifs.length} résident${actifs.length > 1 ? 's' : ''} actif${actifs.length > 1 ? 's' : ''}${compte('renouveler') ? ' · ' + compte('renouveler') + ' contrat' + (compte('renouveler') > 1 ? 's' : '') + ' à renouveler' : ''}${compte('impayes') ? ' · ' + compte('impayes') + ' impayé' + (compte('impayes') > 1 ? 's' : '') : ''}
        </div></div>
        <div class="toolbar">
          <input class="search" id="res-search" data-act="chercherResidents" data-evt="input" data-a1="@value"
                 placeholder="Rechercher un nom, un e-mail, un emplacement" value="${esc(RES_Q)}" style="min-width:280px">
          <button class="btn btn-primary" data-act="formResident">Nouveau résident</button>
        </div></div>

      <div class="card" style="display:flex;padding:0;margin-bottom:14px">
        ${chiffres.map((c, i) => `
          <div style="flex:1;padding:13px 18px;${i ? 'border-left:1px solid var(--hairline)' : ''}">
            <div style="font-size:11.5px;font-weight:600;letter-spacing:.09em;color:var(--brume);text-transform:uppercase">${c.k}</div>
            <div style="font-size:22px;margin-top:5px;font-variant-numeric:tabular-nums;${c.col ? 'color:' + c.col : ''}">${c.v}</div>
            <div class="muted" style="font-size:12px;margin-top:2px">${c.n}</div>
          </div>`).join('')}
      </div>

      <div id="res-puces" style="display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
        ${puces}
        <span id="res-compte" class="muted" style="margin-left:auto;font-size:12.5px"></span>
      </div>

      <div class="card" style="padding:0;overflow:hidden">
        <table>
          <thead><tr>
            <th style="padding:10px 12px">Résident</th>
            <th style="padding:10px 12px">Empl.</th>
            <th style="padding:10px 12px">Contrat</th>
            <th style="padding:10px 12px">Assurance</th>
            <th class="right" style="padding:10px 12px">Solde</th>
          </tr></thead>
          <tbody id="res-body"></tbody>
        </table>
      </div>
      <p class="muted" style="margin:10px 0 0;font-size:12.5px">Un solde positif est une somme due. Cliquez une ligne pour ouvrir la fiche.</p>
    </div>`;

  majListeResidents();
}

/* ---------- Fiche client (pleine page) ---------- */
async function vueFicheClient(id) {
  const [{ resident: r, emplacement, documents }, { factures }, { reglements }, presRes, synRes, msgRes, cfgRes, ctrRes] = await Promise.all([
    api('/api/residents/' + id),
    api('/api/factures?resident_id=' + id + exQSand()),
    api('/api/reglements?resident_id=' + id + exQSand()),
    api('/api/prestations?resident_id=' + id + exQSand()).catch(() => ({ prestations: null })),
    api('/api/prestations/synthese/' + id).catch(() => ({ synthese: null })),
    api('/api/messages?resident_id=' + id).catch(() => ({ messages: null })),
    api('/api/factures/config/' + id).catch(() => ({ facturation: {} })),
    api('/api/contrats?resident_id=' + id).catch(() => ({ contrats: [] })),
  ]);
  const lesContrats = (ctrRes.contrats || []).filter((c) => c.statut !== 'annule');
  const fact = cfgRes.facturation || {};
  const factLignes = fact.lignes || [];
  const aConfig = Number(fact.loyer_mensuel || 0) > 0 || factLignes.length > 0;
  const messages = msgRes.messages;
  const nbNonLus = (messages || []).filter((m) => m.auteur === 'resident' && !m.lu).length;
  const prestations = presRes.prestations;
  const syn = synRes.synthese;
  const facNum = {}; factures.forEach((f) => { facNum[f.id] = f.numero; });
  // Détail des paiements imputés à chaque facture (sous-lignes).
  const _modeLib = { especes: 'Espèces', cheque: 'Chèque', cb: 'CB', virement: 'Virement', prelevement: 'Prélèvement', stripe: 'CB' };
  const payParFacture = {};
  (reglements || []).forEach((g) => {
    (g.affectations || []).forEach((a) => {
      if (!a || !a.facture_id) return;
      (payParFacture[a.facture_id] ||= []).push({
        mode: _modeLib[g.mode] || g.mode, montant: Number(a.montant || 0), date: g.date_reglement, reference: g.reference || null,
      });
    });
  });

  const PTYPE = { sejour: 'Séjour', vente: 'Vente', charge: 'Charge', caution: 'Caution' };
  const etatBadge = (p) => {
    if (p.statut === 'annulee') return '<span class="badge indisponible">annulée</span>';
    if (p.statut === 'facturee') return `<span class="badge reglee">${esc(facNum[p.facture_id] || 'facturée')}</span>`;
    return '<span class="badge emise">en cours</span>';
  };
  const pillType = (t) => `<span class="ptype ${t}">${PTYPE[t] || t}</span>`;
  const banItem = (v, l, cls) => `
    <div class="synth-item${cls ? ' ' + cls : ''}"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  const tabBtn = (key, label, active) => `
    <button class="fiche-tab${active ? ' active' : ''}" data-tab="${key}" data-act="switchFicheTab" data-a1="${key}">${label}</button>`;

  const migrationManquante = prestations === null;
  const nbEnCours = (prestations || []).filter((p) => p.statut === 'en_cours').length;

  $('#main').innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow"><a href="#/residents" style="color:inherit;text-decoration:none">← Résidents</a></div>
        <h1>${esc(r.civilite || '')} ${esc(r.prenom || '')} ${esc(r.nom)}</h1>
        <div class="muted" style="margin-top:4px">
          ${emplacement ? `Empl. <strong>${esc(emplacement.numero)}</strong>${emplacement.secteur ? ' · ' + esc(emplacement.secteur) : ''}` : 'Aucun emplacement'}
          ${r.compte_comptable ? ` · Compte <strong>${esc(r.compte_comptable)}</strong>` : ''}
          ${r.email ? ' · ' + esc(r.email) : ''}
          ${r.telephone ? ' · ' + esc(r.telephone) : ' · <span style="color:var(--rouge)">téléphone manquant</span>'}
          ${(() => { if (!r.assurance_expire_le) return ' · <span class="badge en_retard" title="Aucune attestation d\u2019assurance enregistrée">assurance manquante</span>';
            const jr = Math.floor((new Date(r.assurance_expire_le) - new Date()) / 86400000);
            if (jr < 0) return ` · <span class="badge en_retard" title="Attestation expirée le ${dfr(r.assurance_expire_le)}">assurance expirée</span>`;
            if (jr <= 60) return ` · <span class="badge partielle" title="${r.assurance_ref ? esc(r.assurance_ref) + ' — ' : ''}expire le ${dfr(r.assurance_expire_le)}">assurance : ${jr} j</span>`;
            return ` · <span class="badge reglee" title="${r.assurance_ref ? esc(r.assurance_ref) + ' — ' : ''}valable jusqu\u2019au ${dfr(r.assurance_expire_le)}">assurance OK</span>`; })()}
          ${(() => { if (!lesContrats.length) return ' · <span class="badge en_retard" title="Aucun contrat de location enregistré">contrat manquant</span>';
            // contrat de référence : celui qui finit le plus tard (sans date_fin = illimité)
            const sansFin = lesContrats.find((c) => !c.date_fin);
            if (sansFin) return ` · <span class="badge reglee" title="Contrat ${esc(sansFin.numero || '')} sans date de fin">contrat OK</span>`;
            const ref = lesContrats.reduce((m, c) => (!m || c.date_fin > m.date_fin ? c : m), null);
            const jr = Math.floor((new Date(ref.date_fin) - new Date()) / 86400000);
            const sig = ref.statut === 'signe' ? ' · signé' : ' · à faire signer';
            if (jr < 0) return ` · <span class="badge en_retard" title="Contrat ${esc(ref.numero || '')} expiré le ${dfr(ref.date_fin)} — pensez au renouvellement">contrat expiré</span>`;
            if (jr <= 60) return ` · <span class="badge partielle" title="Contrat ${esc(ref.numero || '')}${sig} — expire le ${dfr(ref.date_fin)}">contrat : ${jr} j${ref.statut !== 'signe' ? ' · non signé' : ''}</span>`;
            return ` · <span class="badge ${ref.statut === 'signe' ? 'reglee' : 'partielle'}" title="Contrat ${esc(ref.numero || '')}${sig} — jusqu\u2019au ${dfr(ref.date_fin)}">${ref.statut === 'signe' ? 'contrat OK' : 'contrat non signé'}</span>`; })()}
        </div>
        ${r.adresse ? `<div class="muted" style="margin-top:2px">${esc(r.adresse)}</div>` : ''}
      </div>
      <div class="toolbar">
        <button class="btn btn-ghost" data-act="formResident" data-a1="${id}">Modifier</button>
        <button class="btn btn-ghost" data-act="nouveauContrat" data-a1="${id}">Nouveau contrat</button>
        <button class="btn btn-ghost" data-act="encaisserClient" data-a1="${id}">Encaisser</button>
      </div>
    </div>

    ${syn ? `
    <div class="synth">
      ${banItem(eur(syn.a_facturer), 'À facturer', syn.a_facturer > 0 ? 'warn' : '')}
      ${banItem(eur(syn.a_regler), 'À régler', syn.a_regler > 0 ? 'bad' : '')}
      ${banItem(eur(syn.regle_total), 'Réglé (total)')}
      ${/* passage seulement — vocabulaire d'hotellerie : sur un resident a
            l'annee ces deux cases afficheraient « 0 » et « — » pendant toute
            la vie du dossier, et devalueraient les chiffres voisins. C'est la
            donnee qui decide, pas un reglage. */
        (Number(syn.nb_sejours) > 0 || syn.dernier_sejour)
          ? banItem(`${syn.nb_sejours} <small>(${syn.nb_nuits} nuits)</small>`, 'Séjours')
            + banItem(syn.dernier_sejour ? `${dfr(syn.dernier_sejour.du)} <small>→ ${dfr(syn.dernier_sejour.au)}</small>` : '—', 'Dernier séjour')
          : ''}
      ${banItem(eur(syn.cautions_en_cours), 'Cautions')}
    </div>` : ''}

    <div class="fiche-tabs">
      ${tabBtn('prestations', `Prestations${nbEnCours ? ` (${nbEnCours})` : ''}`, true)}
      ${tabBtn('factures', `Factures${factures.length ? ` (${factures.length})` : ''}`, false)}
      ${tabBtn('compte', 'Compte', false)}
      ${tabBtn('messages', `Messages${nbNonLus ? ` (${nbNonLus})` : ''}`, false)}
      ${tabBtn('documents', 'Documents', false)}
    </div>

    <section data-panel="prestations">
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <h2 style="margin:0">Prestations</h2>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-ghost btn-sm" data-act="formPrestation" data-a1="${id}" data-a2="sejour">+ Séjour</button>
            <button class="btn btn-ghost btn-sm" data-act="formPrestation" data-a1="${id}" data-a2="vente">+ Vente</button>
            <button class="btn btn-ghost btn-sm" data-act="formPrestation" data-a1="${id}" data-a2="charge">+ Charge</button>
            <button class="btn btn-ghost btn-sm" data-act="formPrestation" data-a1="${id}" data-a2="caution">+ Caution</button>
          </div>
        </div>
        ${migrationManquante
          ? '<p class="form-error" style="margin-top:12px">Table « prestations » absente — exécutez la migration db/07_catalogue_facturation.sql dans Supabase.</p>'
          : `<table style="margin-top:12px"><thead><tr><th style="width:30px"></th><th></th><th>Intitulé</th><th>Du</th><th>Au</th><th class="right">Montant TTC</th><th>État</th><th></th></tr></thead>
        <tbody>${(prestations || []).map((p) => `
          <tr>
            <td>${p.statut === 'en_cours' ? `<input type="checkbox" class="presta-check" data-pid="${p.id}" data-type="${p.type}" data-ttc="${p.montant_ttc}" data-act="majSelectionPresta" data-evt="change" data-a1="${id}">` : ''}</td>
            <td>${pillType(p.type)}</td>
            <td><strong>${esc(p.designation)}</strong>${Number(p.quantite) !== 1 ? ` <span class="muted">× ${Number(p.quantite)}</span>` : ''}</td>
            <td class="muted" data-l="Du">${p.date_debut ? dfr(p.date_debut) : '—'}</td>
            <td class="muted" data-l="Au">${p.date_fin ? dfr(p.date_fin) : '—'}</td>
            <td class="right" data-l="Montant TTC"><strong>${eur(p.montant_ttc)}</strong></td>
            <td data-l="État">${etatBadge(p)}</td>
            <td class="right">${p.statut === 'en_cours' ? `<button class="btn btn-ghost btn-sm" data-act="supprimerPrestation" data-a1="${p.id}" data-a2="${id}">Annuler</button>` : ''}</td>
          </tr>`).join('') || '<tr><td colspan="8" class="muted">Aucune prestation. Ajoute un séjour, une vente, une charge ou une caution.</td></tr>'}</tbody></table>
        <div id="presta-actionbar" class="selbar hidden">
          <span id="presta-selinfo" style="font-weight:600"></span>
          <div class="selbar-actions">
            <button class="btn btn-ghost btn-sm" data-act="proformaSelection" data-a1="${id}">Proforma</button>
            <button class="btn btn-primary btn-sm" data-act="facturerSelection" data-a1="${id}">Facturer la sélection</button>
          </div>
        </div>`}
      </div>
    </section>

    <section data-panel="factures" class="hidden">
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <h2 style="margin:0">Factures</h2>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <button class="btn btn-primary btn-sm" data-act="genererFactureMois" data-a1="${id}" title="Loyer + lignes récurrentes + taxe de séjour">Générer la facture du mois</button>
            ${syn && syn.credit_a_affecter > 0 ? `<button class="btn btn-ghost btn-sm" data-act="lettrerCredit" data-a1="${id}" title="Affecter les paiements non lettrés aux factures ouvertes, des plus anciennes aux plus récentes">Affecter les paiements (${eur(syn.credit_a_affecter)})</button>` : ''}
          </div>
        </div>
        <table style="margin-top:12px"><thead><tr><th>N°</th><th>Date</th><th>Statut</th><th class="right">TTC</th><th class="right">Réglé</th><th class="right">Reste</th><th></th></tr></thead>
        <tbody>${(factures || []).map((f) => {
          const reste = Math.round((Number(f.total_ttc) - Number(f.montant_regle || 0)) * 100) / 100;
          const brouillon = f.statut === 'brouillon';
          const payable = !brouillon && !['avoir', 'annulee'].includes(f.statut) && reste > 0.004;
          return `<tr${brouillon ? ' style="background:#FDFBF4"' : ''}>
            <td data-l="N°">${brouillon
              ? '<em class="muted">à émettre</em>'
              : `<strong>${esc(f.numero)}</strong>`}</td>
            <td class="muted" data-l="Date">${dfr(f.date_emission)}</td>
            <td data-l="Statut"><span class="badge ${f.statut}">${lib(f.statut)}</span></td>
            <td class="right" data-l="TTC">${eur(f.total_ttc)}</td>
            <td class="right" data-l="Réglé">${brouillon ? '—' : eur(f.montant_regle)}</td>
            <td class="right" data-l="Reste">${brouillon ? '—'
              : (reste > 0.004 ? eur(reste) : '<span class="badge reglee">soldée</span>')}</td>
            <td class="right">
              <button class="btn btn-ghost btn-sm" data-act="pdfFacture" data-a1="${f.id}">PDF</button>
              ${!brouillon && r.siret ? `<button class="btn btn-ghost btn-sm" data-act="facturxFacture" data-a1="${f.id}" title="Facture électronique (PDF + XML EN 16931)">Factur-X</button>` : ''}
              ${!brouillon && r.siret ? `<button class="btn btn-ghost btn-sm" data-act="envoyerFacturePA" data-a1="${f.id}" title="Transmettre à la plateforme agréée">Envoyer à la PA</button>` : ''}
              ${f.efacture_statut ? `<span class="badge reglee" title="Statut plateforme agréée">PA · ${esc(f.efacture_statut)}</span>` : ''}
              ${brouillon ? `
                <button class="btn btn-ghost btn-sm" data-act="ajouterPrestationsFacture" data-a1="${f.id}" data-a2="${id}">+ Prestations</button>
                <button class="btn btn-ghost btn-sm" data-act="editerLignesFacture" data-a1="${f.id}">Modifier</button>
                <button class="btn btn-ghost btn-sm" data-act="supprimerBrouillon" data-a1="${f.id}">Supprimer</button>
                <button class="btn btn-primary btn-sm" data-act="emettreFacture" data-a1="${f.id}">Émettre</button>` : ''}
              ${payable ? `<button class="btn btn-primary btn-sm" data-act="encaisserFacture" data-a1="${f.id}" data-a2="${id}" data-a3="${reste}" data-num="3">Encaisser</button>` : ''}
            </td>
          </tr>
          ${!brouillon && (payParFacture[f.id] || []).length ? `<tr class="pay-detail"><td colspan="7" style="padding:2px 8px 8px">
            ${payParFacture[f.id].map((pp) => `<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--brume,#8a8778)"><span>↳ Paiement · ${esc(pp.mode)}${pp.reference ? ' · ' + esc(pp.reference) : ''} · ${dfr(pp.date)}</span><span>${eur(pp.montant)}</span></div>`).join('')}
          </td></tr>` : ''}`;
        }).join('') || '<tr><td colspan="7" class="muted">Aucune facture pour ce résident.</td></tr>'}</tbody></table>
      </div>

      <div class="card" style="margin-top:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <div>
            <h2 style="margin:0">Facturation récurrente</h2>
            <p class="muted" style="margin:2px 0 0;font-size:12.5px">Le « montant type » facturé chaque mois. Modifiable à tout moment (révision de tarif).</p>
          </div>
          <button class="btn btn-ghost btn-sm" data-act="formFacturation" data-a1="${id}">Configurer</button>
        </div>
        ${aConfig ? `
          <table style="margin-top:12px"><thead><tr><th>Désignation</th><th class="right">Qté</th><th class="right">PU TTC</th><th class="right">TVA</th><th>Prorata</th></tr></thead>
          <tbody>
            ${Number(fact.loyer_mensuel || 0) > 0 ? `<tr>
              <td data-l="Désignation"><strong>Loyer emplacement</strong></td>
              <td class="right" data-l="Qté">1</td>
              <td class="right" data-l="PU TTC"><strong>${eur(fact.loyer_mensuel)}</strong></td>
              <td class="right" data-l="TVA">${Number(fact.loyer_tva || 0)} %</td>
              <td data-l="Prorata">${fact.loyer_prorata === false ? '<span class="muted">fixe</span>' : '<span class="badge emise">au prorata</span>'}</td>
            </tr>` : ''}
            ${factLignes.map((l) => `
            <tr>
              <td data-l="Désignation">${esc(l.designation)}</td>
              <td class="right" data-l="Qté">${l.quantite || 1}</td>
              <td class="right" data-l="PU TTC">${eur(l.pu_ttc)}</td>
              <td class="right" data-l="TVA">${Number(l.taux_tva || 0)} %</td>
              <td data-l="Prorata">${l.prorata ? '<span class="badge emise">au prorata</span>' : '<span class="muted">fixe</span>'}</td>
            </tr>`).join('')}
          </tbody></table>`
          : '<p class="muted" style="margin-top:10px">Aucun montant configuré. Cliquez sur « Configurer » pour saisir le loyer et les lignes qui reviennent chaque mois (forfait, redevance OM…).</p>'}
      </div>
    </section>

    <section data-panel="compte" class="hidden">
      <div id="releve-zone"><p class="muted">Chargement du relevé…</p></div>
    </section>

    <section data-panel="messages" class="hidden">
      <div class="card">
        <h2>Messages</h2>
        ${messages === null
          ? '<p class="form-error" style="margin-top:12px">Table « messages » absente — exécutez la migration db/11_echanges_carte_suivi.sql dans Supabase.</p>'
          : `<div id="fil-messages" class="msg-fil">
          ${(messages || []).map((m) => `
            <div class="msg-row ${m.auteur === 'camping' ? 'me' : 'them'}">
              <div class="msg-bubble">${esc(m.corps)}</div>
              <div class="msg-meta">${m.auteur === 'camping' ? 'Camping' : esc(r.prenom || r.nom)} · ${new Date(m.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
            </div>`).join('') || '<p class="muted" style="margin:0">Aucun message. Écrivez le premier ci-dessous — le client le verra sur son portail et sera notifié par e-mail.</p>'}
        </div>
        <form id="f-msg" class="msg-form">
          <input name="corps" placeholder="Écrire un message au client…" required>
          <button class="btn btn-primary">Envoyer</button>
        </form>`}
      </div>
    </section>

    <section data-panel="documents" class="hidden">
      <div class="card">
        <div class="card-actions">
          <div>
            <h2 style="margin:0">Données personnelles (RGPD)</h2>
            <p class="muted" style="margin:4px 0 0">Droit d'accès et à la portabilité (art. 15 et 20) ; droit à l'effacement (art. 17).</p>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-ghost btn-sm" data-act="exportDonneesResident" data-a1="${id}" data-a2="${esc((r.prenom || '') + ' ' + r.nom)}">Exporter ses données</button>
            ${r.anonymise_at ? '<span class="badge indisponible">anonymisé</span>'
              : `<button class="btn btn-ghost btn-sm" data-act="anonymiserResident" data-a1="${id}" data-a2="${esc((r.prenom || '') + ' ' + r.nom)}">Anonymiser</button>`}
          </div>
        </div>
      </div>
      <div class="card" style="margin-top:16px">
        <div class="card-actions"><h2 style="margin:0">Contrats</h2>
          ${/* « Nouveau contrat » est deja dans le bandeau, visible des l'ouverture.
             Un second exemplaire pose contre la liste laisse croire qu'il agit
             sur elle. */ ''}</div>
        ${lesContrats.length ? `<table style="margin-top:10px"><thead><tr><th>N°</th><th>Période</th><th>Statut</th><th></th></tr></thead>
        <tbody>${lesContrats.map((c) => `<tr>
          <td><strong>${esc(c.numero || '—')}</strong></td>
          <td class="muted">${c.date_debut ? dfr(c.date_debut) : '—'} → ${c.date_fin ? dfr(c.date_fin) : 'illimité'}</td>
          <td><span class="badge ${c.statut === 'signe' ? 'reglee' : c.statut === 'brouillon' ? 'brouillon' : 'emise'}">${/* statut accentue */ esc(lib(c.statut))}</span></td>
          <td class="right">
            <button class="btn btn-ghost btn-sm" data-act="telechargerContrat" data-a1="${c.id}" title="Télécharger le PDF (pour impression et signature papier)">Télécharger</button>
            ${c.statut !== 'signe' && c.statut !== 'brouillon' ? `
              <button class="btn btn-ghost btn-sm" data-act="contratVersSignature" data-a1="${c.id}" title="Signature électronique par e-mail">Envoyer en signature</button>
              <button class="btn btn-ghost btn-sm" data-act="signerContratPapier" data-a1="${c.id}" title="Le résident a signé sur papier : marquer signé (scan facultatif)">Signé (papier)</button>` : ''}
            ${/* Un brouillon est un contrat dont le PDF n'a pas abouti : sans lui
                 aucune suite n'est possible. Deux issues, reprendre ou jeter. */
              c.statut === 'brouillon' ? `
              <button class="btn btn-ghost btn-sm" data-act="regenererContrat" data-a1="${c.id}" title="Le PDF n'a pas été généré : réessayer">Réessayer</button>
              <button class="btn btn-ghost btn-sm" data-act="supprimerContrat" data-a1="${c.id}" data-a2="${esc(c.numero || '')}" title="Supprimer ce brouillon">Supprimer</button>` : ''}
          </td></tr>`).join('')}</tbody></table>` : '<p class="muted" style="margin-top:8px">Aucun contrat. « Nouveau contrat » le génère depuis un modèle, puis signature en ligne ou sur papier.</p>'}
      </div>

      <div class="card" style="margin-top:16px">
        <div class="card-actions"><h2 style="margin:0">Documents</h2>
          <button class="btn btn-ghost btn-sm" data-act="ajouterDocResident" data-a1="${id}" title="Attestation d\u2019assurance, contrat papier scanné, pièce d\u2019identité…">Ajouter un document</button></div>
        ${documents.length ? `<ul class="list-tight">${documents.map((d) => `<li><span>${esc(d.type || 'document')} — ${esc(d.nom_fichier || '')}</span><a href="#" data-act="voirDoc" data-a1="${d.id}">ouvrir</a></li>`).join('')}</ul>` : '<p class="muted">Aucun document.</p>'}
      </div>
    </section>`;

  window._ficheClientId = id;
  const fil = $('#fil-messages');
  if (fil) fil.scrollTop = fil.scrollHeight;
  if (window._openTab) { switchFicheTab(window._openTab); window._openTab = null; }
  const fmsg = $('#f-msg');
  if (fmsg) fmsg.addEventListener('submit', async (e) => {
    e.preventDefault();
    const corps = e.target.corps.value.trim();
    if (!corps) return;
    try {
      await api('/api/messages', { method: 'POST', body: { resident_id: id, corps } });
      toast('Message envoyé');
      route();
      setTimeout(() => switchFicheTab('messages'), 60);
    } catch (err) { toast(err.message, true); }
  });
}

window.switchFicheTab = (key) => {
  document.querySelectorAll('[data-panel]').forEach((s) => s.classList.toggle('hidden', s.dataset.panel !== key));
  document.querySelectorAll('.fiche-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === key));
  if (key === 'compte' && window._ficheClientId) chargerReleve(window._ficheClientId);
};

/* ---------- Relevé de compte (historique + solde) ---------- */
window.chargerReleve = async (id, annee) => {
  const zone = $('#releve-zone');
  if (!zone) return;
  zone.innerHTML = '<p class="muted">Chargement du relevé…</p>';
  try {
    const d = await api(`/api/residents/${id}/releve?annee=${annee || exerciceActif().year}`);
    const du = d.solde_total > 0.004;
    const credit = d.solde_total < -0.004;

    zone.innerHTML = `
      <div class="card">
        <div class="card-actions">
          <div>
            <h2 style="margin:0">Relevé de compte</h2>
            <p class="muted" style="margin:4px 0 0">Historique chronologique : factures, avoirs et paiements, avec le solde après chaque opération.</p>
          </div>
          <div class="toolbar">
            <select id="rel-annee" style="width:auto" data-act="chargerReleve" data-evt="change" data-a1="${id}" data-a2="@value">
              ${d.annees.map((a) => `<option value="${a}"${a === d.annee ? ' selected' : ''}>${a}</option>`).join('') || `<option>${d.annee}</option>`}
            </select>
            <button class="btn btn-primary btn-sm" data-act="relevePdf" data-a1="${id}">Relevé PDF</button>
          </div>
        </div>

        <div class="kpis" style="margin-top:14px">
          <div class="kpi"><div class="v">${eur(d.report_a_nouveau)}</div><div class="l">Report au 1ᵉʳ janvier</div></div>
          <div class="kpi"><div class="v">${eur(d.totaux.facture)}</div><div class="l">Facturé en ${d.annee}</div></div>
          <div class="kpi"><div class="v">${eur(d.totaux.regle)}</div><div class="l">Réglé en ${d.annee}</div></div>
          <div class="kpi ${du ? 'bad' : ''}"><div class="v">${eur(d.solde_total)}</div>
            <div class="l">${du ? 'Reste dû aujourd\u2019hui' : credit ? 'Avoir en sa faveur' : 'Compte soldé ✓'}</div></div>
        </div>

        <table style="margin-top:14px">
          <thead><tr><th>Date</th><th>Opération</th><th class="right">Débit</th><th class="right">Crédit</th><th class="right">Solde</th><th></th></tr></thead>
          <tbody>
            <tr class="rel-report">
              <td class="muted">01/01/${d.annee}</td>
              <td class="muted"><em>Report à nouveau</em></td>
              <td></td><td></td>
              <td class="right"><strong>${eur(d.report_a_nouveau)}</strong></td><td></td>
            </tr>
            ${d.lignes.map((l) => `
            <tr>
              <td class="muted" data-l="Date">${dfr(l.date)}</td>
              <td data-l="Opération">${l.type === 'reglement'
                    ? `<span class="ptype sejour">Paiement</span> ${esc(l.libelle.replace(/^Paiement — /, ''))}`
                    : l.type === 'avoir'
                      ? `<span class="ptype caution">Avoir</span> ${esc(l.libelle)}`
                      : `<span class="ptype charge">Facture</span> ${esc(l.libelle.replace(/^Facture /, ''))}`}</td>
              <td class="right" data-l="Débit">${l.debit ? eur(l.debit) : ''}</td>
              <td class="right" data-l="Crédit" style="color:var(--sapin)">${l.credit ? eur(l.credit) : ''}</td>
              <td class="right" data-l="Solde"><strong>${eur(l.solde)}</strong></td>
              <td class="right">${l.facture_id ? `<button class="btn btn-ghost btn-sm" data-act="pdfFacture" data-a1="${l.facture_id}">PDF</button>` : ''}</td>
            </tr>`).join('') || '<tr><td colspan="6" class="muted">Aucun mouvement sur cette année.</td></tr>'}
          </tbody>
          <tfoot><tr class="rel-total">
            <td colspan="2"><strong>Total ${d.annee}</strong></td>
            <td class="right"><strong>${eur(d.totaux.facture)}</strong></td>
            <td class="right"><strong>${eur(d.totaux.regle)}</strong></td>
            <td class="right"><strong>${eur(d.totaux.solde_fin)}</strong></td><td></td>
          </tr></tfoot>
        </table>
      </div>

      ${Object.keys(d.par_annee).length > 1 ? `
      <div class="card">
        <h2>Situation par année</h2>
        <table style="margin-top:10px"><thead><tr><th>Année</th><th class="right">Facturé</th><th class="right">Réglé</th><th class="right">Solde fin d'année</th></tr></thead>
        <tbody>${Object.keys(d.par_annee).sort().reverse().map((a) => {
          const v = d.par_annee[a];
          return `<tr class="row-click" data-act="chargerReleve" data-a1="${id}" data-a2="${a}">
            <td><strong>${a}</strong></td>
            <td class="right">${eur(v.facture)}</td>
            <td class="right">${eur(v.regle)}</td>
            <td class="right"><strong style="${v.solde > 0.004 ? 'color:var(--rouge)' : ''}">${eur(v.solde)}</strong></td>
          </tr>`;
        }).join('')}</tbody></table>
      </div>` : ''}`;
  } catch (e) { zone.innerHTML = `<p class="form-error">${esc(e.message)}</p>`; }
};

window.relevePdf = (id) => {
  const a = $('#rel-annee')?.value || new Date().getFullYear();
  telechargerExport(`/api/residents/${id}/releve.pdf?annee=${a}`, `releve_${a}.pdf`);
};

window.majSelectionPresta = () => {
  const checks = [...document.querySelectorAll('.presta-check:checked')];
  const bar = $('#presta-actionbar');
  if (!bar) return;
  if (!checks.length) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  const total = checks.reduce((s, c) => s + Number(c.dataset.ttc), 0);
  const nbCautions = checks.filter((c) => c.dataset.type === 'caution').length;
  $('#presta-selinfo').innerHTML = `${checks.length} prestation(s) — <strong>${eur(total)}</strong>` +
    (nbCautions ? ' <span class="muted">(les cautions ne seront pas facturées)</span>' : '');
};

function selectionPresta() {
  return [...document.querySelectorAll('.presta-check:checked')].map((c) => ({ id: c.dataset.pid, type: c.dataset.type }));
}

window.facturerSelection = async (residentId) => {
  const sel = selectionPresta();
  const facturables = sel.filter((s) => s.type !== 'caution');
  if (!facturables.length) { toast('Sélectionnez au moins une prestation facturable', true); return; }
  if (!await askConfirm(`Créer une facture avec ${facturables.length} prestation(s) ?`)) return;
  try {
    const r = await api('/api/prestations/facturer', {
      method: 'POST',
      body: { resident_id: residentId, prestation_ids: facturables.map((s) => s.id) },
    });
    toast(`Facture ${r.facture.numero} créée (${r.prestations_facturees} prestation(s))`);
    route();
  } catch (err) { toast(err.message, true); }
};

window.proformaSelection = async (residentId) => {
  const sel = selectionPresta().filter((s) => s.type !== 'caution');
  if (!sel.length) { toast('Sélectionnez au moins une prestation facturable', true); return; }
  try {
    const { url } = await api('/api/prestations/proforma', {
      method: 'POST',
      body: { resident_id: residentId, prestation_ids: sel.map((s) => s.id) },
    });
    window.open(url, '_blank');
  } catch (err) { toast(err.message, true); }
};

/* --- formulaire d'ajout de prestation (séjour / vente / charge / caution) --- */
window.formPrestation = async (residentId, type) => {
  const TITRES = { sejour: 'Nouveau séjour', vente: 'Nouvelle vente', charge: 'Nouvelle charge', caution: 'Nouvelle caution' };
  const needDates = type === 'sejour' || type === 'charge';
  const [empRes, artRes] = await Promise.all([
    type === 'sejour' ? api('/api/emplacements') : Promise.resolve({ emplacements: [] }),
    type === 'vente' ? api('/api/articles').catch(() => ({ articles: [] })) : Promise.resolve({ articles: [] }),
  ]);
  const emplacements = empRes.emplacements || [];
  const articles = artRes.articles || [];
  const artMap = {}; articles.forEach((a) => { artMap[a.id] = a; });

  const lbl = 'display:flex;flex-direction:column;gap:3px';
  openDrawer(`
    <h2>${TITRES[type]}</h2>
    <form id="f-presta" class="form-grid" style="margin-top:14px">
      ${type === 'vente' && articles.length ? `
        <label class="full">Article du catalogue
          <select id="presta-article"><option value="">— saisie libre —</option>
            ${articles.map((a) => `<option value="${a.id}">${esc(a.designation)} — ${eur(Number(a.prix_ht) * (1 + Number(a.taux_tva || 0) / 100))} TTC</option>`).join('')}
          </select></label>` : ''}
      ${type === 'charge' ? `
        <label class="full" style="${lbl}">Nature de la charge *
          <select name="nature_charge" id="nature-charge" required>
            <option value="">— choisir —</option>
            ${['Électricité', 'Eau', 'Ordures ménagères'].map((n) => `<option value="${n}">${n}</option>`).join('')}
            <option value="__autre">Autre…</option>
          </select></label>
        <label class="full hidden" id="nature-autre-wrap" style="${lbl}">Préciser la nature *
          <input name="nature_autre" id="nature-autre" placeholder="Ex : Gaz, Internet, Assainissement…"></label>`
      : `<label class="full" style="${lbl}">Désignation *<input name="designation" required placeholder="${type === 'sejour' ? 'Séjour MH 1 chambre' : type === 'caution' ? 'Caution location' : 'Bouteille de gaz'}"></label>`}
      ${type === 'sejour' ? `
        <label>Emplacement
          <select name="emplacement_id"><option value="">—</option>
            ${emplacements.map((e) => `<option value="${e.id}">${esc(e.numero)}${e.secteur ? ' · ' + esc(e.secteur) : ''}</option>`).join('')}
          </select></label>` : ''}
      ${needDates ? `
        <label>Du<input name="date_debut" type="date"></label>
        <label>Au<input name="date_fin" type="date"></label>` : type === 'caution' ? `
        <label>Date<input name="date_debut" type="date" value="${new Date().toISOString().slice(0, 10)}"></label>` : ''}
      <label>Qté<input name="quantite" type="number" step="0.01" value="1"></label>
      <label>PU TTC (€) *<input name="pu_ttc" type="number" step="0.01" required></label>
      <label>TVA (%)<input name="taux_tva" type="number" step="0.1" value="${type === 'caution' ? 0 : ''}" ${type === 'caution' ? 'readonly' : ''} placeholder="0"></label>
      <label class="full">Notes<input name="notes"></label>
      <div class="full"><button class="btn btn-primary btn-block">Ajouter la prestation</button></div>
    </form>`);

  const natSel = $('#nature-charge');
  if (natSel) natSel.addEventListener('change', () => {
    const autre = natSel.value === '__autre';
    const wrap = $('#nature-autre-wrap');
    if (wrap) wrap.classList.toggle('hidden', !autre);
    const inp = $('#nature-autre'); if (inp) inp.required = autre;
  });

  const sel = $('#presta-article');
  if (sel) sel.addEventListener('change', () => {
    const a = artMap[sel.value];
    if (!a) return;
    const f = $('#f-presta');
    f.designation.value = a.designation;
    f.taux_tva.value = a.taux_tva;
    f.pu_ttc.value = (Number(a.prix_ht) * (1 + Number(a.taux_tva || 0) / 100)).toFixed(2);
  });

  $('#f-presta').addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target).entries());
    b.resident_id = residentId; b.type = type;
    if (type === 'charge') {
      const nat = b.nature_charge === '__autre' ? (b.nature_autre || '').trim() : (b.nature_charge || '').trim();
      if (!nat) { toast('Choisis la nature de la charge', true); return; }
      b.designation = `Charges — ${nat}`;
      delete b.nature_charge; delete b.nature_autre;
    }
    b.quantite = Number(b.quantite || 1); b.pu_ttc = Number(b.pu_ttc || 0); b.taux_tva = Number(b.taux_tva || 0);
    for (const k in b) if (b[k] === '') delete b[k];
    try {
      await api('/api/prestations', { method: 'POST', body: b });
      closeDrawer(); toast('Prestation ajoutée'); route();
    } catch (err) { toast(err.message, true); }
  });
};

window.supprimerPrestation = async (pid, residentId) => {
  if (!await askConfirm('Annuler cette prestation ?')) return;
  try { await api(`/api/prestations/${pid}`, { method: 'DELETE' }); toast('Prestation annulée'); route(); }
  catch (err) { toast(err.message, true); }
};

window.encaisserClient = async (id) => {
  const { moyens } = await api('/api/moyens-paiement').catch(() => ({ moyens: [] }));
  openDrawer(`
    <h2>Encaisser un paiement</h2>
    <form id="f-enc" class="form-grid" style="margin-top:14px">
      <label>Moyen de paiement<select name="mode">${
        moyens.length ? moyens.map((m) => `<option value="${esc(m.code)}">${esc(m.libelle)}</option>`).join('')
                      : '<option value="espece">Espèces</option><option value="cheque">Chèque</option>'
      }</select></label>
      <label>Montant (€) *<input name="montant" type="number" step="0.01" required></label>
      <label class="full">Référence<input name="reference" placeholder="n° chèque, libellé virement…"></label>
      <div class="full"><button class="btn btn-primary btn-block">Encaisser (lettrage automatique)</button></div>
    </form>`);
  $('#f-enc').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    body.montant = Number(body.montant); body.resident_id = id;
    try { await api('/api/reglements', { method: 'POST', body }); closeDrawer(); toast('Paiement encaissé et lettré'); route(); }
    catch (err) { toast(err.message, true); }
  });
};
/* --- Facturation récurrente : loyer + lignes du "montant type" (sur le RÉSIDENT) --- */
window.formFacturation = async (residentId) => {
  const { facturation } = await api('/api/factures/config/' + residentId).catch(() => ({ facturation: {} }));
  const f = facturation || {};
  const ligne = (l = {}) => `
    <div class="rec-ligne" style="display:flex;gap:6px;margin-bottom:8px;align-items:center;flex-wrap:wrap">
      <input name="designation" placeholder="Désignation (ex : Forfait Confort)" value="${esc(l.designation || '')}" style="flex:1;min-width:160px">
      <input name="quantite" type="number" step="0.01" placeholder="Qté" value="${l.quantite != null ? l.quantite : 1}" style="width:66px" title="Quantité">
      <input name="pu_ttc" type="number" step="0.01" placeholder="PU TTC" value="${l.pu_ttc != null ? l.pu_ttc : ''}" style="width:96px" title="Prix unitaire TTC">
      <input name="taux_tva" type="number" step="0.1" placeholder="TVA %" value="${l.taux_tva != null ? l.taux_tva : ''}" style="width:76px" title="Taux de TVA">
      <label style="display:flex;align-items:center;gap:5px;font-size:12px;text-transform:none;letter-spacing:0;font-weight:500" title="Ajuster au nombre de jours de présence (mois partiel)">
        <input name="prorata" type="checkbox" ${l.prorata ? 'checked' : ''} style="width:16px;height:16px"> prorata</label>
      <button type="button" class="btn btn-ghost btn-sm" data-act="retirerLigne">✕</button>
    </div>`;
  openDrawer(`
    <h2>Facturation récurrente</h2>
    <p class="muted" style="margin-top:4px">Ce qui est facturé chaque mois à ce résident. Indépendant du contrat :
      vous pouvez réviser les tarifs ici sans refaire le contrat signé.</p>

    <form id="f-fact" style="margin-top:16px">
      <div style="background:#FBF9F4;border:1px solid var(--hairline);border-radius:11px;padding:14px;margin-bottom:16px">
        <div style="font-size:11.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--brume);margin-bottom:10px">Loyer emplacement</div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input name="loyer_mensuel" type="number" step="0.01" placeholder="Montant TTC / mois" value="${f.loyer_mensuel != null ? f.loyer_mensuel : ''}" style="flex:1;min-width:140px">
          <input name="loyer_tva" type="number" step="0.1" placeholder="TVA %" value="${f.loyer_tva != null ? f.loyer_tva : ''}" style="width:86px">
          <label style="display:flex;align-items:center;gap:5px;font-size:12px;text-transform:none;letter-spacing:0;font-weight:500">
            <input name="loyer_prorata" type="checkbox" ${f.loyer_prorata === false ? '' : 'checked'} style="width:16px;height:16px"> prorata</label>
        </div>
      </div>

      <div style="font-size:11.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--brume);margin-bottom:8px">Lignes récurrentes</div>
      <div id="rec-lignes">${(f.lignes || []).map(ligne).join('') || ligne()}</div>
      <button type="button" class="btn btn-ghost btn-sm" id="rec-add">+ Ajouter une ligne</button>
      <div style="margin-top:16px"><button class="btn btn-primary btn-block">Enregistrer</button></div>
    </form>`);
  $('#rec-add').addEventListener('click', () => $('#rec-lignes').insertAdjacentHTML('beforeend', ligne()));
  $('#f-fact').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const lignes = [...document.querySelectorAll('#rec-lignes .rec-ligne')].map((el) => ({
      designation: el.querySelector('[name=designation]').value.trim(),
      quantite: Number(el.querySelector('[name=quantite]').value || 1),
      pu_ttc: Number(el.querySelector('[name=pu_ttc]').value || 0),
      taux_tva: Number(el.querySelector('[name=taux_tva]').value || 0),
      prorata: el.querySelector('[name=prorata]').checked,
    })).filter((l) => l.designation && l.pu_ttc !== 0);
    try {
      await api('/api/factures/config/' + residentId, { method: 'PUT', body: {
        loyer_mensuel: Number(fd.get('loyer_mensuel') || 0),
        loyer_tva: Number(fd.get('loyer_tva') || 0),
        loyer_prorata: !!e.target.querySelector('[name=loyer_prorata]').checked,
        lignes,
      } });
      closeDrawer(); toast('Facturation enregistrée'); route();
    } catch (err) { toast(err.message, true); }
  });
};

/* --- Brouillons : éditer les lignes, émettre, supprimer --- */
window.editerLignesFacture = async (factureId) => {
  const { facture } = await api('/api/factures/' + factureId);
  const ligne = (l = {}) => `
    <div class="fl-ligne" style="display:flex;gap:6px;margin-bottom:8px;align-items:center;flex-wrap:wrap">
      <input name="designation" placeholder="Désignation" value="${esc(l.designation || '')}" style="flex:1;min-width:160px">
      <input name="quantite" type="number" step="0.01" value="${l.quantite != null ? l.quantite : 1}" style="width:66px" title="Quantité">
      <input name="pu_ttc" type="number" step="0.01" placeholder="PU TTC" value="${l.pu_ttc != null ? l.pu_ttc : ''}" style="width:96px" title="Prix unitaire TTC">
      <input name="taux_tva" type="number" step="0.1" placeholder="TVA %" value="${l.taux_tva != null ? l.taux_tva : 0}" style="width:76px" title="Taux de TVA">
      <button type="button" class="btn btn-ghost btn-sm" data-act="retirerLigne">✕</button>
    </div>`;
  // le PDF stocke pu_ht ; on réaffiche le TTC pour l'édition
  const enTtc = (l) => ({ ...l, pu_ttc: l.pu_ttc != null ? l.pu_ttc
    : Math.round(Number(l.pu_ht || 0) * (1 + Number(l.taux_tva || 0) / 100) * 100) / 100 });
  openDrawer(`
    <h2>Modifier le brouillon</h2>
    <p class="muted" style="margin-top:4px">Ajustez les lignes avant émission. Une fois émise, la facture est figée
      (elle ne se corrige plus que par un avoir).</p>
    <form id="f-lignes" style="margin-top:14px">
      <div id="fl-lignes">${(facture.lignes || []).map((l) => ligne(enTtc(l))).join('')}</div>
      <button type="button" class="btn btn-ghost btn-sm" id="fl-add">+ Ajouter une ligne</button>
      <div style="margin-top:16px"><button class="btn btn-primary btn-block">Enregistrer le brouillon</button></div>
    </form>`);
  $('#fl-add').addEventListener('click', () => $('#fl-lignes').insertAdjacentHTML('beforeend', ligne()));
  $('#f-lignes').addEventListener('submit', async (e) => {
    e.preventDefault();
    const lignes = [...document.querySelectorAll('#fl-lignes .fl-ligne')].map((el) => ({
      designation: el.querySelector('[name=designation]').value.trim(),
      quantite: Number(el.querySelector('[name=quantite]').value || 1),
      pu_ttc: Number(el.querySelector('[name=pu_ttc]').value || 0),
      taux_tva: Number(el.querySelector('[name=taux_tva]').value || 0),
    })).filter((l) => l.designation);
    if (!lignes.length) return toast('Au moins une ligne est requise', true);
    try {
      await api(`/api/factures/${factureId}/lignes`, { method: 'PUT', body: { lignes } });
      closeDrawer(); toast('Brouillon enregistré'); route();
    } catch (err) { toast(err.message, true); }
  });
};

window.ajouterPrestationsFacture = async (factureId, residentId) => {
  const { prestations } = await api('/api/prestations?resident_id=' + residentId).catch(() => ({ prestations: [] }));
  const dispo = (prestations || []).filter((p) =>
    p.type !== 'caution' && p.statut !== 'facturee' && p.statut !== 'annulee');
  if (!dispo.length) {
    return toast('Aucune prestation à facturer pour ce résident', true);
  }
  openDrawer(`
    <h2>Ajouter des prestations</h2>
    <p class="muted" style="margin-top:4px">Cochez ce que vous voulez ajouter à ce brouillon.</p>
    <form id="f-addp" style="margin-top:14px">
      ${dispo.map((p) => `
        <label style="display:flex;gap:10px;align-items:center;padding:11px 2px;border-bottom:1px solid #F1EDE2;
          text-transform:none;letter-spacing:0;font-weight:400;font-size:14px">
          <input type="checkbox" value="${esc(p.id)}" checked style="width:17px;height:17px;flex-shrink:0">
          <span style="flex:1;min-width:0">
            <span style="font-weight:600">${esc(p.designation)}</span>
            ${p.quantite && Number(p.quantite) !== 1 ? `<span class="muted"> × ${p.quantite}</span>` : ''}
          </span>
          <strong style="white-space:nowrap">${eur(Number(p.pu_ttc || 0) * Number(p.quantite || 1))}</strong>
        </label>`).join('')}
      <div style="margin-top:16px"><button class="btn btn-primary btn-block">Ajouter au brouillon</button></div>
    </form>`);
  $('#f-addp').addEventListener('submit', async (e) => {
    e.preventDefault();
    const ids = [...e.target.querySelectorAll('input[type=checkbox]:checked')].map((i) => i.value);
    if (!ids.length) return toast('Sélectionnez au moins une prestation', true);
    try {
      const r = await api(`/api/factures/${factureId}/prestations`, { method: 'POST', body: { prestation_ids: ids } });
      closeDrawer(); toast(`${r.ajoutees} prestation(s) ajoutée(s) — total ${eur(r.facture.total_ttc)}`); route();
    } catch (err) { toast(err.message, true); }
  });
};

window.emettreFacture = async (factureId) => {
  if (!await askConfirm(
    "L'émission est définitive : un numéro de facture est attribué, la pièce entre dans la chaîne fiscale "
    + 'et la facture est envoyée au locataire par e-mail.\n\nVérifiez le brouillon avant de continuer.',
    { titre: 'Émettre la facture', ok: 'Émettre' })) return;
  try {
    const r = await api(`/api/factures/${factureId}/emettre`, { method: 'POST' });
    toast(`Facture ${r.facture.numero} émise — ${eur(r.facture.total_ttc)}`);
    route();
  } catch (e) { toast(e.message, true); }
};

window.supprimerBrouillon = async (factureId) => {
  if (!await askConfirm('Supprimer ce brouillon ? Les prestations qu\'il reprend redeviendront facturables.',
    { titre: 'Supprimer le brouillon', ok: 'Supprimer', danger: true })) return;
  try {
    await api('/api/factures/' + factureId, { method: 'DELETE' });
    toast('Brouillon supprimé'); route();
  } catch (e) { toast(e.message, true); }
};

/* --- Facture du mois en un clic (loyer + lignes récurrentes + taxe de séjour) --- */
window.genererFactureMois = async (residentId) => {
  const periode = await askMois(new Date().toISOString().slice(0, 7),
    { titre: 'Générer la facture du mois', ok: 'Générer la facture' });
  if (!periode) return;
  try {
    const r = await api('/api/factures/run-resident', { method: 'POST', body: { resident_id: residentId, periode } });
    toast(`Brouillon créé — ${eur(r.facture.total_ttc)}${r.prestations ? ` (${r.prestations} prestation(s) reprise(s))` : ''}. Vérifiez puis émettez.`);
    route();
  } catch (e) { toast(e.message, true); }
};

/* Facture électronique Factur-X (PDF + XML EN 16931) — clients entreprise */
window.facturxFacture = async (id) => {
  try {
    const headers = { Authorization: 'Bearer ' + TOKEN };
    if (ACTIVE_CAMPING) headers['x-camping-id'] = ACTIVE_CAMPING;
    const r = await fetch(API + `/api/factures/${id}/facturx`, { headers });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'Factur-X indisponible'); }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'facture_facturx.pdf'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    toast('Factur-X généré');
  } catch (e) { toast(e.message, true); }
};

window.envoyerFacturePA = async (id) => {
  if (!await askConfirm('Transmettre cette facture à la plateforme agréée ?', { titre: 'Envoyer à la PA', ok: 'Envoyer' })) return;
  try {
    const r = await api(`/api/factures/${id}/emettre-pa`, { method: 'POST' });
    toast(`Transmise à la PA (${r.statut || 'déposée'})`);
    route();
  } catch (e) { toast(e.message || 'Échec de la transmission', true); }
};

window.lettrerCredit = async (residentId) => {
  try {
    const r = await api('/api/reglements/lettrer', { method: 'POST', body: { resident_id: residentId } });
    toast(r.factures ? `${r.factures} facture(s) soldée(s) par le crédit — ${eur(r.affecte)}` : 'Aucun crédit d\'avance à appliquer');
    route();
  } catch (e) { toast(e.message, true); }
};
window.encaisserFacture = async (factureId, residentId, reste) => {
  const { moyens } = await api('/api/moyens-paiement').catch(() => ({ moyens: [] }));
  const opts = moyens.length
    ? moyens.map((m) => `<option value="${esc(m.code)}">${esc(m.libelle)}</option>`).join('')
    : '<option value="espece">Espèces</option><option value="cheque">Chèque</option><option value="virement">Virement</option><option value="tpe">Carte bancaire</option>';
  const ligne = (montant = '') => `
    <div class="enc-ligne" style="display:flex;gap:8px;margin-bottom:8px;align-items:center">
      <select name="mode" style="flex:1">${opts}</select>
      <input name="montant" type="number" step="0.01" placeholder="Montant" value="${montant}" style="width:120px">
      <input name="reference" placeholder="Réf." style="width:100px">
      <button type="button" class="btn btn-ghost btn-sm" data-act="retirerLigne">✕</button>
    </div>`;
  openDrawer(`
    <h2>Encaisser sur la facture</h2>
    <p class="muted" style="margin-top:4px">Reste dû : <strong>${eur(reste)}</strong></p>
    <form id="f-encf" style="margin-top:12px">
      <div id="enc-lignes">${ligne(reste != null ? Number(reste).toFixed(2) : '')}</div>
      <button type="button" class="btn btn-ghost btn-sm" id="enc-add">+ Ajouter un règlement (paiement mixte)</button>
      <div style="margin-top:16px"><button class="btn btn-primary btn-block">Encaisser sur cette facture</button></div>
    </form>`);
  $('#enc-add').addEventListener('click', () => $('#enc-lignes').insertAdjacentHTML('beforeend', ligne()));
  $('#f-encf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const lignes = [...document.querySelectorAll('#enc-lignes .enc-ligne')].map((el) => ({
      mode: el.querySelector('[name=mode]').value,
      montant: Number(el.querySelector('[name=montant]').value),
      reference: el.querySelector('[name=reference]').value || null,
    })).filter((l) => l.montant > 0);
    if (!lignes.length) return toast('Indiquez au moins un montant', true);
    try {
      for (const l of lignes) {
        await api('/api/reglements', { method: 'POST', body: {
          resident_id: residentId, mode: l.mode, montant: l.montant, reference: l.reference,
          affectations: [{ facture_id: factureId, montant: l.montant }],
        } });
      }
      closeDrawer(); toast('Encaissement enregistré'); route();
    } catch (err) { toast(err.message, true); }
  });
};
window.voirDoc = async (id) => {
  try { const { url } = await api(`/api/documents/${id}/url`); window.open(url, '_blank'); }
  catch (e) { toast(e.message, true); }
};

/* Création ET modification d'un résident (un seul formulaire).
   Le téléphone est requis : il sert à l'identification par code SMS à la signature. */
window.formResident = async (id = null) => {
  const [{ emplacements }, r] = await Promise.all([
    api('/api/emplacements'),
    id ? api('/api/residents/' + id).then((d) => d.resident) : Promise.resolve(null),
  ]);
  /* Meme deduction que sur la carte : la colonne « statut » ne dit pas qui
     habite ou. S'y fier proposait des emplacements deja occupes, et ecartait
     des emplacements libres mal etiquetes. On garde l'emplacement actuel du
     resident a la modification — il n'est plus libre, mais c'est le sien. */
  const dispo = emplacements.filter((e) => statutReel(e) === 'libre' || (r && e.id === r.emplacement_id));
  const v = (k) => esc((r && r[k]) || '');
  openDrawer(`
    <h2>${r ? 'Modifier le résident' : 'Nouveau résident'}</h2>
    <form id="f-res" class="form-grid" style="margin-top:14px">
      <label>Civilité<select name="civilite">
        <option value="">—</option>
        <option ${r && r.civilite === 'M.' ? 'selected' : ''}>M.</option>
        <option ${r && r.civilite === 'Mme' ? 'selected' : ''}>Mme</option></select></label>
      <label>Nom *<input name="nom" required value="${v('nom')}"></label>
      <label>Prénom<input name="prenom" value="${v('prenom')}"></label>
      <label>E-mail<input name="email" type="email" value="${v('email')}"></label>
      <label>Téléphone *<input name="telephone" type="tel" required placeholder="06 12 34 56 78" value="${v('telephone')}"></label>
      <label>Emplacement<select name="emplacement_id"><option value="">— aucun —</option>${dispo.map((e) => `<option value="${e.id}" ${r && r.emplacement_id === e.id ? 'selected' : ''}>${esc(e.numero)} (${esc(e.secteur || '')})</option>`).join('')}</select></label>
      <label class="full">Adresse<input name="adresse" value="${v('adresse')}"></label>
      <label>Date de naissance<input name="date_naissance" type="date" value="${v('date_naissance')}"></label>
      <label>Nationalité<input name="nationalite" value="${v('nationalite')}"></label>
      <label class="full">Notes internes<input name="notes_internes" value="${v('notes_internes')}"></label>
      <p class="muted full" style="margin:-4px 0 2px;font-size:12.5px">Le téléphone permet d'envoyer le code de sécurité par SMS lors des signatures.</p>

            <div class="full" style="margin-top:6px"><strong>Assurance</strong>
        <p class="muted" style="margin:4px 0 0;font-size:12.5px">Date de fin de l\u2019attestation en cours : des rappels automatiques partent avant l\u2019échéance (60/30/7 jours).</p>
      </div>
      <label>Attestation valable jusqu\u2019au<input type="date" name="assurance_expire_le" value="${v('assurance_expire_le')}"></label>
      <label>Assureur / n° de police<input name="assurance_ref" value="${v('assurance_ref')}" placeholder="MAIF n° 1234567"></label>
      <div class="full" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--hairline)">
        <div style="font-size:11.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--brume)">Client entreprise (facultatif)</div>
        <p class="muted" style="margin:4px 0 0;font-size:12.5px">À remplir uniquement pour une société, un CE ou une association.
          Le SIRET déclenche la facturation électronique (Factur-X) ; sans lui, le client est un particulier.</p>
      </div>
      <label class="full">Raison sociale<input name="raison_sociale" value="${v('raison_sociale')}" placeholder="CE Renault"></label>
      <label>SIRET<input name="siret" value="${v('siret')}" placeholder="552 100 555 00013"></label>
      <label>N° TVA intracom.<input name="tva_intra" value="${v('tva_intra')}" placeholder="FR12552100555"></label>
      <label>Code postal<input name="adresse_cp" value="${v('adresse_cp')}"></label>
      <label>Ville<input name="adresse_ville" value="${v('adresse_ville')}"></label>
      <div class="full"><button class="btn btn-primary btn-block">${r ? 'Enregistrer' : 'Créer le résident'}</button></div>
    </form>`);
  $('#f-res').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    // en modification, un champ vidé doit être effacé -> on n'élague qu'à la création
    if (!r) { for (const k in body) if (body[k] === '') delete body[k]; }
    else { for (const k in body) if (body[k] === '') body[k] = null; }
    try {
      if (r) await api('/api/residents/' + id, { method: 'PUT', body });
      else await api('/api/residents', { method: 'POST', body });
      closeDrawer(); toast(r ? 'Résident modifié' : 'Résident créé'); route();
    } catch (err) { toast(err.message, true); }
  });
};

/* ---------- Emplacements ---------- */
/* ---------- Emplacements : liste + fiche ----------
   L'etat de l'ecran (selection, filtre, recherche) vit ici : on
   revient sur le meme emplacement apres une modification, qui passe
   par route(). */
let EMP_SEL = null;
let EMP_FILTRE = 'tous';
let EMP_Q = '';
let EMP_CACHE = { emplacements: [], retard: new Set() };

const EMP_AMBRE = '#7A5A22';

const empTriNaturel = (a, b) => String(a.numero || '')
  .localeCompare(String(b.numero || ''), 'fr', { numeric: true, sensitivity: 'base' });

const EMP_FILTRES = [
  ['tous', 'Tous', () => true],
  ['occupes', 'Occupés', (e) => statutReel(e) === 'occupe'],
  ['libres', 'Libres', (e) => statutReel(e) === 'libre'],
  ['impayes', 'Impayés', (e) => e.resident && EMP_CACHE.retard.has(e.resident.id)],
  ['horsplan', 'Hors plan', (e) => e.coord_x == null || e.coord_y == null],
];

function empEtat(e) {
  const s = statutReel(e);
  if (e.resident && EMP_CACHE.retard.has(e.resident.id)) return { txt: 'Impayé', col: 'var(--rouge)' };
  if (s === 'occupe') return { txt: 'Occupé', col: 'var(--brume)' };
  if (s === 'libre') return { txt: 'Libre', col: 'var(--sapin)' };
  return { txt: lib(s), col: EMP_AMBRE };
}

const empEur = (n) => (Math.abs(Number(n || 0)) < 0.005 ? '—' : eur(n));

function empVisibles() {
  const f = (EMP_FILTRES.find((x) => x[0] === EMP_FILTRE) || EMP_FILTRES[0])[2];
  const q = EMP_Q.trim().toLowerCase();
  return EMP_CACHE.emplacements.filter((e) => {
    if (!f(e)) return false;
    if (!q) return true;
    const r = e.resident ? `${e.resident.prenom || ''} ${e.resident.nom || ''}` : '';
    return `${e.numero || ''} ${e.secteur || ''} ${e.type || ''} ${r}`.toLowerCase().includes(q);
  });
}

function empLigneListe(e) {
  const et = empEtat(e);
  const sel = e.id === EMP_SEL;
  const r = e.resident;
  return `
    <div data-act="ouvrirEmplacement" data-a1="${e.id}"
         style="display:flex;align-items:center;gap:12px;padding:0 18px;height:62px;cursor:pointer;
                border-bottom:1px solid var(--hairline);
                background:${sel ? 'var(--sapin-pale)' : 'transparent'};
                box-shadow:${sel ? 'inset 3px 0 0 var(--sapin)' : 'none'}">
      <div style="width:38px;height:38px;flex:none;border-radius:var(--r-s);display:flex;align-items:center;
                  justify-content:center;font-size:13.5px;font-weight:600;
                  background:${sel ? 'var(--sapin)' : 'var(--ivoire)'};
                  color:${sel ? 'var(--ivoire)' : '#5D6E66'}">${esc(e.numero)}</div>
      <div style="min-width:0;flex:1">
        <div style="font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          ${r ? esc(`${r.prenom || ''} ${r.nom || ''}`.trim()) : '<span style="font-weight:400;color:#5D6E66">Libre</span>'}</div>
        <div class="muted" style="font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          ${esc(e.type || 'type non renseigné')}${e.secteur ? ' · ' + esc(e.secteur) : ''}</div>
      </div>
      <div style="text-align:right;flex:none">
        <div style="font-size:13.5px;font-variant-numeric:tabular-nums">${empEur(e.loyer_base)}</div>
        <div style="font-size:11.5px;font-weight:600;margin-top:2px;color:${et.col}">${et.txt}</div>
      </div>
    </div>`;
}

function majListeEmplacements() {
  const box = $('#emp-liste');
  if (!box) return;
  const v = empVisibles();
  box.innerHTML = v.length ? v.map(empLigneListe).join('')
    : '<p class="muted" style="padding:18px">Aucun emplacement ne correspond.</p>';
  const c = $('#emp-compte');
  if (c) c.textContent = v.length + (v.length > 1 ? ' emplacements' : ' emplacement');
}

window.ouvrirEmplacement = (id) => { EMP_SEL = id; vueEmplacements(); };
window.filtrerEmplacements = (k) => { EMP_FILTRE = k; EMP_SEL = null; vueEmplacements(); };
window.chercherEmplacements = (v) => { EMP_Q = v; majListeEmplacements(); };

async function empFiche(id) {
  const { emplacement: e, residents } = await api('/api/emplacements/' + id);
  const r = (residents || [])[0];
  const et = empEtat({ ...e, resident: r });

  let factures = [];
  if (r) {
    const d = await api('/api/factures?resident_id=' + r.id + exQSand()).catch(() => ({ factures: [] }));
    factures = (d.factures || []).filter((f) => ['emise', 'partielle', 'en_retard'].includes(f.statut));
  }
  const du = factures.reduce((s, f) => s + (Number(f.total_ttc || 0) - Number(f.montant_regle || 0)), 0);

  const infos = [
    ['Type', e.type ? esc(e.type) : '<span class="muted">non renseigné</span>'],
    ['Secteur', e.secteur ? esc(e.secteur) : '<span class="muted">—</span>'],
    ['Loyer de base', empEur(e.loyer_base)],
    ['Statut saisi', `<span class="badge ${esc(e.statut)}">${lib(e.statut)}</span>`],
    ['Sur le plan', e.coord_x != null && e.coord_y != null
      ? `oui · x ${Math.round(e.coord_x)} · y ${Math.round(e.coord_y)}`
      : '<span style="color:' + EMP_AMBRE + '">non placé</span>'],
  ];

  return `
    <div style="background:var(--carte);border-bottom:1px solid var(--hairline);padding:22px 26px 18px;
                display:flex;align-items:flex-start;gap:18px;flex-wrap:wrap">
      <div style="width:52px;height:52px;flex:none;border-radius:var(--r-s);background:var(--sapin-pale);
                  color:var(--sapin);display:flex;align-items:center;justify-content:center;
                  font-size:19px;font-weight:600">${esc(e.numero)}</div>
      <div style="flex:1;min-width:200px">
        <h1 style="margin:0;font-size:24px;line-height:1.15">Emplacement ${esc(e.numero)}</h1>
        <div class="muted" style="font-size:13.5px;margin-top:4px">
          ${esc(e.type || 'type non renseigné')}${e.secteur ? ' · ' + esc(e.secteur) : ''} ·
          <span style="color:${et.col};font-weight:600">${et.txt}</span>
        </div>
      </div>
      <div style="flex:none;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
        <button class="btn btn-ghost btn-sm" data-act="allerA" data-a1="#/carte">Voir sur le plan</button>
        <button class="btn btn-primary btn-sm" data-act="modifierEmplacement" data-a1="${e.id}">Modifier</button>
      </div>
    </div>

    <div style="padding:20px 26px;display:flex;flex-direction:column;gap:16px">
      <div class="card" style="padding:0;overflow:hidden">
        ${infos.map(([k, v]) => `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;
                      padding:0 18px;height:46px;border-bottom:1px solid var(--hairline)">
            <span class="muted" style="font-size:13px">${k}</span>
            <span style="font-size:13.5px;text-align:right">${v}</span>
          </div>`).join('')}
      </div>

      <div class="card" style="padding:0;overflow:hidden">
        <div style="padding:13px 18px;border-bottom:1px solid var(--hairline);display:flex;
                    align-items:center;justify-content:space-between;gap:12px">
          <div style="font-size:14px;font-weight:600">Résident</div>
          ${r ? `<button class="btn btn-ghost btn-sm" data-act="allerA" data-a1="#/residents/${r.id}">Ouvrir la fiche</button>` : ''}
        </div>
        ${r ? `
          <div style="padding:16px 18px;display:flex;flex-direction:column;gap:4px">
            <div style="font-size:15px;font-weight:600">${esc(`${r.prenom || ''} ${r.nom || ''}`.trim())}</div>
            <div class="muted" style="font-size:13px">${esc(r.email || '—')}${r.telephone ? ' · ' + esc(r.telephone) : ''}</div>
          </div>
          <div style="display:flex;border-top:1px solid var(--hairline)">
            <div style="flex:1;padding:13px 18px">
              <div class="muted" style="font-size:11.5px;font-weight:600;letter-spacing:.09em;text-transform:uppercase">Reste dû</div>
              <div style="font-size:20px;margin-top:4px;font-variant-numeric:tabular-nums;${du > 0.005 ? 'color:var(--rouge);font-weight:600' : ''}">${empEur(du)}</div>
            </div>
            <div style="flex:1;padding:13px 18px;border-left:1px solid var(--hairline)">
              <div class="muted" style="font-size:11.5px;font-weight:600;letter-spacing:.09em;text-transform:uppercase">Factures en attente</div>
              <div style="font-size:20px;margin-top:4px;font-variant-numeric:tabular-nums">${factures.length || '—'}</div>
            </div>
          </div>
          ${factures.length ? factures.map((f) => `
            <div data-act="ouvrirFacture" data-a1="${f.id}" style="display:grid;grid-template-columns:1fr 110px 96px;
                        gap:12px;align-items:center;padding:0 18px;height:46px;cursor:pointer;
                        border-top:1px solid var(--hairline)">
              <div style="font-size:13.5px">${esc(f.numero || 'brouillon')}</div>
              <div><span class="badge ${esc(f.statut)}">${lib(f.statut)}</span></div>
              <div style="text-align:right;font-size:13.5px;font-variant-numeric:tabular-nums;color:var(--rouge)">${eur(f.total_ttc - f.montant_regle)}</div>
            </div>`).join('') : ''}`
  : `<div style="padding:16px 18px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">
               <span class="muted" style="font-size:13.5px">Aucun résident rattaché — cet emplacement est libre.</span>
               <button class="btn btn-ghost btn-sm" data-act="formResident">Installer un résident</button>
             </div>`}
      </div>
    </div>`;
}

async function vueEmplacements() {
  const [{ emplacements }, facD] = await Promise.all([
    api('/api/emplacements'),
    api('/api/factures' + exQS()).catch(() => ({ factures: [] })),
  ]);
  /* Meme regle que le plan : « en retard » se lit dans les factures
     echues, pas dans un champ du resident. */
  const retard = new Set();
  for (const f of (facD.factures || [])) {
    if (!['emise', 'partielle', 'en_retard'].includes(f.statut)) continue;
    if (Number(f.total_ttc || 0) - Number(f.montant_regle || 0) < 0.005) continue;
    if (f.date_echeance && new Date(f.date_echeance) >= new Date()) continue;
    if (f.resident_id) retard.add(f.resident_id);
  }
  const liste = (emplacements || []).slice().sort(empTriNaturel);
  EMP_CACHE = { emplacements: liste, retard };

  const visibles = empVisibles();
  if (EMP_SEL && !liste.some((e) => e.id === EMP_SEL)) EMP_SEL = null;
  if (!EMP_SEL && visibles.length) EMP_SEL = visibles[0].id;

  const compte = (k) => liste.filter((EMP_FILTRES.find((x) => x[0] === k) || EMP_FILTRES[0])[2]).length;
  const puces = EMP_FILTRES.map(([k, l]) => {
    const on = k === EMP_FILTRE;
    return `<button data-act="filtrerEmplacements" data-a1="${k}"
      style="padding:4px 11px;border-radius:20px;font-size:12.5px;cursor:pointer;font-family:inherit;
             border:1px solid ${on ? 'var(--nuit)' : 'var(--hairline)'};
             background:${on ? 'var(--nuit)' : 'transparent'};color:${on ? 'var(--ivoire)' : '#5D6E66'};
             font-weight:${on ? '600' : '400'}">${l} ${compte(k)}</button>`;
  }).join('');

  $('#main').innerHTML = `
    <div class="page-head"><div><h1>Emplacements</h1>
      <div class="muted" style="font-size:13.5px;margin-top:4px">
        ${liste.length} emplacement${liste.length > 1 ? 's' : ''} · ${compte('occupes')} occupé${compte('occupes') > 1 ? 's' : ''} · ${compte('libres')} libre${compte('libres') > 1 ? 's' : ''}
      </div></div>
      <button class="btn btn-primary" data-act="formEmplacement">Nouvel emplacement</button></div>

    <div class="card" style="padding:0;overflow:hidden;display:flex;align-items:stretch;min-height:560px">
      <div style="width:380px;flex:none;border-right:1px solid var(--hairline);display:flex;flex-direction:column;min-width:0">
        <div style="padding:16px 18px 13px;border-bottom:1px solid var(--hairline);display:flex;flex-direction:column;gap:11px">
          <input id="emp-q" data-act="chercherEmplacements" data-evt="input" data-a1="@value"
                 placeholder="Numéro, type, secteur, résident" value="${esc(EMP_Q)}" style="width:100%">
          <div style="display:flex;gap:6px;flex-wrap:wrap">${puces}</div>
          <div id="emp-compte" class="muted" style="font-size:12px"></div>
        </div>
        <div id="emp-liste" style="flex:1;overflow:auto"></div>
      </div>
      <div id="emp-fiche" style="flex:1;min-width:0;background:var(--ivoire)"></div>
    </div>`;

  majListeEmplacements();
  const fiche = $('#emp-fiche');
  if (!EMP_SEL) {
    fiche.innerHTML = `<p class="muted" style="padding:26px">${liste.length
      ? 'Aucun emplacement dans ce filtre.'
      : 'Aucun emplacement. « Nouvel emplacement » crée le premier.'}</p>`;
    return;
  }
  fiche.innerHTML = '<p class="muted" style="padding:26px">Chargement…</p>';
  try { fiche.innerHTML = await empFiche(EMP_SEL); }
  catch (err) { fiche.innerHTML = `<p class="form-error" style="margin:26px">${esc(err.message)}</p>`; }
}

window.formEmplacement = async () => {
  const types = await typesEmplacement();
  openDrawer(`
    <h2>Nouvel emplacement</h2>
    <form id="f-emp" class="form-grid" style="margin-top:14px">
      <label>Numéro *<input name="numero" required></label>
      <label>Secteur<input name="secteur"></label>
      <label class="full">Type
        <input name="type" list="liste-types-emp" autocomplete="off" placeholder="MH 2 chambres, chalet, parcelle nue…">
      </label>
      ${datalistTypesEmp(types)}
      <label>Loyer de base TTC (€)<input name="loyer_base" type="number" step="0.01"></label>
      <label>Coord. X (carte)<input name="coord_x" type="number" step="1"></label>
      <label>Coord. Y (carte)<input name="coord_y" type="number" step="1"></label>
      <div class="full"><button class="btn btn-primary btn-block">Créer l'emplacement</button></div>
    </form>`);
  $('#f-emp').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    for (const k of ['loyer_base', 'coord_x', 'coord_y']) body[k] = body[k] === '' ? undefined : Number(body[k]);
    for (const k in body) if (body[k] === '' || body[k] === undefined) delete body[k];
    try { await api('/api/emplacements', { method: 'POST', body }); closeDrawer(); toast('Emplacement créé'); route(); }
    catch (err) { toast(err.message, true); }
  });
};

/* ---------- Contrats (ecran dedie) ----------
   Les contrats vivaient au fond de la fiche resident. Ici, la seule
   question qui compte : lesquels reclament une action. */
let CTR_SEL = null;
let CTR_FILTRE = 'tous';
let CTR_Q = '';
let CTR_CACHE = { contrats: [], res: {}, emp: {} };

const CTR_AMBRE = '#7A5A22';
const CTR_J = 86400000;
const ctrJours = (d) => (d ? Math.floor((new Date(d) - new Date()) / CTR_J) : null);

/* Un contrat « en attente » est emis mais pas signe : c'est le seul
   etat ou l'action attend quelqu'un d'autre que nous. */
const ctrEnAttente = (c) => !['signe', 'brouillon', 'annule'].includes(c.statut);

function ctrEtat(c) {
  if (c.statut === 'brouillon') return { txt: 'Brouillon', col: CTR_AMBRE, rang: 3 };
  if (c.statut === 'annule') return { txt: 'Annulé', col: 'var(--brume)', rang: 5 };
  const j = ctrJours(c.date_fin);
  if (c.date_fin && j < 0) return { txt: 'Échu le ' + dfr(c.date_fin), col: 'var(--rouge)', rang: 0 };
  if (ctrEnAttente(c)) return { txt: 'En attente de signature', col: CTR_AMBRE, rang: 1 };
  if (c.date_fin && j <= 60) return { txt: `Fin dans ${j} j`, col: CTR_AMBRE, rang: 2 };
  return { txt: 'Signé', col: 'var(--sapin)', rang: 4 };
}

const ctrEur = (n) => (Math.abs(Number(n || 0)) < 0.005 ? '—' : eur(n));
const ctrNom = (c) => CTR_CACHE.res[c.resident_id] || 'Résident supprimé';

const CTR_FILTRES = [
  ['tous', 'Tous', (c) => c.statut !== 'annule'],
  ['renouveler', 'À renouveler', (c) => {
    if (['brouillon', 'annule'].includes(c.statut) || !c.date_fin) return false;
    return ctrJours(c.date_fin) <= 60;
  }],
  ['attente', 'En attente', (c) => ctrEnAttente(c)],
  ['signes', 'Signés', (c) => c.statut === 'signe'],
  ['brouillons', 'Brouillons', (c) => c.statut === 'brouillon'],
];

function ctrVisibles() {
  const f = (CTR_FILTRES.find((x) => x[0] === CTR_FILTRE) || CTR_FILTRES[0])[2];
  const q = CTR_Q.trim().toLowerCase();
  return CTR_CACHE.contrats.filter((c) => {
    if (!f(c)) return false;
    if (!q) return true;
    return `${c.numero || ''} ${ctrNom(c)}`.toLowerCase().includes(q);
  });
}

function ctrLigneListe(c) {
  const e = ctrEtat(c);
  const sel = c.id === CTR_SEL;
  return `
    <div data-act="ouvrirContrat" data-a1="${c.id}"
         style="display:flex;align-items:center;gap:12px;padding:0 18px;height:62px;cursor:pointer;
                border-bottom:1px solid var(--hairline);
                background:${sel ? 'var(--sapin-pale)' : 'transparent'};
                box-shadow:${sel ? 'inset 3px 0 0 var(--sapin)' : 'none'}">
      <div style="min-width:0;flex:1">
        <div style="font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          ${esc(ctrNom(c))}</div>
        <div class="muted" style="font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          ${esc(c.numero || 'sans numéro')}${c.date_fin ? ' · fin ' + dfr(c.date_fin) : ''}</div>
      </div>
      <div style="text-align:right;flex:none">
        <div style="font-size:13.5px;font-variant-numeric:tabular-nums">${ctrEur(c.montant_mensuel)}</div>
        <div style="font-size:11.5px;font-weight:600;margin-top:2px;color:${e.col}">${e.txt}</div>
      </div>
    </div>`;
}

function majListeContrats() {
  const box = $('#ctr-liste');
  if (!box) return;
  const v = ctrVisibles();
  box.innerHTML = v.length ? v.map(ctrLigneListe).join('')
    : '<p class="muted" style="padding:18px">Aucun contrat ne correspond.</p>';
  const n = $('#ctr-compte');
  if (n) n.textContent = v.length + (v.length > 1 ? ' contrats' : ' contrat');
}

window.ouvrirContrat = (id) => { CTR_SEL = id; vueContrats(); };
window.filtrerContrats = (k) => { CTR_FILTRE = k; CTR_SEL = null; vueContrats(); };
window.chercherContrats = (v) => { CTR_Q = v; majListeContrats(); };

function ctrFiche(c) {
  const e = ctrEtat(c);
  const nom = ctrNom(c);
  const emp = CTR_CACHE.emp[c.resident_id];
  const brouillon = c.statut === 'brouillon';
  const signe = c.statut === 'signe';

  const boutons = [];
  if (brouillon) {
    boutons.push(`<button class="btn btn-ghost btn-sm" data-act="supprimerContrat" data-a1="${c.id}" data-a2="${esc(c.numero || '')}">Supprimer</button>`);
    boutons.push(`<button class="btn btn-primary btn-sm" data-act="regenererContrat" data-a1="${c.id}">Réessayer le PDF</button>`);
  } else {
    boutons.push(`<button class="btn btn-ghost btn-sm" data-act="telechargerContrat" data-a1="${c.id}">PDF</button>`);
    if (!signe) {
      boutons.push(`<button class="btn btn-ghost btn-sm" data-act="signerContratPapier" data-a1="${c.id}">Signé (papier)</button>`);
      boutons.push(`<button class="btn btn-primary btn-sm" data-act="contratVersSignature" data-a1="${c.id}">Envoyer en signature</button>`);
    } else if (c.date_fin && ctrJours(c.date_fin) <= 60) {
      boutons.push(`<button class="btn btn-primary btn-sm" data-act="renouvelerContrat" data-a1="${c.id}">Renouveler</button>`);
    }
  }

  const infos = [
    ['Période', `${c.date_debut ? dfr(c.date_debut) : '—'} → ${c.date_fin ? dfr(c.date_fin) : 'illimité'}`],
    ['Loyer mensuel', ctrEur(c.montant_mensuel)],
    ['Emplacement', emp ? esc(emp) : '<span class="muted">non rattaché</span>'],
    ['Statut', `<span class="badge ${signe ? 'reglee' : brouillon ? 'brouillon' : 'emise'}">${lib(c.statut)}</span>`],
    ['Signature', signe
      ? 'signé' + (c.date_signature ? ' le ' + dfr(c.date_signature) : '')
      : brouillon
        ? '<span style="color:' + CTR_AMBRE + '">PDF non généré</span>'
        : '<span style="color:' + CTR_AMBRE + '">en attente du résident</span>'],
  ];

  return `
    <div style="background:var(--carte);border-bottom:1px solid var(--hairline);padding:22px 26px 18px;
                display:flex;align-items:flex-start;gap:18px;flex-wrap:wrap">
      <div style="flex:1;min-width:220px">
        <h1 style="margin:0;font-size:24px;line-height:1.15">${esc(c.numero || 'Brouillon')}</h1>
        <div class="muted" style="font-size:13.5px;margin-top:4px">
          ${esc(nom)}${emp ? ' · emplacement ' + esc(emp) : ''}
        </div>
        <div style="display:flex;gap:7px;margin-top:11px;flex-wrap:wrap">
          <span style="font-size:12.5px;font-weight:600;padding:3px 9px;border-radius:var(--r-s);
                       background:${e.col === 'var(--rouge)' ? 'var(--rouge-pale)' : e.col === 'var(--sapin)' ? 'var(--sapin-pale)' : 'var(--laiton-pale)'};
                       color:${e.col}">${e.txt}</span>
        </div>
      </div>
      <div style="flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:5px">
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">${boutons.join('')}</div>
        ${brouillon
  ? '<div class="muted" style="font-size:12px">Un brouillon est un contrat dont le PDF n\'a pas abouti.</div>'
  : signe ? '' : '<div class="muted" style="font-size:12px">La signature papier accepte un scan, facultatif.</div>'}
      </div>
    </div>

    <div style="padding:20px 26px;display:flex;flex-direction:column;gap:16px">
      <div class="card" style="padding:0;overflow:hidden">
        ${infos.map(([k, v]) => `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;
                      padding:0 18px;height:46px;border-bottom:1px solid var(--hairline)">
            <span class="muted" style="font-size:13px">${k}</span>
            <span style="font-size:13.5px;text-align:right">${v}</span>
          </div>`).join('')}
      </div>
      <div class="card" style="padding:0;overflow:hidden">
        <div style="padding:13px 18px;border-bottom:1px solid var(--hairline);display:flex;
                    align-items:center;justify-content:space-between;gap:12px">
          <div style="font-size:14px;font-weight:600">Résident</div>
          ${c.resident_id ? `<button class="btn btn-ghost btn-sm" data-act="allerA" data-a1="#/residents/${c.resident_id}">Ouvrir la fiche</button>` : ''}
        </div>
        <div style="padding:16px 18px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">
          <div style="font-size:15px;font-weight:600">${esc(nom)}</div>
          ${c.resident_id ? `<button class="btn btn-ghost btn-sm" data-act="nouveauContrat" data-a1="${c.resident_id}">Nouveau contrat</button>` : ''}
        </div>
      </div>
    </div>`;
}

async function vueContrats() {
  const [ctrD, resD, empD] = await Promise.all([
    api('/api/contrats'),
    api('/api/residents').catch(() => ({ residents: [] })),
    api('/api/emplacements').catch(() => ({ emplacements: [] })),
  ]);
  const res = {}; const emp = {};
  const numEmp = {};
  (empD.emplacements || []).forEach((x) => { numEmp[x.id] = x.numero; });
  (resD.residents || []).forEach((r) => {
    res[r.id] = `${r.prenom ? r.prenom + ' ' : ''}${r.nom || ''}`.trim() || '—';
    if (r.emplacement_id && numEmp[r.emplacement_id]) emp[r.id] = numEmp[r.emplacement_id];
  });

  /* Tri par urgence : ce qui reclame une action remonte. A rang egal,
     la fin la plus proche d'abord. */
  const liste = (ctrD.contrats || []).slice().sort((a, b) => {
    const ra = ctrEtat(a).rang; const rb = ctrEtat(b).rang;
    if (ra !== rb) return ra - rb;
    const ja = a.date_fin ? new Date(a.date_fin).getTime() : Infinity;
    const jb = b.date_fin ? new Date(b.date_fin).getTime() : Infinity;
    return ja - jb;
  });
  CTR_CACHE = { contrats: liste, res, emp };

  const visibles = ctrVisibles();
  if (CTR_SEL && !liste.some((c) => c.id === CTR_SEL)) CTR_SEL = null;
  if (!CTR_SEL && visibles.length) CTR_SEL = visibles[0].id;

  const compte = (k) => liste.filter((CTR_FILTRES.find((x) => x[0] === k) || CTR_FILTRES[0])[2]).length;
  const puces = CTR_FILTRES.map(([k, l]) => {
    const on = k === CTR_FILTRE;
    return `<button data-act="filtrerContrats" data-a1="${k}"
      style="padding:4px 11px;border-radius:20px;font-size:12.5px;cursor:pointer;font-family:inherit;
             border:1px solid ${on ? 'var(--nuit)' : 'var(--hairline)'};
             background:${on ? 'var(--nuit)' : 'transparent'};color:${on ? 'var(--ivoire)' : '#5D6E66'};
             font-weight:${on ? '600' : '400'}">${l} ${compte(k)}</button>`;
  }).join('');

  const urgents = compte('renouveler');
  $('#main').innerHTML = `
    <div class="page-head"><div><h1>Contrats</h1>
      <div class="muted" style="font-size:13.5px;margin-top:4px">
        ${compte('tous')} contrat${compte('tous') > 1 ? 's' : ''} en cours${urgents ? ' · ' + urgents + ' à renouveler' : ''}${compte('attente') ? ' · ' + compte('attente') + ' en attente de signature' : ''}
      </div></div>
      <button class="btn btn-ghost" data-act="allerA" data-a1="#/residents"
              title="Un contrat se crée depuis la fiche du résident">Créer depuis un résident</button></div>

    <div class="card" style="padding:0;overflow:hidden;display:flex;align-items:stretch;min-height:560px">
      <div style="width:380px;flex:none;border-right:1px solid var(--hairline);display:flex;flex-direction:column;min-width:0">
        <div style="padding:16px 18px 13px;border-bottom:1px solid var(--hairline);display:flex;flex-direction:column;gap:11px">
          <input id="ctr-q" data-act="chercherContrats" data-evt="input" data-a1="@value"
                 placeholder="Numéro, résident" value="${esc(CTR_Q)}" style="width:100%">
          <div style="display:flex;gap:6px;flex-wrap:wrap">${puces}</div>
          <div id="ctr-compte" class="muted" style="font-size:12px"></div>
        </div>
        <div id="ctr-liste" style="flex:1;overflow:auto"></div>
      </div>
      <div id="ctr-fiche" style="flex:1;min-width:0;background:var(--ivoire)"></div>
    </div>`;

  majListeContrats();
  const fiche = $('#ctr-fiche');
  const c = liste.find((x) => x.id === CTR_SEL);
  fiche.innerHTML = c ? ctrFiche(c)
    : `<p class="muted" style="padding:26px">${liste.length
      ? 'Aucun contrat dans ce filtre.'
      : 'Aucun contrat. Ouvrez la fiche d\'un résident et utilisez « Nouveau contrat ».'}</p>`;
}

/* ---------- Factures ---------- */
/* ---------- Factures : liste + fiche ----------
   L'etat de l'ecran (facture ouverte, filtre, recherche) vit ici et
   non dans l'URL : on revient sur la meme facture apres un
   encaissement, qui passe par route(). */
let FAC_SEL = null;
let FAC_FILTRE = 'toutes';
let FAC_Q = '';
let FAC_CACHE = { factures: [], noms: {} };

const FAC_FILTRES = [
  ['toutes', 'Toutes', () => true],
  ['impayees', 'Impayées', (f) => ['emise', 'partielle', 'en_retard'].includes(f.statut) && facReste(f) > 0.005],
  ['brouillons', 'Brouillons', (f) => f.statut === 'brouillon'],
  ['reglees', 'Réglées', (f) => f.statut === 'reglee'],
];

const facReste = (f) => Math.round((Number(f.total_ttc || 0) - Number(f.montant_regle || 0)) * 100) / 100;
/* Un montant nul s'ecrit « — » : le mur de zeros comptables donne
   l'impression que rien n'est calcule. */
const facEur = (n) => (Math.abs(Number(n || 0)) < 0.005 ? '—' : eur(n));

function facEtat(f) {
  if (f.statut === 'brouillon') return { txt: 'Brouillon', col: 'var(--brume)' };
  if (f.statut === 'avoir') return { txt: 'Avoir', col: 'var(--brume)' };
  if (f.statut === 'annulee') return { txt: 'Annulée', col: 'var(--brume)' };
  if (facReste(f) > 0.005) {
    const j = f.date_emission
      ? Math.floor((Date.now() - new Date(f.date_emission).getTime()) / 86400000) : null;
    return { txt: 'Impayée' + (j != null && j > 0 ? ' · ' + j + ' j' : ''), col: 'var(--rouge)' };
  }
  return { txt: 'Réglée', col: 'var(--sapin)' };
}

function facVisibles() {
  const f = (FAC_FILTRES.find((x) => x[0] === FAC_FILTRE) || FAC_FILTRES[0])[2];
  const q = FAC_Q.trim().toLowerCase();
  return FAC_CACHE.factures.filter((x) => {
    if (!f(x)) return false;
    if (!q) return true;
    return (String(x.numero || '') + ' ' + (FAC_CACHE.noms[x.resident_id] || '') + ' '
      + String(x.periode || '')).toLowerCase().includes(q);
  });
}

function facLigneListe(f) {
  const e = facEtat(f);
  const sel = f.id === FAC_SEL;
  return `
    <div data-act="ouvrirFacture" data-a1="${f.id}"
         style="display:flex;align-items:center;gap:12px;padding:0 18px;height:62px;cursor:pointer;
                border-bottom:1px solid var(--hairline);
                background:${sel ? 'var(--sapin-pale)' : 'transparent'};
                box-shadow:${sel ? 'inset 3px 0 0 var(--sapin)' : 'none'}">
      <div style="min-width:0;flex:1">
        <div style="font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          ${esc(FAC_CACHE.noms[f.resident_id] || 'Résident supprimé')}</div>
        <div style="font-size:12.5px;color:var(--brume);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          ${esc(f.numero || 'brouillon')}${f.periode ? ' · ' + esc(f.periode) : ''}</div>
      </div>
      <div style="text-align:right;flex:none">
        <div style="font-variant-numeric:tabular-nums;font-size:14px">${eur(f.total_ttc)}</div>
        <div style="font-size:11.5px;font-weight:600;margin-top:2px;color:${e.col}">${e.txt}</div>
      </div>
    </div>`;
}

function majListeFactures() {
  const box = $('#fac-liste');
  if (!box) return;
  const v = facVisibles();
  box.innerHTML = v.length
    ? v.map(facLigneListe).join('')
    : `<p class="muted" style="padding:18px">Aucune facture ne correspond.</p>`;
  const c = $('#fac-compte');
  if (c) c.textContent = v.length + (v.length > 1 ? ' factures' : ' facture');
}

window.ouvrirFacture = (id) => { FAC_SEL = id; vueFactures(); };
window.filtrerFactures = (k) => { FAC_FILTRE = k; FAC_SEL = null; vueFactures(); };
window.chercherFactures = (v) => { FAC_Q = v; majListeFactures(); };

async function facFiche(id) {
  const { facture: f } = await api('/api/factures/' + id);
  const { reglements } = await api('/api/reglements?resident_id=' + f.resident_id + exQSand())
    .catch(() => ({ reglements: [] }));

  const reste = facReste(f);
  const e = facEtat(f);
  const nom = FAC_CACHE.noms[f.resident_id] || 'Résident supprimé';
  const brouillon = f.statut === 'brouillon';
  const fige = ['avoir', 'annulee'].includes(f.statut);

  /* Le montant d'une ligne : le TTC stocke est la source de verite ;
     a defaut on le rededuit, comme le fait le PDF. */
  const ligneTtc = (l) => {
    const q = Number(l.quantite || 1);
    if (l.montant_ttc != null) return Number(l.montant_ttc);
    if (l.total_ttc != null) return Number(l.total_ttc);
    if (l.pu_ttc != null) return Number(l.pu_ttc) * q;
    return Number(l.pu_ht || 0) * q * (1 + Number(l.taux_tva || 0) / 100);
  };
  const pu = (l) => {
    const q = Number(l.quantite || 1) || 1;
    return l.pu_ttc != null ? Number(l.pu_ttc) : ligneTtc(l) / q;
  };

  const postes = (f.lignes || []).map((l) => `
    <div style="display:grid;grid-template-columns:1fr 68px 96px 108px;gap:12px;align-items:center;
                padding:0 18px;height:52px;border-bottom:1px solid var(--hairline)">
      <div style="font-size:13.5px;min-width:0">${esc(l.designation || '—')}</div>
      <div style="text-align:right;font-size:13px;color:var(--brume);font-variant-numeric:tabular-nums">${Number(l.quantite || 1)}</div>
      <div style="text-align:right;font-size:13px;color:var(--brume);font-variant-numeric:tabular-nums">${eur(pu(l))}</div>
      <div style="text-align:right;font-size:14px;font-variant-numeric:tabular-nums">${eur(ligneTtc(l))}</div>
    </div>`).join('') || '<p class="muted" style="padding:16px 18px;margin:0">Aucune ligne.</p>';

  /* Suivi : ce qui est arrive a cette facture, du plus recent au plus
     ancien. Les reglements sont lus dans leurs affectations : un
     encaissement peut couvrir plusieurs factures. */
  const suivi = [];
  for (const g of (reglements || [])) {
    for (const a of (g.affectations || [])) {
      if (!a || a.facture_id !== f.id) continue;
      suivi.push({ d: g.date_reglement, txt: `Règlement ${lib(g.mode) || esc(g.mode)} — ${eur(a.montant)}${g.reference ? ' · réf. ' + esc(g.reference) : ''}` });
    }
  }
  if (f.date_emission) suivi.push({ d: f.date_emission, txt: brouillon ? 'Brouillon créé' : 'Facture émise' });
  suivi.sort((a, b) => String(b.d).localeCompare(String(a.d)));

  const boutons = [];
  if (brouillon) {
    boutons.push(`<button class="btn btn-ghost btn-sm" data-act="editerLignesFacture" data-a1="${f.id}">Modifier les lignes</button>`);
    boutons.push(`<button class="btn btn-ghost btn-sm" data-act="supprimerBrouillon" data-a1="${f.id}">Supprimer</button>`);
    boutons.push(`<button class="btn btn-primary btn-sm" data-act="emettreFacture" data-a1="${f.id}">Émettre</button>`);
  } else {
    boutons.push(`<button class="btn btn-ghost btn-sm" data-act="pdfFacture" data-a1="${f.id}">PDF</button>`);
    if (!fige) boutons.push(`<button class="btn btn-ghost btn-sm" data-act="emailFacture" data-a1="${f.id}">E-mail</button>`);
    if (!fige) boutons.push(`<button class="btn btn-ghost btn-sm" data-act="faireAvoir" data-a1="${f.id}">Avoir</button>`);
    if (!fige && reste > 0.005) {
      boutons.push(`<button class="btn btn-primary btn-sm" data-act="encaisserFacture" data-a1="${f.id}" data-a2="${f.resident_id}" data-a3="${reste}" data-num="3">Encaisser</button>`);
    }
  }

  return `
    <div style="background:var(--carte);border-bottom:1px solid var(--hairline);padding:22px 26px 18px;
                display:flex;align-items:flex-start;gap:18px;flex-wrap:wrap">
      <div style="flex:1;min-width:240px">
        <h1 style="margin:0;font-size:24px;line-height:1.15">${esc(f.numero || 'Brouillon')}</h1>
        <div class="muted" style="font-size:13.5px;margin-top:4px">
          ${esc(nom)}${f.periode ? ' · période ' + esc(f.periode) : ''} · ${brouillon ? 'créé' : 'émise'} le ${dfr(f.date_emission)}
        </div>
        <div style="display:flex;gap:7px;margin-top:11px;flex-wrap:wrap">
          <span class="badge ${esc(f.statut)}">${lib(f.statut)}</span>
          ${reste > 0.005 ? `<span style="font-size:12.5px;font-weight:600;padding:3px 9px;border-radius:var(--r-s);background:var(--rouge-pale);color:var(--rouge)">${e.txt}</span>` : ''}
        </div>
      </div>
      <div style="flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:5px">
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">${boutons.join('')}</div>
        ${!brouillon && reste > 0.005
  ? '<div class="muted" style="font-size:12px">Le lettrage se fait tout seul.</div>'
  : brouillon ? '<div class="muted" style="font-size:12px">L\'émission attribue le numéro définitif.</div>' : ''}
      </div>
    </div>

    <div style="padding:20px 26px;display:flex;flex-direction:column;gap:16px">
      <div class="card" style="padding:0;overflow:hidden">
        <div style="display:grid;grid-template-columns:1fr 68px 96px 108px;gap:12px;padding:10px 18px;
                    border-bottom:1px solid var(--hairline);font-size:11px;font-weight:600;
                    letter-spacing:.08em;text-transform:uppercase;color:var(--brume)">
          <div>Poste</div><div style="text-align:right">Qté</div>
          <div style="text-align:right">PU</div><div style="text-align:right">Total</div>
        </div>
        ${postes}
        <div style="padding:14px 18px;display:flex;flex-direction:column;gap:6px;align-items:flex-end">
          <div style="display:flex;gap:26px;font-size:13px;color:var(--brume)"><span>Total HT</span><span style="font-variant-numeric:tabular-nums;min-width:92px;text-align:right">${eur(f.total_ht)}</span></div>
          <div style="display:flex;gap:26px;font-size:13px;color:var(--brume)"><span>TVA</span><span style="font-variant-numeric:tabular-nums;min-width:92px;text-align:right">${eur(f.total_tva)}</span></div>
          <div style="display:flex;gap:26px;font-size:15px;font-weight:600;align-items:baseline"><span>Total TTC</span><span style="font-variant-numeric:tabular-nums;min-width:92px;text-align:right;font-size:19px">${eur(f.total_ttc)}</span></div>
          <div style="display:flex;gap:26px;font-size:13px;color:var(--brume)"><span>Déjà réglé</span><span style="font-variant-numeric:tabular-nums;min-width:92px;text-align:right">${facEur(f.montant_regle)}</span></div>
          <div style="display:flex;gap:26px;font-size:13px;font-weight:600;color:${reste > 0.005 ? 'var(--rouge)' : 'var(--sapin)'}"><span>Reste dû</span><span style="font-variant-numeric:tabular-nums;min-width:92px;text-align:right">${facEur(reste)}</span></div>
        </div>
      </div>

      <div class="card" style="padding:0;overflow:hidden">
        <div style="padding:13px 18px;border-bottom:1px solid var(--hairline);font-size:14px;font-weight:600">Suivi</div>
        ${suivi.length ? suivi.map((s) => `
          <div style="display:grid;grid-template-columns:92px 1fr;gap:14px;align-items:center;
                      padding:0 18px;height:46px;border-bottom:1px solid var(--hairline)">
            <div style="font-size:12.5px;color:var(--brume);font-variant-numeric:tabular-nums">${dfr(s.d)}</div>
            <div style="font-size:13.5px">${s.txt}</div>
          </div>`).join('')
  : '<p class="muted" style="padding:16px 18px;margin:0">Rien à signaler pour l\'instant.</p>'}
      </div>
    </div>`;
}

async function vueFactures() {
  const mois = new Date().toISOString().slice(0, 7);
  const [{ factures }, resD] = await Promise.all([
    api('/api/factures' + exQS()),
    api('/api/residents').catch(() => ({ residents: [] })),
  ]);
  const noms = {};
  for (const r of (resD.residents || [])) {
    noms[r.id] = `${r.prenom ? r.prenom + ' ' : ''}${r.nom || ''}`.trim() || '—';
  }
  FAC_CACHE = { factures: factures || [], noms };

  const visibles = facVisibles();
  if (FAC_SEL && !FAC_CACHE.factures.some((f) => f.id === FAC_SEL)) FAC_SEL = null;
  if (!FAC_SEL && visibles.length) FAC_SEL = visibles[0].id;

  const compte = (k) => FAC_CACHE.factures.filter((FAC_FILTRES.find((x) => x[0] === k) || FAC_FILTRES[0])[2]).length;
  const puces = FAC_FILTRES.map(([k, l]) => {
    const n = compte(k);
    const on = k === FAC_FILTRE;
    return `<button data-act="filtrerFactures" data-a1="${k}"
      style="padding:4px 11px;border-radius:20px;font-size:12.5px;cursor:pointer;font-family:inherit;
             ${on ? 'background:var(--nuit);color:var(--ivoire);border:1px solid var(--nuit);font-weight:600'
  : 'background:transparent;color:#5D6E66;border:1px solid var(--hairline)'}">${l} ${n}</button>`;
  }).join('');

  $('#main').innerHTML = `
    <div class="page-head"><div><h1>Factures</h1></div>
      <div class="toolbar">
        <input id="fac-periode" type="month" value="${mois}">
        <button class="btn btn-ghost" data-act="formFacture">Nouvelle facture</button>
        <button class="btn btn-primary" data-act="runFacturation">Générer la facturation du mois</button>
      </div></div>

    <div class="card" style="padding:0;overflow:hidden;display:flex;align-items:stretch;min-height:560px">
      <div style="width:380px;flex:none;border-right:1px solid var(--hairline);display:flex;flex-direction:column;min-width:0">
        <div style="padding:16px 18px 13px;border-bottom:1px solid var(--hairline);display:flex;flex-direction:column;gap:11px">
          <input id="fac-q" data-act="chercherFactures" data-evt="input" data-a1="@value"
                 placeholder="Numéro, résident, période" value="${esc(FAC_Q)}" style="width:100%">
          <div style="display:flex;gap:6px;flex-wrap:wrap">${puces}</div>
          <div id="fac-compte" class="muted" style="font-size:12px">${visibles.length} facture${visibles.length > 1 ? 's' : ''}</div>
        </div>
        <div id="fac-liste" style="flex:1;overflow:auto"></div>
      </div>
      <div id="fac-fiche" style="flex:1;min-width:0;background:var(--ivoire)"></div>
    </div>`;

  majListeFactures();
  const fiche = $('#fac-fiche');
  if (!FAC_SEL) {
    fiche.innerHTML = `<p class="muted" style="padding:26px">${FAC_CACHE.factures.length
      ? 'Aucune facture dans ce filtre.'
      : 'Aucune facture. « Générer la facturation du mois » crée les brouillons du mois pour tous les résidents.'}</p>`;
    return;
  }
  fiche.innerHTML = '<p class="muted" style="padding:26px">Chargement…</p>';
  try { fiche.innerHTML = await facFiche(FAC_SEL); }
  catch (err) { fiche.innerHTML = `<p class="form-error" style="margin:26px">${esc(err.message)}</p>`; }
}

/* ---------- Messagerie (boîte de réception) ---------- */
async function vueMessagerie() {
  const { conversations } = await api('/api/messages/conversations').catch(() => ({ conversations: null }));
  $('#main').innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Échanges clients</div><h1>Messagerie</h1></div>
      <div class="toolbar">
        ${/* Le vert plein va a l'action courante. Ecrire a un resident se fait
             tous les jours ; diffuser a tout le camping quelques fois par an, et
             ne se rattrape pas. */ ''}
        <button class="btn btn-ghost" data-act="messageGroupe">Message à tous</button>
        <button class="btn btn-primary" data-act="messageRapide">Message à un résident</button>
      </div></div>
    ${conversations === null
      ? '<p class="form-error">Table « messages » absente — exécutez la migration db/11_echanges_carte_suivi.sql dans Supabase.</p>'
      : `<div class="card" style="padding:6px 0">
      ${conversations.length ? conversations.map((c) => `
        <div class="conv${c.non_lus ? ' unread' : ''}" data-act="ouvrirConversation" data-a1="${c.resident_id}">
          <div style="min-width:0">
            <div class="who">${esc(c.resident_nom)}</div>
            <div class="prev">${c.dernier_message.auteur === 'camping' ? 'Vous : ' : ''}${esc(c.dernier_message.corps)}</div>
          </div>
          <div class="conv-side">
            <span class="when">${new Date(c.dernier_message.date).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
            ${c.non_lus ? `<span class="pill-count">${c.non_lus}</span>` : ''}
          </div>
        </div>`).join('') : '<p class="muted" style="padding:18px 20px;margin:0">Aucune conversation. Les échanges apparaissent ici dès qu\u2019un client écrit depuis son portail, ou que vous écrivez depuis une fiche client.</p>'}
    </div>`}`;
}

window.ouvrirConversation = (residentId) => {
  window._openTab = 'messages';
  location.hash = '#/residents/' + residentId;
};

/* ---------- Compteurs (tournée de relevés) ---------- */
let COMPTEUR_TYPE = 'elec';   // fluide affiché : 'elec' | 'eau'

async function vueCompteurs() {
  const t = COMPTEUR_TYPE;
  const d = await api('/api/compteurs?type=' + t);
  d.emplacements.sort((a, b) => String(a.numero || '').localeCompare(String(b.numero || ''), undefined, { numeric: true, sensitivity: 'base' }));
  window._tourneeData = d.emplacements;
  window._tourneeUnite = d.unite;
  window._tourneeType = t;
  const prixOk = d.prix != null && d.prix > 0;
  const U = d.unite;

  /* Combien de compteurs restent à relever. « Jamais relevé » et « relevé
     il y a plus d'un mois » ne sont pas la même tournée : le premier est un
     compteur à initialiser, le second un compteur en retard. */
  const ilYAUnMois = new Date(Date.now() - 31 * 86400000);
  const cptRestants = { jamais: 0, retard: 0, ok: 0 };
  d.emplacements.forEach((e) => {
    if (!e.dernier_releve) cptRestants.jamais += 1;
    else if (new Date(e.dernier_releve.date_releve) < ilYAUnMois) cptRestants.retard += 1;
    else cptRestants.ok += 1;
  });
  const cptResume = [
    cptRestants.jamais ? cptRestants.jamais + ' jamais relevé' + (cptRestants.jamais > 1 ? 's' : '') : '',
    cptRestants.retard ? cptRestants.retard + ' en retard' : '',
    cptRestants.ok ? cptRestants.ok + ' à jour' : '',
  ].filter(Boolean).join(' · ');

  /* Un prix se saisit à quatre décimales (Paramètres, step 0.0001) : eur()
     arrondirait à deux et afficherait 0,39 € pour 0,3912 €. */
  const prixTexte = Number(d.prix || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  $('#main').innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Énergie &amp; eau</div><h1>Compteurs</h1></div>
      <div class="toolbar" style="align-items:center;gap:10px">
        <span class="muted">${prixOk
          ? `Prix du ${U} : <strong>${prixTexte} € TTC</strong> · TVA ${d.taux_tva} %`
          /* Le prix manquant s'annonce ICI, à la place du prix. Un <span> vide
             faisait glisser le bouton « Feuille de tournée » d'un onglet à
             l'autre, et l'information réapparaissait ailleurs. */
          : `<span style="color:var(--laiton)">Prix du ${U} non configuré</span>`}</span>
        <button class="btn btn-ghost btn-sm" data-act="imprimerTournee" title="Feuille papier pour relever sur le terrain">Feuille de tournée</button>
      </div></div>
    <div class="fiche-tabs" style="margin-bottom:14px">
      <button class="fiche-tab ${t === 'elec' ? 'active' : ''}" data-act="switchCompteurType" data-a1="elec">Électricité (kWh)</button>
      <button class="fiche-tab ${t === 'eau' ? 'active' : ''}" data-act="switchCompteurType" data-a1="eau">Eau (m³)</button>
      ${cptResume ? `<span class="muted" style="margin-left:14px;font-size:13px">${cptResume}</span>` : ''}
    </div>
    ${prixOk ? '' : `<p style="margin:0 0 14px;padding:11px 14px;border-radius:var(--r-s);
        background:var(--laiton-pale);border:1px solid rgba(185,138,60,.28);color:#7A5A22;font-size:13.5px;line-height:1.5">
        — Prix du ${U} non configuré. Les relevés sont bien enregistrés, mais aucune charge n\u2019est créée sur les fiches résidents.
        <a href="#/parametres" style="color:inherit;font-weight:600">Renseigner le prix dans Paramètres → Énergie &amp; eau</a>.</p>`}
    <div class="card"><table><thead><tr><th>Empl.</th><th>Résident</th><th>Dernier relevé</th><th class="right">Index</th><th class="right">Nouvel index</th><th></th></tr></thead>
    <tbody>${d.emplacements.map((e) => `
      <tr>
        <td><strong>${esc(e.numero)}</strong>${e.secteur ? ` <span class="muted">· ${esc(e.secteur)}</span>` : ''}</td>
        <td class="muted">${e.resident ? esc((e.resident.prenom || '') + ' ' + e.resident.nom) : '—'}</td>
        <td class="muted">${e.dernier_releve ? dfr(e.dernier_releve.date_releve) + (e.dernier_releve.conso_kwh != null ? ` <span class="badge occupe">${Number(e.dernier_releve.conso_kwh)} ${U}</span>` : '') : '<span class="badge emise">jamais relevé</span>'}</td>
        <td class="right">${e.dernier_releve ? Number(e.dernier_releve.index_kwh) : '—'}</td>
        <td class="right"><input type="number" step="0.01" min="0" id="idx-${e.id}" placeholder="${e.dernier_releve ? Number(e.dernier_releve.index_kwh) : 'index initial'}" style="width:132px;text-align:right"></td>
        <td class="right"><button class="btn btn-primary btn-sm" data-act="releverCompteur" data-a1="${e.id}">Relever</button></td>
      </tr>`).join('') || '<tr><td colspan="6" class="muted">Aucun emplacement.</td></tr>'}</tbody></table></div>
    <p class="muted" style="margin-top:12px">Un relevé crée automatiquement une charge « en cours » sur la fiche du résident rattaché (conso × prix du ${U}) — à facturer depuis sa fiche. Chaque fluide a sa propre série d\u2019index.</p>`;
}

window.switchCompteurType = (t) => { COMPTEUR_TYPE = t === 'eau' ? 'eau' : 'elec'; vueCompteurs(); };

window.releverCompteur = async (empId) => {
  const input = $('#idx-' + empId);
  const v = input.value;
  if (v === '' || Number(v) < 0) { toast('Saisis le nouvel index', true); input.focus(); return; }
  try {
    const r = await api('/api/compteurs/releve', { method: 'POST', body: { emplacement_id: empId, index_kwh: Number(v), type: COMPTEUR_TYPE } });
    if (r.alerte) toast(r.alerte, true);
    else if (r.prestation) toast(`Relevé enregistré — charge de ${eur(r.prestation.montant_ttc)} créée (${Number(r.releve.conso_kwh)} ${r.unite})`);
    else toast(r.info || 'Relevé enregistré');
    route();
  } catch (err) { toast(err.message, true); }
};

window.imprimerTournee = () => {
  const emps = window._tourneeData || [];
  if (!emps.length) { toast('Aucun emplacement', true); return; }
  const nom = (CAMPINGS.find((c) => c.camping_id === ACTIVE_CAMPING) || {}).nom || 'Camping';
  const dateStr = new Date().toLocaleDateString('fr-FR');
  const w = window.open('', '_blank', 'width=900,height=800');
  if (!w) { toast('Autorise les pop-ups pour imprimer', true); return; }
  w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Tournée ${window._tourneeType === 'eau' ? 'eau' : 'électricité'} — ${esc(nom)}</title>
    <style>
      @page{size:A4 portrait;margin:12mm}
      body{margin:0;font-family:system-ui,-apple-system,sans-serif;color:#2b2b26;font-size:12px}
      h1{font-size:16px;margin:0 0 2px}
      .dt{color:#777;margin-bottom:12px}
      table{width:100%;border-collapse:collapse}
      th,td{border:1px solid #cfc8b6;padding:6px 8px;text-align:left}
      th{background:#f2eee2;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
      td.num{text-align:right}
      td.saisie{width:110px}
      tr{page-break-inside:avoid}
    </style></head><body>
    <h1>${esc(nom)} — tournée ${window._tourneeType === 'eau' ? 'compteurs d\u2019eau (m³)' : 'compteurs électriques (kWh)'}</h1>
    <div class="dt">Édition du ${dateStr} — relevé par : ______________________</div>
    <table><thead><tr><th>Empl.</th><th>Résident</th><th>Dernier relevé</th><th>Ancien index</th><th>Nouvel index</th><th>Observations</th></tr></thead>
    <tbody>${emps.map((e) => `<tr>
      <td><strong>${esc(e.numero)}</strong>${e.secteur ? ` · ${esc(e.secteur)}` : ''}</td>
      <td>${e.resident ? esc((e.resident.prenom || '') + ' ' + e.resident.nom) : '—'}</td>
      <td>${e.dernier_releve ? new Date(e.dernier_releve.date_releve).toLocaleDateString('fr-FR') : 'jamais'}</td>
      <td class="num">${e.dernier_releve ? Number(e.dernier_releve.index_kwh) : '—'}</td>
      <td class="saisie"></td><td></td>
    </tr>`).join('')}</tbody></table>
  </body></html>`);
  w.document.close();
  w.onload = () => { try { w.focus(); w.print(); } catch (_) {} };
};

/* ---------- Administration : comptes, droits, journal ---------- */
let ADMIN_DROITS = null;   // référentiel (libellés + matrice par rôle)

async function vueAdministration() {
  const [{ utilisateurs }, ref] = await Promise.all([
    api('/api/admin/utilisateurs'),
    ADMIN_DROITS ? Promise.resolve(ADMIN_DROITS) : api('/api/admin/droits'),
  ]);
  ADMIN_DROITS = ref;
  const LIB = ref.libelles;

  const puces = (d) => ref.droits.filter((k) => d[k] && k !== 'admin')
    .map((k) => `<span class="ptype vente" style="margin:2px 3px 2px 0">${esc(LIB[k])}</span>`).join('') || '<span class="muted">Lecture seule</span>';

  $('#main').innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">Administration</div><h1>Comptes &amp; activité</h1></div>
      <button class="btn btn-primary" data-act="formUtilisateur">Ajouter un compte</button>
    </div>

    <div class="fiche-tabs">
      <button class="fiche-tab active" data-tab="comptes" data-act="switchFicheTab" data-a1="comptes">Comptes (${utilisateurs.length})</button>
      <button class="fiche-tab" data-tab="moyens" data-act="ouvrirOngletParam" data-a1="moyens">Moyens de paiement</button>
      <button class="fiche-tab" data-tab="journal" data-act="ouvrirOngletParam" data-a1="journal">Journal d'activité</button>
      <button class="fiche-tab" data-tab="fiscal" data-act="ouvrirOngletParam" data-a1="fiscal">Conformité fiscale</button>
      <button class="fiche-tab" data-tab="rgpd" data-act="ouvrirOngletParam" data-a1="rgpd">RGPD</button>
    </div>

    <section data-panel="rgpd" class="hidden">
      <div id="rgpd-body"><p class="muted">Chargement…</p></div>
    </section>

    <section data-panel="fiscal" class="hidden">
      <div id="fiscal-body"><p class="muted">Chargement…</p></div>
    </section>

    <section data-panel="moyens" class="hidden">
      <div class="card">
        <div class="card-actions">
          <div>
            <h2 style="margin:0">Moyens de paiement</h2>
            <p class="muted" style="margin:4px 0 0">Un moyen « remisable » (chèques, ANCV) apparaît dans les remises en banque, avec son propre bordereau.</p>
          </div>
          <button class="btn btn-primary btn-sm" data-act="formMoyen">Ajouter un moyen</button>
        </div>
        <div id="moyens-body" style="margin-top:12px"><p class="muted">Chargement…</p></div>
      </div>
    </section>

    <section data-panel="comptes">
      <div class="card">
        <h2>Accès à cet espace</h2>
        <p class="muted" style="margin-top:2px">Les droits ci-dessous ne valent que pour le camping actif. Un même compte peut avoir des droits différents sur un autre camping.</p>
        <table style="margin-top:12px"><thead><tr><th>Compte</th><th>Rôle</th><th>Droits</th><th></th></tr></thead>
        <tbody>${utilisateurs.map((u) => `
          <tr>
            <td><strong>${esc((u.prenom || '') + ' ' + (u.nom || ''))}</strong>${u.est_moi ? ' <span class="badge reglee">vous</span>' : ''}
              <div class="muted">${esc(u.email || '')}</div></td>
            <td><span class="badge ${u.role === 'admin' ? 'reglee' : 'occupe'}">${esc(u.role)}</span></td>
            <td style="max-width:340px">${puces(u.droits)}</td>
            <td class="right">
              <button class="btn btn-ghost btn-sm" data-act="formUtilisateur" data-a1="${u.id}">Modifier</button>
              ${u.est_moi ? '' : `<button class="btn btn-ghost btn-sm" data-act="retirerAcces" data-a1="${u.id}" data-a2="${esc((u.prenom || '') + ' ' + (u.nom || ''))}">Retirer</button>`}
            </td>
          </tr>`).join('')}</tbody></table>
      </div>
    </section>

    <section data-panel="journal" class="hidden">
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:10px">
          <div>
            <h2 style="margin:0">Journal d'activité</h2>
            <p class="muted" style="margin:4px 0 0">Toutes les opérations sont horodatées et conservées : qui a fait quoi, quand, depuis quelle adresse IP.</p>
          </div>
          <div class="toolbar">
            <label style="text-transform:none;letter-spacing:0;font-size:11px">Du<input type="date" id="j-debut"></label>
            <label style="text-transform:none;letter-spacing:0;font-size:11px">Au<input type="date" id="j-fin"></label>
            <select id="j-entite" style="width:auto"><option value="">Tout</option>
              <option value="reglements">Encaissements</option>
              <option value="factures">Factures</option>
              <option value="prestations">Prestations</option>
              <option value="residents">Résidents</option>
              <option value="user_campings">Accès utilisateurs</option>
            </select>
            <button class="btn btn-ghost btn-sm" data-act="chargerJournal">Filtrer</button>
            <button class="btn btn-primary btn-sm" data-act="exportJournal">Export fisc (CSV)</button>
          </div>
        </div>
        <div id="journal-body" style="margin-top:14px"><p class="muted">Chargement…</p></div>
      </div>
    </section>`;
}

const TYPES_MOYEN = { espece: 'Espèces', cheque: 'Chèque', virement: 'Virement', carte: 'Carte', ancv: 'ANCV', autre: 'Autre' };

window.chargerMoyens = async () => {
  const box = $('#moyens-body');
  if (!box) return;
  box.innerHTML = '<p class="muted">Chargement…</p>';
  try {
    const { moyens, migration_manquante } = await api('/api/moyens-paiement?tous=1');
    if (migration_manquante) {
      box.innerHTML = '<p class="form-error">Table « moyens_paiement » absente — exécutez la migration db/07_catalogue_facturation.sql dans Supabase.</p>';
      return;
    }
    box.innerHTML = moyens.length ? `
      <table><thead><tr><th>Libellé</th><th>Code</th><th>Type</th><th>Compte</th><th>Remisable</th><th>Statut</th><th></th></tr></thead>
      <tbody>${moyens.map((m) => `
        <tr${m.actif ? '' : ' style="opacity:.55"'}>
          <td><strong>${esc(m.libelle)}</strong></td>
          <td class="muted"><code>${esc(m.code)}</code></td>
          <td class="muted">${esc(TYPES_MOYEN[m.type] || m.type)}</td>
          <td class="muted">${esc(m.compte_comptable || '—')}</td>
          <td>${m.remisable ? '<span class="badge reglee">bordereau</span>' : '<span class="muted">—</span>'}</td>
          <td>${m.actif ? '<span class="badge libre">actif</span>' : '<span class="badge indisponible">inactif</span>'}</td>
          <td class="right">
            <button class="btn btn-ghost btn-sm" data-act="formMoyen" data-a1="${m.id}">Modifier</button>
            ${m.actif ? `<button class="btn btn-ghost btn-sm" data-act="retirerMoyen" data-a1="${m.id}" data-a2="${esc(m.libelle)}">Désactiver</button>` : ''}
          </td>
        </tr>`).join('')}</tbody></table>`
      : '<p class="muted">Aucun moyen de paiement. Ajoute-en un.</p>';
  } catch (e) { box.innerHTML = `<p class="form-error">${esc(e.message)}</p>`; }
};

window.formMoyen = async (id) => {
  let m = null;
  if (id) {
    const { moyens } = await api('/api/moyens-paiement?tous=1');
    m = moyens.find((x) => x.id === id);
    if (!m) { toast('Moyen introuvable', true); return; }
  }
  openDrawer(`
    <h2>${m ? 'Modifier le moyen' : 'Nouveau moyen de paiement'}</h2>
    ${m ? `<p class="muted" style="margin-top:4px">Code <code>${esc(m.code)}</code> — non modifiable (il est inscrit dans l'historique des règlements).</p>` : ''}
    <form id="f-moyen" class="form-grid" style="margin-top:14px">
      <label class="full">Libellé *<input name="libelle" required value="${esc(m?.libelle || '')}" placeholder="Chèques-vacances ANCV"></label>
      <label>Type
        <select name="type">${Object.entries(TYPES_MOYEN).map(([k, v]) => `<option value="${k}"${m?.type === k ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
      <label>Compte comptable<input name="compte_comptable" value="${esc(m?.compte_comptable || '')}" placeholder="511500"></label>
      <label class="full" style="flex-direction:row;align-items:center;gap:10px;text-transform:none;letter-spacing:0;font-size:14px;font-weight:500;color:var(--encre)">
        <input type="checkbox" name="remisable" ${m?.remisable ? 'checked' : ''} style="width:auto">
        Se remet en banque (bordereau dédié)</label>
      ${m ? `<label class="full" style="flex-direction:row;align-items:center;gap:10px;text-transform:none;letter-spacing:0;font-size:14px;font-weight:500;color:var(--encre)">
        <input type="checkbox" name="actif" ${m.actif ? 'checked' : ''} style="width:auto">
        Actif (proposé à l'encaissement)</label>` : ''}
      <div class="full"><button class="btn btn-primary btn-block">${m ? 'Enregistrer' : 'Créer le moyen'}</button></div>
    </form>`);

  $('#f-moyen').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      libelle: fd.get('libelle'),
      type: fd.get('type'),
      compte_comptable: fd.get('compte_comptable') || null,
      remisable: fd.get('remisable') === 'on',
    };
    if (m) body.actif = fd.get('actif') === 'on';
    try {
      if (m) await api(`/api/moyens-paiement/${m.id}`, { method: 'PUT', body });
      else await api('/api/moyens-paiement', { method: 'POST', body });
      closeDrawer();
      toast(m ? 'Moyen mis à jour' : 'Moyen de paiement créé');
      chargerMoyens();
    } catch (err) { toast(err.message, true); }
  });
};

window.retirerMoyen = async (id, libelle) => {
  if (!await askConfirm(`Désactiver « ${libelle} » ? Il ne sera plus proposé à l'encaissement. L'historique est conservé.`)) return;
  try {
    const r = await api(`/api/moyens-paiement/${id}`, { method: 'DELETE' });
    toast(r.message || (r.supprime ? 'Moyen supprimé' : 'Moyen désactivé'));
    chargerMoyens();
  } catch (e) { toast(e.message, true); }
};

window.chargerRgpd = async () => {
  const box = $('#rgpd-body');
  if (!box) return;
  box.innerHTML = '<p class="muted">Chargement…</p>';
  try {
    const d = await api('/api/rgpd/etat');
    box.innerHTML = `
      <div class="card">
        <div class="card-actions">
          <div>
            <h2 style="margin:0">Protection des données personnelles</h2>
            <p class="muted" style="margin:4px 0 0">Règlement (UE) 2016/679. Le registre des traitements (art. 30) est obligatoire et doit être présentable à la CNIL.</p>
          </div>
          <button class="btn btn-primary btn-sm" data-act="registreRgpd">Registre des traitements</button>
        </div>
        <div class="kpis" style="margin-top:14px">
          <div class="kpi"><div class="v">${d.anonymises}</div><div class="l">Résidents anonymisés</div></div>
          <div class="kpi ${d.candidats_purge.length ? 'warn' : ''}"><div class="v">${d.candidats_purge.length}</div><div class="l">À anonymiser (conservation dépassée)</div></div>
          <div class="kpi"><div class="v">${d.demandes.length}</div><div class="l">Demandes de droits</div></div>
          <div class="kpi ${d.violations.length ? 'bad' : ''}"><div class="v">${d.violations.length}</div><div class="l">Violations enregistrées</div></div>
        </div>
      </div>

      <div class="card">
        <h2>Durée de conservation dépassée</h2>
        <p class="muted" style="margin-top:2px">Résidents inactifs depuis plus de ${d.durees.resident_inactif_ans} ans (avant le ${dfr(d.seuil_purge)}). Le RGPD impose de ne pas conserver les données au-delà du nécessaire.</p>
        ${d.candidats_purge.length ? `<table style="margin-top:12px"><thead><tr><th>Résident</th><th>Inactif depuis</th><th></th></tr></thead>
        <tbody>${d.candidats_purge.map((r) => `<tr>
          <td><strong>${esc(r.nom)}</strong></td>
          <td class="muted">${dfr(r.inactif_depuis)}</td>
          <td class="right"><button class="btn btn-ghost btn-sm" data-act="anonymiserResident" data-a1="${r.id}" data-a2="${esc(r.nom)}">Anonymiser</button></td>
        </tr>`).join('')}</tbody></table>`
        : '<p class="muted" style="margin-top:10px">Aucun résident à anonymiser. ✓</p>'}
      </div>

      <div class="card">
        <div class="card-actions">
          <div>
            <h2 style="margin:0">Registre des violations de données</h2>
            <p class="muted" style="margin:4px 0 0">Une violation présentant un risque doit être notifiée à la CNIL sous <strong>72 heures</strong> (art. 33).</p>
          </div>
          <button class="btn btn-ghost btn-sm" data-act="formViolation">Déclarer une violation</button>
        </div>
        ${d.violations.length ? `<table style="margin-top:12px"><thead><tr><th>Date</th><th>Nature</th><th>Description</th><th class="right">Personnes</th><th>CNIL</th></tr></thead>
        <tbody>${d.violations.map((v) => `<tr>
          <td class="muted">${dfr(v.date_incident)}</td>
          <td>${esc(v.nature)}</td>
          <td class="muted" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v.description)}</td>
          <td class="right">${v.personnes_touchees ?? '—'}</td>
          <td>${v.cnil_notifiee ? '<span class="badge reglee">notifiée</span>' : '<span class="badge en_retard">non notifiée</span>'}</td>
        </tr>`).join('')}</tbody></table>`
        : '<p class="muted" style="margin-top:10px">Aucune violation enregistrée.</p>'}
      </div>

      ${d.demandes.length ? `<div class="card">
        <h2>Demandes d'exercice de droits</h2>
        <table style="margin-top:10px"><thead><tr><th>Date</th><th>Type</th><th>Origine</th><th>Statut</th></tr></thead>
        <tbody>${d.demandes.map((x) => `<tr>
          <td class="muted">${new Date(x.created_at).toLocaleString('fr-FR')}</td>
          <td>${esc(x.type)}</td><td class="muted">${esc(x.origine)}</td>
          <td><span class="badge ${x.statut === 'traitee' ? 'reglee' : 'emise'}">${esc(x.statut)}</span></td>
        </tr>`).join('')}</tbody></table></div>` : ''}`;
  } catch (e) { box.innerHTML = `<p class="form-error">${esc(e.message)}</p>`; }
};

window.registreRgpd = () => telechargerExport('/api/rgpd/registre.pdf', 'registre_traitements_rgpd.pdf');

window.exportDonneesResident = (id, nom) => {
  telechargerExport(`/api/rgpd/resident/${id}/export`, `donnees_${(nom || 'resident').replace(/[^a-zA-Z0-9]/g, '_')}.json`);
  toast('Export des données généré (droit d\u2019accès)');
};

window.anonymiserResident = async (id, nom) => {
  const ok = await askPrompt(
    `ANONYMISER « ${nom} » ?\n\n`
    + `Seront DÉFINITIVEMENT effacés : identité, coordonnées, documents (pièces d'identité…), messages.\n\n`
    + `Seront CONSERVÉS : factures et encaissements — obligation légale de conservation `
    + `(10 ans comptable, 6 ans fiscal ; art. 17.3.b du RGPD).\n\n`
    + `Cette action est IRRÉVERSIBLE. Tape ANONYMISER pour confirmer :`);
  if (ok !== 'ANONYMISER') { if (ok !== null) toast('Confirmation incorrecte — annulé', true); return; }
  try {
    const r = await api(`/api/rgpd/resident/${id}/anonymiser`, { method: 'POST', body: { confirmation: 'ANONYMISER' } });
    toast(r.message || 'Résident anonymisé');
    route();
  } catch (e) { toast(e.message, true); }
};

window.formViolation = () => {
  openDrawer(`
    <h2>Déclarer une violation de données</h2>
    <p class="muted" style="margin-top:4px">Perte, vol, accès non autorisé, divulgation, destruction… À notifier à la CNIL sous 72 h si risque pour les personnes.</p>
    <form id="f-viol" class="form-grid" style="margin-top:14px">
      <label>Date de l'incident *<input name="date_incident" type="datetime-local" required></label>
      <label>Nature
        <select name="nature">
          <option value="confidentialite">Confidentialité (divulgation, accès non autorisé)</option>
          <option value="integrite">Intégrité (altération)</option>
          <option value="disponibilite">Disponibilité (perte, destruction)</option>
        </select></label>
      <label class="full">Description *<textarea name="description" rows="3" required style="width:100%"></textarea></label>
      <label>Personnes touchées<input name="personnes_touchees" type="number" min="0"></label>
      <label>Données concernées<input name="donnees_touchees" placeholder="identité, e-mails…"></label>
      <label class="full">Conséquences probables<input name="consequences"></label>
      <label class="full">Mesures prises<input name="mesures"></label>
      <label class="full" style="flex-direction:row;align-items:center;gap:10px;text-transform:none;letter-spacing:0;font-size:14px;font-weight:500;color:var(--encre)">
        <input type="checkbox" name="cnil_notifiee" style="width:auto"> CNIL notifiée</label>
      <label class="full" style="flex-direction:row;align-items:center;gap:10px;text-transform:none;letter-spacing:0;font-size:14px;font-weight:500;color:var(--encre)">
        <input type="checkbox" name="personnes_informees" style="width:auto"> Personnes concernées informées</label>
      <div class="full"><button class="btn btn-primary btn-block">Enregistrer au registre</button></div>
    </form>`);
  $('#f-viol').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const body = Object.fromEntries(f.entries());
    body.cnil_notifiee = f.get('cnil_notifiee') === 'on';
    body.personnes_informees = f.get('personnes_informees') === 'on';
    try {
      const r = await api('/api/rgpd/violations', { method: 'POST', body });
      closeDrawer();
      toast(r.rappel || 'Violation enregistrée au registre', !!r.rappel);
      chargerRgpd();
    } catch (err) { toast(err.message, true); }
  });
};

window.chargerFiscal = async () => {
  const box = $('#fiscal-body');
  if (!box) return;
  box.innerHTML = '<p class="muted">Vérification de la chaîne…</p>';
  try {
    const { chaine, clotures, cumul_perpetuel } = await api('/api/fiscal/etat');
    const mois = new Date().toISOString().slice(0, 7);
    const hier = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    box.innerHTML = `
      <div class="card">
        <div class="card-actions">
          <div>
            <h2 style="margin:0">Inaltérabilité des données</h2>
            <p class="muted" style="margin:4px 0 0">Loi anti-fraude TVA — article 286-I-3° bis du CGI. Chaque facture, avoir et encaissement est chaîné par empreinte SHA-256.</p>
          </div>
          <button class="btn btn-primary btn-sm" data-act="attestationFiscale">Attestation de conformité</button>
        </div>

        <div class="kpis" style="margin-top:14px">
          <div class="kpi ${chaine.integre ? '' : 'bad'}">
            <div class="v">${chaine.integre ? 'Intègre' : 'ROMPUE'}</div>
            <div class="l">État de la chaîne</div></div>
          <div class="kpi"><div class="v">${chaine.enregistrements}</div><div class="l">Enregistrements scellés</div></div>
          <div class="kpi"><div class="v">${eur(cumul_perpetuel)}</div><div class="l">Cumul perpétuel</div></div>
          <div class="kpi"><div class="v">${clotures.length}</div><div class="l">Clôtures archivées</div></div>
        </div>

        ${chaine.integre
          ? `<p class="muted" style="margin-top:6px">Aucune anomalie. Empreinte finale : <code style="font-size:11px">${esc(chaine.empreinte_finale.slice(0, 32))}…</code></p>`
          : `<div class="card" style="background:var(--rouge-pale);border-color:#E4C4BC;margin-top:12px">
              <h2 style="color:var(--rouge);margin:0 0 8px">⚠ Anomalies détectées</h2>
              <ul class="list-tight">${chaine.anomalies.slice(0, 10).map((a) => `<li><span>N° ${a.seq} — ${esc(a.type)}</span><span class="muted">${esc(a.message)}</span></li>`).join('')}</ul>
              <p class="muted" style="margin:8px 0 0">Une donnée fiscale a été modifiée ou supprimée hors du logiciel. Conserve cette information : elle doit être signalée en cas de contrôle.</p>
            </div>`}
      </div>

      <div class="card">
        <div class="card-actions">
          <div>
            <h2 style="margin:0">Clôtures &amp; archivage</h2>
            <p class="muted" style="margin:4px 0 0">Une clôture est <strong>définitive</strong> : elle fige les totaux de la période et alimente le cumul perpétuel. La clôture journalière est automatique.</p>
          </div>
          <div class="toolbar">
            <select id="clot-type" style="width:auto">
              <option value="journaliere">Journalière</option>
              <option value="mensuelle" selected>Mensuelle</option>
              <option value="annuelle">Annuelle</option>
            </select>
            <input id="clot-periode" value="${mois}" style="width:130px" placeholder="2026-07">
            <button class="btn btn-ghost btn-sm" data-act="lancerCloture">Clôturer</button>
            <button class="btn btn-ghost btn-sm" data-act="archiveFiscale">Archive (JSON)</button>
          </div>
        </div>
        ${clotures.length ? `<table style="margin-top:12px"><thead><tr><th>Type</th><th>Période</th><th class="right">Factures</th><th class="right">Encaissements</th><th class="right">CA TTC</th><th class="right">Encaissé</th><th class="right">Cumul perpétuel</th><th>Scellée le</th></tr></thead>
        <tbody>${clotures.map((c) => `<tr>
          <td><span class="ptype ${c.type === 'annuelle' ? 'caution' : c.type === 'mensuelle' ? 'sejour' : 'charge'}">${esc(c.type)}</span></td>
          <td><strong>${esc(c.periode)}</strong></td>
          <td class="right">${c.nb_factures}</td>
          <td class="right">${c.nb_reglements}</td>
          <td class="right">${eur(c.total_ttc)}</td>
          <td class="right">${eur(c.total_encaisse)}</td>
          <td class="right"><strong>${eur(c.cumul_perpetuel)}</strong></td>
          <td class="muted" style="font-size:12px">${new Date(c.horodatage).toLocaleString('fr-FR')}</td>
        </tr>`).join('')}</tbody></table>`
        : '<p class="muted" style="margin-top:12px">Aucune clôture. La première clôture journalière sera créée automatiquement, ou lance-la manuellement ci-dessus.</p>'}
        <p class="muted" style="margin-top:10px">Format de période : <code>2026-07-11</code> (journalière), <code>2026-07</code> (mensuelle), <code>2026</code> (annuelle).</p>
      </div>`;
  } catch (e) { box.innerHTML = `<p class="form-error">${esc(e.message)}</p>`; }
};

window.idxApercu = async () => {
  const taux = Number($('#idx-taux').value);
  if (!Number.isFinite(taux) || taux === 0) { toast('Saisissez un taux d\u2019indexation, par exemple 3,26 pour +3,26 %. Un taux de zéro ne changerait aucun loyer.', true); return; }
  const zone = $('#idx-zone'); zone.innerHTML = '<span class="muted">Calcul&hellip;</span>';
  try {
    const { loyers, modeles } = await api('/api/indexation/apercu?taux=' + encodeURIComponent(taux));
    const concernes = loyers.filter((x) => x.avant > 0);
    if (!concernes.length && !modeles.length) { zone.innerHTML = '<span class="muted">Aucun loyer configuré à indexer.</span>'; return; }
    const srcLib = { fiche: 'fiche', modele: 'modèle', contrat: 'contrat' };
    zone.innerHTML = `
      ${modeles.length ? `<p style="margin:0 0 6px"><strong>Modèles partagés</strong> — les résidents qui les suivent sont revalorisés automatiquement :</p>
      <table style="margin-bottom:12px"><thead><tr><th>Modèle</th><th class="right">Avant</th><th class="right">Après</th></tr></thead>
      <tbody>${modeles.map((m) => `<tr><td>${esc(m.nom)}</td><td class="right">${eur(m.avant)}</td><td class="right"><strong>${eur(m.apres)}</strong></td></tr>`).join('')}</tbody></table>` : ''}
      <table><thead><tr><th>Résident</th><th>Empl.</th><th>Source</th><th class="right">Avant</th><th class="right">Après</th></tr></thead>
      <tbody>${concernes.map((x) => `<tr>
        <td><a href="#/residents/${x.resident_id}" style="color:inherit">${esc(x.nom)}</a></td>
        <td class="muted">${esc(x.emplacement || '—')}</td>
        <td class="muted">${srcLib[x.source] || x.source}${x.modele_nom ? ' · ' + esc(x.modele_nom) : ''}</td>
        <td class="right">${eur(x.avant)}</td>
        <td class="right"><strong>${eur(x.apres)}</strong></td>
      </tr>`).join('')}</tbody></table>
      <div style="margin-top:12px;text-align:right">
        <button class="btn btn-primary" data-act="idxAppliquer" data-a1="${taux}" data-num="1">Appliquer +${taux} % à ${concernes.filter((x) => x.source !== 'modele').length + modeles.length} loyer(s)/modèle(s)</button>
      </div>`;
  } catch (e) { zone.innerHTML = `<span class="bad">${esc(e.message || 'Erreur')}</span>`; }
};

window.idxAppliquer = async (taux) => {
  const ref = $('#idx-ref') ? $('#idx-ref').value.trim() : '';
  if (!await askConfirm(`Appliquer +${taux} % à tous les loyers ?\nLes fiches et modèles sont mis à jour immédiatement ; la prochaine facturation mensuelle utilisera les nouveaux montants. Cette campagne sera journalisée${ref ? ' (' + ref + ')' : ''}.`, { titre: 'Indexer les loyers', ok: 'Appliquer' })) return;
  try {
    const r = await api('/api/indexation', { method: 'POST', body: { taux, reference: ref || null } });
    toast(`Indexation appliquée : ${r.nb_loyers} loyer(s) et ${r.nb_modeles} modèle(s) revalorisés`);
    $('#idx-zone').innerHTML = ''; idxHisto();
  } catch (e) { toast(e.message || 'Erreur', true); }
};

window.idxHisto = async () => {
  const zone = $('#idx-histo'); if (!zone) return;
  try {
    const { indexations } = await api('/api/indexation/historique');
    zone.innerHTML = indexations.length
      ? `<table><thead><tr><th>Date</th><th>Taux</th><th>Référence</th><th class="right">Loyers</th><th class="right">Modèles</th></tr></thead>
        <tbody>${indexations.map((i) => `<tr><td>${dfr(i.created_at)}</td><td>+${Number(i.taux)} %</td><td class="muted">${esc(i.reference || '—')}</td><td class="right">${i.nb_loyers}</td><td class="right">${i.nb_modeles}</td></tr>`).join('')}</tbody></table>`
      : '<span class="muted">Aucune campagne pour le moment.</span>';
  } catch (e) { zone.innerHTML = `<span class="bad">${esc(e.message || 'Erreur')}</span>`; }
};

window.lancerCloture = async () => {
  const type = $('#clot-type').value;
  const periode = $('#clot-periode').value.trim();
  if (!periode) { toast('Indique la période', true); return; }
  if (!await askConfirm(`Clôturer la période ${periode} ?\n\nUne clôture est DÉFINITIVE : les totaux sont figés et scellés, elle ne pourra pas être annulée.`)) return;
  try {
    const r = await api('/api/fiscal/cloturer', { method: 'POST', body: { type, periode } });
    toast(`Période ${periode} clôturée — ${eur(r.cloture.total_ttc)} scellés`);
    chargerFiscal();
  } catch (e) { toast(e.message, true); }
};

window.attestationFiscale = () => {
  telechargerExport('/api/fiscal/attestation.pdf', 'attestation_conformite_locamp.pdf');
};

window.archiveFiscale = () => {
  const fin = new Date().toISOString().slice(0, 10);
  telechargerExport(`/api/fiscal/archive?debut=2000-01-01&fin=${fin}`, `archive_fiscale_${fin}.json`);
};

window.chargerJournal = async () => {
  const p = new URLSearchParams();
  const d = $('#j-debut')?.value, f = $('#j-fin')?.value, e = $('#j-entite')?.value;
  if (d) p.set('debut', d);
  if (f) p.set('fin', f);
  if (e) p.set('entite', e);
  const box = $('#journal-body');
  if (!box) return;
  box.innerHTML = '<p class="muted">Chargement…</p>';
  try {
    const { entrees, limite } = await api('/api/admin/journal?' + p.toString());
    box.innerHTML = entrees.length ? `
      <table><thead><tr><th>Date &amp; heure</th><th>Auteur</th><th>Opération</th><th>Détail</th><th>IP</th></tr></thead>
      <tbody>${entrees.map((x) => `
        <tr>
          <td style="white-space:nowrap">${new Date(x.horodatage).toLocaleString('fr-FR')}</td>
          <td>${esc(x.auteur_email || '—')}</td>
          <td><span class="ptype ${x.entite === 'reglements' ? 'sejour' : 'charge'}">${esc(x.entite_lib || '—')}</span> <span class="muted">${esc(x.action_lib)}</span></td>
          <td class="muted" style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(resumeAudit(x))}</td>
          <td class="muted">${esc(x.ip || '—')}</td>
        </tr>`).join('')}</tbody></table>
      ${entrees.length >= limite ? `<p class="muted" style="margin-top:10px">${limite} dernières entrées affichées — affine les dates ou exporte en CSV pour tout voir.</p>` : ''}`
      : '<p class="muted">Aucune opération sur cette période.</p>';
  } catch (err) { box.innerHTML = `<p class="form-error">${esc(err.message)}</p>`; }
};

function resumeAudit(x) {
  const a = x.apres || x.avant || {};
  if (x.entite === 'reglements' && a.montant != null) return `${a.montant} € — ${a.mode || ''} ${a.reference || ''}`.trim();
  if (a.numero) return a.numero;
  if (a.nom || a.email) return `${a.nom || ''} ${a.email || ''}`.trim();
  if (a.role) return `rôle : ${a.role}`;
  if (a.lignes != null) return `${a.lignes} ligne(s)`;
  return x.entite_id ? x.entite_id.slice(0, 8) + '…' : '—';
}

window.exportJournal = () => {
  const d = $('#j-debut')?.value || '2000-01-01';
  const f = $('#j-fin')?.value || new Date().toISOString().slice(0, 10);
  const url = `/api/admin/journal/export?debut=${d}&fin=${f}`;
  fetch(API + url, { headers: { Authorization: 'Bearer ' + TOKEN, 'x-camping-id': ACTIVE_CAMPING } })
    .then((r) => { if (!r.ok) throw new Error('Export refusé'); return r.blob(); })
    .then((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `journal_activite_${d}_${f}.csv`;
      a.click(); URL.revokeObjectURL(a.href);
      toast('Journal exporté');
    })
    .catch((e) => toast(e.message, true));
};

window.formUtilisateur = async (userId) => {
  const ref = ADMIN_DROITS || await api('/api/admin/droits');
  ADMIN_DROITS = ref;
  let u = null;
  if (userId) {
    const { utilisateurs } = await api('/api/admin/utilisateurs');
    u = utilisateurs.find((x) => x.id === userId);
    if (!u) { toast('Compte introuvable', true); return; }
  }
  const role = u?.role || 'gestionnaire';

  const casesDroits = (r) => ref.droits.map((d) => {
    const parRole = ref.droits_par_role[r] || {};
    const val = (u && typeof u.permissions[d] === 'boolean') ? u.permissions[d] : !!parRole[d];
    return `<label style="flex-direction:row;align-items:center;gap:9px;text-transform:none;letter-spacing:0;font-size:13.5px;font-weight:500;color:var(--encre)">
      <input type="checkbox" name="d_${d}" ${val ? 'checked' : ''} style="width:auto">${esc(ref.libelles[d])}</label>`;
  }).join('');

  openDrawer(`
    <h2>${u ? 'Modifier l\u2019accès' : 'Ajouter un compte'}</h2>
    <p class="muted" style="margin-top:4px">${u ? esc(u.email) : 'Le compte recevra ses identifiants par e-mail. Les droits ne valent que pour le camping actif.'}</p>
    <form id="f-user" class="form-grid" style="margin-top:14px">
      ${u ? '' : `
        <label class="full">E-mail *<input name="email" type="email" required></label>
        <label>Prénom<input name="prenom"></label>
        <label>Nom<input name="nom"></label>`}
      <label class="full">Rôle
        <select name="role" id="u-role">
          ${ref.roles.map((r) => `<option value="${r}"${r === role ? ' selected' : ''}>${esc(r)}</option>`).join('')}
        </select></label>
      <div class="full">
        <div class="muted" style="margin-bottom:8px">Droits — cochés par défaut selon le rôle, ajustables un par un.</div>
        <div id="u-droits" style="display:flex;flex-direction:column;gap:9px">${casesDroits(role)}</div>
      </div>
      <div class="full"><button class="btn btn-primary btn-block">${u ? 'Enregistrer' : 'Créer le compte'}</button></div>
    </form>`);

  $('#u-role').addEventListener('change', (e) => {
    if (u) return;   // en modification, on garde les cases telles quelles
    $('#u-droits').innerHTML = ref.droits.map((d) => {
      const val = !!(ref.droits_par_role[e.target.value] || {})[d];
      return `<label style="flex-direction:row;align-items:center;gap:9px;text-transform:none;letter-spacing:0;font-size:13.5px;font-weight:500;color:var(--encre)">
        <input type="checkbox" name="d_${d}" ${val ? 'checked' : ''} style="width:auto">${esc(ref.libelles[d])}</label>`;
    }).join('');
  });

  $('#f-user').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const permissions = {};
    ref.droits.forEach((d) => { permissions[d] = fd.get('d_' + d) === 'on'; });
    const body = { role: fd.get('role'), permissions };
    try {
      if (u) {
        await api(`/api/admin/utilisateurs/${u.id}`, { method: 'PUT', body });
        toast('Droits mis à jour');
      } else {
        body.email = fd.get('email'); body.nom = fd.get('nom'); body.prenom = fd.get('prenom');
        const r = await api('/api/admin/utilisateurs', { method: 'POST', body });
        toast(r.mot_de_passe_temporaire
          ? `Compte créé — mot de passe provisoire : ${r.mot_de_passe_temporaire}`
          : 'Compte créé — identifiants envoyés par e-mail');
      }
      closeDrawer(); route();
    } catch (err) { toast(err.message, true); }
  });
};

window.retirerAcces = async (id, nom) => {
  if (!await askConfirm(`Retirer l\u2019accès de ${nom} à ce camping ? Son compte et ses autres accès sont conservés.`)) return;
  try { await api(`/api/admin/utilisateurs/${id}`, { method: 'DELETE' }); toast('Accès retiré'); route(); }
  catch (e) { toast(e.message, true); }
};

/* ---------- Signatures électroniques ---------- */
/** Filtre la liste des signatures par statut.
    Agit sur les lignes déjà rendues plutôt que de relancer une requête :
    la liste est courte, et le résultat est immédiat. Le compteur dit
    combien de lignes sont masquées — sinon un filtre actif se confond
    avec une liste vide. */
function filtrerSignatures(statut) {
  const lignes = document.querySelectorAll('#main tr[data-sig-statut]');
  let visibles = 0;
  lignes.forEach((tr) => {
    const ok = !statut || tr.getAttribute('data-sig-statut') === statut;
    tr.style.display = ok ? '' : 'none';
    if (ok) visibles += 1;
  });

  let info = document.getElementById('sig-filtre-info');
  if (!info) {
    const sel = document.getElementById('sig-filtre');
    if (!sel) return;
    info = document.createElement('span');
    info.id = 'sig-filtre-info';
    info.className = 'muted';
    info.style.fontSize = '13px';
    sel.insertAdjacentElement('afterend', info);
  }
  info.textContent = statut
    ? visibles + ' sur ' + lignes.length
    : '';
}


const SIG_STATUT = { brouillon: 'brouillon', envoye: 'envoyé — en attente', signe: 'signé', refuse: 'refusé', annule: 'annulé' };

async function vueSignatures() {
  const [{ documents }, { residents }] = await Promise.all([
    api('/api/signatures' + exQS()),
    api('/api/residents'),
  ]);
  const rmap = {}; residents.forEach((r) => { rmap[r.id] = `${r.prenom || ''} ${r.nom}`.trim(); });

  $('#main').innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">Documents</div><h1>Signature électronique</h1></div>
      <div style="display:flex;align-items:center;gap:10px">
        <select id="sig-filtre" data-act="filtrerSignatures" data-evt="change" data-a1="@value"
                aria-label="Filtrer les documents par statut" style="width:auto">
          <option value="">Tous les statuts</option>
          <option value="envoye">En attente de signature</option>
          <option value="signe">Signés</option>
          <option value="brouillon">Brouillons</option>
          <option value="annule">Annulés</option>
          <option value="refuse">Refusés</option>
        </select>
        <button class="btn btn-primary" data-act="formDocSignature">Déposer un document</button>
      </div>
    </div>
    <p class="muted" style="margin:-14px 0 18px">Contrats, règlements intérieurs, avenants… Le signataire signe à la main depuis son téléphone. Adresse IP, horodatage et empreinte du document sont conservés comme preuve.</p>

    <div class="card">
      ${documents.length ? `<table><thead><tr><th>Document</th><th>Signataire</th><th>Zones</th><th>Statut</th><th>Signé le</th><th>Terme</th><th></th></tr></thead>
      <tbody>${documents.map((d) => `
        <tr data-sig-statut="${d.statut}">
          <td><strong>${esc(d.titre)}</strong><div class="muted">${d.nb_pages || 1} page(s)</div></td>
          <td>${esc(d.resident_nom || '—')}</td>
          <td class="muted">${(d.champs || []).length}</td>
          <td><span class="badge ${d.statut === 'signe' ? 'reglee' : d.statut === 'envoye' ? 'emise' : d.statut === 'annule' ? 'annulee' : 'brouillon'}">${esc(SIG_STATUT[d.statut] || d.statut)}</span></td>
          <td class="muted">${d.date_signature ? new Date(d.date_signature).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
          <td data-stop>${d.statut === 'annule' || d.statut === 'refuse'
            /* Un document annulé ou refusé n'a pas de terme : proposer de le
               modifier n'a pas de sens, et le badge « expiré » y donnait
               l'impression qu'il restait quelque chose à refaire. */
            ? '<span class="muted">—</span>'
            : (() => {
            const jr = d.date_fin ? Math.floor((new Date(d.date_fin) - new Date()) / 86400000) : null;
            const badge = jr == null ? '' : jr < 0 ? `<span class="badge en_retard" title="À refaire / re-signer">expiré</span> ` : jr <= 60 ? `<span class="badge partielle">${jr} j</span> ` : '';
            return `${badge}<input type="date" value="${d.date_fin || ''}" data-act="majTermeDoc" data-evt="change" data-a1="${d.id}" data-a2="@value" title="Terme du document — modifiable directement, les échéances suivent" style="width:130px;font-size:12px">`; })()}</td>
          <td class="right">
            ${d.statut === 'signe'
              ? `<button class="btn btn-ghost btn-sm" data-act="recapSignature" data-a1="${d.id}" title="Récapitulatif de transaction (dossier de preuve)">Récapitulatif</button>
                 <button class="btn btn-ghost btn-sm" data-act="voirSignature" data-a1="${d.id}">Preuve</button>`
              : d.statut === 'annule'
                ? '<span class="muted">—</span>'
                : `<button class="btn btn-ghost btn-sm" data-act="editeurZones" data-a1="${d.id}">Zones</button>
                 ${(d.champs || []).length && d.resident_id ? `<button class="btn btn-primary btn-sm" data-act="envoyerSignature" data-a1="${d.id}">Envoyer</button>` : ''}
                 <button class="btn btn-ghost btn-sm" data-act="annulerDocSignature" data-a1="${d.id}">Annuler</button>`}
          </td>
        </tr>`).join('')}</tbody></table>`
      : '<p class="muted" style="margin:0">Aucun document. Dépose un PDF pour commencer.</p>'}
    </div>`;
}

const VARS_CONTRAT = [
  ['{{nom}}', 'Nom du résident'], ['{{prenom}}', 'Prénom'], ['{{emplacement}}', 'N° d\u2019emplacement'],
  ['{{secteur}}', 'Secteur'], ['{{montant}}', 'Loyer mensuel'], ['{{date_debut}}', 'Début du contrat'], ['{{date_fin}}', 'Fin du contrat'],
];

window.chargerModelesContrat = async () => {
  const zone = $('#modeles-zone'); if (!zone) return;
  try {
    const { modeles } = await api('/api/contrat-modeles');
    zone.innerHTML = (modeles || []).length
      ? `<table><thead><tr><th>Nom</th><th>Type</th><th class="right">Longueur</th><th></th></tr></thead>
        <tbody>${modeles.map((m) => `<tr>
          <td><strong>${esc(m.nom)}</strong></td>
          <td class="muted">${esc(m.type || '—')}</td>
          <td class="right muted">${(m.clauses || '').length.toLocaleString('fr-FR')} car.</td>
          <td class="right">
            <button class="btn btn-ghost btn-sm" data-act="formModeleContrat" data-a1="${m.id}">Éditer</button>
            <button class="btn btn-ghost btn-sm" data-act="supprimerModeleContrat" data-a1="${m.id}">Supprimer</button>
          </td></tr>`).join('')}</tbody></table>`
      : '<span class="muted">Aucun modèle. Importez votre contrat PDF ou créez un modèle vierge.</span>';
  } catch (e) { zone.innerHTML = `<span class="bad">${esc(e.message || 'Erreur')}</span>`; }
};

window.formModeleContrat = async (id) => {
  let m = null;
  if (id) {
    const { modeles } = await api('/api/contrat-modeles');
    m = (modeles || []).find((x) => x.id === id) || null;
  }
  openDrawer(`
    <h2>${m ? 'Modifier le modèle' : 'Nouveau modèle de contrat'}</h2>
    <p class="muted" style="margin-top:4px">Clique une variable pour l\u2019insérer à l\u2019endroit du curseur — elle sera remplacée automatiquement à la création de chaque contrat.</p>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin:10px 0">${VARS_CONTRAT.map(([v, l]) => `<button type="button" class="btn btn-ghost btn-sm" data-act="insererVarModele" data-a1="${v}" title="${esc(l)}">${esc(v)}</button>`).join('')}</div>
    <form id="f-modele" class="form-grid">
      <label class="full">Nom du modèle *<input name="nom" required value="${m ? esc(m.nom) : ''}" placeholder="Contrat résidentiel annuel"></label>
      <label class="full">Texte du contrat (clauses)
        <textarea id="modele-clauses" name="clauses" rows="18" style="width:100%;font-family:ui-monospace,monospace;font-size:12.5px">${m ? esc(m.clauses || '') : ''}</textarea></label>
      <div class="full"><button class="btn btn-primary btn-block">${m ? 'Enregistrer' : 'Créer le modèle'}</button></div>
    </form>`);
  $('#f-modele').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    try {
      if (m) { await api('/api/contrat-modeles/' + m.id, { method: 'PUT', body }); toast('Modèle mis à jour'); }
      else { await api('/api/contrat-modeles', { method: 'POST', body }); toast('Modèle créé'); }
      closeDrawer(); chargerModelesContrat();
    } catch (err) { toast(err.message, true); }
  });
};

window.insererVarModele = (v) => {
  const ta = $('#modele-clauses'); if (!ta) return;
  const [a, b] = [ta.selectionStart || 0, ta.selectionEnd || 0];
  ta.value = ta.value.slice(0, a) + v + ta.value.slice(b);
  ta.focus(); ta.selectionStart = ta.selectionEnd = a + v.length;
};

window.supprimerModeleContrat = async (id) => {
  if (!await askConfirm('Supprimer ce modèle ? (refusé s\u2019il est utilisé par des contrats)', { titre: 'Supprimer le modèle', ok: 'Supprimer', danger: true })) return;
  try { await api('/api/contrat-modeles/' + id, { method: 'DELETE' }); toast('Modèle supprimé'); chargerModelesContrat(); }
  catch (e) { toast(e.message, true); }
};

window.importerModeleContrat = () => {
  openDrawer(`
    <h2>Importer un contrat existant</h2>
    <p class="muted" style="margin-top:4px">Déposez votre contrat PDF : Locamp en extrait le texte et en fait un modèle. Vous n\u2019aurez plus qu\u2019à remplacer le nom, les dates et le montant par les variables — clique-les dans l\u2019éditeur qui s\u2019ouvrira.</p>
    <form id="f-import-modele" class="form-grid" style="margin-top:12px">
      <label class="full">Contrat PDF *<input type="file" name="file" accept="application/pdf" required></label>
      <label class="full">Nom du modèle<input name="nom" placeholder="(par défaut : nom du fichier)"></label>
      <div class="full"><button class="btn btn-primary btn-block">Importer</button></div>
    </form>
    <p class="muted" style="font-size:12px">PDF texte uniquement — un scan (image) ne peut pas être converti.</p>`);
  $('#f-import-modele').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const { modele } = await api('/api/contrat-modeles/importer', { method: 'POST', body: fd });
      closeDrawer(); toast('Contrat importé — remplace maintenant les passages variables');
      formModeleContrat(modele.id);
      chargerModelesContrat();
    } catch (err) { toast(err.message, true); }
  });
};

window.nouveauContrat = async (residentId) => {
  const [{ modeles }, { resident: r }] = await Promise.all([
    api('/api/contrat-modeles').catch(() => ({ modeles: [] })),
    api('/api/residents/' + residentId),
  ]);
  const an = new Date().getFullYear();
  openDrawer(`
    <h2>Nouveau contrat — ${esc((r.prenom || '') + ' ' + r.nom)}</h2>
    <p class="muted" style="margin-top:4px">Le contrat est généré depuis le modèle (variables remplies), puis vous pourrez l\u2019envoyer en signature.</p>
    <form id="f-contrat" class="form-grid" style="margin-top:12px">
      <label class="full">Modèle ${modeles.length ? '' : '<span class="muted">(aucun — créez-en un dans Paramètres)</span>'}
        <select name="modele_id">${['<option value="">— sans modèle (PDF standard) —</option>']
          .concat(modeles.map((m) => `<option value="${m.id}">${esc(m.nom)}</option>`)).join('')}</select></label>
      <label>Début *<input type="date" name="date_debut" required value="${an}-01-01"></label>
      <label>Fin *<input type="date" name="date_fin" required value="${an}-12-31"></label>
      <label>Loyer mensuel (€ TTC)<input type="number" step="0.01" min="0" name="montant_mensuel" placeholder="0"></label>
      <div class="full"><button class="btn btn-primary btn-block">Créer le contrat</button></div>
    </form>`);
  $('#f-contrat').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    body.resident_id = residentId;
    if (!body.modele_id) delete body.modele_id;
    try {
      const { contrat } = await api('/api/contrats', { method: 'POST', body });
      closeDrawer();
      if (await askConfirm(`Contrat ${contrat.numero} créé. L\u2019envoyer en signature au résident maintenant ?`, { titre: 'Contrat créé', ok: 'Envoyer en signature' })) {
        await contratVersSignature(contrat.id);
      } else { route(); }
    } catch (err) { toast(err.message, true); }
  });
};

window.majTermeDoc = async (id, val) => {
  try {
    await api(`/api/signatures/${id}/dates`, { method: 'PUT', body: { date_fin: val || null } });
    toast(val ? 'Terme mis à jour — le document est suivi dans les échéances' : 'Terme retiré');
  } catch (e) { toast(e.message || 'Erreur', true); route(); }
};

window.regenererContrat = async (id) => {
  try {
    await api(`/api/contrats/${id}/regenerer-pdf`, { method: 'POST' });
    toast('Contrat émis — PDF généré');
    route();
  } catch (e) { toast(e.message || 'Erreur', true); }
};

window.supprimerContrat = async (id, numero) => {
  if (!await askConfirm(`Supprimer le brouillon ${numero || ''} ?\n\nIl n'a pas de PDF et n'a jamais été envoyé.`,
    { titre: 'Supprimer le brouillon', ok: 'Supprimer', danger: true })) return;
  try {
    await api(`/api/contrats/${id}`, { method: 'DELETE' });
    toast('Brouillon supprimé');
    route();
  } catch (e) { toast(e.message || 'Erreur', true); }
};

window.telechargerContrat = async (id) => {
  try {
    const { url, signe } = await api(`/api/contrats/${id}/pdf`);
    window.open(url, '_blank');
    if (!signe) toast('PDF ouvert — imprimez-le pour une signature papier, puis « Signé (papier) »');
  } catch (e) { toast(e.message || 'Erreur', true); }
};

window.signerContratPapier = async (id) => {
  openDrawer(`
    <h2>Contrat signé sur papier</h2>
    <p class="muted" style="margin-top:4px">Le résident a signé l\u2019exemplaire imprimé. Joins le scan du contrat signé (recommandé — il devient l\u2019exemplaire officiel), ou marque simplement signé.</p>
    <form id="f-papier" class="form-grid" style="margin-top:12px">
      <label class="full">Scan du contrat signé (PDF, facultatif)<input type="file" name="file" accept="application/pdf"></label>
      <label class="full">Note<input name="note" placeholder="ex. signé au bureau le 12/07"></label>
      <div class="full"><button class="btn btn-primary btn-block">Marquer signé</button></div>
    </form>`);
  $('#f-papier').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (!fd.get('file') || !fd.get('file').size) fd.delete('file');
    try {
      const r = await api(`/api/contrats/${id}/signer-papier`, { method: 'POST', body: fd });
      closeDrawer(); toast(r.scan_joint ? 'Contrat signé — scan conservé comme exemplaire officiel' : 'Contrat marqué signé (papier)');
      route();
    } catch (err) { toast(err.message, true); }
  });
};

window.ajouterDocResident = (residentId) => {
  openDrawer(`
    <h2>Ajouter un document</h2>
    <form id="f-doc" class="form-grid" style="margin-top:12px">
      <label class="full">Fichier *<input type="file" name="file" required></label>
      <label>Type<select name="type">
        <option value="attestation_assurance">Attestation d\u2019assurance</option>
        <option value="contrat_papier">Contrat signé (papier)</option>
        <option value="piece_identite">Pièce d\u2019identité</option>
        <option value="autre">Autre</option>
      </select></label>
      <label>Date d\u2019expiration<input type="date" name="date_expiration"></label>
      <div class="full muted" style="font-size:12px">Pour une attestation d\u2019assurance : pense aussi à renseigner la date sur la fiche (Modifier → Assurance) pour déclencher les rappels automatiques.</div>
      <div class="full"><button class="btn btn-primary btn-block">Ajouter</button></div>
    </form>`);
  $('#f-doc').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    fd.append('resident_id', residentId);
    try {
      await api('/api/documents', { method: 'POST', body: fd });
      closeDrawer(); toast('Document ajouté'); route();
    } catch (err) { toast(err.message, true); }
  });
};

window.formDocSignature = async () => {
  const { residents } = await api('/api/residents');
  const actifs = residents.filter((r) => r.actif !== false && r.email);
  openDrawer(`
    <h2>Déposer un document à signer</h2>
    <p class="muted" style="margin-top:4px">PDF uniquement. Vous placerez ensuite les zones de signature sur le document.</p>
    <form id="f-docsig" class="form-grid" style="margin-top:14px">
      <label class="full">Fichier PDF *<input type="file" name="file" accept="application/pdf" required></label>
      <label class="full">Titre *<input name="titre" required placeholder="Contrat de location — emplacement 077"></label>
      <label class="full">Signataire *
        <select name="resident_id" required>
          <option value="">— choisir —</option>
          ${actifs.map((r) => `<option value="${r.id}">${esc(r.prenom || '')} ${esc(r.nom)} · ${esc(r.email)}</option>`).join('')}
        </select></label>
      <label class="full">Message d'accompagnement<textarea name="message" rows="2" style="width:100%"></textarea></label>
      <div class="full muted" style="font-size:12.5px;margin-top:2px">Si c\u2019est un contrat (ou tout document à durée limitée), renseignez son terme : Locamp vous préviendra avant l\u2019échéance et le marquera « à refaire ».</div>
      <label>Début de validité<input type="date" name="date_debut"></label>
      <label>Fin de validité (terme)<input type="date" name="date_fin"></label>
      <div class="full"><button class="btn btn-primary btn-block">Déposer le document</button></div>
    </form>
    ${actifs.length ? '' : '<p class="form-error">Aucun résident avec une adresse e-mail — ajoute-la sur sa fiche.</p>'}`);

  $('#f-docsig').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const { document: d } = await api('/api/signatures', { method: 'POST', body: fd });
      closeDrawer();
      toast('Document déposé — place maintenant les zones de signature');
      editeurZones(d.id);
    } catch (err) { toast(err.message, true); }
  });
};

/* --- Éditeur de zones : on clique sur le PDF pour poser les champs --- */
let zonesState = null;

window.editeurZones = async (id) => {
  await chargerPdfJs();
  const { document: doc, url } = await api('/api/signatures/' + id);
  zonesState = { id, champs: [...(doc.champs || [])], outil: 'signature', pages: [] };

  $('#main').innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow"><a href="#/signatures" style="color:inherit;text-decoration:none">← Signatures</a></div>
        <h1>${esc(doc.titre)}</h1></div>
      <div class="toolbar">
        <button class="btn btn-ghost btn-sm" data-act="allerA" data-a1="#/signatures">Fermer</button>
        <button class="btn btn-primary btn-sm" data-act="enregistrerZones">Enregistrer les zones</button>
      </div>
    </div>

    <div class="map-edit-layout">
      <div>
        <div class="card" style="padding:14px;background:#EFEAE0">
          <div id="pdf-pages"></div>
        </div>
      </div>
      <aside class="map-panel">
        <div class="map-panel-sec">
          <h3>Outil</h3>
          <div class="map-chips" id="outils">
            <button class="map-chip actif" data-t="signature" data-act="choisirOutil" data-a1="signature">Signature</button>
            <button class="map-chip" data-t="texte" data-act="choisirOutil" data-a1="texte">Texte</button>
            <button class="map-chip" data-t="case" data-act="choisirOutil" data-a1="case">Case à cocher</button>
          </div>
          <p class="map-aide" style="padding:12px 0 0;background:none;border:none">Clique sur le document à l'endroit où placer la zone.</p>
        </div>
        <div class="map-panel-sec">
          <h3>Zones posées <span class="map-count" id="nb-zones">0</span></h3>
          <div id="liste-zones"></div>
        </div>
      </aside>
    </div>`;

  const box = $('#pdf-pages');
  const pdf = await pdfjsLib.getDocument(url).promise;
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const larg = Math.min(box.clientWidth - 4, 740);
    const vp = page.getViewport({ scale: larg / base.width });

    const holder = document.createElement('div');
    holder.className = 'pdf-page';
    holder.dataset.page = n;
    holder.style.cssText = `position:relative;margin:0 auto 14px;width:${vp.width}px;height:${vp.height}px;box-shadow:var(--shadow-s);border-radius:4px;overflow:hidden;background:#fff;cursor:crosshair`;

    const canvas = document.createElement('canvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = vp.width * dpr; canvas.height = vp.height * dpr;
    canvas.style.cssText = 'width:100%;height:100%;display:block';
    holder.appendChild(canvas);
    box.appendChild(holder);

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;

    holder.addEventListener('click', (e) => {
      if (e.target.closest('.zone')) return;
      const r = holder.getBoundingClientRect();
      poserZone(n, ((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100);
    });
  }
  dessinerZones();
};

window.choisirOutil = (t) => {
  zonesState.outil = t;
  document.querySelectorAll('#outils .map-chip').forEach((b) => b.classList.toggle('actif', b.dataset.t === t));
};

async function poserZone(page, x, y) {
  const t = zonesState.outil;
  const def = t === 'signature' ? { w: 30, h: 9 } : t === 'case' ? { w: 55, h: 2.4 } : { w: 34, h: 4 };
  let label = null;
  if (t === 'case') {
    label = await askPrompt('Texte de la case à cocher', 'Je certifie avoir lu et approuvé le document');
    if (label === null) return;
  } else if (t === 'texte') {
    label = await askPrompt('Intitulé du champ', 'Nom et prénom');
    if (label === null) return;
  }
  zonesState.champs.push({
    id: 'z' + Math.random().toString(36).slice(2, 9),
    type: t, page, x: Math.max(0, x - def.w / 2), y: Math.max(0, y - def.h / 2),
    w: def.w, h: def.h, label, requis: true,
  });
  dessinerZones();
}

function dessinerZones() {
  document.querySelectorAll('.zone').forEach((z) => z.remove());
  const COUL = { signature: '#175243', texte: '#3D5A99', case: '#B98A3C' };
  const LIB = { signature: 'Signature', texte: 'Texte', case: 'Case' };

  for (const c of zonesState.champs) {
    const holder = document.querySelector(`.pdf-page[data-page="${c.page}"]`);
    if (!holder) continue;
    const d = document.createElement('div');
    d.className = 'zone';
    d.dataset.id = c.id;
    d.style.cssText = `position:absolute;left:${c.x}%;top:${c.y}%;width:${c.w}%;height:${c.h}%;
      border:2px solid ${COUL[c.type]};background:${COUL[c.type]}22;border-radius:4px;
      display:flex;align-items:center;justify-content:center;font:600 10px Inter,sans-serif;
      color:${COUL[c.type]};cursor:pointer`;
    d.title = c.label || LIB[c.type];
    d.textContent = LIB[c.type];
    d.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (await askConfirm(`Retirer la zone « ${c.label || LIB[c.type]} » ?`)) {
        zonesState.champs = zonesState.champs.filter((x) => x.id !== c.id);
        dessinerZones();
      }
    });
    holder.appendChild(d);
  }

  $('#nb-zones').textContent = zonesState.champs.length;
  $('#liste-zones').innerHTML = zonesState.champs.length
    ? zonesState.champs.map((c) => `<div class="muted" style="font-size:12.5px;padding:5px 0;border-bottom:1px solid #F1EDE2">
        <strong style="color:${COUL[c.type]}">${LIB[c.type]}</strong> · p.${c.page}${c.label ? ` — ${esc(c.label.slice(0, 30))}` : ''}</div>`).join('')
    : '<p class="muted" style="margin:0;font-size:12.5px">Aucune zone. Clique sur le document.</p>';
}

window.enregistrerZones = async () => {
  try {
    await api(`/api/signatures/${zonesState.id}/champs`, { method: 'PUT', body: { champs: zonesState.champs } });
    toast('Zones enregistrées');
    // L'éditeur s'affiche sous le hash #/signatures : le réassigner ne déclenche
    // aucun hashchange, donc aucun rafraîchissement. On rend la vue directement.
    if (location.hash.replace(/^#\/?/, '') === 'signatures') route();
    else location.hash = '#/signatures';
  } catch (e) { toast(e.message, true); }
};

window.envoyerSignature = async (id) => {
  if (!await askConfirm('Envoyer le document au signataire par e-mail ?')) return;
  try {
    const r = await api(`/api/signatures/${id}/envoyer`, { method: 'POST' });
    toast(`Document envoyé à ${r.envoye_a}`);
    route();
  } catch (e) { toast(e.message, true); }
};

window.annulerDocSignature = async (id) => {
  if (!await askConfirm('Annuler ce document ?')) return;
  try { await api(`/api/signatures/${id}`, { method: 'DELETE' }); toast('Document annulé'); route(); }
  catch (e) { toast(e.message, true); }
};

/* Récapitulatif de transaction (PDF façon prestataire de confiance) */
window.recapSignature = async (id) => {
  try {
    const headers = { Authorization: 'Bearer ' + TOKEN };
    if (ACTIVE_CAMPING) headers['x-camping-id'] = ACTIVE_CAMPING;
    const r = await fetch(API + `/api/signatures/${id}/recap`, { headers });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'Récapitulatif indisponible'); }
    const url = URL.createObjectURL(await r.blob());
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) { toast(e.message, true); }
};

window.voirSignature = async (id) => {
  const { document: d, url, preuve } = await api('/api/signatures/' + id);
  openDrawer(`
    <h2>Preuve de signature</h2>
    <p class="muted" style="margin-top:4px">${esc(d.titre)}</p>
    ${preuve ? `
      <ul class="list-tight" style="margin-top:14px">
        <li><span>Signataire</span><span><strong>${esc(preuve.signataire_nom)}</strong></span></li>
        <li><span>E-mail</span><span>${esc(preuve.signataire_email || '—')}</span></li>
        <li><span>Date et heure</span><span>${new Date(preuve.horodatage).toLocaleString('fr-FR')}</span></li>
        <li><span>Adresse IP</span><span><code>${esc(preuve.ip)}</code></span></li>
        <li><span>Navigateur</span><span class="muted" style="font-size:11px">${esc((preuve.user_agent || '—').slice(0, 46))}…</span></li>
      </ul>
      <h2 style="margin-top:18px">Intégrité</h2>
      <p class="muted" style="font-size:11.5px;word-break:break-all;line-height:1.7">
        Empreinte du document présenté :<br><code>${esc(preuve.hash_original)}</code><br><br>
        Empreinte du document signé :<br><code>${esc(preuve.hash_signe)}</code></p>
      ${preuve.signature_png ? `<h2 style="margin-top:18px">Signature manuscrite</h2>
        <img src="${preuve.signature_png}" alt="signature" style="max-width:100%;border:1px solid var(--hairline);border-radius:8px;background:#fff;padding:8px">` : ''}
    ` : '<p class="muted">Dossier de preuve introuvable.</p>'}
    <a class="btn btn-primary btn-block" style="margin-top:18px" href="${url}" target="_blank" rel="noopener">Ouvrir le document signé</a>`);
};

/* ---------- Facturation électronique : connecteur Plateforme Agreee (OD) ---------- */
function renderEfactureCard(cx, plateformes) {
  const platNom = (code) => (plateformes.find((x) => x.code === code) || {}).nom || code;

  /* Le SIRET compte quatorze chiffres. Le champ en affichait neuf — un SIREN —
     sans que rien ne le signale, alors que c'est une mention obligatoire des
     factures et le déclencheur de Factur-X. On informe sans bloquer : un
     camping en cours d'immatriculation doit pouvoir enregistrer le reste. */
  const majSiretInfo = () => {
    const ch = $('#cfg-siret'); const info = $('#cfg-siret-info');
    if (!ch || !info) return;
    const n = String(ch.value || '').replace(/\D/g, '').length;
    if (!n) { info.textContent = ''; info.style.color = ''; return; }
    if (n === 14) { info.textContent = '14 chiffres — format valide.'; info.style.color = 'var(--sapin)'; return; }
    info.style.color = 'var(--laiton)';
    info.textContent = n === 9
      ? '9 chiffres : c\u2019est un SIREN. Le SIRET en compte 14 (SIREN + 5 chiffres d\u2019établissement). '
        + 'Sans SIRET complet, la facturation électronique sera refusée.'
      : n + ' chiffre' + (n > 1 ? 's' : '') + ' sur les 14 attendus.';
  };
  $('#cfg-siret')?.addEventListener('input', majSiretInfo);
  majSiretInfo();

  /* Envoi automatique actif sans expéditeur : les factures partent avec
     l'adresse de repli du serveur, que le résident ne reconnaît pas. */
  const majExpInfo = () => {
    const ch = $('#cfg-exp'); const info = $('#cfg-exp-info');
    if (!ch || !info) return;
    const auto = document.querySelector('[name="email_auto"]')?.value !== 'false';
    if (auto && !String(ch.value || '').trim()) {
      info.style.color = 'var(--laiton)';
      info.textContent = 'L\u2019envoi automatique est actif mais aucun expéditeur n\u2019est défini : '
        + 'vos factures partiront depuis une adresse que vos résidents ne reconnaîtront pas.';
    } else { info.textContent = ''; info.style.color = ''; }
  };
  $('#cfg-exp')?.addEventListener('input', majExpInfo);
  document.querySelector('[name="email_auto"]')?.addEventListener('change', majExpInfo);
  majExpInfo();

  /* ---- Modifications non enregistrées ----------------------------
     Six sections, six boutons : c'est volontaire — ce sont six domaines
     indépendants, et un bouton unique renverrait tout à chaque fois.
     Le défaut était ailleurs : une modification non enregistrée
     disparaissait sans un mot.

     Chaque formulaire retient l'état de ses champs au chargement ; dès
     qu'un champ s'en écarte, son bouton le dit et quitter demande
     confirmation. */
  const surveillerModifs = () => {
    const formulaires = [...document.querySelectorAll('#main form')];
    if (!formulaires.length) return;

    /* L'empreinte est relevée sur le DOM, pas sur les données du serveur :
       un champ vide côté serveur et un champ vide à l'écran ne sont pas
       toujours la même chaîne, ce qui produirait de fausses alertes. */
    const empreinte = (f) => [...f.elements]
      .filter((el) => el.name && el.type !== 'file' && el.type !== 'submit' && el.type !== 'button')
      .map((el) => el.name + '=' + (el.type === 'checkbox' ? el.checked : el.value))
      .join('\u0001');

    formulaires.forEach((f) => {
      f.dataset.etatInitial = empreinte(f);

      const majRepere = () => {
        const modifie = empreinte(f) !== f.dataset.etatInitial;
        f.dataset.modifie = modifie ? '1' : '';
        const btn = f.querySelector('button.btn-primary');
        if (!btn) return;
        if (!btn.dataset.libelle) btn.dataset.libelle = btn.textContent.trim();
        btn.textContent = modifie ? '\u2022 ' + btn.dataset.libelle : btn.dataset.libelle;
        btn.style.boxShadow = modifie ? '0 0 0 3px rgba(185,138,60,.30)' : '';
        btn.title = modifie ? 'Modifications non enregistrées dans cette section.' : '';
      };

      f.addEventListener('input', majRepere);
      f.addEventListener('change', majRepere);
      /* Après un envoi réussi la vue est rechargée : l'empreinte repart de
         zéro. On remet quand même le repère à plat tout de suite, pour que
         le bouton ne reste pas marqué le temps de l'aller-retour réseau. */
      f.addEventListener('submit', () => {
        f.dataset.etatInitial = empreinte(f);
        f.dataset.modifie = '';
        majRepere();
      });
    });

    const sectionsModifiees = () => [...document.querySelectorAll('#main form[data-modifie="1"]')]
      .map((f) => (f.closest('.card')?.querySelector('h2')?.textContent || '').trim())
      .filter(Boolean);

    /* Fermeture d'onglet ou rechargement : le navigateur impose son propre
       texte, on ne peut que demander l'arrêt. */
    const avantFermeture = (e) => {
      if (!sectionsModifiees().length) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', avantFermeture);

    /* Navigation interne : là on peut nommer les sections concernées.
       En capture, pour intercepter le clic avant que le routeur ne parte. */
    const avantNavigation = async (e) => {
      const lien = e.target.closest?.('a[href^="#/"]');
      if (!lien) return;
      const noms = sectionsModifiees();
      if (!noms.length) return;
      e.preventDefault();
      e.stopPropagation();
      const liste = noms.map((n) => '\u2022 ' + n).join('\n');
      const ok = await askConfirm(
        'Quitter sans enregistrer ?\n\n'
        + 'Ces sections ont des modifications non enregistrées :\n' + liste
        + '\n\nChaque section a son propre bouton « Enregistrer » : les '
        + 'modifications seront perdues.',
        { ok: 'Quitter sans enregistrer', danger: true }
      );
      if (!ok) return;
      document.removeEventListener('click', avantNavigation, true);
      window.removeEventListener('beforeunload', avantFermeture);
      location.hash = lien.getAttribute('href');
    };
    document.addEventListener('click', avantNavigation, true);

    /* La surveillance ne vaut que pour cet écran : en changeant de vue, on
       la retire, sinon elle avertirait sur des formulaires disparus. */
    const nettoyer = () => {
      if (location.hash.startsWith('#/parametres')) return;
      document.removeEventListener('click', avantNavigation, true);
      window.removeEventListener('beforeunload', avantFermeture);
      window.removeEventListener('hashchange', nettoyer);
    };
    window.addEventListener('hashchange', nettoyer);
  };
  surveillerModifs();
  const intro = `<p class="muted" style="margin-top:4px">Locamp pilote vos flux ; la transmission réglementaire passe par votre <strong>plateforme agréée</strong> (PA). Réforme : réception obligatoire au 1er sept. 2026, émission/e-reporting au 1er sept. 2027 pour les TPE/PME.</p>`;
  const connecte = cx && (cx.statut === 'connecte' || cx.statut === 'connectee');
  if (connecte) {
    return `
    <div class="card" style="margin-top:16px">
      <div class="card-actions"><h2 style="margin:0">Facturation électronique</h2>
        <span class="badge reglee">Connectée &mdash; ${esc(platNom(cx.pa_code))}</span></div>
      ${intro}
      <div class="stat" style="margin-top:10px"><span class="k">Adresse de routage</span><span class="v">${esc(cx.adresse_routage || '&mdash;')}</span></div>
      ${cx.message ? `<p class="muted">${esc(cx.message)}</p>` : ''}
      <div class="card-actions" style="margin-top:10px">
        <button class="btn btn-ghost btn-sm" data-act="deconnecterPA">Deconnecter</button></div>

      <div style="border-top:1px solid var(--trait,#E4DCC8);margin-top:16px;padding-top:12px">
        <h3 style="margin:0 0 2px;font-size:15px">E-reporting (ventes aux particuliers)</h3>
        <p class="muted" style="margin:0 0 10px;font-size:12px">Vos ventes B2C ne partent pas en Factur-X : on transmet leurs donnees agregees a la PA. Les clients entreprise en sont exclus (ils partent en Factur-X).</p>
        <div class="form-grid">
          <label>Periode<input type="month" id="erep-periode" value="${new Date().toISOString().slice(0, 7)}"></label>
          <label>Type<select id="erep-type"><option value="transaction">Transactions (ventes)</option><option value="encaissement">Encaissements (paiements recus)</option></select></label>
          <div class="full"><button class="btn btn-primary btn-sm" data-act="efApercu">Apercu de la periode</button></div>
        </div>
        <div id="erep-apercu" style="margin-top:10px"></div>
        <h3 style="margin:16px 0 6px;font-size:14px">Periodes deja transmises</h3>
        <div id="erep-histo" class="muted">Chargement&hellip;</div>
      </div>

      <div style="border-top:1px solid var(--trait,#E4DCC8);margin-top:16px;padding-top:12px">
        <div class="card-actions"><h3 style="margin:0;font-size:15px">Factures fournisseurs reçues</h3>
          <button class="btn btn-ghost btn-sm" data-act="efRecuesSync">Synchroniser</button></div>
        <p class="muted" style="margin:2px 0 8px;font-size:12px">Les factures que vos fournisseurs vous adressent via la plateforme. À accepter ou refuser (statut renvoyé à l'émetteur).</p>
        <div id="recues-zone" class="muted">Chargement&hellip;</div>
      </div>
    </div>`;
  }
  const opts = plateformes.map((x) => `<option value="${esc(x.code)}">${esc(x.nom)}</option>`).join('');
  return `
    <div class="card" style="margin-top:16px">
      <div class="card-actions"><h2 style="margin:0">Facturation électronique</h2>
        <span class="badge en_retard">Non connectée</span></div>
      ${intro}
      <div class="form-grid" style="margin-top:12px">
        <label>Plateforme agréée
          <select id="ef-pa" data-act="efRenderChamps" data-evt="change">${opts || '<option value="">Aucune disponible</option>'}</select></label>
        <div id="ef-champs" class="full"></div>
        <div class="full"><button class="btn btn-primary btn-sm" data-act="connecterPA">Connecter</button></div>
      </div>
    </div>`;
}
window.efRenderChamps = () => {
  const sel = $('#ef-pa'); const zone = $('#ef-champs');
  if (!sel || !zone) return;
  const plat = (window._efPlats || []).find((x) => x.code === sel.value);
  const champs = (plat && plat.champs_config) || [];
  zone.innerHTML = champs.length
    ? champs.map((ch) => `<label>${esc(ch.libelle)}${ch.requis ? ' *' : ''}<input data-ef="${esc(ch.cle)}" type="${ch.secret ? 'password' : 'text'}" autocomplete="off"></label>`).join('')
    : '<p class="muted">Aucun parametre requis pour cette plateforme.</p>';
};
window.connecterPA = async () => {
  const sel = $('#ef-pa'); if (!sel || !sel.value) return;
  const config = {};
  document.querySelectorAll('#ef-champs [data-ef]').forEach((i) => { if (i.value) config[i.dataset.ef] = i.value; });
  try {
    const r = await api('/api/efacture/connexion', { method: 'POST', body: { pa_code: sel.value, config } });
    toast(r.message || 'Plateforme connectee'); route();
  } catch (e) { toast(e.message || 'Echec de la connexion', true); }
};
window.deconnecterPA = async () => {
  if (!await askConfirm("Déconnecter la plateforme agréée ? Les flux ne seront plus transmis tant qu'une plateforme n'est pas reconnectée.", { ok: 'Déconnecter', danger: true })) return;
  try { await api('/api/efacture/connexion', { method: 'DELETE' }); toast('Plateforme déconnectée'); route(); }
  catch (e) { toast(e.message || 'Erreur', true); }
};
window.efApercu = async () => {
  const per = ($('#erep-periode') || {}).value; const type = ($('#erep-type') || {}).value || 'transaction';
  const zone = $('#erep-apercu'); if (!zone) return;
  if (!per) { zone.innerHTML = '<p class="muted">Choisissez une periode.</p>'; return; }
  zone.innerHTML = '<p class="muted">Calcul&hellip;</p>';
  try {
    const lot = await api(`/api/efacture/ereporting?periode=${per}&type=${type}`);
    const vent = (lot.ventilation_tva || []).map((v) =>
      `<tr><td>${dfrTaux(v.taux)} %</td><td class="right">${eur(v.base_ht)}</td><td class="right">${eur(v.montant_tva)}</td></tr>`).join('');
    const exclues = (lot.exclues_b2b || []).length;
    zone.innerHTML = `
      <div class="stat"><span class="k">Operations B2C</span><span class="v">${lot.nb_operations || 0}</span></div>
      <div class="stat"><span class="k">Total TTC</span><span class="v">${eur(lot.total_ttc)}</span></div>
      ${type === 'transaction' ? `<table style="margin-top:8px"><thead><tr><th>Taux</th><th class="right">Base HT</th><th class="right">TVA</th></tr></thead><tbody>${vent || '<tr><td colspan="3" class="muted">Aucune vente sur la periode.</td></tr>'}</tbody></table>` : ''}
      ${exclues ? `<p class="muted" style="margin-top:6px">${exclues} facture(s) entreprise exclue(s) (transmises en Factur-X).</p>` : ''}
      <div style="margin-top:10px"><button class="btn btn-primary btn-sm" data-act="efTransmettre">Transmettre cette periode a la PA</button></div>`;
  } catch (e) { zone.innerHTML = `<p class="bad">${esc(e.message || 'Erreur')}</p>`; }
};
window.efTransmettre = async () => {
  const per = ($('#erep-periode') || {}).value; const type = ($('#erep-type') || {}).value || 'transaction';
  if (!await askConfirm(`Transmettre l'e-reporting ${type} de ${per} ? Une periode transmise est figee.`, { ok: 'Transmettre' })) return;
  try {
    const r = await api('/api/efacture/ereporting', { method: 'POST', body: { periode: per, type } });
    toast(r.message || `Periode ${per} transmise` + (r.doc_externe_id ? ` (ref. ${r.doc_externe_id})` : ''));
    efHistorique();
  } catch (e) { toast(e.message || 'Echec de la transmission', true); }
};
window.efHistorique = async () => {
  const zone = $('#erep-histo'); if (!zone) return;
  try {
    const { lots } = await api('/api/efacture/ereporting/historique');
    if (!lots || !lots.length) { zone.innerHTML = '<span class="muted">Aucune periode transmise pour le moment.</span>'; return; }
    zone.innerHTML = `<table><thead><tr><th>Periode</th><th>Type</th><th class="right">TTC</th><th>Transmis le</th><th>Ref. PA</th></tr></thead><tbody>${
      lots.map((l) => `<tr><td>${esc(l.periode)}</td><td>${esc(l.type)}</td><td class="right">${eur(l.total_ttc || (l.donnees && l.donnees.total_ttc))}</td><td class="muted">${l.transmis_at ? dfr(l.transmis_at) : '&mdash;'}</td><td class="muted">${esc(l.doc_externe_id || '&mdash;')}</td></tr>`).join('')
    }</tbody></table>`;
  } catch (e) { zone.innerHTML = `<span class="bad">${esc(e.message || 'Erreur')}</span>`; }
};
window.efRecuesSync = async () => {
  const zone = $('#recues-zone'); if (zone) zone.innerHTML = '<span class="muted">Synchronisation&hellip;</span>';
  try {
    const r = await api('/api/efacture/recues/sync', { method: 'POST' });
    toast(r.importees ? `${r.importees} facture(s) fournisseur importée(s)` : 'Aucune nouvelle facture');
    efRecuesLoad();
  } catch (e) { toast(e.message || 'Échec de la synchronisation', true); efRecuesLoad(); }
};
const EF_RECUE_STATUT = { recue: 'reçue', acceptee: 'acceptée', refusee: 'refusée', litige: 'en litige', comptabilisee: 'comptabilisée' };
const EF_RECUE_BADGE = { recue: 'en_retard', acceptee: 'reglee', refusee: 'annulee', litige: 'partielle', comptabilisee: 'reglee' };
window.efRecuesLoad = async () => {
  const zone = $('#recues-zone'); if (!zone) return;
  try {
    const { recues } = await api('/api/efacture/recues');
    if (!recues || !recues.length) { zone.innerHTML = '<span class="muted">Aucune facture reçue. Cliquez « Synchroniser ».</span>'; return; }
    zone.innerHTML = `<table><thead><tr><th>Émetteur</th><th>N°</th><th>Date</th><th class="right">TTC</th><th>Statut</th><th></th></tr></thead><tbody>${
      recues.map((f) => `<tr>
        <td>${esc(f.emetteur_nom || '—')}${f.emetteur_siren ? `<br><span class="muted" style="font-size:11px">SIREN ${esc(f.emetteur_siren)}</span>` : ''}</td>
        <td>${esc(f.numero || '—')}</td>
        <td class="muted">${f.date_facture ? dfr(f.date_facture) : '—'}</td>
        <td class="right">${eur(f.total_ttc)}</td>
        <td><span class="badge ${EF_RECUE_BADGE[f.statut] || ''}">${EF_RECUE_STATUT[f.statut] || esc(f.statut)}</span>${f.motif ? `<br><span class="muted" style="font-size:11px">${esc(f.motif)}</span>` : ''}</td>
        <td class="right">${f.statut === 'recue'
          ? `<button class="btn btn-ghost btn-sm" data-act="efRecueStatut" data-a1="${f.id}" data-a2="acceptee">Accepter</button>
             <button class="btn btn-ghost btn-sm" data-act="efRecueStatut" data-a1="${f.id}" data-a2="refusee">Refuser</button>`
          : (f.statut === 'acceptee' ? `<button class="btn btn-ghost btn-sm" data-act="efRecueStatut" data-a1="${f.id}" data-a2="comptabilisee">Marquer comptabilisée</button>` : '')}</td>
      </tr>`).join('')
    }</tbody></table>`;
  } catch (e) { zone.innerHTML = `<span class="bad">${esc(e.message || 'Erreur')}</span>`; }
};
window.efRecueStatut = async (id, statut) => {
  let motif = null;
  if (statut === 'refusee') {
    motif = await askPrompt('Motif du refus', '', { titre: 'Refuser la facture', placeholder: 'ex. montant erroné, prestation non reçue…' });
    if (motif == null) return;
  }
  try {
    await api(`/api/efacture/recues/${id}/statut`, { method: 'POST', body: { statut, motif } });
    toast('Statut mis à jour'); efRecuesLoad();
  } catch (e) { toast(e.message || 'Erreur', true); }
};
function dfrTaux(t) { const n = Number(t || 0); return Number.isInteger(n) ? String(n) : String(n).replace('.', ','); }

async function vueParametres() {
  const { camping: c } = await api('/api/camping');
  const p = c.parametres || {};
  const fp = (p.facturation) || {};
  /* Le formulaire du catalogue naissait avec « TVA : 0 » — même défaut que le
     tiroir de facture. Sur une facture française, 0 % est un régime
     particulier qui exige une mention légale, pas une absence de taux. */
  const tvaDefaut = Number(fp.tva_taux_loyer || 0);
  const ts = p.taxe_sejour || {};
  const en = p.energie || {};
  const rl = p.relances || {};
  const { articles } = await api('/api/articles?inclure_inactifs=1').catch(() => ({ articles: [] }));
  const { url: logoUrl } = await api('/api/camping/logo').catch(() => ({ url: null }));
  const efRes = await api('/api/efacture/connexion').catch(() => ({ connexion: null }));
  const efPlats = await api('/api/efacture/plateformes').catch(() => ({ plateformes: [] }));
  window._efPlats = efPlats.plateformes || [];
  const efCard = renderEfactureCard(efRes.connexion, window._efPlats);
  $('#main').innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Configuration</div><h1>Paramètres du camping</h1></div>
      <span class="muted">${esc(c.nom || '')}</span></div>

    <div class="card">
      <h2>Identité & mentions légales</h2>
      <form id="f-ident" class="form-grid" style="margin-top:12px">
        <label>Nom (interne)<input name="nom" value="${esc(c.nom || '')}"></label>
        <label>Raison sociale<input name="raison_sociale" value="${esc(c.raison_sociale || '')}"></label>
        <label>SIRET<input name="siret" id="cfg-siret" value="${esc(c.siret || '')}" inputmode="numeric"
          placeholder="14 chiffres" title="Mention obligatoire sur vos factures (art. L441-9 du code de commerce). C'est aussi lui qui déclenche Factur-X.">
          <span id="cfg-siret-info" class="muted" style="display:block;font-size:12px;margin-top:3px"></span></label>
        <label>N° TVA intracom.<input name="tva" value="${esc(c.tva || '')}"></label>
        <label class="full">Adresse<input name="adresse" value="${esc(c.adresse || '')}"></label>
        <label>E-mail<input name="email" type="email" value="${esc(c.email || '')}"></label>
        <label>Téléphone<input name="telephone" value="${esc(c.telephone || '')}"></label>
        <div class="full"><button class="btn btn-primary">Enregistrer l'identité</button></div>
      </form>
    </div>

    <div class="card">
      <div class="card-actions"><h2>Modèles de contrats</h2>
        <div class="toolbar">
          <button class="btn btn-ghost btn-sm" data-act="importerModeleContrat" title="Dépose un contrat PDF existant : Locamp en extrait le texte pour en faire un modèle">Importer un PDF</button>
          <button class="btn btn-primary btn-sm" data-act="formModeleContrat">Nouveau modèle</button>
        </div></div>
      <p class="muted">Un modèle = le texte de votre contrat avec des variables (nom du résident, emplacement, montant, dates) remplies automatiquement à la création. Chaque camping a ses propres modèles.</p>
      <div id="modeles-zone" class="muted" style="margin-top:10px">Chargement&hellip;</div>
    </div>

    ${efCard}

    <div class="card" style="margin-top:16px">
      <h2>Logo</h2>
      <div class="logo-row">
        <div class="logo-preview">${logoUrl ? `<img src="${logoUrl}" alt="logo">` : '<span class="muted">Aucun logo</span>'}</div>
        <div>
          <input type="file" id="logo-file" accept="image/png,image/jpeg">
          <button class="btn btn-ghost btn-sm" data-act="uploadLogo">Téléverser</button>
          <p class="muted" style="margin:6px 0 0">PNG ou JPG, format paysage de préférence. Apparaît en haut des factures.</p>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <h2>Facturation</h2>
      <p class="muted" style="margin-top:2px">Tous les prix se saisissent <strong>TTC</strong> dans Locamp. Le HT et la TVA sont calculés automatiquement d'après le taux de chaque ligne.</p>
      <form id="f-fact-params" class="form-grid" style="margin-top:12px">
        <label>TVA loyer (%)<input name="tva_taux_loyer" type="number" step="0.1" value="${fp.tva_taux_loyer ?? 0}"></label>
        <label>Délai de paiement (jours)<input name="delai_paiement" type="number" step="1" value="${fp.delai_paiement ?? 30}"></label>
        <label class="full">Conditions de règlement<input name="conditions_reglement" value="${esc(fp.conditions_reglement || 'À réception de facture.')}"></label>
        <label class="full">Mention TVA non applicable (si 0 %)<input name="mention_tva" value="${esc(fp.mention_tva || '')}"></label>
        <label class="full">Pénalités de retard<input name="penalites" value="${esc(fp.penalites || '')}"></label>
        <label class="full">Message e-mail (paragraphe ajouté au corps)<input name="message_email" value="${esc(fp.message_email || '')}"></label>
        <label>Expéditeur e-mail<input name="email_exp" id="cfg-exp" type="email" value="${esc(fp.email || '')}"
          placeholder="contact@votre-camping.fr"
          title="L'adresse qui apparaît comme expéditeur des factures. Sans elle, le serveur utilise une adresse de repli que vos résidents ne reconnaissent pas.">
          <span id="cfg-exp-info" class="muted" style="display:block;font-size:12px;margin-top:3px"></span></label>
        <label>Envoi auto de la facture<select name="email_auto"><option value="true"${fp.email_auto === false ? '' : ' selected'}>Activé</option><option value="false"${fp.email_auto === false ? ' selected' : ''}>Désactivé</option></select></label>
        <div class="full"><button class="btn btn-primary">Enregistrer la facturation</button></div>
      </form>
    </div>

    <div class="card" style="margin-top:16px">
      <h2>Taxe de séjour</h2>
      <form id="f-taxe" class="form-grid" style="margin-top:12px">
        <label>Active<select name="actif"><option value="true"${ts.actif ? ' selected' : ''}>Oui</option><option value="false"${ts.actif ? '' : ' selected'}>Non</option></select></label>
        <label>Tarif / nuit / personne (€)<input name="tarif_nuit_personne" type="number" step="0.01" value="${ts.tarif_nuit_personne ?? 0}"></label>
        <p class="muted full" style="margin:0">La taxe de séjour n'est pas soumise à TVA : le tarif saisi est le montant final.</p>
        <div class="full"><button class="btn btn-primary">Enregistrer la taxe</button></div>
      </form>
    </div>

    <div class="card" style="margin-top:16px">
      <h2>Énergie &amp; eau</h2>
      <p class="muted" style="margin-top:2px">Utilisé par l'écran Compteurs : chaque relevé crée une charge (conso × prix kWh) sur la fiche du résident.</p>
      <form id="f-energie" class="form-grid" style="margin-top:12px">
        <label>Prix du kWh TTC (€)<input name="prix_kwh" type="number" step="0.0001" value="${en.prix_kwh ?? ''}" placeholder="0.39"></label>
        <label>TVA électricité (%)<input name="taux_tva" type="number" step="0.1" value="${en.taux_tva ?? 10}"></label>
        <label>Prix du m³ d\u2019eau TTC (€)<input name="prix_m3_eau" type="number" step="0.0001" value="${en.prix_m3_eau ?? ''}" placeholder="4.20"></label>
        <label>TVA eau (%)<input name="taux_tva_eau" type="number" step="0.1" value="${en.taux_tva_eau ?? 10}"></label>
        <div class="full"><button class="btn btn-primary">Enregistrer l'énergie</button></div>
      </form>
    </div>

    <div class="card" style="margin-top:16px">
      <h2>Relances</h2>
      <p class="muted" style="margin-top:2px">En automatique, les clients en retard reçoivent un rappel par e-mail (au plus un par facture tous les 7 jours).</p>
      <form id="f-relances" class="form-grid" style="margin-top:12px">
        <label>Relances automatiques<select name="auto"><option value="false"${rl.auto === true ? '' : ' selected'}>Désactivées</option><option value="true"${rl.auto === true ? ' selected' : ''}>Activées (quotidien)</option></select></label>
        <div class="full"><button class="btn btn-primary">Enregistrer les relances</button></div>
      </form>
    </div>

    <div class="card" style="margin-top:16px">
      <h2>Catalogue de ventes</h2>
      <p class="muted" style="margin-top:2px">Articles vendables (jetons de lavage, bouteille de gaz…), réutilisables sur les factures via « Article du catalogue ».</p>
      <table style="margin-top:10px"><thead><tr><th>Désignation</th><th>Unité</th><th class="right">Prix TTC</th><th class="right">TVA</th><th></th></tr></thead>
        <tbody id="art-body"></tbody></table>
      <form id="f-article" class="form-grid" style="margin-top:12px">
        <label>Désignation *<input name="designation" required placeholder="Jeton de lavage"></label>
        <label>Unité<input name="unite" placeholder="unité, jeton, bouteille…"></label>
        <label>Prix TTC (€)<input name="prix_ttc" type="number" step="0.01" value="0"></label>
        <label>TVA (%)<input name="taux_tva" type="number" step="0.1" value="${tvaDefaut}"
          title="Taux repris de Facturation ci-dessus. Modifiable pour cet article."></label>
        <div class="full"><button class="btn btn-primary">Ajouter l'article</button></div>
      </form>
    </div>`;

  const renderArts = (list) => {
    $('#art-body').innerHTML = (list || []).filter((a) => a.actif !== false).map((a) => `
      <tr>
        <td><strong>${esc(a.designation)}</strong></td>
        <td class="muted">${esc(a.unite || '—')}</td>
        <td class="right">${eur(Number(a.prix_ht) * (1 + Number(a.taux_tva || 0) / 100))}</td>
        <td class="right">${Number(a.taux_tva)} %</td>
        <td class="right"><button class="btn btn-ghost btn-sm" data-act="supprimerArticle" data-a1="${a.id}">Retirer</button></td>
      </tr>`).join('') || '<tr><td colspan="5" class="muted">Aucun article. Ajoutez le premier ci-dessous.</td></tr>';
  };
  renderArts(articles);

  $('#f-article').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    body.prix_ttc = Number(body.prix_ttc || 0);
    body.taux_tva = Number(body.taux_tva || 0);
    try {
      await api('/api/articles', { method: 'POST', body });
      const { articles: list } = await api('/api/articles?inclure_inactifs=1');
      renderArts(list); e.target.reset(); toast('Article ajouté');
    } catch (err) { toast(err.message, true); }
  });

  if ($('#ef-pa')) efRenderChamps();
  if ($('#erep-histo')) efHistorique();
  if ($('#recues-zone')) efRecuesLoad();
  if ($('#modeles-zone')) chargerModelesContrat();

  $('#f-ident').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    try { await api('/api/camping', { method: 'PUT', body }); toast('Identité enregistrée'); }
    catch (err) { toast(err.message, true); }
  });

  $('#f-fact-params').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    const facturation = {
      ...fp,
      tva_taux_loyer: Number(f.tva_taux_loyer || 0),
      delai_paiement: Number(f.delai_paiement || 30),
      conditions_reglement: f.conditions_reglement,
      mention_tva: f.mention_tva,
      penalites: f.penalites,
      message_email: f.message_email,
      email: f.email_exp || undefined,
      email_auto: f.email_auto === 'true',
    };
    try { await api('/api/camping/parametres', { method: 'PUT', body: { facturation, exercice_debut_mois: Number(f.exercice_debut_mois || 1) } }); toast('Facturation enregistrée'); }
    catch (err) { toast(err.message, true); }
  });

  $('#f-taxe').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    const taxe_sejour = { ...ts, actif: f.actif === 'true', tarif_nuit_personne: Number(f.tarif_nuit_personne || 0) };
    try { await api('/api/camping/parametres', { method: 'PUT', body: { taxe_sejour } }); toast('Taxe de séjour enregistrée'); }
    catch (err) { toast(err.message, true); }
  });

  $('#f-energie').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    const energie = { ...en,
      prix_kwh: f.prix_kwh === '' ? null : Number(f.prix_kwh), taux_tva: Number(f.taux_tva || 10),
      prix_m3_eau: f.prix_m3_eau === '' ? null : Number(f.prix_m3_eau), taux_tva_eau: Number(f.taux_tva_eau || 10) };
    try { await api('/api/camping/parametres', { method: 'PUT', body: { energie } }); toast('Énergie enregistrée'); }
    catch (err) { toast(err.message, true); }
  });

  $('#f-relances').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    const relances = { ...rl, auto: f.auto === 'true' };
    try { await api('/api/camping/parametres', { method: 'PUT', body: { relances } }); toast('Relances enregistrées'); }
    catch (err) { toast(err.message, true); }
  });
}

window.uploadLogo = async () => {
  const input = $('#logo-file');
  if (!input.files || !input.files[0]) { toast('Choisis une image', true); return; }
  const fd = new FormData(); fd.append('file', input.files[0]);
  try { await api('/api/camping/logo', { method: 'POST', body: fd }); toast('Logo mis à jour'); route(); }
  catch (err) { toast(err.message, true); }
};

window.supprimerArticle = async (id) => {
  if (!await askConfirm('Retirer cet article du catalogue ?')) return;
  try { await api(`/api/articles/${id}`, { method: 'DELETE' }); toast('Article retiré'); route(); }
  catch (err) { toast(err.message, true); }
};

window.formFacture = async (presetResidentId, preset) => {
  const [{ residents }, artRes] = await Promise.all([
    api('/api/residents'),
    api('/api/articles').catch(() => ({ articles: [] })),
  ]);
  const actifs = residents.filter((r) => r.actif !== false);
  const articles = artRes.articles || [];
  const articleMap = {}; articles.forEach((a) => { articleMap[a.id] = a; });
  const mois = (preset && preset.periode) || new Date().toISOString().slice(0, 7);

  const ligneRow = (p = {}) => `
    <div class="fac-ligne">
      <input name="designation" placeholder="Désignation" required value="${esc(p.designation || '')}">
      <div class="fac-grid">
        <label >Du<input name="date_debut" type="date" value="${p.date_debut || ''}"></label>
        <label >Au<input name="date_fin" type="date" value="${p.date_fin || ''}"></label>
        <label >Qté<input name="quantite" type="number" step="0.01" value="${p.quantite ?? 1}"></label>
        <label >PU TTC €<input name="pu_ttc" type="number" step="0.01" required value="${p.pu_ttc ?? ''}"></label>
        <label >TVA %<input name="taux_tva" type="number" step="0.1" value="${p.taux_tva ?? 0}"></label>
      </div>
      <div class="fac-foot">
        <button type="button" class="btn btn-ghost btn-sm" data-act="retirerLigne" data-a1=".fac-ligne">Retirer la ligne</button>
      </div>
    </div>`;

  openDrawer(`
    <h2>Nouvelle facture / vente</h2>
    <form id="f-fac" class="form-grid" style="margin-top:14px">
      <label class="full">Résident *
        <select name="resident_id" required>
          <option value="">— choisir —</option>
          ${actifs.map((r) => `<option value="${r.id}"${r.id === presetResidentId ? ' selected' : ''}>${esc(r.prenom || '')} ${esc(r.nom)}${r.email ? ` · ${esc(r.email)}` : ''}</option>`).join('')}
        </select></label>
      <label>Période<input name="periode" type="month" value="${mois}"></label>
      ${articles.length ? `<div class="full" style="display:flex;gap:8px;align-items:flex-end">
        <label style="flex:1;margin:0">Article du catalogue
          <select id="cat-select">${articles.map((a) => `<option value="${a.id}">${esc(a.designation)} — ${eur(Number(a.prix_ht) * (1 + Number(a.taux_tva || 0) / 100))} TTC</option>`).join('')}</select></label>
        <button type="button" class="btn btn-ghost btn-sm" data-act="ajouterLigneCatalogue">+ Ajouter</button>
      </div>` : ''}
      <div class="full">
        <div class="muted" style="margin-bottom:6px">Lignes — loyer, taxe, charges, ventes…</div>
        <div id="fac-lignes">${(preset && preset.lignes ? preset.lignes.map((l) => ligneRow(l)).join('') : ligneRow())}</div>
        <button type="button" class="btn btn-ghost btn-sm" data-act="ajouterLigneFacture" style="margin-top:4px">+ Ligne libre</button>
      </div>
      <div class="full"><button class="btn btn-primary btn-block">Créer la facture</button></div>
    </form>`);

  window.ajouterLigneFacture = () => { $('#fac-lignes').insertAdjacentHTML('beforeend', ligneRow()); };
  window.ajouterLigneCatalogue = () => {
    const a = articleMap[$('#cat-select').value];
    if (!a) return;
    const ttc = (Number(a.prix_ht) * (1 + Number(a.taux_tva || 0) / 100)).toFixed(2);
    $('#fac-lignes').insertAdjacentHTML('beforeend', ligneRow({ designation: a.designation, pu_ttc: ttc, taux_tva: a.taux_tva, quantite: 1 }));
  };

  $('#f-fac').addEventListener('submit', async (e) => {
    e.preventDefault();
    const resident_id = e.target.resident_id.value;
    const periode = e.target.periode.value || undefined;
    const lignes = [...e.target.querySelectorAll('.fac-ligne')].map((row) => ({
      designation: row.querySelector('[name=designation]').value.trim(),
      date_debut: row.querySelector('[name=date_debut]').value || undefined,
      date_fin: row.querySelector('[name=date_fin]').value || undefined,
      quantite: Number(row.querySelector('[name=quantite]').value || 1),
      pu_ttc: Number(row.querySelector('[name=pu_ttc]').value || 0),
      taux_tva: Number(row.querySelector('[name=taux_tva]').value || 0),
    })).filter((l) => l.designation && l.pu_ttc);
    if (!resident_id) { toast('Choisis un résident', true); return; }
    if (!lignes.length) { toast('Ajoute au moins une ligne (désignation + PU TTC)', true); return; }
    try {
      const { facture } = await api('/api/factures', { method: 'POST', body: { resident_id, periode, lignes } });
      closeDrawer();
      toast(`Facture ${facture.numero} créée`);
      route();
    } catch (err) { toast(err.message, true); }
  });
};

// Duplique une facture sur le mois suivant : période +1, dates de lignes +1 mois,
// libellés de mois ajustés. Ouvre le formulaaire prérempli pour vérification.
window.dupliquerFacture = async (id) => {
  try {
    const { facture: f } = await api('/api/factures/' + id);
    const lignes = (f.lignes || []).map((l) => ({
      designation: shiftMoisTexte(l.designation, 1),
      date_debut: l.date_debut ? addMoisISO(l.date_debut, 1) : undefined,
      date_fin: l.date_fin ? addMoisISO(l.date_fin, 1) : undefined,
      quantite: l.quantite,
      pu_ttc: (Number(l.pu_ht || 0) * (1 + Number(l.taux_tva || 0) / 100)).toFixed(2),
      taux_tva: l.taux_tva,
    }));
    formFacture(f.resident_id, { periode: addMoisPeriode(f.periode, 1) || undefined, lignes });
    toast('Facture dupliquée sur le mois suivant — vérifier puis créer');
  } catch (e) { toast(e.message, true); }
};

window.runFacturation = async () => {
  try {
    const periode = $('#fac-periode').value;
    const r = await api('/api/factures/run-mensuel', { method: 'POST', body: { periode } });
    toast(`Facturation ${r.periode} : ${r.crees} créée(s), ${r.ignores} ignorée(s)`);
    route();
  } catch (e) { toast(e.message, true); }
};
window.pdfFacture = async (id) => {
  try { const { url } = await api(`/api/factures/${id}/pdf`); window.open(url, '_blank'); }
  catch (e) { toast(e.message, true); }
};
window.emailFacture = async (id) => {
  try {
    const r = await api(`/api/factures/${id}/email`, { method: 'POST' });
    toast(`Facture envoyée à ${r.to || 'le résident'}`);
  } catch (e) { toast(e.message, true); }
};
window.faireAvoir = async (id) => {
  if (!await askConfirm('Émettre un avoir et annuler cette facture ?')) return;
  try { await api(`/api/factures/${id}/avoir`, { method: 'POST' }); toast('Avoir émis'); route(); }
  catch (e) { toast(e.message, true); }
};

/* ---------- Règlements ---------- */

/** Ce qu'on attend comme référence, par TYPE de moyen de paiement.
    La règle suit le type configuré dans Administration, pas une liste de
    codes : un moyen ajouté demain (« Chèque BNP », code maison) hérite de
    la règle du moment qu'il est typé « cheque ». Une liste de codes
    l'aurait oublié en silence.

    obligatoire : sans cette référence, la ligne du relevé bancaire ne peut
    plus être reliée à l'encaissement au moment du rapprochement. */
const REF_PAR_TYPE = {
  cheque:   { requis: true,  aide: 'N° du chèque', exemple: 'ex. 7845213' },
  virement: { requis: true,  aide: 'Libellé du virement', exemple: 'tel qu\u2019il apparaît sur le relevé' },
  ancv:     { requis: true,  aide: 'N° du titre ANCV', exemple: 'ex. 0123456789' },
  espece:   { requis: false, aide: 'Référence', exemple: 'facultatif — rien à référencer' },
  carte:    { requis: false, aide: 'Référence', exemple: 'facultatif — n° de ticket TPE' },
  stripe:   { requis: false, aide: 'Référence', exemple: 'facultatif' },
  autre:    { requis: false, aide: 'Référence', exemple: 'facultatif' },
};
/* Repli quand le moyen n'a pas de type connu : facultatif. Rendre
   obligatoire un champ dont on ne sait pas ce qu'il doit contenir
   bloquerait la saisie sans rien apprendre à personne. */
const REF_DEFAUT = { requis: false, aide: 'Référence', exemple: 'facultatif' };
function regleRef(type) { return REF_PAR_TYPE[String(type || '')] || REF_DEFAUT; }

async function vueReglements() {
  const [{ reglements }, { residents }, moyRes] = await Promise.all([
    api('/api/reglements' + exQS()), api('/api/residents'),
    api('/api/moyens-paiement').catch(() => ({ moyens: [] })),
  ]);
  const rmap = {}; residents.forEach((r) => { rmap[r.id] = `${r.prenom || ''} ${r.nom}`.trim(); });
  const moyens = moyRes.moyens || [];
  const mlib = {}; moyens.forEach((m) => { mlib[m.code] = m.libelle; });

  $('#main').innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Encaissements</div><h1>Règlements</h1></div></div>
    <div class="card">
      <h2>Enregistrer un paiement</h2>
      <form id="f-reg" class="form-grid" style="margin-top:10px">
        ${/* Sans option vide, un <select required> est considéré rempli par le
             navigateur : valider sans y toucher enregistrait le paiement au nom
             du PREMIER résident de la liste, avec lettrage automatique sur ses
             factures. Le tiroir « Nouvelle facture » ouvre bien sur « choisir ». */''}
        <label>Résident *<select name="resident_id" required>
          <option value="">— choisir —</option>
          ${residents.map((r) => `<option value="${r.id}">${esc(rmap[r.id])}</option>`).join('')}</select></label>
        <label>Moyen de paiement *<select name="mode" required>
          ${moyens.length
            ? moyens.map((m) => `<option value="${esc(m.code)}">${esc(m.libelle)}</option>`).join('')
            : '<option value="espece">Espèces</option><option value="cheque">Chèque</option>'}
        </select></label>
        <label>Montant (€) *<input name="montant" type="number" step="0.01" required></label>
        ${/* L'ancien texte d'aide énumérait les trois cas — « n° chèque, n° titre
             ANCV, libellé virement… » — et laissait trier mentalement lequel
             s'applique. Le libellé suit maintenant le moyen choisi. */''}
        <label><span id="reg-ref-label">Référence</span><input name="reference" id="reg-ref"></label>
        <div class="full"><button class="btn btn-primary">Encaisser (lettrage automatique)</button></div>
      </form>
      ${moyens.length ? '' : '<p class="muted" style="margin-top:8px">Moyens de paiement par défaut — configurez-les dans Administration.</p>'}
    </div>
    <div class="card"><table><thead><tr><th>Date</th><th>Résident</th><th>Moyen</th><th>Référence</th><th class="right">Montant</th></tr></thead>
    <tbody>${reglements.map((g) => `
      ${/* L'heure de saisie en infobulle : deux paiements de même date, même
           résident, même montant et sans référence étaient indistinguables —
           impossible de dire si c'était une double saisie. */''}
      <tr><td class="muted"${g.created_at ? ` title="Saisi le ${new Date(g.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}"` : ''}>${dfr(g.date_reglement)}</td><td>${esc(rmap[g.resident_id] || '—')}</td>
      <td class="muted">${esc(mlib[g.mode] || g.mode)}</td><td class="muted">${esc(g.reference || '—')}</td>
      <td class="right"><strong>${eur(g.montant)}</strong></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Aucun règlement enregistré.</td></tr>'}</tbody>
    ${reglements.length ? `<tfoot><tr><td colspan="4" class="right muted">Total encaissé — ${reglements.length} règlement${reglements.length > 1 ? 's' : ''}</td>
      <td class="right"><strong>${eur(reglements.reduce((s, g) => s + Number(g.montant || 0), 0))}</strong></td></tr></tfoot>` : ''}</table></div>`;

  /* Le type du moyen, par code : c'est lui qui décide si la référence est
     obligatoire. moyens vient de /api/moyens-paiement ; sans configuration,
     les deux options de repli portent leur type dans leur valeur. */
  const typeParCode = {};
  moyens.forEach((m) => { typeParCode[m.code] = m.type; });
  if (!moyens.length) { typeParCode.espece = 'espece'; typeParCode.cheque = 'cheque'; }

  const majChampRef = () => {
    const champ = $('#reg-ref');
    const lab = $('#reg-ref-label');
    if (!champ || !lab) return;
    const code = $('#f-reg').mode?.value;
    const r = regleRef(typeParCode[code]);
    lab.innerHTML = esc(r.aide) + (r.requis ? ' *' : '');
    champ.placeholder = r.exemple;
    champ.required = r.requis;
  };
  $('#f-reg').mode?.addEventListener('change', majChampRef);
  majChampRef();

  $('#f-reg').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    body.montant = Number(body.montant);
    if (!body.resident_id) { toast('Choisissez le résident.', true); return; }
    if (!(body.montant > 0)) { toast('Le montant doit être supérieur à zéro.', true); return; }

    /* Refait ici et pas seulement par l'attribut required : changer le moyen
       après avoir saisi la référence, ou l'inverse, ne doit pas passer entre
       les mailles. Sans référence, un chèque ou un virement est introuvable
       au rapprochement bancaire. */
    const regle = regleRef(typeParCode[body.mode]);
    if (regle.requis && !String(body.reference || '').trim()) {
      const nom = (mlib[body.mode] || body.mode || 'ce moyen').toLowerCase();
      toast(regle.aide + ' obligatoire pour un paiement par ' + nom
        + ' : sans elle, l\u2019encaissement ne pourra pas être retrouvé au rapprochement bancaire.', true);
      $('#reg-ref')?.focus();
      return;
    }

    /* Un même montant, le même jour, pour le même résident : c'est peut-être
       deux versements réels, c'est peut-être une double saisie. On ne bloque
       pas — on force le regard, parce qu'après lettrage la correction demande
       d'annuler un règlement déjà imputé sur des factures. */
    const aujourdhui = new Date().toISOString().slice(0, 10);
    const doublonProbable = (reglements || []).some((g) =>
      g.resident_id === body.resident_id
      && String(g.date_reglement).slice(0, 10) === aujourdhui
      && Math.abs(Number(g.montant) - body.montant) < 0.005
      && String(g.mode) === String(body.mode));
    if (doublonProbable) {
      const ok = await askConfirm(
        'Un paiement de ' + eur(body.montant) + ' a déjà été enregistré aujourd\u2019hui pour '
        + (rmap[body.resident_id] || 'ce résident') + ', avec le même moyen.\n\n'
        + 'S\u2019agit-il bien d\u2019un second versement ?'
      );
      if (!ok) return;
    }

    try { await api('/api/reglements', { method: 'POST', body }); toast('Paiement enregistré et lettré'); route(); }
    catch (err) { toast(err.message, true); }
  });

  $('#main').insertAdjacentHTML('beforeend', '<div id="remises-zone"></div>');
  chargerRemises();
}

// Remises en banque : un bordereau par moyen de paiement (chèques ≠ ANCV).
async function chargerRemises() {
  const zone = $('#remises-zone');
  if (!zone) return;
  try {
    const { moyens, en_attente, remises } = await api('/api/remises');

    // regroupement des règlements en attente par moyen
    const parMoyen = {};
    (en_attente || []).forEach((c) => { (parMoyen[c.mode] ||= []).push(c); });

    const blocsAttente = (moyens || []).map((m) => {
      const list = parMoyen[m.code] || [];
      if (!list.length) return '';
      const total = list.reduce((s, c) => s + Number(c.montant), 0);
      return `
      <div class="card">
        <div class="card-actions">
          <h2>${esc(m.libelle)} à remettre <span class="map-count">${list.length}</span></h2>
          <button class="btn btn-primary btn-sm" data-act="creerRemise" data-a1="${esc(m.code)}" data-a2="${esc(m.libelle)}">Créer le bordereau</button>
        </div>
        <table><thead><tr><th></th><th>Date</th><th>Tireur</th><th>Référence</th><th class="right">Montant</th></tr></thead>
        <tbody>${list.map((c) => `<tr>
          <td><input type="checkbox" class="chk-remise" data-moyen="${esc(m.code)}" value="${c.id}" checked></td>
          <td class="muted">${dfr(c.date_reglement)}</td><td>${esc(c.tireur)}</td>
          <td class="muted">${esc(c.reference || '—')}</td>
          <td class="right"><strong>${eur(c.montant)}</strong></td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="4" class="right muted">Total sélectionnable</td>
          <td class="right"><strong>${eur(total)}</strong></td></tr></tfoot></table>
      </div>`;
    }).join('');

    const badgeStatut = (s) => s === 'encaissee'
      ? '<span class="badge reglee">encaissée</span>'
      : s === 'annulee' ? '<span class="badge annulee">annulée</span>'
      : '<span class="badge emise">remise</span>';

    zone.innerHTML = `
      ${blocsAttente || `<div class="card"><p class="muted" style="margin:0">Aucun règlement en attente de remise${(() => {
        /* Le message énumérait « chèques, ANCV » en dur, alors que « se remet en
           banque » est une case à cocher par moyen dans Administration : un
           camping peut y mettre les espèces, et la remise R-2026-001 le prouve.
           On nomme donc ce qui est réellement configuré. */
        const noms = (moyens || []).filter((m) => m.remisable).map((m) => m.libelle);
        return noms.length ? ' (' + noms.join(', ') + ')' : '';
      })()}.</p></div>`}
      <div class="card">
        <h2>Remises en banque</h2>
        ${(remises || []).length ? `<table><thead><tr><th>N°</th><th>Date</th><th>Moyen</th><th>Banque</th><th>Titres</th><th class="right">Total</th><th>Statut</th><th></th></tr></thead>
        <tbody>${remises.map((r) => `<tr${r.statut === 'annulee' ? ' style="opacity:.6"' : ''}>
          <td><strong>${esc(r.numero)}</strong></td>
          <td class="muted">${dfr(r.date_remise)}</td>
          <td class="muted">${esc(r.moyen_libelle || '—')}</td>
          <td class="muted">${esc(r.banque || '—')}</td>
          <td>${r.nb_cheques}</td>
          <td class="right">${eur(r.total)}</td>
          <td>${badgeStatut(r.statut)}${r.motif_annulation ? `<div class="muted" style="font-size:11px;margin-top:2px">${esc(r.motif_annulation)}</div>` : ''}</td>
          <td class="right">
            <button class="btn btn-ghost btn-sm" data-act="pdfRemise" data-a1="${r.id}" data-a2="${esc(r.numero)}">Bordereau</button>
            ${r.statut === 'remise' ? `<button class="btn btn-ghost btn-sm" data-act="encaisserRemise" data-a1="${r.id}">Marquer encaissée</button>` : ''}
            ${r.statut !== 'annulee' ? `<button class="btn btn-ghost btn-sm" data-act="annulerRemise" data-a1="${r.id}" data-a2="${esc(r.numero)}" data-a3="${r.statut === 'encaissee'}" data-bool="3">Annuler</button>` : ''}
          </td></tr>`).join('')}</tbody></table>` : '<p class="muted">Aucune remise.</p>'}
      </div>`;
  } catch (e) {
    zone.innerHTML = `<p class="form-error">Remises : ${esc(e.message)}</p>`;
  }
}

window.creerRemise = async (code, libelle) => {
  const ids = [...document.querySelectorAll(`.chk-remise[data-moyen="${code}"]:checked`)].map((x) => x.value);
  if (!ids.length) { toast('Sélectionnez au moins un titre', true); return; }
  const banque = await askPrompt(`Banque pour ce bordereau ${libelle} (optionnel) :`) || undefined;
  try {
    const { remise } = await api('/api/remises', { method: 'POST', body: { reglement_ids: ids, banque } });
    toast(`Bordereau ${remise.numero} créé — ${ids.length} ${libelle.toLowerCase()}(s)`);
    chargerRemises();
  } catch (e) { toast(e.message, true); }
};

window.pdfRemise = async (id, numero) => {
  telechargerExport('/api/remises/' + id + '/pdf', 'remise_' + numero + '.pdf');
};

window.encaisserRemise = async (id) => {
  if (!await askConfirm('Marquer cette remise comme encaissée en banque ?')) return;
  try { await api(`/api/remises/${id}/encaisser`, { method: 'PUT' }); toast('Remise encaissée'); chargerRemises(); }
  catch (e) { toast(e.message, true); }
};

// Annulation : motif obligatoire, remise conservée (statut « annulée »), tout est tracé.
window.annulerRemise = async (id, numero, etaitEncaissee) => {
  const avert = etaitEncaissee
    ? `\n\nATTENTION : cette remise est DÉJÀ ENCAISSÉE. L'annulation ne supprime pas l'encaissement bancaire — pense à passer la contre-écriture en comptabilité.`
    : '';
  const motif = await askPrompt(`Annuler la remise ${numero} ?${avert}\n\nMotif d'annulation (obligatoire, conservé au journal) :`);
  if (motif === null) return;
  if (motif.trim().length < 3) { toast('Motif obligatoire (3 caractères minimum)', true); return; }
  try {
    const r = await api(`/api/remises/${id}/annuler`, { method: 'PUT', body: { motif: motif.trim() } });
    toast(r.message || 'Remise annulée');
    chargerRemises();
  } catch (e) { toast(e.message, true); }
};

/* ---------- Impayés ---------- */
/* ---------- Impayes : un debiteur par ligne ----------
   L'unite du recouvrement est la personne, pas la facture. */
let IMP_SEL = null;
let IMP_FILTRE = 'retard';
let IMP_Q = '';
let IMP_CACHE = { debiteurs: [], delai: 30 };

const IMP_AMBRE = '#7A5A22';

const IMP_FILTRES = [
  ['retard', 'En retard', (d) => d.montantRetard > 0.005],
  ['tous', 'Tous', () => true],
  ['grave', 'Retard 60 j et +', (d) => d.pireRetard > 60],
  ['echoir', 'À échoir seulement', (d) => d.montantRetard <= 0.005],
];

function impVisibles() {
  const f = (IMP_FILTRES.find((x) => x[0] === IMP_FILTRE) || IMP_FILTRES[0])[2];
  const q = IMP_Q.trim().toLowerCase();
  return IMP_CACHE.debiteurs.filter((d) => {
    if (!f(d)) return false;
    if (!q) return true;
    return (d.nom + ' ' + d.factures.map((x) => x.numero || '').join(' ')).toLowerCase().includes(q);
  });
}

function impRetardTexte(j) {
  if (j <= 0) return { txt: 'À échoir', col: 'var(--sapin)' };
  if (j <= 30) return { txt: j + ' j de retard', col: IMP_AMBRE };
  return { txt: j + ' j de retard', col: 'var(--rouge)' };
}

function impLigneListe(d) {
  const sel = d.id === IMP_SEL;
  const r = impRetardTexte(d.pireRetard);
  return `
    <div data-act="ouvrirDebiteur" data-a1="${d.id}"
         style="display:flex;align-items:center;gap:12px;padding:0 18px;height:62px;cursor:pointer;
                border-bottom:1px solid var(--hairline);
                background:${sel ? 'var(--sapin-pale)' : 'transparent'};
                box-shadow:${sel ? 'inset 3px 0 0 var(--sapin)' : 'none'}">
      <div style="min-width:0;flex:1">
        <div style="font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          ${esc(d.nom)}</div>
        <div class="muted" style="font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          ${d.factures.length} facture${d.factures.length > 1 ? 's' : ''}${d.relances ? ' · ' + d.relances + ' relance' + (d.relances > 1 ? 's' : '') : ''}</div>
      </div>
      <div style="text-align:right;flex:none">
        <div style="font-size:14px;font-variant-numeric:tabular-nums;font-weight:600">${eur(d.total)}</div>
        <div style="font-size:11.5px;font-weight:600;margin-top:2px;color:${r.col}">${r.txt}</div>
      </div>
    </div>`;
}

function majListeImpayes() {
  const box = $('#imp-liste');
  if (!box) return;
  const v = impVisibles();
  box.innerHTML = v.length ? v.map(impLigneListe).join('')
    : '<p class="muted" style="padding:18px">Aucun débiteur ne correspond.</p>';
  const n = $('#imp-compte');
  if (n) {
    const somme = v.reduce((s, d) => s + d.total, 0);
    n.textContent = v.length
      ? `${v.length} débiteur${v.length > 1 ? 's' : ''} · ${eur(somme)}`
      : '';
  }
}

window.ouvrirDebiteur = (id) => { IMP_SEL = id; majFicheDebiteur(); majListeImpayes(); };
window.filtrerImpayes = (k) => { IMP_FILTRE = k; IMP_SEL = null; vueImpayes(); };
window.chercherImpayes = (v) => { IMP_Q = v; majListeImpayes(); };

function impFiche(d) {
  const r = impRetardTexte(d.pireRetard);
  const lignes = d.factures.slice()
    .sort((a, b) => b.jours_retard - a.jours_retard)
    .map((f) => {
      const fr = impRetardTexte(f.jours_retard);
      return `
      <div style="display:grid;grid-template-columns:1fr 130px 100px 104px;gap:12px;align-items:center;
                  padding:0 18px;height:52px;border-bottom:1px solid var(--hairline)">
        <div style="font-size:13.5px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(f.numero || '—')}</div>
        <div style="font-size:12.5px;color:${fr.col};font-weight:600">${fr.txt}</div>
        <div style="text-align:right;font-size:14px;font-variant-numeric:tabular-nums">${eur(f.reste)}</div>
        <div style="text-align:right">
          <button class="btn btn-ghost btn-sm" data-act="encaisserFacture"
                  data-a1="${f.id}" data-a2="${d.id}" data-a3="${f.reste}" data-num="3">Encaisser</button>
        </div>
      </div>`;
    }).join('');

  return `
    <div style="background:var(--carte);border-bottom:1px solid var(--hairline);padding:22px 26px 18px;
                display:flex;align-items:flex-start;gap:18px;flex-wrap:wrap">
      <div style="flex:1;min-width:220px">
        <h1 style="margin:0;font-size:24px;line-height:1.15">${esc(d.nom)}</h1>
        <div class="muted" style="font-size:13.5px;margin-top:4px">
          ${d.factures.length} facture${d.factures.length > 1 ? 's' : ''} impayée${d.factures.length > 1 ? 's' : ''}
          ${d.email ? ' · ' + esc(d.email) : ''}${d.telephone ? ' · ' + esc(d.telephone) : ''}
        </div>
        <div style="display:flex;gap:7px;margin-top:11px;flex-wrap:wrap">
          <span style="font-size:12.5px;font-weight:600;padding:3px 9px;border-radius:var(--r-s);
                       background:${d.pireRetard > 30 ? 'var(--rouge-pale)' : d.pireRetard > 0 ? 'var(--laiton-pale)' : 'var(--sapin-pale)'};
                       color:${r.col}">${r.txt}</span>
          ${d.relances ? `<span style="font-size:12.5px;padding:3px 9px;border-radius:var(--r-s);background:var(--ivoire);border:1px solid var(--hairline);color:#5D6E66">${d.relances} relance${d.relances > 1 ? 's' : ''} envoyée${d.relances > 1 ? 's' : ''}</span>` : ''}
        </div>
      </div>
      <div style="flex:none;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
        ${d.email ? `<a class="btn btn-ghost btn-sm" href="mailto:${esc(d.email)}">Écrire</a>` : ''}
        <button class="btn btn-primary btn-sm" data-act="allerA" data-a1="#/residents/${d.id}">Ouvrir la fiche</button>
      </div>
    </div>

    <div style="padding:20px 26px;display:flex;flex-direction:column;gap:16px">
      <div class="card" style="display:flex;padding:0">
        <div style="flex:1;padding:13px 18px">
          <div style="font-size:11.5px;font-weight:600;letter-spacing:.09em;color:var(--brume);text-transform:uppercase">Total dû</div>
          <div style="font-size:22px;margin-top:5px;font-variant-numeric:tabular-nums">${eur(d.total)}</div>
        </div>
        <div style="flex:1;padding:13px 18px;border-left:1px solid var(--hairline)">
          <div style="font-size:11.5px;font-weight:600;letter-spacing:.09em;color:var(--brume);text-transform:uppercase">Dont en retard</div>
          <div style="font-size:22px;margin-top:5px;font-variant-numeric:tabular-nums;${d.montantRetard > 0.005 ? 'color:var(--rouge);font-weight:600' : ''}">${d.montantRetard > 0.005 ? eur(d.montantRetard) : '—'}</div>
        </div>
        <div style="flex:1;padding:13px 18px;border-left:1px solid var(--hairline)">
          <div style="font-size:11.5px;font-weight:600;letter-spacing:.09em;color:var(--brume);text-transform:uppercase">Plus ancienne</div>
          <div style="font-size:22px;margin-top:5px;font-variant-numeric:tabular-nums">${d.pireRetard > 0 ? d.pireRetard + ' j' : '—'}</div>
        </div>
      </div>

      <div class="card" style="padding:0;overflow:hidden">
        <div style="padding:13px 18px;border-bottom:1px solid var(--hairline);display:flex;
                    align-items:center;justify-content:space-between;gap:12px">
          <div style="font-size:14px;font-weight:600">Factures impayées</div>
          <div class="muted" style="font-size:12.5px">délai de paiement : ${IMP_CACHE.delai} j</div>
        </div>
        ${lignes}
      </div>
    </div>`;
}

function majFicheDebiteur() {
  const box = $('#imp-fiche');
  if (!box) return;
  const d = IMP_CACHE.debiteurs.find((x) => x.id === IMP_SEL);
  box.innerHTML = d ? impFiche(d)
    : `<p class="muted" style="padding:26px">${IMP_CACHE.debiteurs.length
      ? 'Aucun débiteur dans ce filtre.'
      : 'Aucun impayé : toutes les factures de l\'exercice sont réglées.'}</p>`;
}

async function vueImpayes() {
  const [imp, resD, relD] = await Promise.all([
    api('/api/relances/impayes' + exQS()),
    api('/api/residents').catch(() => ({ residents: [] })),
    api('/api/relances').catch(() => ({ relances: [] })),
  ]);
  const info = {};
  (resD.residents || []).forEach((r) => {
    info[r.id] = {
      nom: `${r.prenom || ''} ${r.nom || ''}`.trim() || '—',
      email: r.email || null, telephone: r.telephone || null,
    };
  });
  const nbRelances = {};
  for (const x of (relD.relances || [])) {
    if (x.resident_id) nbRelances[x.resident_id] = (nbRelances[x.resident_id] || 0) + 1;
  }

  /* Regroupement par debiteur : c'est la personne qu'on appelle. */
  const par = new Map();
  for (const f of (imp.impayes || [])) {
    let d = par.get(f.resident_id);
    if (!d) {
      const i = info[f.resident_id] || { nom: 'Résident supprimé', email: null, telephone: null };
      d = { id: f.resident_id, nom: i.nom, email: i.email, telephone: i.telephone,
        factures: [], total: 0, montantRetard: 0, pireRetard: 0, relances: nbRelances[f.resident_id] || 0 };
      par.set(f.resident_id, d);
    }
    d.factures.push(f);
    d.total += Number(f.reste || 0);
    if (f.en_retard) d.montantRetard += Number(f.reste || 0);
    if (f.jours_retard > d.pireRetard) d.pireRetard = f.jours_retard;
  }
  /* Le retard le plus ancien d'abord : c'est l'ordre des appels. */
  const debiteurs = [...par.values()].sort((a, b) => (b.pireRetard - a.pireRetard) || (b.total - a.total));
  IMP_CACHE = { debiteurs, delai: imp.delai };

  const enRetard = (imp.impayes || []).filter((f) => f.en_retard);
  const montantRetard = enRetard.reduce((s, f) => s + Number(f.reste || 0), 0);
  /* Le bouton de relance n'agit que sur les factures echues : le nombre
     annonce avant l'envoi doit etre celui-la. */
  window._impayesEnRetard = enRetard.length;

  const visibles = impVisibles();
  if (IMP_SEL && !debiteurs.some((d) => d.id === IMP_SEL)) IMP_SEL = null;
  if (!IMP_SEL && visibles.length) IMP_SEL = visibles[0].id;

  const compte = (k) => debiteurs.filter((IMP_FILTRES.find((x) => x[0] === k) || IMP_FILTRES[0])[2]).length;
  const puces = IMP_FILTRES.map(([k, l]) => {
    const on = k === IMP_FILTRE;
    return `<button data-act="filtrerImpayes" data-a1="${k}"
      style="padding:4px 11px;border-radius:20px;font-size:12.5px;cursor:pointer;font-family:inherit;
             border:1px solid ${on ? 'var(--nuit)' : 'var(--hairline)'};
             background:${on ? 'var(--nuit)' : 'transparent'};color:${on ? 'var(--ivoire)' : '#5D6E66'};
             font-weight:${on ? '600' : '400'}">${l} ${compte(k)}</button>`;
  }).join('');

  const a = imp.aging;
  const chiffres = [
    { k: 'Créance totale', v: eur(imp.total_du), n: `${(imp.impayes || []).length} facture${(imp.impayes || []).length > 1 ? 's' : ''}`, col: '' },
    { k: 'En retard', v: montantRetard > 0.005 ? eur(montantRetard) : '—', n: `${enRetard.length} facture${enRetard.length > 1 ? 's' : ''} échue${enRetard.length > 1 ? 's' : ''}`, col: montantRetard > 0.005 ? 'var(--rouge)' : '' },
    { k: 'Pas encore échu', v: a.a_echoir > 0.005 ? eur(a.a_echoir) : '—', n: `délai ${imp.delai} j`, col: '' },
    { k: 'Retard 61 j et +', v: (a.j61_90 + a.j90_plus) > 0.005 ? eur(a.j61_90 + a.j90_plus) : '—', n: 'le plus difficile à récupérer', col: (a.j61_90 + a.j90_plus) > 0.005 ? 'var(--rouge)' : '' },
  ];

  $('#main').innerHTML = `
    <div class="page-head"><div><h1>Impayés</h1>
      <div class="muted" style="font-size:13.5px;margin-top:4px">
        ${debiteurs.length} débiteur${debiteurs.length > 1 ? 's' : ''}${enRetard.length ? ' · ' + enRetard.length + ' facture' + (enRetard.length > 1 ? 's' : '') + ' en retard' : ' · rien en retard'}
      </div></div>
      <button class="btn btn-primary" data-act="runRelancesBtn">Envoyer les relances</button></div>

    <div class="card" style="display:flex;padding:0;margin-bottom:14px">
      ${chiffres.map((c, i) => `
        <div style="flex:1;padding:13px 18px;${i ? 'border-left:1px solid var(--hairline)' : ''}">
          <div style="font-size:11.5px;font-weight:600;letter-spacing:.09em;color:var(--brume);text-transform:uppercase">${c.k}</div>
          <div style="font-size:22px;margin-top:5px;font-variant-numeric:tabular-nums;${c.col ? 'color:' + c.col + ';font-weight:600' : ''}">${c.v}</div>
          <div class="muted" style="font-size:12px;margin-top:2px">${c.n}</div>
        </div>`).join('')}
    </div>

    <div class="card" style="padding:0;overflow:hidden;display:flex;align-items:stretch;min-height:520px">
      <div style="width:380px;flex:none;border-right:1px solid var(--hairline);display:flex;flex-direction:column;min-width:0">
        <div style="padding:16px 18px 13px;border-bottom:1px solid var(--hairline);display:flex;flex-direction:column;gap:11px">
          <input id="imp-q" data-act="chercherImpayes" data-evt="input" data-a1="@value"
                 placeholder="Résident, numéro de facture" value="${esc(IMP_Q)}" style="width:100%">
          <div style="display:flex;gap:6px;flex-wrap:wrap">${puces}</div>
          <div id="imp-compte" class="muted" style="font-size:12px"></div>
        </div>
        <div id="imp-liste" style="flex:1;overflow:auto"></div>
      </div>
      <div id="imp-fiche" style="flex:1;min-width:0;background:var(--ivoire)"></div>
    </div>
    <p class="muted" style="margin:10px 0 0;font-size:12.5px">« Envoyer les relances » agit sur toutes les factures échues du camping — il n'existe pas d'envoi par débiteur.</p>`;

  majListeImpayes();
  majFicheDebiteur();
}

window.runRelancesBtn = async () => {
  /* Chaque relance est un e-mail réel, enregistré avec son niveau : la
     prochaine sera une relance de niveau 2, puis 3. Rien ne se rattrape,
     et le bouton partait au premier clic. */
  const n = window._impayesEnRetard || 0;
  if (!n) { toast('Aucune facture en retard : il n\u2019y a rien à relancer.'); return; }

  const ok = await askConfirm(
    'Relancer ' + n + ' facture' + (n > 1 ? 's' : '') + ' en retard ?\n\n'
    + 'Un e-mail part vers chaque résident concerné. La relance est '
    + 'enregistrée : la prochaine sera de niveau supérieur.\n\n'
    + 'Les factures non échues, et celles déjà relancées ces derniers jours, '
    + 'sont laissées de côté.'
  );
  if (!ok) return;

  try {
    const r = await api('/api/relances/run', { method: 'POST' });

    /* Le serveur regroupe sous « ignorees » deux cas distincts : la facture
       n'est pas échue, ou elle a été relancée trop récemment. Les annoncer
       toutes comme « à échoir » laissait croire qu'aucune facture en retard
       n'avait été omise. On ne peut pas les départager depuis la réponse :
       on dit donc les deux raisons, plutôt qu'une seule qui serait fausse. */
    const parts = [r.envoyees + ' relance' + (r.envoyees > 1 ? 's' : '') + ' envoyée' + (r.envoyees > 1 ? 's' : '')];
    if (r.ignorees) parts.push(r.ignorees + ' laissée' + (r.ignorees > 1 ? 's' : '') + ' de côté (non échues ou déjà relancées)');

    /* Les échecs d'envoi — adresse invalide, refus du serveur de mail —
       n'étaient pas affichés : on croyait ses relances parties. */
    if (r.erreurs) {
      toast(parts.join(', ') + ' · ' + r.erreurs + ' envoi' + (r.erreurs > 1 ? 's ont' : ' a')
        + ' échoué : vérifiez les adresses e-mail de ces résidents.', true);
    } else {
      toast(parts.join(', ') + '.');
    }
    route();
  } catch (e) { toast(e.message, true); }
};

/* ---------- Comptabilité ---------- */
/* exerciceCourant supprimée : elle calculait une fin d'exercice un mois
   trop tôt en année civile (30/11 au lieu du 31/12), à cause d'un
   new Date(y, 11, 0) — qui renvoie le dernier jour de NOVEMBRE, les mois
   étant numérotés à partir de zéro.

   exBornesAn(), déjà présente dans ce fichier, fait le même calcul
   correctement. Une seule implémentation désormais : deux fonctions qui
   calculent la même chose finissent toujours par diverger, et c'est la
   fausse qui s'affichait. */
function exerciceCourant(debutMois) {
  return exBornesAn(exAnCourant(debutMois), debutMois);
}

async function telechargerExport(url, filename) {
  try {
    const headers = { Authorization: 'Bearer ' + TOKEN };
    if (ACTIVE_CAMPING) headers['x-camping-id'] = ACTIVE_CAMPING;
    const r = await fetch(API + url, { headers });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'Erreur export'); }
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename; a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) { toast(e.message, true); }
}
window.telechargerExport = telechargerExport;

async function vueCompta() {
  const { camping } = await api('/api/camping');
  const dm = camping?.parametres?.exercice_debut_mois || 1;
  const ex = exerciceCourant(dm);
  const mois = new Date().toISOString().slice(0, 7);

  /* La période d'export partait sur l'exercice ENTIER, donc sur une date de
     fin future tant que l'exercice n'est pas clos. Le fichier produit
     s'appelait alors FEC_2026-12-31.txt en contenant les écritures jusqu'à
     aujourd'hui : un nom qui annonce une période plus large que son contenu.
     Sur un fichier destiné à l'administration, c'est un écart qu'on ne veut
     pas avoir à expliquer.

     On s'arrête donc à aujourd'hui tant que l'exercice court, et à la clôture
     une fois qu'il est terminé. Le champ reste modifiable. */
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const finExportDefaut = ex.fin > aujourdhui ? aujourdhui : ex.fin;
  $('#main').innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Comptabilité</div><h1>Compta & TVA</h1></div>
      <div class="compta-exercice">Exercice en cours
        <strong>${dfr(ex.debut)} → ${dfr(ex.fin)}</strong>${dm !== 1 ? '' : '<span class="muted"> (année civile)</span>'}</div></div>

    
    <div class="compta-duo" style="align-items:start">
    <div class="card">
      <div class="card-actions"><h2>TVA sur les encaissements</h2>
        <div class="toolbar"><input id="tva-mois" type="month" value="${mois}">
        <button class="btn btn-primary btn-sm" data-act="chargerTva">Calculer</button></div></div>
      <p class="muted">TVA exigible au titre des paiements reçus sur le mois (régime des encaissements), ventilée par taux via le lettrage.</p>
      <div id="tva-resultat" style="margin-top:12px"></div>
    </div>

    <div class="card">
      <div class="card-actions"><h2>Indexation des loyers</h2>
        <div class="toolbar">
          <input id="idx-taux" type="number" step="0.01" placeholder="taux %" style="width:90px" title="ex. 3.26 pour +3,26 %">
          <input id="idx-ref" type="text" placeholder="référence (ex. IRL T1 2026)" style="width:230px" title="L’indice qui justifie la revalorisation. Il est conservé dans l’historique et opposable au résident.">
          <button class="btn btn-primary btn-sm" data-act="idxApercu">Aperçu</button>
        </div></div>
      <p class="muted" style="font-size:13px">Revalorise tous les loyers d\u2019un pourcentage (indice IRL, ILC\u2026). Aperçu avant/après, puis application en un clic : les fiches et les modèles partagés sont mis à jour, la facturation suivante applique le nouveau montant. Les contrats signés restent scellés — l\u2019avenant passe par le renouvellement en signature.</p>
      <div id="idx-zone" style="margin-top:10px"></div>
      <h3 style="margin:16px 0 6px;font-size:14px" id="idx-histo-titre" hidden>Campagnes passées</h3>
      <div id="idx-histo" class="muted">Chargement&hellip;</div>
    </div>

    </div>
    <div class="compta-duo">
    <div class="card">
      <div class="card-actions"><h2>Comptes clients (auxiliaires)</h2></div>
      <p class="muted">Chaque client reçoit automatiquement un numéro de compte à sa création (ex. 41100001). Réglez la racine ci-dessous, puis attribuez un compte aux clients existants qui n'en ont pas.</p>
      <div class="toolbar" style="margin-top:10px">
        <label style="margin:0">Racine<input id="cc-racine" value="${esc((camping?.parametres?.comptabilite || {}).racine_client || '411')}" style="width:110px"></label>
        <label style="margin:0">Chiffres de séquence<input id="cc-lng" type="number" min="2" max="8" value="${(camping?.parametres?.comptabilite || {}).longueur_seq_client || 5}" style="width:90px"></label>
        <button class="btn btn-ghost" data-act="enregistrerRacine">Enregistrer</button>
        <button class="btn btn-primary" data-act="attribuerComptes">Attribuer aux clients existants</button>
      </div>
      <p class="muted" style="margin-top:8px">Aperçu : <strong id="cc-apercu"></strong></p>
    </div>

    <div class="card">
      <div class="card-actions"><h2>Exports comptables</h2></div>
      <p class="muted">Exercice en cours, arrêté à aujourd'hui${ex.fin > aujourdhui ? ` — la clôture est prévue le ${dfr(ex.fin)}` : ''}. Modifiable ci-dessous.</p>
      <div class="toolbar" style="margin-top:10px">
        <label style="margin:0">Du<input id="exp-debut" type="date" value="${ex.debut}"></label>
        <label style="margin:0">Au<input id="exp-fin" type="date" value="${finExportDefaut}"></label>
        <button class="btn btn-primary" data-act="exporterCompta" data-a1="fec">Export FEC</button>
        <button class="btn btn-ghost" data-act="exporterCompta" data-a1="csv">Écritures CSV</button>
      </div>
    </div>
    </div>`;
  /* Une date de fin dans le futur produit un fichier dont le nom annonce
     une période que son contenu ne couvre pas. On ne l'interdit pas — on
     peut vouloir préparer un export — mais on le dit. */
  const majAvertExport = () => {
    const fin = $('#exp-fin')?.value;
    let z = $('#exp-avert');
    if (!z) {
      z = document.createElement('p');
      z.id = 'exp-avert';
      z.className = 'muted';
      z.style.cssText = 'margin:10px 0 0;font-size:13px';
      $('#exp-fin')?.closest('.toolbar')?.insertAdjacentElement('afterend', z);
    }
    if (fin && fin > aujourdhui) {
      z.innerHTML = '<span style="color:var(--laiton)">La date de fin est dans le futur : '
        + 'le fichier portera ce nom, mais s\u2019arrêtera aux dernières écritures enregistrées.</span>';
    } else { z.textContent = ''; }
  };
  $('#exp-fin')?.addEventListener('change', majAvertExport);
  majAvertExport();

  majApercuCompte();
  $('#cc-racine').addEventListener('input', majApercuCompte);
  $('#cc-lng').addEventListener('input', majApercuCompte);
  if ($('#idx-histo')) idxHisto();
}

function majApercuCompte() {
  const r = ($('#cc-racine')?.value || '411').replace(/[^0-9A-Za-z]/g, '');
  const l = Math.min(Math.max(Number($('#cc-lng')?.value || 5), 2), 8);
  const el = $('#cc-apercu');
  if (el) el.textContent = r + '1'.padStart(l, '0') + ', ' + r + '2'.padStart(l, '0') + ', …';
}
window.enregistrerRacine = async () => {
  const racine_client = ($('#cc-racine').value || '411').replace(/[^0-9A-Za-z]/g, '');
  const longueur_seq_client = Math.min(Math.max(Number($('#cc-lng').value || 5), 2), 8);
  try {
    const { camping } = await api('/api/camping');
    const comptabilite = { ...((camping.parametres || {}).comptabilite || {}), racine_client, longueur_seq_client };
    await api('/api/camping/parametres', { method: 'PUT', body: { comptabilite } });
    toast('Racine des comptes clients enregistrée');
    majApercuCompte();
  } catch (e) { toast(e.message, true); }
};
window.attribuerComptes = async () => {
  /* Cette action n'envoie PAS la racine : le serveur utilise celle qui est
     enregistrée dans les paramètres. Un utilisateur qui modifie le champ
     puis clique directement ici — « Attribuer » est le bouton plein, donc
     le plus visible — obtient des comptes avec l'ANCIENNE racine, alors
     que l'aperçu juste en dessous affiche la nouvelle.

     Les numéros attribués entrent dans les écritures comptables : on ne
     les reprend pas. Mieux vaut refuser que produire un plan de comptes
     que personne n'a voulu. */
  let racineEnregistree = null;
  let longueurEnregistree = null;
  try {
    const { camping } = await api('/api/camping');
    const c = (camping.parametres || {}).comptabilite || {};
    racineEnregistree = String(c.racine_client || '411');
    longueurEnregistree = Number(c.longueur_seq_client || 5);
  } catch (e) { /* on continue : le contrôle ci-dessous est simplement ignoré */ }

  const racineSaisie = ($('#cc-racine')?.value || '411').replace(/[^0-9A-Za-z]/g, '');
  const longueurSaisie = Math.min(Math.max(Number($('#cc-lng')?.value || 5), 2), 8);

  if (racineEnregistree !== null
      && (racineSaisie !== racineEnregistree || longueurSaisie !== longueurEnregistree)) {
    toast('La racine affichée (' + racineSaisie + ', ' + longueurSaisie + ' chiffres) n\u2019est pas celle '
      + 'enregistrée (' + racineEnregistree + ', ' + longueurEnregistree + ' chiffres). '
      + 'Cliquez d\u2019abord sur « Enregistrer » : sinon les comptes seraient créés avec l\u2019ancienne racine.', true);
    $('#cc-racine')?.focus();
    return;
  }

  /* Combien de clients sont concernés. Trois ou trois cents, ce n'est pas
     la même décision — et la confirmation ne le disait pas. */
  let sansCompte = null;
  try {
    const { residents } = await api('/api/residents');
    if (Array.isArray(residents) && residents.length && 'compte_comptable' in residents[0]) {
      sansCompte = residents.filter((r) => !String(r.compte_comptable || '').trim()).length;
    }
  } catch (e) { /* compte indisponible : on le dira plutôt que d'inventer un nombre */ }

  const laRacine = racineEnregistree || racineSaisie;
  if (sansCompte === 0) {
    toast('Tous les clients ont déjà un numéro de compte.');
    return;
  }

  const combien = sansCompte === null
    ? 'aux clients qui n\u2019en ont pas'
    : sansCompte + ' client' + (sansCompte > 1 ? 's' : '');

  const ok = await askConfirm(
    'Attribuer un numéro de compte à ' + combien + ' ?\n\n'
    + 'Les comptes seront créés en ' + laRacine + ', sur '
    + (longueurEnregistree || longueurSaisie) + ' chiffres — par exemple '
    + laRacine + String(1).padStart(longueurEnregistree || longueurSaisie, '0') + '.\n\n'
    + 'Un numéro de compte auxiliaire entre dans les écritures comptables : '
    + 'il ne se reprend pas ensuite.'
  );
  if (!ok) return;

  try {
    const r = await api('/api/residents/attribuer-comptes', { method: 'POST' });
    toast(r.attribues + ' compte' + (r.attribues > 1 ? 's' : '') + ' attribué' + (r.attribues > 1 ? 's' : '')
      + (r.attribues ? ' en ' + laRacine + '.' : '.'));
  } catch (e) { toast(e.message, true); }
};

window.chargerTva = async () => {
  const m = $('#tva-mois').value;
  if (!m) return;
  const [y, mo] = m.split('-').map(Number);
  const debut = `${m}-01`;
  const fin = `${m}-${String(new Date(y, mo, 0).getDate()).padStart(2, '0')}`;
  const el = $('#tva-resultat');
  el.innerHTML = '<p class="muted">Calcul…</p>';
  try {
    const d = await api(`/api/compta/tva-encaissements?debut=${debut}&fin=${fin}`);
    const taux = Object.entries(d.par_taux).sort((a, b) => Number(b[0]) - Number(a[0]));
    el.innerHTML = `
      <table><thead><tr><th>Taux</th><th class="right">Base HT encaissée</th><th class="right">TVA exigible</th><th class="right">TTC encaissé</th></tr></thead>
      <tbody>${taux.map(([t, v]) => `<tr><td><strong>${t} %</strong></td>
        <td class="right">${eur(v.base_ht)}</td><td class="right"><strong>${eur(v.tva)}</strong></td><td class="right">${eur(v.ttc)}</td></tr>`).join('')
        || '<tr><td colspan="4" class="muted">Aucun encaissement sur la période.</td></tr>'}</tbody></table>
      <div style="display:flex;justify-content:space-between;margin-top:12px;flex-wrap:wrap;gap:8px">
        <span class="muted">${d.non_ventile > 0 ? `⚠️ ${eur(d.non_ventile)} encaissés non lettrés (TVA non ventilable) — lettrer les règlements concernés.` : 'Tous les encaissements sont lettrés.'}</span>
        <strong>TVA exigible du mois : ${eur(d.total_tva_exigible)}</strong>
      </div>`;
  } catch (e) { el.innerHTML = `<p class="form-error">${esc(e.message)}</p>`; }
};

/* ---------- go ---------- */
boot();

/* ==================== CLOCHE DE NOTIFICATIONS (staff) ==================== */
/* Cloche dans la barre du haut ; au clic, panneau plein écran centré (overlay). */
(function () {
  let built = false;
  const ICONES = {
    paiement_recu: '💶', paiement_confirme: '✅', nouveau_message: '💬',
    nouvelle_facture: '🧾', relance: '⏰', document_signe: '✍️',
  };
  function tempsRelatif(iso) {
    const d = new Date(iso), diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return "à l'instant";
    if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
    if (diff < 172800) return 'hier';
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  }

  function build() {
    if (built) return;
    const anchor = document.getElementById('logout-btn');
    if (!anchor) return;
    built = true;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-ghost btn-sm';
    btn.title = 'Notifications';
    btn.style.cssText = 'position:relative;padding:6px 9px;line-height:1;margin-right:8px';
    btn.innerHTML = '<span style="font-size:18px"><svg class="nav-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8.5a6 6 0 1 0-12 0c0 6-2 7.5-2 7.5h16s-2-1.5-2-7.5z"/><path d="M13.7 20a2 2 0 0 1-3.4 0"/></svg><span>Notifications</span></span>'
      + '<span id="notif-badge" class="hidden" style="position:absolute;top:-3px;right:-3px;min-width:16px;height:16px;'
      + 'padding:0 4px;border-radius:9px;background:#E5484D;color:#fff;font-size:10px;font-weight:700;'
      + 'display:flex;align-items:center;justify-content:center">0</span>';
    anchor.parentNode.insertBefore(btn, anchor);

    const ov = document.createElement('div');
    ov.id = 'notif-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(15,25,20,.45);'
      + 'display:none;align-items:flex-start;justify-content:center;padding:64px 14px 14px';
    ov.innerHTML = '<div id="notif-card" style="width:100%;max-width:440px;max-height:80vh;background:#fff;'
      + 'border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.3);display:flex;flex-direction:column;overflow:hidden"></div>';
    document.body.appendChild(ov);

    btn.onclick = (e) => { e.stopPropagation(); ouvrir(); };
    ov.addEventListener('click', (e) => { if (e.target === ov) fermer(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fermer(); });

    setInterval(majCompteur, 30000);
    majCompteur();
  }

  async function majCompteur() {
    if (!built) return;
    try {
      const { non_lues } = await api('/api/notifications/compteur');
      const b = document.getElementById('notif-badge');
      if (!b) return;
      b.textContent = non_lues > 99 ? '99+' : non_lues;
      b.classList.toggle('hidden', !non_lues);
    } catch { /* table absente / non connecté */ }
  }

  function fermer() { const o = document.getElementById('notif-overlay'); if (o) o.style.display = 'none'; }

  async function ouvrir() {
    const o = document.getElementById('notif-overlay'); const card = document.getElementById('notif-card');
    if (!o || !card) return;
    o.style.display = 'flex';
    card.innerHTML = '<div style="padding:26px;color:#999;font-size:14px">Chargement…</div>';
    try {
      const { notifications } = await api('/api/notifications?limit=40');
      rendre(notifications || []);
    } catch (e) {
      card.innerHTML = `<div style="padding:26px;color:#B3492F;font-size:14px">${esc(e.message)}</div>`;
    }
  }

  function rendre(list) {
    const card = document.getElementById('notif-card');
    const nonLues = list.filter((n) => !n.lu).length;
    let html = '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;'
      + 'padding:16px 18px;border-bottom:1px solid #EFEBE1;flex-shrink:0">'
      + '<strong style="font-size:16px">Notifications</strong>'
      + '<div style="display:flex;gap:14px;align-items:center">'
      + (nonLues ? '<a href="#" id="notif-tout-lu" style="font-size:13px;color:#1A7A5E;text-decoration:none">Tout marquer lu</a>' : '')
      + '<button id="notif-close" aria-label="Fermer" style="background:none;border:none;font-size:24px;line-height:1;cursor:pointer;color:#999;padding:0 2px">×</button>'
      + '</div></div><div style="overflow:auto;flex:1;-webkit-overflow-scrolling:touch">';

    if (!list.length) {
      html += '<div style="padding:44px 20px;text-align:center;color:#999;font-size:14px">Aucune notification</div>';
    } else {
      html += list.map((n) => `
        <div class="notif-item" data-id="${esc(n.id)}" style="display:flex;gap:12px;padding:14px 18px;cursor:pointer;
          border-bottom:1px solid #F4F1E9;${n.lu ? '' : 'background:#F5FBF8'}">
          <span style="font-size:21px;line-height:1.2;flex-shrink:0">${ICONES[n.type] || '<svg class="nav-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8.5a6 6 0 1 0-12 0c0 6-2 7.5-2 7.5h16s-2-1.5-2-7.5z"/><path d="M13.7 20a2 2 0 0 1-3.4 0"/></svg><span>Notifications</span>'}</span>
          <div style="min-width:0;flex:1">
            <div style="font-size:14.5px;font-weight:${n.lu ? '500' : '700'};color:#14283F">${esc(n.titre)}</div>
            ${n.corps ? `<div style="font-size:13px;color:#6b6b6b;margin-top:2px;line-height:1.45">${esc(n.corps)}</div>` : ''}
            <div style="font-size:11.5px;color:#a3a3a3;margin-top:4px">${tempsRelatif(n.created_at)}</div>
          </div>
          ${n.lu ? '' : '<span style="width:9px;height:9px;border-radius:50%;background:#1A7A5E;flex-shrink:0;margin-top:6px"></span>'}
        </div>`).join('');
    }
    html += '</div>';
    card.innerHTML = html;

    document.getElementById('notif-close').onclick = fermer;
    const toutLu = document.getElementById('notif-tout-lu');
    if (toutLu) toutLu.onclick = async (e) => {
      e.preventDefault(); e.stopPropagation();
      try { await api('/api/notifications/tout-lu', { method: 'POST' }); await ouvrir(); majCompteur(); } catch (err) { toast(err.message, true); }
    };
    card.querySelectorAll('.notif-item').forEach((el) => {
      el.onclick = () => activer(el.dataset.id, list.find((n) => String(n.id) === String(el.dataset.id)));
    });
  }

  async function activer(id, notif) {
    try { await api(`/api/notifications/${id}/lu`, { method: 'POST' }); } catch { /* non bloquant */ }
    fermer(); majCompteur(); naviguer(notif);
  }

  function naviguer(n) {
    if (!n) return;
    const rid = n.donnees && n.donnees.resident_id;
    if (n.type === 'nouveau_message' && rid && typeof window.ouvrirConversation === 'function') { window.ouvrirConversation(rid); return; }
    if ((n.entite === 'facture' || n.type === 'relance' || n.type === 'paiement_recu') && rid) { location.hash = '#/residents/' + rid; return; }
    if (n.type === 'relance') { location.hash = '#/impayes'; return; }
  }

  window.addEventListener('hashchange', () => { build(); majCompteur(); });
  [800, 2500].forEach((t) => setTimeout(() => { build(); majCompteur(); }, t));
  setInterval(() => { build(); majCompteur(); }, 25000);
})();

/* ==================== NOTIFICATIONS PUSH (app gestion) ==================== */
/* Plugin @capacitor-firebase/messaging : jeton FCM sur iOS et Android.
   Diagnostic via la console uniquement (rien n'est affiché à l'utilisateur). */
(function () {
  const dbg = (m, err) => (err ? console.error('[push] ' + m) : console.log('[push] ' + m));

  const CAP = window.Capacitor;
  if (!CAP) return;                       // navigateur : aucun push natif

  // Le plugin natif peut être exposé de deux façons selon la version de Capacitor.
  let FM = (CAP.Plugins && CAP.Plugins.FirebaseMessaging) || null;
  if (!FM && typeof CAP.registerPlugin === 'function') {
    try { FM = CAP.registerPlugin('FirebaseMessaging'); } catch { /* ignore */ }
  }
  if (!FM) {
    const dispo = CAP.Plugins ? Object.keys(CAP.Plugins).join(', ') : '(Capacitor.Plugins absent)';
    setTimeout(() => dbg('plugin introuvable. Plugins vus : ' + dispo, true), 3000);
    return;
  }

  const plateforme = () => (CAP.getPlatform ? CAP.getPlatform() : 'ios');
  let dejaFait = false;
  let monToken = null;

  async function envoyerToken(token) {
    if (!token) { dbg('jeton vide renvoyé par Firebase', true); return; }
    monToken = token;
    try {
      await api('/api/push/register', { method: 'POST', body: { token, platform: plateforme() } });
      dbg('appareil enregistré');
    } catch (e) { dbg('serveur refuse : ' + (e && e.message), true); }
  }

  async function enregistrer() {
    if (dejaFait) return;
    if (!TOKEN || !ACTIVE_CAMPING) return;   // il faut une session + un camping actif
    dejaFait = true;
    try {
      const perm = await FM.requestPermissions();
      if (perm.receive !== 'granted') { dbg('permission refusée (' + perm.receive + ')', true); return; }

      FM.addListener('tokenReceived', (e) => envoyerToken(e && e.token));
      FM.addListener('notificationReceived', () => { try { route(); } catch { /* ignore */ } });
      FM.addListener('notificationActionPerformed', (action) => {
        const d = (action && action.notification && action.notification.data) || {};
        setTimeout(() => {
          if (d.type === 'nouveau_message') location.hash = '#/messagerie';
          else if (d.type === 'relance' || d.type === 'paiement_recu') location.hash = '#/impayes';
          else if (d.entite === 'facture') location.hash = '#/factures';
        }, 300);
      });

      const res = await FM.getToken();
      await envoyerToken(res && res.token);
    } catch (e) {
      dejaFait = false;
      dbg('ERREUR : ' + (e && (e.message || e.errorMessage || JSON.stringify(e))), true);
    }
  }

  const _logout = window.logout || logout;
  window.logout = function () {
    if (monToken && TOKEN) {
      api('/api/push/register', { method: 'DELETE', body: { token: monToken } }).catch(() => {});
    }
    dejaFait = false; monToken = null;
    return _logout.apply(this, arguments);
  };
  const btn = document.getElementById('logout-btn');
  if (btn) { btn.replaceWith(btn.cloneNode(true)); document.getElementById('logout-btn').addEventListener('click', window.logout); }

  window.addEventListener('hashchange', enregistrer);
  [1500, 4000].forEach((t) => setTimeout(enregistrer, t));
})();

/* ============================================================
   Emplacements : modification d'un emplacement existant
   (ajoute par outils/emplacement-modifiable.js)
   ============================================================ */
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

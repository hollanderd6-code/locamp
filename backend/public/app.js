/* ============ Locamp — front admin (vanilla JS, hash routing) ============ */
const API = window.LOCAMP_API || '';   // '' en web (relatif) ; URL Render absolue en app mobile
let TOKEN = localStorage.getItem('lc_token') || null;
let CAMPINGS = [];
let ACTIVE_CAMPING = localStorage.getItem('lc_camping') || null;
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
    <p class="muted" style="margin-top:4px">Un espace séparé, avec ses propres résidents, emplacements et factures. Tu en seras administrateur.</p>
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
document.getElementById('nav-burger')?.addEventListener('click', () => document.body.classList.toggle('nav-open'));
document.querySelectorAll('.nav a').forEach((a) => a.addEventListener('click', () => document.body.classList.remove('nav-open')));

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

const routes = { dashboard: vueDashboard, carte: vueCarte, residents: vueResidents, emplacements: vueEmplacements, factures: vueFactures, reglements: vueReglements, impayes: vueImpayes, compteurs: vueCompteurs, messagerie: vueMessagerie, compta: vueCompta, signatures: vueSignatures, parametres: vueParametres, administration: vueAdministration };
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
  const [d, imp, presRes, msgRes, { residents }] = await Promise.all([
    api('/api/dashboard'),
    api('/api/relances/impayes').catch(() => null),
    api('/api/prestations?statut=en_cours').catch(() => ({ prestations: [] })),
    api('/api/messages/non-lus').catch(() => ({ total: 0 })),
    api('/api/residents').catch(() => ({ residents: [] })),
  ]);
  const st = d.factures_mois.par_statut || {};
  const rmap = {}; residents.forEach((r) => { rmap[r.id] = `${r.prenom || ''} ${r.nom}`.trim(); });
  const aFacturer = (presRes.prestations || []).filter((p) => p.type !== 'caution')
    .reduce((s, p) => s + Number(p.montant_ttc), 0);
  const enRetard = imp ? imp.impayes.filter((f) => f.en_retard) : [];

  $('#main').innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">Vue d'ensemble</div><h1>Tableau de bord</h1></div>
      <div class="toolbar">
        <button class="btn btn-ghost btn-sm" onclick="messageRapide()">Prévenir un client</button>
        <button class="btn btn-ghost btn-sm" onclick="messageGroupe()">Message à tous</button>
        ${enRetard.length ? `<button class="btn btn-primary btn-sm" onclick="relancerImpayes()">Relancer ${enRetard.length} retard${enRetard.length > 1 ? 's' : ''}</button>` : ''}
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
          <td class="right">${f.resident_id ? `<button class="btn btn-ghost btn-sm" onclick="ouvrirConversation('${f.resident_id}')">Écrire</button>` : ''}</td>
        </tr>`).join('')}</tbody></table>
      ${enRetard.length > 8 ? `<p class="muted" style="margin-top:8px"><a href="#/impayes">Voir les ${enRetard.length} impayés →</a></p>` : ''}
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

window.relancerImpayes = async () => {
  if (!await askConfirm('Envoyer un rappel par e-mail à tous les clients en retard de paiement ?')) return;
  try {
    const r = await api('/api/relances/run', { method: 'POST' });
    toast(`Relances : ${r.envoyees} envoyée(s), ${r.ignorees} ignorée(s) (à échoir ou déjà relancées récemment)`);
    route();
  } catch (e) { toast(e.message, true); }
};

/* --- messages rapides & groupés --- */
window.messageGroupe = () => {
  openDrawer(`
    <h2>Message à tous les résidents</h2>
    <p class="muted" style="margin-top:4px">Envoyé sur le portail de chaque résident actif, avec notification e-mail.</p>
    <form id="f-groupe" style="margin-top:14px">
      <textarea name="corps" required rows="5" placeholder="Ex. : Coupure d'eau prévue mardi de 9h à 12h…" style="width:100%;resize:vertical"></textarea>
      <button class="btn btn-primary btn-block" style="margin-top:12px">Envoyer à tous</button>
    </form>`);
  $('#f-groupe').addEventListener('submit', async (e) => {
    e.preventDefault();
    const corps = e.target.corps.value.trim();
    if (!corps) return;
    if (!await askConfirm('Envoyer ce message à TOUS les résidents actifs ?')) return;
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
    <h2>Message rapide</h2>
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

function carteColor(e) {
  const imp = e.resident && carteState.enRetard.has(e.resident.id);
  return imp ? STATUT_COLOR.impaye : (STATUT_COLOR[e.statut] || '#999');
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
      ${lib && allee ? `<g transform="rotate(${angle} ${mx} ${my})">
        <rect class="celem-allee-bg" x="${mx - larg / 2}" y="${my - 8}" width="${larg}" height="16" rx="8"></rect>
        <text class="celem-allee" x="${mx}" y="${my}">${esc(lib)}</text></g>` : ''}
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
  const pins = placed.map((e) => {
    const c = carteCoords(e);
    const x = carteClamp(c.coord_x, CARTE_PAD, CARTE_W - CARTE_PAD);
    const y = carteClamp(c.coord_y, CARTE_PAD, CARTE_H - CARTE_PAD);
    const sel = st.selected?.kind === 'emp' && st.selected.id === e.id ? ' selected' : '';
    return `<g class="pin${sel}" data-id="${e.id}" data-kind="emp" transform="translate(${x},${y})">
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
          <button class="btn btn-ghost btn-sm" onclick="cancelCarteEdit()">Annuler</button>
          <button class="btn btn-primary btn-sm" onclick="saveCarte()" ${n ? '' : 'disabled'}>Enregistrer le plan</button>
        </div>`
        : `<button class="btn btn-primary btn-sm" onclick="toggleCarteEdit()">Éditer le plan</button>`}
    </div>
    ${st.migrationManquante && edit ? '<p class="form-error" style="margin-bottom:12px">Table « carte_elements » absente — exécute la migration db/15_carte_elements.sql.</p>' : ''}
    ${edit ? '' : `<span class="muted">${st.emplacements.length} emplacements — cliquer une pastille pour ouvrir la fiche</span>`}

    <div class="${edit ? 'map-edit-layout' : ''}">
      <div>
        <div class="map-wrap${edit ? ' editing' : ''}">
          <svg class="map-svg" viewBox="0 0 ${CARTE_W} ${CARTE_H}" role="img" aria-label="Plan du camping">
            <g class="layer-decor">${decor}</g>
            <g class="layer-pins">${pins}</g>
          </svg>
          <div class="map-legend">
            <span><span class="dot" style="background:${STATUT_COLOR.libre}"></span>Libre</span>
            <span><span class="dot" style="background:${STATUT_COLOR.occupe}"></span>Occupé</span>
            <span><span class="dot" style="background:${STATUT_COLOR.impaye}"></span>Impayé</span>
            <span><span class="dot" style="background:${STATUT_COLOR.reserve}"></span>Réservé</span>
            <span><span class="dot" style="background:${STATUT_COLOR.indisponible}"></span>Indisponible</span>
          </div>
        </div>
        ${!edit && unplaced.length ? `<p class="muted" style="margin-top:12px">Sans position : ${unplaced.map((e) => esc(e.numero)).join(', ')} — passer en mode édition pour les placer.</p>` : ''}
      </div>

      ${edit ? `<aside class="map-panel">
        <div id="map-props"></div>
        <div class="map-panel-sec">
          <h3>Ajouter</h3>
          ${Object.entries(groupes).map(([g, items]) => `
            <div class="map-grp">${esc(g)}</div>
            <div class="map-chips">${items.map(([k, d]) => `<button class="map-chip" onclick="ajouterElement('${k}')">${esc(d.lib)}</button>`).join('')}</div>`).join('')}
        </div>
        ${unplaced.length ? `<div class="map-panel-sec">
          <h3>Emplacements à placer <span class="map-count">${unplaced.length}</span></h3>
          <div class="map-chips">${unplaced.map((e) => `<button class="map-chip" onclick="placeEmplacement('${e.id}')">${esc(e.numero)}</button>`).join('')}</div>
        </div>` : ''}
        <p class="map-aide">Glisse pour déplacer · poignée dorée pour redimensionner · <kbd>Suppr</kbd> pour retirer · <kbd>Échap</kbd> pour désélectionner. Aimantation automatique.</p>
      </aside>` : ''}
    </div>`;

  wireCarte();
  renderProps();
}

/* --------------------- panneau de propriétés --------------------- */

function renderProps() {
  const box = $('#map-props');
  if (!box) return;
  const st = carteState;
  const s = st.selected;

  if (!s) {
    box.innerHTML = `<div class="map-panel-sec map-empty">Sélectionne un élément du plan pour le modifier.</div>`;
    return;
  }

  if (s.kind === 'emp') {
    const e = st.emplacements.find((x) => x.id === s.id);
    box.innerHTML = `<div class="map-panel-sec">
      <h3>Emplacement ${esc(e.numero)}</h3>
      <p class="muted" style="margin:0 0 10px">${esc(e.secteur || '')} ${e.type ? '· ' + esc(e.type) : ''}</p>
      <button class="btn btn-ghost btn-sm btn-block" onclick="retirerSelection()">Retirer du plan</button>
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
      <button class="btn btn-ghost btn-sm" style="flex:1" onclick="dupliquerElement()">Dupliquer</button>
      <button class="btn btn-ghost btn-sm" style="flex:1" onclick="supprimerElement()">Supprimer</button>
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
    const { factures } = await api('/api/factures?resident_id=' + r.id);
    const dues = factures.filter((f) => ['emise', 'partielle', 'en_retard'].includes(f.statut));
    facturesHtml = `<h2 style="margin-top:18px">Factures en cours</h2>
      ${dues.length ? `<ul class="list-tight">${dues.map((f) => `<li><span>${esc(f.numero)} <span class="badge ${f.statut}">${lib(f.statut)}</span></span><span>${eur(f.total_ttc - f.montant_regle)}</span></li>`).join('')}</ul>` : '<p class="muted">Aucune facture en attente.</p>'}`;
  }
  openDrawer(`
    <h2>Emplacement ${esc(e.numero)}</h2>
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
async function vueResidents() {
  const [{ residents }, { emplacements }] = await Promise.all([api('/api/residents'), api('/api/emplacements')]);
  const empNum = {}; emplacements.forEach((e) => { empNum[e.id] = e.numero + (e.secteur ? ' · ' + e.secteur : ''); });
  $('#main').innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Locataires</div><h1>Résidents</h1></div>
      <div class="toolbar">
        <input class="search" id="res-search" placeholder="Rechercher nom, e-mail, emplacement…">
        <button class="btn btn-primary" onclick="formResident()">Nouveau résident</button>
      </div></div>
    <div class="card"><table><thead><tr><th>Nom</th><th>Contact</th><th>Emplacement</th><th class="right">Solde</th></tr></thead>
    <tbody id="res-body"></tbody></table></div>`;
  const render = (list) => {
    $('#res-body').innerHTML = list.map((r) => `
      <tr class="row-click" onclick="location.hash='#/residents/${r.id}'">
        <td><strong>${esc(r.prenom || '')} ${esc(r.nom)}</strong>${r.actif ? '' : ' <span class="badge indisponible">inactif</span>'}</td>
        <td class="muted" data-l="Contact">${esc(r.email || '')}${r.telephone ? ' · ' + esc(r.telephone) : ''}</td>
        <td data-l="Emplacement">${r.emplacement_id && empNum[r.emplacement_id] ? `<strong>${esc(empNum[r.emplacement_id])}</strong>` : '<span class="muted">—</span>'}</td>
        <td class="right" data-l="Solde">${eur(r.solde)}</td>
      </tr>`).join('') || '<tr><td colspan="4" class="muted">Aucun résident. Créer le premier avec « Nouveau résident ».</td></tr>';
  };
  render(residents);
  $('#res-search').addEventListener('input', (e) => {
    const s = e.target.value.toLowerCase();
    render(residents.filter((r) => `${r.nom} ${r.prenom} ${r.email} ${r.telephone} ${r.compte_comptable || ''} ${r.emplacement_id ? empNum[r.emplacement_id] || '' : ''}`.toLowerCase().includes(s)));
  });
}

/* ---------- Fiche client (pleine page) ---------- */
async function vueFicheClient(id) {
  const [{ resident: r, emplacement, documents }, { factures }, { reglements }, presRes, synRes, msgRes, cfgRes] = await Promise.all([
    api('/api/residents/' + id),
    api('/api/factures?resident_id=' + id),
    api('/api/reglements?resident_id=' + id),
    api('/api/prestations?resident_id=' + id).catch(() => ({ prestations: null })),
    api('/api/prestations/synthese/' + id).catch(() => ({ synthese: null })),
    api('/api/messages?resident_id=' + id).catch(() => ({ messages: null })),
    api('/api/factures/config/' + id).catch(() => ({ facturation: {} })),
  ]);
  const fact = cfgRes.facturation || {};
  const factLignes = fact.lignes || [];
  const aConfig = Number(fact.loyer_mensuel || 0) > 0 || factLignes.length > 0;
  const messages = msgRes.messages;
  const nbNonLus = (messages || []).filter((m) => m.auteur === 'resident' && !m.lu).length;
  const prestations = presRes.prestations;
  const syn = synRes.synthese;
  const facNum = {}; factures.forEach((f) => { facNum[f.id] = f.numero; });

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
    <button class="fiche-tab${active ? ' active' : ''}" data-tab="${key}" onclick="switchFicheTab('${key}')">${label}</button>`;

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
          ${r.email ? ' · ' + esc(r.email) : ''}${r.telephone ? ' · ' + esc(r.telephone) : ''}
        </div>
      </div>
      <div class="toolbar">
        <button class="btn btn-ghost" onclick="encaisserClient('${id}')">Encaisser</button>
      </div>
    </div>

    ${syn ? `
    <div class="synth">
      ${banItem(eur(syn.a_facturer), 'À facturer', syn.a_facturer > 0 ? 'warn' : '')}
      ${banItem(eur(syn.a_regler), 'À régler', syn.a_regler > 0 ? 'bad' : '')}
      ${banItem(eur(syn.regle_total), 'Réglé (total)')}
      ${banItem(`${syn.nb_sejours} <small>(${syn.nb_nuits} nuits)</small>`, 'Séjours')}
      ${banItem(syn.dernier_sejour ? `${dfr(syn.dernier_sejour.du)} <small>→ ${dfr(syn.dernier_sejour.au)}</small>` : '—', 'Dernier séjour')}
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
            <button class="btn btn-ghost btn-sm" onclick="formPrestation('${id}','sejour')">+ Séjour</button>
            <button class="btn btn-ghost btn-sm" onclick="formPrestation('${id}','vente')">+ Vente</button>
            <button class="btn btn-ghost btn-sm" onclick="formPrestation('${id}','charge')">+ Charge</button>
            <button class="btn btn-ghost btn-sm" onclick="formPrestation('${id}','caution')">+ Caution</button>
          </div>
        </div>
        ${migrationManquante
          ? '<p class="form-error" style="margin-top:12px">Table « prestations » absente — exécute la migration db/09_prestations.sql dans Supabase.</p>'
          : `<table style="margin-top:12px"><thead><tr><th style="width:30px"></th><th></th><th>Intitulé</th><th>Du</th><th>Au</th><th class="right">Montant TTC</th><th>État</th><th></th></tr></thead>
        <tbody>${(prestations || []).map((p) => `
          <tr>
            <td>${p.statut === 'en_cours' ? `<input type="checkbox" class="presta-check" data-pid="${p.id}" data-type="${p.type}" data-ttc="${p.montant_ttc}" onchange="majSelectionPresta('${id}')">` : ''}</td>
            <td>${pillType(p.type)}</td>
            <td><strong>${esc(p.designation)}</strong>${Number(p.quantite) !== 1 ? ` <span class="muted">× ${Number(p.quantite)}</span>` : ''}</td>
            <td class="muted" data-l="Du">${p.date_debut ? dfr(p.date_debut) : '—'}</td>
            <td class="muted" data-l="Au">${p.date_fin ? dfr(p.date_fin) : '—'}</td>
            <td class="right" data-l="Montant TTC"><strong>${eur(p.montant_ttc)}</strong></td>
            <td data-l="État">${etatBadge(p)}</td>
            <td class="right">${p.statut === 'en_cours' ? `<button class="btn btn-ghost btn-sm" onclick="supprimerPrestation('${p.id}','${id}')">Annuler</button>` : ''}</td>
          </tr>`).join('') || '<tr><td colspan="8" class="muted">Aucune prestation. Ajoute un séjour, une vente, une charge ou une caution.</td></tr>'}</tbody></table>
        <div id="presta-actionbar" class="selbar hidden">
          <span id="presta-selinfo" style="font-weight:600"></span>
          <div class="selbar-actions">
            <button class="btn btn-ghost btn-sm" onclick="proformaSelection('${id}')">Proforma</button>
            <button class="btn btn-primary btn-sm" onclick="facturerSelection('${id}')">Facturer la sélection</button>
          </div>
        </div>`}
      </div>
    </section>

    <section data-panel="factures" class="hidden">
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <h2 style="margin:0">Factures</h2>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <button class="btn btn-primary btn-sm" onclick="genererFactureMois('${id}')" title="Loyer + lignes récurrentes + taxe de séjour">Générer la facture du mois</button>
            <button class="btn btn-ghost btn-sm" onclick="lettrerCredit('${id}')" title="Appliquer le crédit d'avance (trop-perçu) aux factures impayées">Lettrer le crédit</button>
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
              <button class="btn btn-ghost btn-sm" onclick="pdfFacture('${f.id}')">PDF</button>
              ${brouillon ? `
                <button class="btn btn-ghost btn-sm" onclick="ajouterPrestationsFacture('${f.id}','${id}')">+ Prestations</button>
                <button class="btn btn-ghost btn-sm" onclick="editerLignesFacture('${f.id}')">Modifier</button>
                <button class="btn btn-ghost btn-sm" onclick="supprimerBrouillon('${f.id}')">Supprimer</button>
                <button class="btn btn-primary btn-sm" onclick="emettreFacture('${f.id}')">Émettre</button>` : ''}
              ${payable ? `<button class="btn btn-primary btn-sm" onclick="encaisserFacture('${f.id}','${id}',${reste})">Encaisser</button>` : ''}
            </td>
          </tr>`;
        }).join('') || '<tr><td colspan="7" class="muted">Aucune facture pour ce résident.</td></tr>'}</tbody></table>
      </div>

      <div class="card" style="margin-top:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <div>
            <h2 style="margin:0">Facturation récurrente</h2>
            <p class="muted" style="margin:2px 0 0;font-size:12.5px">Le « montant type » facturé chaque mois. Modifiable à tout moment (révision de tarif).</p>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="formFacturation('${id}')">Configurer</button>
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
          ? '<p class="form-error" style="margin-top:12px">Table « messages » absente — exécute la migration db/10_messages.sql dans Supabase.</p>'
          : `<div id="fil-messages" class="msg-fil">
          ${(messages || []).map((m) => `
            <div class="msg-row ${m.auteur === 'camping' ? 'me' : 'them'}">
              <div class="msg-bubble">${esc(m.corps)}</div>
              <div class="msg-meta">${m.auteur === 'camping' ? 'Camping' : esc(r.prenom || r.nom)} · ${new Date(m.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
            </div>`).join('') || '<p class="muted" style="margin:0">Aucun message. Écris le premier ci-dessous — le client le verra sur son portail et sera notifié par e-mail.</p>'}
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
            <button class="btn btn-ghost btn-sm" onclick="exportDonneesResident('${id}','${esc((r.prenom || '') + ' ' + r.nom)}')">Exporter ses données</button>
            ${r.anonymise_at ? '<span class="badge indisponible">anonymisé</span>'
              : `<button class="btn btn-ghost btn-sm" onclick="anonymiserResident('${id}','${esc((r.prenom || '') + ' ' + r.nom)}')">Anonymiser</button>`}
          </div>
        </div>
      </div>
      <div class="card" style="margin-top:16px">
        <h2>Documents</h2>
        ${documents.length ? `<ul class="list-tight">${documents.map((d) => `<li><span>${esc(d.type || 'document')} — ${esc(d.nom_fichier || '')}</span><a href="#" onclick="voirDoc('${d.id}');return false">ouvrir</a></li>`).join('')}</ul>` : '<p class="muted">Aucun document.</p>'}
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
    const d = await api(`/api/residents/${id}/releve${annee ? '?annee=' + annee : ''}`);
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
            <select id="rel-annee" style="width:auto" onchange="chargerReleve('${id}', this.value)">
              ${d.annees.map((a) => `<option value="${a}"${a === d.annee ? ' selected' : ''}>${a}</option>`).join('') || `<option>${d.annee}</option>`}
            </select>
            <button class="btn btn-primary btn-sm" onclick="relevePdf('${id}')">Relevé PDF</button>
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
              <td class="right">${l.facture_id ? `<button class="btn btn-ghost btn-sm" onclick="pdfFacture('${l.facture_id}')">PDF</button>` : ''}</td>
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
          return `<tr class="row-click" onclick="chargerReleve('${id}','${a}')">
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
  if (!facturables.length) { toast('Sélectionne au moins une prestation facturable', true); return; }
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
  if (!sel.length) { toast('Sélectionne au moins une prestation facturable', true); return; }
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
      <button type="button" class="btn btn-ghost btn-sm" onclick="this.parentElement.remove()">✕</button>
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
      <button type="button" class="btn btn-ghost btn-sm" onclick="this.parentElement.remove()">✕</button>
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
      <button type="button" class="btn btn-ghost btn-sm" onclick="this.parentElement.remove()">✕</button>
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

window.formResident = async () => {
  const { emplacements } = await api('/api/emplacements');
  const libres = emplacements.filter((e) => e.statut === 'libre');
  openDrawer(`
    <h2>Nouveau résident</h2>
    <form id="f-res" class="form-grid" style="margin-top:14px">
      <label>Civilité<select name="civilite"><option value="">—</option><option>M.</option><option>Mme</option></select></label>
      <label>Nom *<input name="nom" required></label>
      <label>Prénom<input name="prenom"></label>
      <label>E-mail<input name="email" type="email"></label>
      <label>Téléphone<input name="telephone"></label>
      <label>Emplacement<select name="emplacement_id"><option value="">— aucun —</option>${libres.map((e) => `<option value="${e.id}">${esc(e.numero)} (${esc(e.secteur || '')})</option>`).join('')}</select></label>
      <label class="full">Adresse<input name="adresse"></label>
      <div class="full"><button class="btn btn-primary btn-block">Créer le résident</button></div>
    </form>`);
  $('#f-res').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    for (const k in body) if (body[k] === '') delete body[k];
    try { await api('/api/residents', { method: 'POST', body }); closeDrawer(); toast('Résident créé'); route(); }
    catch (err) { toast(err.message, true); }
  });
};

/* ---------- Emplacements ---------- */
async function vueEmplacements() {
  const { emplacements } = await api('/api/emplacements');
  $('#main').innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Parcelles</div><h1>Emplacements</h1></div>
      <button class="btn btn-primary" onclick="formEmplacement()">Nouvel emplacement</button></div>
    <div class="card"><table><thead><tr><th>N°</th><th>Secteur</th><th>Type</th><th>Statut</th><th class="right">Loyer</th><th>Carte</th></tr></thead>
    <tbody>${emplacements.map((e) => `
      <tr class="row-click" onclick="ficheEmplacement('${e.id}')">
        <td><strong>${esc(e.numero)}</strong></td><td class="muted">${esc(e.secteur || '—')}</td>
        <td class="muted">${esc(e.type || '—')}</td><td><span class="badge ${e.statut}">${lib(e.statut)}</span></td>
        <td class="right">${eur(e.loyer_base)}</td>
        <td class="muted">${e.coord_x != null ? '✓' : '—'}</td>
      </tr>`).join('') || '<tr><td colspan="6" class="muted">Aucun emplacement.</td></tr>'}</tbody></table></div>`;
}

window.formEmplacement = () => {
  openDrawer(`
    <h2>Nouvel emplacement</h2>
    <form id="f-emp" class="form-grid" style="margin-top:14px">
      <label>Numéro *<input name="numero" required></label>
      <label>Secteur<input name="secteur"></label>
      <label>Type<select name="type"><option value="">—</option><option>mobil-home</option><option>chalet</option><option>caravane</option><option>parcelle nue</option></select></label>
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

/* ---------- Factures ---------- */
async function vueFactures() {
  const { factures } = await api('/api/factures');
  const mois = new Date().toISOString().slice(0, 7);
  $('#main').innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Facturation</div><h1>Factures</h1></div>
      <div class="toolbar">
        <input id="fac-periode" type="month" value="${mois}">
        <button class="btn btn-ghost" onclick="formFacture()">Nouvelle facture</button>
        <button class="btn btn-primary" onclick="runFacturation()">Générer la facturation du mois</button>
      </div></div>
    <div class="card"><table><thead><tr><th>N°</th><th>Période</th><th>Date</th><th>Statut</th><th class="right">TTC</th><th class="right">Réglé</th><th></th></tr></thead>
    <tbody>${factures.map((f) => `
      <tr>
        <td><strong>${esc(f.numero)}</strong></td><td class="muted">${esc(f.periode || '—')}</td>
        <td class="muted">${dfr(f.date_emission)}</td><td><span class="badge ${f.statut}">${lib(f.statut)}</span></td>
        <td class="right">${eur(f.total_ttc)}</td><td class="right">${eur(f.montant_regle)}</td>
        <td class="right">
          <button class="btn btn-ghost btn-sm" onclick="pdfFacture('${f.id}')">PDF</button>
          ${!['avoir', 'annulee'].includes(f.statut) ? `<button class="btn btn-ghost btn-sm" onclick="dupliquerFacture('${f.id}')">Dupliquer</button>` : ''}
          ${!['avoir', 'annulee'].includes(f.statut) ? `<button class="btn btn-ghost btn-sm hide-sm" onclick="emailFacture('${f.id}')">E-mail</button>` : ''}
          ${!['avoir', 'annulee'].includes(f.statut) ? `<button class="btn btn-ghost btn-sm hide-sm" onclick="faireAvoir('${f.id}')">Avoir</button>` : ''}
        </td>
      </tr>`).join('') || '<tr><td colspan="7" class="muted">Aucune facture. Générer la facturation du mois pour commencer.</td></tr>'}</tbody></table></div>`;
}
/* ---------- Messagerie (boîte de réception) ---------- */
async function vueMessagerie() {
  const { conversations } = await api('/api/messages/conversations').catch(() => ({ conversations: null }));
  $('#main').innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Échanges clients</div><h1>Messagerie</h1></div>
      <div class="toolbar">
        <button class="btn btn-ghost" onclick="messageRapide()">Message rapide</button>
        <button class="btn btn-primary" onclick="messageGroupe()">Message à tous</button>
      </div></div>
    ${conversations === null
      ? '<p class="form-error">Table « messages » absente — exécute la migration db/10_messages.sql dans Supabase.</p>'
      : `<div class="card" style="padding:6px 0">
      ${conversations.length ? conversations.map((c) => `
        <div class="conv${c.non_lus ? ' unread' : ''}" onclick="ouvrirConversation('${c.resident_id}')">
          <div style="min-width:0">
            <div class="who">${esc(c.resident_nom)}</div>
            <div class="prev">${c.dernier_message.auteur === 'camping' ? 'Vous : ' : ''}${esc(c.dernier_message.corps)}</div>
          </div>
          <div class="conv-side">
            <span class="when">${new Date(c.dernier_message.date).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
            ${c.non_lus ? `<span class="pill-count">${c.non_lus}</span>` : ''}
          </div>
        </div>`).join('') : '<p class="muted" style="padding:18px 20px;margin:0">Aucune conversation. Les échanges apparaissent ici dès qu\u2019un client écrit depuis son portail, ou que tu écris depuis une fiche client.</p>'}
    </div>`}`;
}

window.ouvrirConversation = (residentId) => {
  window._openTab = 'messages';
  location.hash = '#/residents/' + residentId;
};

/* ---------- Compteurs (tournée de relevés) ---------- */
async function vueCompteurs() {
  const d = await api('/api/compteurs');
  const prixOk = d.prix_kwh != null && d.prix_kwh > 0;
  $('#main').innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Énergie</div><h1>Compteurs électriques</h1></div>
      <span class="muted">${prixOk ? `Prix du kWh : <strong>${Number(d.prix_kwh)} € TTC</strong> · TVA ${d.taux_tva} %` : ''}</span></div>
    ${prixOk ? '' : `<p class="form-error" style="margin-bottom:14px">Prix du kWh non configuré — les relevés seront enregistrés mais aucune charge ne sera créée. <a href="#/parametres">Configurer dans Paramètres → Énergie</a>.</p>`}
    <div class="card"><table><thead><tr><th>Empl.</th><th>Résident</th><th>Dernier relevé</th><th class="right">Index</th><th class="right">Nouvel index</th><th></th></tr></thead>
    <tbody>${d.emplacements.map((e) => `
      <tr>
        <td><strong>${esc(e.numero)}</strong>${e.secteur ? ` <span class="muted">· ${esc(e.secteur)}</span>` : ''}</td>
        <td class="muted">${e.resident ? esc((e.resident.prenom || '') + ' ' + e.resident.nom) : '—'}</td>
        <td class="muted">${e.dernier_releve ? dfr(e.dernier_releve.date_releve) + (e.dernier_releve.conso_kwh != null ? ` <span class="badge occupe">${Number(e.dernier_releve.conso_kwh)} kWh</span>` : '') : '<span class="badge emise">jamais relevé</span>'}</td>
        <td class="right">${e.dernier_releve ? Number(e.dernier_releve.index_kwh) : '—'}</td>
        <td class="right"><input type="number" step="0.01" min="0" id="idx-${e.id}" placeholder="${e.dernier_releve ? Number(e.dernier_releve.index_kwh) : 'index initial'}" style="width:110px;text-align:right"></td>
        <td class="right"><button class="btn btn-primary btn-sm" onclick="releverCompteur('${e.id}')">Relever</button></td>
      </tr>`).join('') || '<tr><td colspan="6" class="muted">Aucun emplacement.</td></tr>'}</tbody></table></div>
    <p class="muted" style="margin-top:12px">Un relevé crée automatiquement une charge « en cours » sur la fiche du résident rattaché (conso × prix kWh) — à facturer depuis sa fiche.</p>`;
}

window.releverCompteur = async (empId) => {
  const input = $('#idx-' + empId);
  const v = input.value;
  if (v === '' || Number(v) < 0) { toast('Saisis le nouvel index', true); input.focus(); return; }
  try {
    const r = await api('/api/compteurs/releve', { method: 'POST', body: { emplacement_id: empId, index_kwh: Number(v) } });
    if (r.prestation) toast(`Relevé enregistré — charge de ${eur(r.prestation.montant_ttc)} créée (${Number(r.releve.conso_kwh)} kWh)`);
    else toast(r.info || 'Relevé enregistré');
    route();
  } catch (err) { toast(err.message, true); }
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
      <button class="btn btn-primary" onclick="formUtilisateur()">Ajouter un compte</button>
    </div>

    <div class="fiche-tabs">
      <button class="fiche-tab active" data-tab="comptes" onclick="switchFicheTab('comptes')">Comptes (${utilisateurs.length})</button>
      <button class="fiche-tab" data-tab="moyens" onclick="switchFicheTab('moyens');chargerMoyens()">Moyens de paiement</button>
      <button class="fiche-tab" data-tab="journal" onclick="switchFicheTab('journal');chargerJournal()">Journal d'activité</button>
      <button class="fiche-tab" data-tab="fiscal" onclick="switchFicheTab('fiscal');chargerFiscal()">Conformité fiscale</button>
      <button class="fiche-tab" data-tab="rgpd" onclick="switchFicheTab('rgpd');chargerRgpd()">RGPD</button>
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
          <button class="btn btn-primary btn-sm" onclick="formMoyen()">Ajouter un moyen</button>
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
              <button class="btn btn-ghost btn-sm" onclick="formUtilisateur('${u.id}')">Modifier</button>
              ${u.est_moi ? '' : `<button class="btn btn-ghost btn-sm" onclick="retirerAcces('${u.id}','${esc((u.prenom || '') + ' ' + (u.nom || ''))}')">Retirer</button>`}
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
            <button class="btn btn-ghost btn-sm" onclick="chargerJournal()">Filtrer</button>
            <button class="btn btn-primary btn-sm" onclick="exportJournal()">Export fisc (CSV)</button>
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
      box.innerHTML = '<p class="form-error">Table « moyens_paiement » absente — exécute la migration db/16_moyens_paiement_remises.sql dans Supabase.</p>';
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
            <button class="btn btn-ghost btn-sm" onclick="formMoyen('${m.id}')">Modifier</button>
            ${m.actif ? `<button class="btn btn-ghost btn-sm" onclick="retirerMoyen('${m.id}','${esc(m.libelle)}')">Désactiver</button>` : ''}
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
          <button class="btn btn-primary btn-sm" onclick="registreRgpd()">Registre des traitements</button>
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
          <td class="right"><button class="btn btn-ghost btn-sm" onclick="anonymiserResident('${r.id}','${esc(r.nom)}')">Anonymiser</button></td>
        </tr>`).join('')}</tbody></table>`
        : '<p class="muted" style="margin-top:10px">Aucun résident à anonymiser. ✓</p>'}
      </div>

      <div class="card">
        <div class="card-actions">
          <div>
            <h2 style="margin:0">Registre des violations de données</h2>
            <p class="muted" style="margin:4px 0 0">Une violation présentant un risque doit être notifiée à la CNIL sous <strong>72 heures</strong> (art. 33).</p>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="formViolation()">Déclarer une violation</button>
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
          <button class="btn btn-primary btn-sm" onclick="attestationFiscale()">Attestation de conformité</button>
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
            <button class="btn btn-ghost btn-sm" onclick="lancerCloture()">Clôturer</button>
            <button class="btn btn-ghost btn-sm" onclick="archiveFiscale()">Archive (JSON)</button>
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
const SIG_STATUT = { brouillon: 'brouillon', envoye: 'envoyé — en attente', signe: 'signé', refuse: 'refusé', annule: 'annulé' };

async function vueSignatures() {
  const [{ documents }, { residents }] = await Promise.all([
    api('/api/signatures'),
    api('/api/residents'),
  ]);
  const rmap = {}; residents.forEach((r) => { rmap[r.id] = `${r.prenom || ''} ${r.nom}`.trim(); });

  $('#main').innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">Documents</div><h1>Signature électronique</h1></div>
      <button class="btn btn-primary" onclick="formDocSignature()">Déposer un document</button>
    </div>
    <p class="muted" style="margin:-14px 0 18px">Contrats, règlements intérieurs, avenants… Le signataire signe à la main depuis son téléphone. Adresse IP, horodatage et empreinte du document sont conservés comme preuve.</p>

    <div class="card">
      ${documents.length ? `<table><thead><tr><th>Document</th><th>Signataire</th><th>Zones</th><th>Statut</th><th>Signé le</th><th></th></tr></thead>
      <tbody>${documents.map((d) => `
        <tr>
          <td><strong>${esc(d.titre)}</strong><div class="muted">${d.nb_pages || 1} page(s)</div></td>
          <td>${esc(d.resident_nom || '—')}</td>
          <td class="muted">${(d.champs || []).length}</td>
          <td><span class="badge ${d.statut === 'signe' ? 'reglee' : d.statut === 'envoye' ? 'emise' : d.statut === 'annule' ? 'annulee' : 'brouillon'}">${esc(SIG_STATUT[d.statut] || d.statut)}</span></td>
          <td class="muted">${d.date_signature ? new Date(d.date_signature).toLocaleString('fr-FR') : '—'}</td>
          <td class="right">
            ${d.statut === 'signe'
              ? `<button class="btn btn-ghost btn-sm" onclick="voirSignature('${d.id}')">Preuve</button>`
              : d.statut === 'annule'
                ? '<span class="muted">—</span>'
                : `<button class="btn btn-ghost btn-sm" onclick="editeurZones('${d.id}')">Zones</button>
                 ${(d.champs || []).length && d.resident_id ? `<button class="btn btn-primary btn-sm" onclick="envoyerSignature('${d.id}')">Envoyer</button>` : ''}
                 <button class="btn btn-ghost btn-sm" onclick="annulerDocSignature('${d.id}')">Annuler</button>`}
          </td>
        </tr>`).join('')}</tbody></table>`
      : '<p class="muted" style="margin:0">Aucun document. Dépose un PDF pour commencer.</p>'}
    </div>`;
}

window.formDocSignature = async () => {
  const { residents } = await api('/api/residents');
  const actifs = residents.filter((r) => r.actif !== false && r.email);
  openDrawer(`
    <h2>Déposer un document à signer</h2>
    <p class="muted" style="margin-top:4px">PDF uniquement. Tu placeras ensuite les zones de signature sur le document.</p>
    <form id="f-docsig" class="form-grid" style="margin-top:14px">
      <label class="full">Fichier PDF *<input type="file" name="file" accept="application/pdf" required></label>
      <label class="full">Titre *<input name="titre" required placeholder="Contrat de location — emplacement 077"></label>
      <label class="full">Signataire *
        <select name="resident_id" required>
          <option value="">— choisir —</option>
          ${actifs.map((r) => `<option value="${r.id}">${esc(r.prenom || '')} ${esc(r.nom)} · ${esc(r.email)}</option>`).join('')}
        </select></label>
      <label class="full">Message d'accompagnement<textarea name="message" rows="2" style="width:100%"></textarea></label>
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
        <button class="btn btn-ghost btn-sm" onclick="location.hash='#/signatures'">Fermer</button>
        <button class="btn btn-primary btn-sm" onclick="enregistrerZones()">Enregistrer les zones</button>
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
            <button class="map-chip actif" data-t="signature" onclick="choisirOutil('signature')">Signature</button>
            <button class="map-chip" data-t="texte" onclick="choisirOutil('texte')">Texte</button>
            <button class="map-chip" data-t="case" onclick="choisirOutil('case')">Case à cocher</button>
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
    location.hash = '#/signatures';
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
    <button class="btn btn-primary btn-block" style="margin-top:18px" onclick="window.open('${url}','_blank')">Ouvrir le document signé</button>`);
};

async function vueParametres() {
  const { camping: c } = await api('/api/camping');
  const p = c.parametres || {};
  const fp = p.facturation || {};
  const ts = p.taxe_sejour || {};
  const en = p.energie || {};
  const rl = p.relances || {};
  const { articles } = await api('/api/articles?inclure_inactifs=1').catch(() => ({ articles: [] }));
  const { url: logoUrl } = await api('/api/camping/logo').catch(() => ({ url: null }));
  $('#main').innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Configuration</div><h1>Paramètres du camping</h1></div>
      <span class="muted">${esc(c.nom || '')}</span></div>

    <div class="card">
      <h2>Identité & mentions légales</h2>
      <form id="f-ident" class="form-grid" style="margin-top:12px">
        <label>Nom (interne)<input name="nom" value="${esc(c.nom || '')}"></label>
        <label>Raison sociale<input name="raison_sociale" value="${esc(c.raison_sociale || '')}"></label>
        <label>SIRET<input name="siret" value="${esc(c.siret || '')}"></label>
        <label>N° TVA intracom.<input name="tva" value="${esc(c.tva || '')}"></label>
        <label class="full">Adresse<input name="adresse" value="${esc(c.adresse || '')}"></label>
        <label>E-mail<input name="email" type="email" value="${esc(c.email || '')}"></label>
        <label>Téléphone<input name="telephone" value="${esc(c.telephone || '')}"></label>
        <div class="full"><button class="btn btn-primary">Enregistrer l'identité</button></div>
      </form>
    </div>

    <div class="card" style="margin-top:16px">
      <h2>Logo</h2>
      <div class="logo-row">
        <div class="logo-preview">${logoUrl ? `<img src="${logoUrl}" alt="logo">` : '<span class="muted">Aucun logo</span>'}</div>
        <div>
          <input type="file" id="logo-file" accept="image/png,image/jpeg">
          <button class="btn btn-ghost btn-sm" onclick="uploadLogo()">Téléverser</button>
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
        <label>Expéditeur e-mail<input name="email_exp" type="email" value="${esc(fp.email || '')}"></label>
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
      <h2>Énergie</h2>
      <p class="muted" style="margin-top:2px">Utilisé par l'écran Compteurs : chaque relevé crée une charge (conso × prix kWh) sur la fiche du résident.</p>
      <form id="f-energie" class="form-grid" style="margin-top:12px">
        <label>Prix du kWh TTC (€)<input name="prix_kwh" type="number" step="0.0001" value="${en.prix_kwh ?? ''}" placeholder="0.39"></label>
        <label>TVA énergie (%)<input name="taux_tva" type="number" step="0.1" value="${en.taux_tva ?? 10}"></label>
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
        <label>TVA (%)<input name="taux_tva" type="number" step="0.1" value="0"></label>
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
        <td class="right"><button class="btn btn-ghost btn-sm" onclick="supprimerArticle('${a.id}')">Retirer</button></td>
      </tr>`).join('') || '<tr><td colspan="5" class="muted">Aucun article. Ajoute ton premier ci-dessous.</td></tr>';
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
    const energie = { ...en, prix_kwh: f.prix_kwh === '' ? null : Number(f.prix_kwh), taux_tva: Number(f.taux_tva || 10) };
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
        <button type="button" class="btn btn-ghost btn-sm" onclick="this.closest('.fac-ligne').remove()">Retirer la ligne</button>
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
        <button type="button" class="btn btn-ghost btn-sm" onclick="ajouterLigneCatalogue()">+ Ajouter</button>
      </div>` : ''}
      <div class="full">
        <div class="muted" style="margin-bottom:6px">Lignes — loyer, taxe, charges, ventes…</div>
        <div id="fac-lignes">${(preset && preset.lignes ? preset.lignes.map((l) => ligneRow(l)).join('') : ligneRow())}</div>
        <button type="button" class="btn btn-ghost btn-sm" onclick="ajouterLigneFacture()" style="margin-top:4px">+ Ligne libre</button>
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
async function vueReglements() {
  const [{ reglements }, { residents }, moyRes] = await Promise.all([
    api('/api/reglements'), api('/api/residents'),
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
        <label>Résident *<select name="resident_id" required>${residents.map((r) => `<option value="${r.id}">${esc(rmap[r.id])}</option>`).join('')}</select></label>
        <label>Moyen de paiement *<select name="mode" required>
          ${moyens.length
            ? moyens.map((m) => `<option value="${esc(m.code)}">${esc(m.libelle)}</option>`).join('')
            : '<option value="espece">Espèces</option><option value="cheque">Chèque</option>'}
        </select></label>
        <label>Montant (€) *<input name="montant" type="number" step="0.01" required></label>
        <label>Référence<input name="reference" placeholder="n° chèque, n° titre ANCV, libellé virement…"></label>
        <div class="full"><button class="btn btn-primary">Encaisser (lettrage automatique)</button></div>
      </form>
      ${moyens.length ? '' : '<p class="muted" style="margin-top:8px">Moyens de paiement par défaut — configure-les dans Administration.</p>'}
    </div>
    <div class="card"><table><thead><tr><th>Date</th><th>Résident</th><th>Moyen</th><th>Référence</th><th class="right">Montant</th></tr></thead>
    <tbody>${reglements.map((g) => `
      <tr><td class="muted">${dfr(g.date_reglement)}</td><td>${esc(rmap[g.resident_id] || '—')}</td>
      <td class="muted">${esc(mlib[g.mode] || g.mode)}</td><td class="muted">${esc(g.reference || '—')}</td>
      <td class="right"><strong>${eur(g.montant)}</strong></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Aucun règlement enregistré.</td></tr>'}</tbody></table></div>`;

  $('#f-reg').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    body.montant = Number(body.montant);
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
          <button class="btn btn-primary btn-sm" onclick="creerRemise('${esc(m.code)}','${esc(m.libelle)}')">Créer le bordereau</button>
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
      ${blocsAttente || '<div class="card"><p class="muted" style="margin:0">Aucun règlement en attente de remise (chèques, ANCV…).</p></div>'}
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
            <button class="btn btn-ghost btn-sm" onclick="pdfRemise('${r.id}','${esc(r.numero)}')">Bordereau</button>
            ${r.statut === 'remise' ? `<button class="btn btn-ghost btn-sm" onclick="encaisserRemise('${r.id}')">Encaissée ✓</button>` : ''}
            ${r.statut !== 'annulee' ? `<button class="btn btn-ghost btn-sm" onclick="annulerRemise('${r.id}','${esc(r.numero)}',${r.statut === 'encaissee'})">Annuler</button>` : ''}
          </td></tr>`).join('')}</tbody></table>` : '<p class="muted">Aucune remise.</p>'}
      </div>`;
  } catch (e) {
    zone.innerHTML = `<p class="form-error">Remises : ${esc(e.message)}</p>`;
  }
}

window.creerRemise = async (code, libelle) => {
  const ids = [...document.querySelectorAll(`.chk-remise[data-moyen="${code}"]:checked`)].map((x) => x.value);
  if (!ids.length) { toast('Sélectionne au moins un titre', true); return; }
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
async function vueImpayes() {
  const [imp, { residents }] = await Promise.all([api('/api/relances/impayes'), api('/api/residents')]);
  const rmap = {}; residents.forEach((r) => { rmap[r.id] = `${r.prenom || ''} ${r.nom}`.trim(); });
  const a = imp.aging;
  $('#main').innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Recouvrement</div><h1>Impayés</h1></div>
      <button class="btn btn-primary" onclick="runRelancesBtn()">Envoyer les relances</button></div>
    <div class="kpis">
      <div class="kpi"><div class="v">${eur(imp.total_du)}</div><div class="l">Total dû</div></div>
      <div class="kpi"><div class="v">${eur(a.a_echoir)}</div><div class="l">À échoir (délai ${imp.delai} j)</div></div>
      <div class="kpi warn"><div class="v">${eur(a.j0_30 + a.j31_60)}</div><div class="l">Retard 1 à 60 j</div></div>
      <div class="kpi bad"><div class="v">${eur(a.j61_90 + a.j90_plus)}</div><div class="l">Retard 61 j et +</div></div>
    </div>
    <div class="card"><table><thead><tr><th>Facture</th><th>Résident</th><th class="right">Reste dû</th><th class="right">Retard</th></tr></thead>
    <tbody>${imp.impayes.map((f) => `
      <tr><td><strong>${esc(f.numero)}</strong></td><td>${esc(rmap[f.resident_id] || '—')}</td>
      <td class="right">${eur(f.reste)}</td>
      <td class="right">${f.en_retard ? `<span class="badge en_retard">${f.jours_retard} j</span>` : '<span class="badge reglee">à échoir</span>'}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Aucun impayé. 🎉</td></tr>'}</tbody></table></div>`;
}
window.runRelancesBtn = async () => {
  try { const r = await api('/api/relances/run', { method: 'POST' }); toast(`Relances : ${r.envoyees} envoyée(s), ${r.ignorees} à échoir`); route(); }
  catch (e) { toast(e.message, true); }
};

/* ---------- Comptabilité ---------- */
function exerciceCourant(debutMois) {
  // debutMois : 1-12 (parametres.exercice_debut_mois). Renvoie {debut, fin} ISO de l'exercice en cours.
  const dm = Math.min(Math.max(Number(debutMois || 1), 1), 12);
  const now = new Date();
  let y = now.getFullYear();
  if (now.getMonth() + 1 < dm) y -= 1;
  const debut = `${y}-${String(dm).padStart(2, '0')}-01`;
  const finDate = new Date(y + (dm === 1 ? 0 : 1), dm === 1 ? 11 : dm - 1, 0); // dernier jour du mois précédent, année suivante
  const fin = `${finDate.getFullYear()}-${String(finDate.getMonth() + 1).padStart(2, '0')}-${String(finDate.getDate()).padStart(2, '0')}`;
  return { debut, fin };
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
  $('#main').innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Comptabilité</div><h1>Compta & TVA</h1></div>
      <span class="muted">Exercice en cours : <strong>${dfr(ex.debut)} → ${dfr(ex.fin)}</strong>${dm !== 1 ? '' : ' (année civile)'}</span></div>

    <div class="card">
      <div class="card-actions"><h2>TVA sur les encaissements</h2>
        <div class="toolbar"><input id="tva-mois" type="month" value="${mois}">
        <button class="btn btn-primary btn-sm" onclick="chargerTva()">Calculer</button></div></div>
      <p class="muted">TVA exigible au titre des paiements reçus sur le mois (régime des encaissements), ventilée par taux via le lettrage.</p>
      <div id="tva-resultat" style="margin-top:12px"><p class="muted">Choisir un mois puis « Calculer ».</p></div>
    </div>

    <div class="card">
      <div class="card-actions"><h2>Comptes clients (auxiliaires)</h2></div>
      <p class="muted">Chaque client reçoit automatiquement un numéro de compte à sa création (ex. 41100001). Réglez la racine ci-dessous, puis attribuez un compte aux clients existants qui n'en ont pas.</p>
      <div class="toolbar" style="margin-top:10px">
        <label style="margin:0">Racine<input id="cc-racine" value="${esc((camping?.parametres?.comptabilite || {}).racine_client || '411')}" style="width:110px"></label>
        <label style="margin:0">Chiffres de séquence<input id="cc-lng" type="number" min="2" max="8" value="${(camping?.parametres?.comptabilite || {}).longueur_seq_client || 5}" style="width:90px"></label>
        <button class="btn btn-ghost" onclick="enregistrerRacine()">Enregistrer</button>
        <button class="btn btn-primary" onclick="attribuerComptes()">Attribuer aux clients existants</button>
      </div>
      <p class="muted" style="margin-top:8px">Aperçu : <strong id="cc-apercu"></strong></p>
    </div>

    <div class="card">
      <div class="card-actions"><h2>Exports comptables</h2></div>
      <p class="muted">Période par défaut : l'exercice en cours. Modifiable ci-dessous.</p>
      <div class="toolbar" style="margin-top:10px">
        <label style="margin:0">Du<input id="exp-debut" type="date" value="${ex.debut}"></label>
        <label style="margin:0">Au<input id="exp-fin" type="date" value="${ex.fin}"></label>
        <button class="btn btn-primary" onclick="telechargerExport('/api/compta/fec?debut=' + $('#exp-debut').value + '&fin=' + $('#exp-fin').value, 'FEC_' + $('#exp-fin').value + '.txt')">Export FEC</button>
        <button class="btn btn-ghost" onclick="telechargerExport('/api/compta/export.csv?debut=' + $('#exp-debut').value + '&fin=' + $('#exp-fin').value, 'ecritures_' + $('#exp-debut').value + '_' + $('#exp-fin').value + '.csv')">Écritures CSV</button>
      </div>
    </div>`;
  majApercuCompte();
  $('#cc-racine').addEventListener('input', majApercuCompte);
  $('#cc-lng').addEventListener('input', majApercuCompte);
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
  if (!await askConfirm('Attribuer un numéro de compte à tous les clients qui n\u2019en ont pas ?')) return;
  try {
    const r = await api('/api/residents/attribuer-comptes', { method: 'POST' });
    toast(`${r.attribues} compte(s) attribué(s)`);
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
    btn.innerHTML = '<span style="font-size:18px">🔔</span>'
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
          <span style="font-size:21px;line-height:1.2;flex-shrink:0">${ICONES[n.type] || '🔔'}</span>
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
/* Plugin @capacitor-firebase/messaging : vrai jeton FCM sur iOS ET Android.
   Sur le web, ce bloc ne fait rien. */
(function () {
  const FM = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.FirebaseMessaging;
  if (!FM) return;

  const plateforme = () => (window.Capacitor.getPlatform ? window.Capacitor.getPlatform() : 'ios');
  let dejaFait = false;
  let monToken = null;

  async function envoyerToken(token) {
    if (!token) return;
    monToken = token;
    try {
      await api('/api/push/register', { method: 'POST', body: { token, platform: plateforme() } });
      console.log('[push] appareil enregistré');
    } catch (e) { console.error('[push] enregistrement refusé par le serveur :', e.message); }
  }

  async function enregistrer() {
    if (dejaFait || !TOKEN || !ACTIVE_CAMPING) return;
    dejaFait = true;
    try {
      const perm = await FM.requestPermissions();
      if (perm.receive !== 'granted') { console.log('[push] permission refusée'); return; }

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

      const { token } = await FM.getToken();
      console.log('[push] jeton FCM obtenu');
      await envoyerToken(token);
    } catch (e) { console.error('[push] init :', e && e.message); dejaFait = false; }
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

/* ============ Locamp — front admin (vanilla JS, hash routing) ============ */
const API = '';
let TOKEN = localStorage.getItem('lc_token') || null;
let CAMPINGS = [];
let ACTIVE_CAMPING = localStorage.getItem('lc_camping') || null;
let USER = null;

/* ---------- utilitaires ---------- */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const eur = (n) => Number(n || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const dfr = (d) => d ? new Date(d).toLocaleDateString('fr-FR') : '—';

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
    if (!ACTIVE_CAMPING && me.activeCampingId) ACTIVE_CAMPING = me.activeCampingId;
    startApp();
  } catch { logout(); }
}

function startApp() {
  $('#login-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#user-name').textContent = `${USER.prenom || ''} ${USER.nom || ''}`.trim() || USER.email;
  if (CAMPINGS.length > 1) {
    const sel = $('#camping-select');
    sel.innerHTML = CAMPINGS.map((c) => `<option value="${c.camping_id}">${esc(c.camping_id.slice(0, 8))}… (${esc(c.role)})</option>`).join('');
    sel.value = ACTIVE_CAMPING || CAMPINGS[0].camping_id;
    sel.onchange = () => { ACTIVE_CAMPING = sel.value; localStorage.setItem('lc_camping', ACTIVE_CAMPING); route(); };
    $('#camping-switch').classList.remove('hidden');
    loadCampingNames(sel);
  }
  if (!location.hash) location.hash = '#/dashboard';
  route();
}

async function loadCampingNames(sel) {
  for (const opt of sel.options) {
    try {
      const saved = ACTIVE_CAMPING; ACTIVE_CAMPING = opt.value;
      const { camping } = await api('/api/camping');
      opt.textContent = camping.nom || opt.value.slice(0, 8);
      ACTIVE_CAMPING = saved;
    } catch { /* ignore */ }
  }
}

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

/* ---------- drawer ---------- */
function openDrawer(html) { $('#drawer-content').innerHTML = html; $('#drawer').classList.remove('hidden'); }
function closeDrawer() { $('#drawer').classList.add('hidden'); }
window.closeDrawer = closeDrawer;

/* ---------- routing ---------- */
const routes = { dashboard: vueDashboard, carte: vueCarte, residents: vueResidents, emplacements: vueEmplacements, factures: vueFactures, reglements: vueReglements, impayes: vueImpayes, compteurs: vueCompteurs, messagerie: vueMessagerie, parametres: vueParametres };
function route() {
  const raw = (location.hash.replace('#/', '') || 'dashboard').split('?')[0];
  const [name, param] = raw.split('/');
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
    <div class="page-head"><div><div class="eyebrow">Vue d'ensemble</div><h1>Tableau de bord</h1></div><span class="muted">${dfr(d.genere_le)}</span></div>
    <div class="kpis">
      <div class="kpi"><div class="v">${d.occupation.occupes}/${d.occupation.total}</div><div class="l">Emplacements occupés (${d.occupation.taux} %)</div></div>
      <div class="kpi"><div class="v">${eur(d.ca_mois)}</div><div class="l">CA facturé ce mois</div></div>
      <div class="kpi ${d.impayes.total_du > 0 ? 'bad' : ''}"><div class="v">${eur(d.impayes.total_du)}</div><div class="l">Impayés (${d.impayes.nombre} factures)</div></div>
      <div class="kpi ${aFacturer > 0 ? 'warn' : ''}"><div class="v">${eur(aFacturer)}</div><div class="l">Prestations à facturer</div></div>
      <div class="kpi ${msgRes.total > 0 ? 'warn' : ''}"><div class="v">${msgRes.total}</div><div class="l"><a href="#/messagerie" style="color:inherit">Messages non lus</a></div></div>
      <div class="kpi ${d.alertes.documents_expirant > 0 ? 'warn' : ''}"><div class="v">${d.alertes.documents_expirant}</div><div class="l">Documents à renouveler (30 j)</div></div>
    </div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <h2 style="margin:0">Actions rapides</h2>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" onclick="messageRapide()">Prévenir un client (colis…)</button>
          <button class="btn btn-ghost btn-sm" onclick="messageGroupe()">Message à tous</button>
          ${enRetard.length ? `<button class="btn btn-primary btn-sm" onclick="relancerImpayes()">Relancer les ${enRetard.length} retard(s)</button>` : ''}
        </div>
      </div>
    </div>

    ${imp && enRetard.length ? `
    <div class="card" style="margin-top:16px">
      <h2>Factures en retard</h2>
      <table style="margin-top:8px"><thead><tr><th>Facture</th><th>Résident</th><th class="right">Reste dû</th><th class="right">Retard</th><th></th></tr></thead>
      <tbody>${enRetard.slice(0, 8).map((f) => `
        <tr>
          <td><strong>${esc(f.numero)}</strong></td>
          <td>${f.resident_id ? `<a href="#/residents/${f.resident_id}" style="color:inherit">${esc(rmap[f.resident_id] || '—')}</a>` : '—'}</td>
          <td class="right">${eur(f.reste)}</td>
          <td class="right"><span class="badge en_retard">${f.jours_retard} j</span></td>
          <td class="right">${f.resident_id ? `<button class="btn btn-ghost btn-sm" onclick="ouvrirConversation('${f.resident_id}')">Écrire</button>` : ''}</td>
        </tr>`).join('')}</tbody></table>
      ${enRetard.length > 8 ? `<p class="muted" style="margin-top:8px"><a href="#/impayes">Voir les ${enRetard.length} impayés →</a></p>` : ''}
    </div>` : ''}

    <div class="card" style="margin-top:16px">
      <h2>Factures du mois</h2>
      <p class="muted">${d.factures_mois.total} factures — ${Object.entries(st).map(([k, v]) => `${v} ${k}`).join(' · ') || 'aucune'}</p>
      <h2 style="margin-top:18px">Encaissements du mois</h2>
      <p class="muted">${Object.entries(d.encaissements_mois).map(([k, v]) => `${k} : ${eur(v)}`).join(' · ') || 'aucun'}</p>
      ${d.alertes.contrats_a_renouveler.length ? `<h2 style="margin-top:18px">Contrats arrivant à échéance</h2>
        <ul class="list-tight">${d.alertes.contrats_a_renouveler.map((c) => `<li><span>${esc(c.numero || c.id.slice(0, 8))}</span><span class="muted">${dfr(c.date_fin)}</span></li>`).join('')}</ul>` : ''}
    </div>`;
}

window.relancerImpayes = async () => {
  if (!confirm('Envoyer un rappel par e-mail à tous les clients en retard de paiement ?')) return;
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
    if (!confirm('Envoyer ce message à TOUS les résidents actifs ?')) return;
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

/* ---------- Carte interactive ---------- */
const STATUT_COLOR = { libre: '#1E5C4A', occupe: '#2C5282', reserve: '#C98B2D', indisponible: '#8A8A8A', impaye: '#B3492F' };
const CARTE_W = 1000, CARTE_H = 620, CARTE_PAD = 30;
let carteState = null;

async function vueCarte() {
  const [{ emplacements }, imp] = await Promise.all([api('/api/emplacements/carte'), api('/api/relances/impayes')]);
  const enRetard = new Set();
  for (const f of imp.impayes || []) if (f.en_retard) enRetard.add(f.resident_id);

  carteState = {
    emplacements: emplacements.map((e) => ({
      ...e,
      coord_x: e.coord_x == null ? null : Number(e.coord_x),
      coord_y: e.coord_y == null ? null : Number(e.coord_y),
    })),
    enRetard,
    mode: 'view',
    dirty: new Map(),   // id -> { coord_x, coord_y } (placé/déplacé) | null (à retirer)
    selected: null,
    drag: null,
  };
  renderCarte();
}

const carteClamp = (v, min, max) => Math.max(min, Math.min(max, v));

function carteColor(e) {
  const isImp = e.resident && carteState.enRetard.has(e.resident.id);
  return isImp ? STATUT_COLOR.impaye : (STATUT_COLOR[e.statut] || '#999');
}

// coordonnées effectives : une modification locale (dirty) l'emporte sur la valeur serveur
function carteCoords(e) {
  if (carteState.dirty.has(e.id)) return carteState.dirty.get(e.id);
  return e.coord_x == null || e.coord_y == null ? null : { coord_x: e.coord_x, coord_y: e.coord_y };
}

function renderCarte() {
  const st = carteState;
  const edit = st.mode === 'edit';

  const placed = [], unplaced = [];
  st.emplacements.forEach((e) => (carteCoords(e) ? placed : unplaced).push(e));

  const pins = placed.map((e) => {
    const c = carteCoords(e);
    const x = carteClamp(c.coord_x, CARTE_PAD, CARTE_W - CARTE_PAD);
    const y = carteClamp(c.coord_y, CARTE_PAD, CARTE_H - CARTE_PAD);
    const sel = st.selected === e.id ? ' selected' : '';
    return `<g class="pin${sel}" data-id="${e.id}" transform="translate(${x},${y})">
      <circle r="13" fill="${carteColor(e)}"></circle>
      <text>${esc(e.numero)}</text>
    </g>`;
  }).join('');

  const dirtyCount = st.dirty.size;
  const selEmp = st.selected ? st.emplacements.find((e) => e.id === st.selected) : null;

  const toolbar = edit
    ? `<div class="map-tools">
        ${dirtyCount ? `<span class="map-dirty">${dirtyCount} modif.</span>` : ''}
        <button class="btn btn-ghost btn-sm" onclick="cancelCarteEdit()">Annuler</button>
        <button class="btn btn-primary btn-sm" onclick="saveCartePositions()" ${dirtyCount ? '' : 'disabled'}>Enregistrer les positions</button>
      </div>`
    : `<button class="btn btn-primary btn-sm" onclick="toggleCarteEdit()">Éditer le plan</button>`;

  const tray = edit ? `
    <div class="map-tray">
      <div class="map-tray-head">À placer (${unplaced.length})</div>
      ${unplaced.length
        ? `<div class="map-chips">${unplaced.map((e) => `<button class="map-chip" onclick="placeEmplacement('${e.id}')">${esc(e.numero)}${e.secteur ? ` · ${esc(e.secteur)}` : ''}</button>`).join('')}</div>`
        : '<p class="muted" style="margin:0">Tous les emplacements sont positionnés.</p>'}
    </div>` : '';

  $('#main').innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">Plan interactif</div><h1>Carte du camping</h1></div>
      ${toolbar}
    </div>
    ${edit
      ? `<div class="map-editbar">
          <span class="muted">Glisse les pastilles pour les positionner. Clique un emplacement « à placer » pour le déposer, puis ajuste-le.</span>
          ${selEmp ? `<button class="btn btn-ghost btn-sm" onclick="retirerSelection()">Retirer « ${esc(selEmp.numero)} » du plan</button>` : ''}
        </div>`
      : `<span class="muted">${st.emplacements.length} emplacements — cliquer une pastille pour ouvrir la fiche</span>`}
    <div class="map-wrap${edit ? ' editing' : ''}">
      <svg class="map-svg" viewBox="0 0 ${CARTE_W} ${CARTE_H}" role="img" aria-label="Plan du camping">${pins}</svg>
      <div class="map-legend">
        <span><span class="dot" style="background:${STATUT_COLOR.libre}"></span>Libre</span>
        <span><span class="dot" style="background:${STATUT_COLOR.occupe}"></span>Occupé</span>
        <span><span class="dot" style="background:${STATUT_COLOR.impaye}"></span>Impayé</span>
        <span><span class="dot" style="background:${STATUT_COLOR.reserve}"></span>Réservé</span>
        <span><span class="dot" style="background:${STATUT_COLOR.indisponible}"></span>Indisponible</span>
      </div>
    </div>
    ${tray}
    ${!edit && unplaced.length ? `<p class="muted" style="margin-top:12px">Sans position sur la carte : ${unplaced.map((e) => esc(e.numero)).join(', ')} — passer en mode édition pour les placer.</p>` : ''}`;

  wireCarte();
}

function updateCarteTools() {
  const n = carteState.dirty.size;
  const tools = document.querySelector('.map-tools');
  if (!tools) return;
  const saveBtn = tools.querySelector('.btn-primary');
  if (saveBtn) saveBtn.disabled = !n;
  let badge = tools.querySelector('.map-dirty');
  if (n && !badge) {
    badge = document.createElement('span');
    badge.className = 'map-dirty';
    tools.insertBefore(badge, tools.firstChild);
  }
  if (badge) badge.textContent = n + ' modif.';
}

function wireCarte() {
  const st = carteState;
  const svg = document.querySelector('.map-svg');
  if (!svg) return;

  if (st.mode !== 'edit') {
    svg.querySelectorAll('.pin').forEach((g) => {
      g.addEventListener('click', () => ficheEmplacement(g.dataset.id));
    });
    return;
  }

  // clic dans le vide -> désélectionne
  svg.addEventListener('pointerdown', (e) => {
    if (e.target === svg && st.selected) { st.selected = null; renderCarte(); }
  });

  const toSvg = (evt) => {
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return { x: p.x, y: p.y };
  };

  svg.querySelectorAll('.pin').forEach((g) => {
    const id = g.dataset.id;

    g.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { g.setPointerCapture(e.pointerId); } catch (_) {}
      st.drag = { id, moved: false };
      g.classList.add('dragging');
    });

    g.addEventListener('pointermove', (e) => {
      if (!st.drag || st.drag.id !== id) return;
      const p = toSvg(e);
      const x = carteClamp(p.x, CARTE_PAD, CARTE_W - CARTE_PAD);
      const y = carteClamp(p.y, CARTE_PAD, CARTE_H - CARTE_PAD);
      g.setAttribute('transform', `translate(${x},${y})`);
      st.dirty.set(id, { coord_x: Math.round(x), coord_y: Math.round(y) });
      st.drag.moved = true;
    });

    const end = (e) => {
      if (!st.drag || st.drag.id !== id) return;
      const moved = st.drag.moved;
      st.drag = null;
      g.classList.remove('dragging');
      try { g.releasePointerCapture(e.pointerId); } catch (_) {}
      if (moved) {
        updateCarteTools();          // pastille déjà à sa place, on rafraîchit juste le compteur
      } else {                       // simple clic = sélection
        st.selected = id;
        setTimeout(renderCarte, 0);
      }
    };
    g.addEventListener('pointerup', end);
    g.addEventListener('pointercancel', end);
  });
}

/* actions mode édition */
window.toggleCarteEdit = () => {
  if (carteState.mode === 'view') carteState.mode = 'edit';
  else {
    if (carteState.dirty.size && !confirm('Des positions non enregistrées seront perdues. Continuer ?')) return;
    carteState.dirty.clear(); carteState.selected = null; carteState.mode = 'view';
  }
  renderCarte();
};

window.cancelCarteEdit = () => {
  carteState.dirty.clear(); carteState.selected = null; carteState.mode = 'view';
  renderCarte();
};

window.placeEmplacement = (id) => {
  const st = carteState;
  const offset = (st.dirty.size % 10) * 24;
  const x = carteClamp(CARTE_PAD + 70 + offset, CARTE_PAD, CARTE_W - CARTE_PAD);
  const y = carteClamp(CARTE_PAD + 70 + offset, CARTE_PAD, CARTE_H - CARTE_PAD);
  st.dirty.set(id, { coord_x: Math.round(x), coord_y: Math.round(y) });
  st.selected = id;
  renderCarte();
};

window.retirerSelection = () => {
  const st = carteState;
  if (!st.selected) return;
  st.dirty.set(st.selected, null);   // null = retirer du plan
  st.selected = null;
  renderCarte();
};

window.saveCartePositions = async () => {
  const st = carteState;
  if (!st.dirty.size) return;
  const positions = [...st.dirty.entries()].map(([id, v]) => ({
    id,
    coord_x: v ? v.coord_x : null,
    coord_y: v ? v.coord_y : null,
  }));
  try {
    await api('/api/emplacements/positions', { method: 'PUT', body: { positions } });
    for (const { id, coord_x, coord_y } of positions) {
      const e = st.emplacements.find((x) => x.id === id);
      if (e) { e.coord_x = coord_x; e.coord_y = coord_y; }
    }
    st.dirty.clear(); st.selected = null; st.mode = 'view';
    toast('Positions enregistrées');
    renderCarte();
  } catch (err) {
    toast(err.message, true);
  }
};

window.ficheEmplacement = async (id) => {
  const { emplacement: e, residents } = await api('/api/emplacements/' + id);
  const r = residents[0];
  let facturesHtml = '';
  if (r) {
    const { factures } = await api('/api/factures?resident_id=' + r.id);
    const dues = factures.filter((f) => ['emise', 'partielle', 'en_retard'].includes(f.statut));
    facturesHtml = `<h2 style="margin-top:18px">Factures en cours</h2>
      ${dues.length ? `<ul class="list-tight">${dues.map((f) => `<li><span>${esc(f.numero)} <span class="badge ${f.statut}">${f.statut}</span></span><span>${eur(f.total_ttc - f.montant_regle)}</span></li>`).join('')}</ul>` : '<p class="muted">Aucune facture en attente.</p>'}`;
  }
  openDrawer(`
    <h2>Emplacement ${esc(e.numero)}</h2>
    <p class="muted">${esc(e.secteur || '')} ${e.type ? '· ' + esc(e.type) : ''} · <span class="badge ${e.statut}">${e.statut}</span></p>
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
        <td class="muted">${esc(r.email || '')}${r.telephone ? ' · ' + esc(r.telephone) : ''}</td>
        <td>${r.emplacement_id && empNum[r.emplacement_id] ? `<strong>${esc(empNum[r.emplacement_id])}</strong>` : '<span class="muted">—</span>'}</td>
        <td class="right">${eur(r.solde)}</td>
      </tr>`).join('') || '<tr><td colspan="4" class="muted">Aucun résident. Créer le premier avec « Nouveau résident ».</td></tr>';
  };
  render(residents);
  $('#res-search').addEventListener('input', (e) => {
    const s = e.target.value.toLowerCase();
    render(residents.filter((r) => `${r.nom} ${r.prenom} ${r.email} ${r.telephone} ${r.emplacement_id ? empNum[r.emplacement_id] || '' : ''}`.toLowerCase().includes(s)));
  });
}

/* ---------- Fiche client (pleine page) ---------- */
async function vueFicheClient(id) {
  const [{ resident: r, emplacement, documents }, { factures }, { reglements }, presRes, synRes, msgRes] = await Promise.all([
    api('/api/residents/' + id),
    api('/api/factures?resident_id=' + id),
    api('/api/reglements?resident_id=' + id),
    api('/api/prestations?resident_id=' + id).catch(() => ({ prestations: null })),
    api('/api/prestations/synthese/' + id).catch(() => ({ synthese: null })),
    api('/api/messages?resident_id=' + id).catch(() => ({ messages: null })),
  ]);
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
            <td class="muted">${p.date_debut ? dfr(p.date_debut) : '—'}</td>
            <td class="muted">${p.date_fin ? dfr(p.date_fin) : '—'}</td>
            <td class="right"><strong>${eur(p.montant_ttc)}</strong></td>
            <td>${etatBadge(p)}</td>
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

    <section data-panel="compte" class="hidden">
      <div class="card">
        <h2>Factures</h2>
        <table><thead><tr><th>N°</th><th>Période</th><th>Date</th><th>Statut</th><th class="right">TTC</th><th class="right">Reste</th><th></th></tr></thead>
        <tbody>${factures.map((f) => `
          <tr>
            <td><strong>${esc(f.numero)}</strong></td>
            <td class="muted">${esc(f.periode || '—')}</td>
            <td class="muted">${dfr(f.date_emission)}</td>
            <td><span class="badge ${f.statut}">${f.statut}</span></td>
            <td class="right">${eur(f.total_ttc)}</td>
            <td class="right">${eur(f.total_ttc - f.montant_regle)}</td>
            <td class="right">
              <button class="btn btn-ghost btn-sm" onclick="pdfFacture('${f.id}')">PDF</button>
              ${!['avoir', 'annulee'].includes(f.statut) ? `<button class="btn btn-ghost btn-sm" onclick="emailFacture('${f.id}')">E-mail</button>` : ''}
              ${!['avoir', 'annulee'].includes(f.statut) ? `<button class="btn btn-ghost btn-sm" onclick="faireAvoir('${f.id}')">Avoir</button>` : ''}
            </td>
          </tr>`).join('') || '<tr><td colspan="7" class="muted">Aucune facture.</td></tr>'}</tbody></table>
      </div>
      <div class="card" style="margin-top:16px">
        <h2>Encaissements</h2>
        <table><thead><tr><th>Date</th><th>Mode</th><th>Référence</th><th class="right">Montant</th></tr></thead>
        <tbody>${reglements.map((g) => `
          <tr><td class="muted">${dfr(g.date_reglement)}</td><td class="muted">${esc(g.mode)}</td>
          <td class="muted">${esc(g.reference || '—')}</td><td class="right"><strong>${eur(g.montant)}</strong></td></tr>`).join('') || '<tr><td colspan="4" class="muted">Aucun encaissement.</td></tr>'}</tbody></table>
      </div>
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
        <h2>Documents</h2>
        ${documents.length ? `<ul class="list-tight">${documents.map((d) => `<li><span>${esc(d.type || 'document')} — ${esc(d.nom_fichier || '')}</span><a href="#" onclick="voirDoc('${d.id}');return false">ouvrir</a></li>`).join('')}</ul>` : '<p class="muted">Aucun document.</p>'}
      </div>
    </section>`;

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
  if (!confirm(`Créer une facture avec ${facturables.length} prestation(s) ?`)) return;
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
            ${articles.map((a) => `<option value="${a.id}">${esc(a.designation)} — ${eur(a.prix_ht)}${Number(a.taux_tva) ? ` (TVA ${a.taux_tva}%)` : ''}</option>`).join('')}
          </select></label>` : ''}
      <label class="full" style="${lbl}">Désignation *<input name="designation" required placeholder="${type === 'sejour' ? 'Séjour MH 1 chambre' : type === 'charge' ? 'Charges énergies' : type === 'caution' ? 'Caution location' : 'Bouteille de gaz'}"></label>
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
      <label>PU HT (€) *<input name="pu_ht" type="number" step="0.01" required></label>
      <label>TVA (%)<input name="taux_tva" type="number" step="0.1" value="${type === 'caution' ? 0 : ''}" ${type === 'caution' ? 'readonly' : ''} placeholder="0"></label>
      <label class="full">Notes<input name="notes"></label>
      <div class="full"><button class="btn btn-primary btn-block">Ajouter la prestation</button></div>
    </form>`);

  const sel = $('#presta-article');
  if (sel) sel.addEventListener('change', () => {
    const a = artMap[sel.value];
    if (!a) return;
    const f = $('#f-presta');
    f.designation.value = a.designation;
    f.pu_ht.value = a.prix_ht;
    f.taux_tva.value = a.taux_tva;
  });

  $('#f-presta').addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target).entries());
    b.resident_id = residentId; b.type = type;
    b.quantite = Number(b.quantite || 1); b.pu_ht = Number(b.pu_ht || 0); b.taux_tva = Number(b.taux_tva || 0);
    for (const k in b) if (b[k] === '') delete b[k];
    try {
      await api('/api/prestations', { method: 'POST', body: b });
      closeDrawer(); toast('Prestation ajoutée'); route();
    } catch (err) { toast(err.message, true); }
  });
};

window.supprimerPrestation = async (pid, residentId) => {
  if (!confirm('Annuler cette prestation ?')) return;
  try { await api(`/api/prestations/${pid}`, { method: 'DELETE' }); toast('Prestation annulée'); route(); }
  catch (err) { toast(err.message, true); }
};

window.encaisserClient = (id) => {
  openDrawer(`
    <h2>Encaisser un paiement</h2>
    <form id="f-enc" class="form-grid" style="margin-top:14px">
      <label>Mode<select name="mode"><option value="espece">Espèces</option><option value="cheque">Chèque</option><option value="virement">Virement</option><option value="tpe">Carte (TPE)</option></select></label>
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
        <td class="muted">${esc(e.type || '—')}</td><td><span class="badge ${e.statut}">${e.statut}</span></td>
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
      <label>Loyer de base (€)<input name="loyer_base" type="number" step="0.01"></label>
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
        <td class="muted">${dfr(f.date_emission)}</td><td><span class="badge ${f.statut}">${f.statut}</span></td>
        <td class="right">${eur(f.total_ttc)}</td><td class="right">${eur(f.montant_regle)}</td>
        <td class="right">
          <button class="btn btn-ghost btn-sm" onclick="pdfFacture('${f.id}')">PDF</button>
          ${!['avoir', 'annulee'].includes(f.statut) ? `<button class="btn btn-ghost btn-sm" onclick="emailFacture('${f.id}')">E-mail</button>` : ''}
          ${!['avoir', 'annulee'].includes(f.statut) ? `<button class="btn btn-ghost btn-sm" onclick="faireAvoir('${f.id}')">Avoir</button>` : ''}
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
      <span class="muted">${prixOk ? `Prix du kWh : <strong>${Number(d.prix_kwh)} € HT</strong> · TVA ${d.taux_tva} %` : ''}</span></div>
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
        <div class="full"><button class="btn btn-primary">Enregistrer la taxe</button></div>
      </form>
    </div>

    <div class="card" style="margin-top:16px">
      <h2>Énergie</h2>
      <p class="muted" style="margin-top:2px">Utilisé par l'écran Compteurs : chaque relevé crée une charge (conso × prix kWh) sur la fiche du résident.</p>
      <form id="f-energie" class="form-grid" style="margin-top:12px">
        <label>Prix du kWh HT (€)<input name="prix_kwh" type="number" step="0.0001" value="${en.prix_kwh ?? ''}" placeholder="0.35"></label>
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
      <table style="margin-top:10px"><thead><tr><th>Désignation</th><th>Unité</th><th class="right">Prix HT</th><th class="right">TVA</th><th></th></tr></thead>
        <tbody id="art-body"></tbody></table>
      <form id="f-article" class="form-grid" style="margin-top:12px">
        <label>Désignation *<input name="designation" required placeholder="Jeton de lavage"></label>
        <label>Unité<input name="unite" placeholder="unité, jeton, bouteille…"></label>
        <label>Prix HT (€)<input name="prix_ht" type="number" step="0.01" value="0"></label>
        <label>TVA (%)<input name="taux_tva" type="number" step="0.1" value="0"></label>
        <div class="full"><button class="btn btn-primary">Ajouter l'article</button></div>
      </form>
    </div>`;

  const renderArts = (list) => {
    $('#art-body').innerHTML = (list || []).filter((a) => a.actif !== false).map((a) => `
      <tr>
        <td><strong>${esc(a.designation)}</strong></td>
        <td class="muted">${esc(a.unite || '—')}</td>
        <td class="right">${eur(a.prix_ht)}</td>
        <td class="right">${Number(a.taux_tva)} %</td>
        <td class="right"><button class="btn btn-ghost btn-sm" onclick="supprimerArticle('${a.id}')">Retirer</button></td>
      </tr>`).join('') || '<tr><td colspan="5" class="muted">Aucun article. Ajoute ton premier ci-dessous.</td></tr>';
  };
  renderArts(articles);

  $('#f-article').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    body.prix_ht = Number(body.prix_ht || 0);
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
    try { await api('/api/camping/parametres', { method: 'PUT', body: { facturation } }); toast('Facturation enregistrée'); }
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
  if (!confirm('Retirer cet article du catalogue ?')) return;
  try { await api(`/api/articles/${id}`, { method: 'DELETE' }); toast('Article retiré'); route(); }
  catch (err) { toast(err.message, true); }
};

window.formFacture = async (presetResidentId) => {
  const [{ residents }, artRes] = await Promise.all([
    api('/api/residents'),
    api('/api/articles').catch(() => ({ articles: [] })),
  ]);
  const actifs = residents.filter((r) => r.actif !== false);
  const articles = artRes.articles || [];
  const articleMap = {}; articles.forEach((a) => { articleMap[a.id] = a; });
  const mois = new Date().toISOString().slice(0, 7);

  const ligneRow = (p = {}) => `
    <div class="fac-ligne">
      <input name="designation" placeholder="Désignation" required value="${esc(p.designation || '')}">
      <div class="fac-grid">
        <label >Du<input name="date_debut" type="date"></label>
        <label >Au<input name="date_fin" type="date"></label>
        <label >Qté<input name="quantite" type="number" step="0.01" value="${p.quantite ?? 1}"></label>
        <label >PU HT €<input name="pu_ht" type="number" step="0.01" required value="${p.pu_ht ?? ''}"></label>
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
          <select id="cat-select">${articles.map((a) => `<option value="${a.id}">${esc(a.designation)} — ${eur(a.prix_ht)}${Number(a.taux_tva) ? ` (TVA ${a.taux_tva}%)` : ''}</option>`).join('')}</select></label>
        <button type="button" class="btn btn-ghost btn-sm" onclick="ajouterLigneCatalogue()">+ Ajouter</button>
      </div>` : ''}
      <div class="full">
        <div class="muted" style="margin-bottom:6px">Lignes — loyer, taxe, charges, ventes…</div>
        <div id="fac-lignes">${ligneRow()}</div>
        <button type="button" class="btn btn-ghost btn-sm" onclick="ajouterLigneFacture()" style="margin-top:4px">+ Ligne libre</button>
      </div>
      <div class="full"><button class="btn btn-primary btn-block">Créer la facture</button></div>
    </form>`);

  window.ajouterLigneFacture = () => { $('#fac-lignes').insertAdjacentHTML('beforeend', ligneRow()); };
  window.ajouterLigneCatalogue = () => {
    const a = articleMap[$('#cat-select').value];
    if (!a) return;
    $('#fac-lignes').insertAdjacentHTML('beforeend', ligneRow({ designation: a.designation, pu_ht: a.prix_ht, taux_tva: a.taux_tva, quantite: 1 }));
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
      pu_ht: Number(row.querySelector('[name=pu_ht]').value || 0),
      taux_tva: Number(row.querySelector('[name=taux_tva]').value || 0),
    })).filter((l) => l.designation && l.pu_ht);
    if (!resident_id) { toast('Choisis un résident', true); return; }
    if (!lignes.length) { toast('Ajoute au moins une ligne (désignation + PU HT)', true); return; }
    try {
      const { facture } = await api('/api/factures', { method: 'POST', body: { resident_id, periode, lignes } });
      closeDrawer();
      toast(`Facture ${facture.numero} créée`);
      route();
    } catch (err) { toast(err.message, true); }
  });
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
  if (!confirm('Émettre un avoir et annuler cette facture ?')) return;
  try { await api(`/api/factures/${id}/avoir`, { method: 'POST' }); toast('Avoir émis'); route(); }
  catch (e) { toast(e.message, true); }
};

/* ---------- Règlements ---------- */
async function vueReglements() {
  const [{ reglements }, { residents }] = await Promise.all([api('/api/reglements'), api('/api/residents')]);
  const rmap = {}; residents.forEach((r) => { rmap[r.id] = `${r.prenom || ''} ${r.nom}`.trim(); });
  $('#main').innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Encaissements</div><h1>Règlements</h1></div></div>
    <div class="card">
      <h2>Enregistrer un paiement</h2>
      <form id="f-reg" class="form-grid" style="margin-top:10px">
        <label>Résident *<select name="resident_id" required>${residents.map((r) => `<option value="${r.id}">${esc(rmap[r.id])}</option>`).join('')}</select></label>
        <label>Mode *<select name="mode"><option value="espece">Espèces</option><option value="cheque">Chèque</option><option value="virement">Virement</option><option value="tpe">Carte (TPE)</option></select></label>
        <label>Montant (€) *<input name="montant" type="number" step="0.01" required></label>
        <label>Référence<input name="reference" placeholder="n° chèque, libellé virement…"></label>
        <div class="full"><button class="btn btn-primary">Encaisser (lettrage automatique)</button></div>
      </form>
    </div>
    <div class="card"><table><thead><tr><th>Date</th><th>Résident</th><th>Mode</th><th>Référence</th><th class="right">Montant</th></tr></thead>
    <tbody>${reglements.map((g) => `
      <tr><td class="muted">${dfr(g.date_reglement)}</td><td>${esc(rmap[g.resident_id] || '—')}</td>
      <td class="muted">${esc(g.mode)}</td><td class="muted">${esc(g.reference || '—')}</td>
      <td class="right"><strong>${eur(g.montant)}</strong></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Aucun règlement enregistré.</td></tr>'}</tbody></table></div>`;
  $('#f-reg').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    body.montant = Number(body.montant);
    try { await api('/api/reglements', { method: 'POST', body }); toast('Paiement enregistré et lettré'); route(); }
    catch (err) { toast(err.message, true); }
  });
}

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

/* ---------- go ---------- */
boot();

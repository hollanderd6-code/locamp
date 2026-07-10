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
const routes = { dashboard: vueDashboard, carte: vueCarte, residents: vueResidents, emplacements: vueEmplacements, factures: vueFactures, reglements: vueReglements, impayes: vueImpayes };
function route() {
  const name = (location.hash.replace('#/', '') || 'dashboard').split('?')[0];
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === name));
  ($('#main').innerHTML = '<p class="muted">Chargement…</p>');
  (routes[name] || vueDashboard)().catch((e) => { $('#main').innerHTML = `<p class="form-error">${esc(e.message)}</p>`; });
}
window.addEventListener('hashchange', route);

/* ================= VUES ================= */

async function vueDashboard() {
  const d = await api('/api/dashboard');
  const st = d.factures_mois.par_statut || {};
  $('#main').innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Vue d'ensemble</div><h1>Tableau de bord</h1></div><span class="muted">${dfr(d.genere_le)}</span></div>
    <div class="kpis">
      <div class="kpi"><div class="v">${d.occupation.occupes}/${d.occupation.total}</div><div class="l">Emplacements occupés (${d.occupation.taux} %)</div></div>
      <div class="kpi"><div class="v">${eur(d.ca_mois)}</div><div class="l">CA facturé ce mois</div></div>
      <div class="kpi ${d.impayes.total_du > 0 ? 'bad' : ''}"><div class="v">${eur(d.impayes.total_du)}</div><div class="l">Impayés (${d.impayes.nombre} factures)</div></div>
      <div class="kpi ${d.alertes.documents_expirant > 0 ? 'warn' : ''}"><div class="v">${d.alertes.documents_expirant}</div><div class="l">Documents à renouveler (30 j)</div></div>
    </div>
    <div class="card">
      <h2>Factures du mois</h2>
      <p class="muted">${d.factures_mois.total} factures — ${Object.entries(st).map(([k, v]) => `${v} ${k}`).join(' · ') || 'aucune'}</p>
      <h2 style="margin-top:18px">Encaissements du mois</h2>
      <p class="muted">${Object.entries(d.encaissements_mois).map(([k, v]) => `${k} : ${eur(v)}`).join(' · ') || 'aucun'}</p>
      ${d.alertes.contrats_a_renouveler.length ? `<h2 style="margin-top:18px">Contrats arrivant à échéance</h2>
        <ul class="list-tight">${d.alertes.contrats_a_renouveler.map((c) => `<li><span>${esc(c.numero || c.id.slice(0, 8))}</span><span class="muted">${dfr(c.date_fin)}</span></li>`).join('')}</ul>` : ''}
    </div>`;
}

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
  const { residents } = await api('/api/residents');
  $('#main').innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Locataires</div><h1>Résidents</h1></div>
      <div class="toolbar">
        <input class="search" id="res-search" placeholder="Rechercher nom, e-mail…">
        <button class="btn btn-primary" onclick="formResident()">Nouveau résident</button>
      </div></div>
    <div class="card"><table><thead><tr><th>Nom</th><th>Contact</th><th>Emplacement</th><th class="right">Solde</th></tr></thead>
    <tbody id="res-body"></tbody></table></div>`;
  const render = (list) => {
    $('#res-body').innerHTML = list.map((r) => `
      <tr class="row-click" onclick="ficheResident('${r.id}')">
        <td><strong>${esc(r.prenom || '')} ${esc(r.nom)}</strong>${r.actif ? '' : ' <span class="badge indisponible">inactif</span>'}</td>
        <td class="muted">${esc(r.email || '')}${r.telephone ? ' · ' + esc(r.telephone) : ''}</td>
        <td class="muted">${r.emplacement_id ? '<span class="badge occupe">rattaché</span>' : '—'}</td>
        <td class="right">${eur(r.solde)}</td>
      </tr>`).join('') || '<tr><td colspan="4" class="muted">Aucun résident. Créer le premier avec « Nouveau résident ».</td></tr>';
  };
  render(residents);
  $('#res-search').addEventListener('input', (e) => {
    const s = e.target.value.toLowerCase();
    render(residents.filter((r) => `${r.nom} ${r.prenom} ${r.email} ${r.telephone}`.toLowerCase().includes(s)));
  });
}

window.ficheResident = async (id) => {
  const { resident: r, emplacement, documents } = await api('/api/residents/' + id);
  const { factures } = await api('/api/factures?resident_id=' + id);
  openDrawer(`
    <h2>${esc(r.civilite || '')} ${esc(r.prenom || '')} ${esc(r.nom)}</h2>
    <p class="muted">${esc(r.email || '')}${r.telephone ? ' · ' + esc(r.telephone) : ''}</p>
    <ul class="list-tight">
      <li><span>Emplacement</span><span>${emplacement ? esc(emplacement.numero) + ' (' + esc(emplacement.secteur || '') + ')' : '—'}</span></li>
      <li><span>Adresse</span><span>${esc(r.adresse || '—')}</span></li>
    </ul>
    <h2 style="margin-top:18px">Factures</h2>
    ${factures.length ? `<ul class="list-tight">${factures.slice(0, 6).map((f) => `<li><span>${esc(f.numero)} <span class="badge ${f.statut}">${f.statut}</span></span><span>${eur(f.total_ttc)}</span></li>`).join('')}</ul>` : '<p class="muted">Aucune facture.</p>'}
    <h2 style="margin-top:18px">Documents</h2>
    ${documents.length ? `<ul class="list-tight">${documents.map((d) => `<li><span>${esc(d.type || 'document')} — ${esc(d.nom_fichier || '')}</span><a href="#" onclick="voirDoc('${d.id}');return false">ouvrir</a></li>`).join('')}</ul>` : '<p class="muted">Aucun document.</p>'}
  `);
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

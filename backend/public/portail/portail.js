/* ============ Portail locataire — logique ============ */
let RTOKEN = localStorage.getItem('lc_portail') || null;
const API = window.LOCAMP_API || '';   // '' en web (relatif) ; URL Render absolue en app mobile

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const eur = (n) => Number(n || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const dfr = (d) => d ? new Date(d).toLocaleDateString('fr-FR') : '—';

function toast(msg, err = false) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : '');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.add('hidden'), 4000);
}

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (!(opts.body instanceof FormData) && opts.body) headers['Content-Type'] = 'application/json';
  if (RTOKEN) headers['Authorization'] = 'Bearer ' + RTOKEN;
  const r = await fetch(API + path, { ...opts, headers, body: opts.body instanceof FormData ? opts.body : (opts.body ? JSON.stringify(opts.body) : undefined) });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) { logout(); throw new Error('Session expirée, reconnectez-vous.'); }
  if (!r.ok) throw new Error(data.error || 'Erreur serveur');
  return data;
}

const ECRANS = ['#ecran-connexion', '#ecran-activation', '#ecran-oubli', '#ecran-email', '#ecran-envoye', '#espace'];
function show(id) {
  ECRANS.forEach((s) => $(s)?.classList.add('hidden'));
  $(id).classList.remove('hidden');
}
function showEmail() { show('#ecran-email'); }
window.showEmail = showEmail;

function logout() { RTOKEN = null; localStorage.removeItem('lc_portail'); show('#ecran-connexion'); }

/* ---------- entrée : lien magique dans l'URL ? ---------- */
let JETON_EN_COURS = null;   // activation ou réinitialisation

async function boot() {
  const p = new URLSearchParams(location.search);
  const activation = p.get('activation');
  const reset = p.get('reset');
  const magic = p.get('token');

  // 1. Lien d'activation (première connexion) : le clic prouve que l'adresse est bien la sienne
  if (activation) {
    history.replaceState({}, '', '/portail/');
    try {
      const d = await api(`/api/portail/activation/${activation}`);
      JETON_EN_COURS = { type: 'activation', jeton: activation };
      $('#act-email').textContent = d.email || '';
      if (d.deja_actif) {
        $('#act-titre').textContent = 'Nouveau mot de passe';
        $('#act-intro').textContent = 'Choisissez un nouveau mot de passe pour votre espace.';
      }
      show('#ecran-activation');
      return;
    } catch (e) {
      show('#ecran-connexion');
      erreurCx(e.message);
      return;
    }
  }

  // 2. Lien de réinitialisation
  if (reset) {
    history.replaceState({}, '', '/portail/');
    JETON_EN_COURS = { type: 'reset', jeton: reset };
    $('#act-titre').textContent = 'Nouveau mot de passe';
    $('#act-intro').textContent = 'Choisissez votre nouveau mot de passe.';
    $('#act-email').textContent = '';
    show('#ecran-activation');
    return;
  }

  // 3. Lien magique (secours)
  if (magic) {
    history.replaceState({}, '', '/portail/');
    try {
      const data = await api('/api/portail/session', { method: 'POST', body: { token: magic } });
      RTOKEN = data.token; localStorage.setItem('lc_portail', RTOKEN);
    } catch (e) { toast(e.message, true); }
  }

  // 4. Session déjà ouverte
  if (RTOKEN) {
    try { await chargerEspace(); show('#espace'); return; }
    catch { logout(); }
  }
  show('#ecran-connexion');
}

function erreurCx(msg) {
  const e = $('#cx-err');
  e.textContent = msg;
  e.classList.remove('hidden');
}

async function ouvrirSession(token) {
  RTOKEN = token;
  localStorage.setItem('lc_portail', RTOKEN);
  await chargerEspace();
  show('#espace');
}

/* ---------- connexion par mot de passe ---------- */
$('#form-connexion').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#btn-connexion');
  btn.disabled = true; btn.textContent = 'Connexion…';
  $('#cx-err').classList.add('hidden');
  try {
    const d = await api('/api/portail/connexion', {
      method: 'POST',
      body: { email: $('#cx-email').value.trim(), mot_de_passe: $('#cx-mdp').value },
    });
    await ouvrirSession(d.token);
  } catch (err) {
    erreurCx(err.message);
    btn.disabled = false; btn.textContent = 'Se connecter';
  }
});

/* ---------- activation / nouveau mot de passe ---------- */
$('#form-activation').addEventListener('submit', async (e) => {
  e.preventDefault();
  const mdp = $('#act-mdp').value;
  const mdp2 = $('#act-mdp2').value;
  const err = $('#act-err');
  err.classList.add('hidden');

  if (mdp !== mdp2) {
    err.textContent = 'Les deux mots de passe ne correspondent pas.';
    err.classList.remove('hidden');
    return;
  }
  const btn = $('#btn-activation');
  btn.disabled = true; btn.textContent = 'Enregistrement…';
  try {
    const route = JETON_EN_COURS.type === 'activation' ? '/api/portail/activation' : '/api/portail/mdp-reinit';
    const d = await api(route, {
      method: 'POST',
      body: { jeton: JETON_EN_COURS.jeton, mot_de_passe: mdp },
    });
    toast(d.message || 'Espace activé');
    await ouvrirSession(d.token);
  } catch (e2) {
    err.textContent = e2.message;
    err.classList.remove('hidden');
    btn.disabled = false; btn.textContent = 'Activer mon espace';
  }
});

/* ---------- mot de passe oublié ---------- */
$('#lien-oubli').addEventListener('click', (e) => { e.preventDefault(); show('#ecran-oubli'); });
$('#lien-magique').addEventListener('click', (e) => { e.preventDefault(); show('#ecran-email'); });
$('#lien-retour-cx').addEventListener('click', (e) => { e.preventDefault(); show('#ecran-connexion'); });
$('#lien-retour-cx2').addEventListener('click', (e) => { e.preventDefault(); show('#ecran-connexion'); });

$('#form-oubli').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#btn-oubli');
  btn.disabled = true; btn.textContent = 'Envoi…';
  try {
    const out = await api('/api/portail/mdp-oublie', { method: 'POST', body: { email: $('#ob-email').value.trim() } });
    const info = $('#ob-info');
    info.textContent = out.message;
    info.classList.remove('hidden');
  } catch (err) { toast(err.message, true); }
  btn.disabled = false; btn.textContent = 'Envoyer le lien';
});

/* ---------- écran e-mail ---------- */
$('#form-email').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#btn-email'); btn.disabled = true;
  try {
    const out = await api('/api/portail/demande-acces', { method: 'POST', body: { email: $('#email').value } });
    if (out.dev_lien) { // mode dev : lien direct
      const info = $('#email-info');
      info.innerHTML = `Mode test : <a href="${out.dev_lien}">cliquer ici pour vous connecter</a>`;
      info.classList.remove('hidden');
    } else {
      show('#ecran-envoye');
    }
  } catch (err) { toast(err.message, true); }
  finally { btn.disabled = false; }
});

/* ---------- espace ---------- */
async function chargerEspace() {
  const [moi, { factures }, { documents }, presta, msgs] = await Promise.all([
    api('/api/portail/moi'), api('/api/portail/factures'), api('/api/portail/documents'),
    api('/api/portail/prestations').catch(() => ({ prestations: [] })),
    api('/api/portail/messages').catch(() => ({ messages: [] })),
  ]);
  const { resident, emplacement, camping, paiement_en_ligne } = moi;
  // Paiement en ligne : masqué dans l'app mobile (conformité Apple Guideline 3.1.1), gardé sur le web.
  window._payok = !!paiement_en_ligne && !window.LOCAMP_NATIVE;

  $('#hello').textContent = `Bonjour ${resident.prenom || resident.nom}`;
  $('#sous-titre').textContent = [camping?.nom, emplacement ? `Emplacement ${emplacement.numero}` : null]
    .filter(Boolean).join(' · ');

  // hero solde = somme des restes dus + retard le plus ancien
  const dues = factures.filter((f) => !['avoir', 'annulee'].includes(f.statut) && f.reste > 0.004);
  const du = dues.reduce((s, f) => s + f.reste, 0);
  const maxRetard = Math.max(0, ...dues.map((f) => f.jours_retard || 0));
  $('#hero-solde').innerHTML = du > 0.004
    ? `<div class="eyebrow">Votre situation</div>
       <div class="montant du">${eur(du)}</div>
       <div class="lib">reste à régler${maxRetard > 0 ? ` — <strong>retard de ${maxRetard} jour${maxRetard > 1 ? 's' : ''}</strong>` : ''}</div>
       ${window._payok ? `<div class="pay-cta"><button class="btn btn-primary" onclick="payerPlusAncienne()">Régler en ligne</button></div>` : ''}`
    : `<div class="eyebrow">Votre situation</div>
       <div class="montant ok">À jour ✓</div>
       <div class="lib">Aucun paiement en attente. Merci !</div>`;

  window._factures = factures;

  // séjours & prestations en préparation
  const TYPELIB = { sejour: 'Séjour', vente: 'Vente', charge: 'Charges', caution: 'Caution' };
  const prestations = presta.prestations || [];
  if (prestations.length) {
    $('#sec-sejours').classList.remove('hidden');
    $('#liste-sejours').innerHTML = prestations.map((p) => `
      <div class="fac">
        <div>
          <div class="l1">${esc(p.designation)}</div>
          <div class="l2">${esc(TYPELIB[p.type] || p.type)}${p.date_debut ? ` · du ${dfr(p.date_debut)}${p.date_fin ? ' au ' + dfr(p.date_fin) : ''}` : ''}</div>
        </div>
        <div class="actions"><span class="m">${eur(p.montant_ttc)}</span></div>
      </div>`).join('');
  } else {
    $('#sec-sejours').classList.add('hidden');
  }

  // factures
  $('#liste-factures').innerHTML = factures.length ? factures.map((f) => `
    <div class="fac">
      <div>
        <div class="l1">${esc(f.numero)}</div>
        <div class="l2">${esc(f.periode || dfr(f.date_emission))} · <span class="badge ${f.statut}">${libStatut(f.statut)}</span>
          ${f.reste > 0.004 && f.date_echeance ? (f.jours_retard > 0
            ? ` · <strong style="color:#B3492F">en retard de ${f.jours_retard} j</strong>`
            : ` · à régler avant le ${dfr(f.date_echeance)}`) : ''}</div>
      </div>
      <div class="actions">
        <span class="m">${eur(f.total_ttc)}</span>
        <button class="btn btn-ghost btn-sm" onclick="voirPdf('${f.id}')">PDF</button>
        ${window._payok && f.reste > 0.004 && !['avoir', 'annulee'].includes(f.statut) ? `<button class="btn btn-primary btn-sm" onclick="payer('${f.id}')">Payer ${eur(f.reste)}</button>` : ''}
      </div>
    </div>`).join('') : '<p class="note">Aucune facture pour le moment.</p>';

  // documents
  $('#liste-docs').innerHTML = documents.length ? documents.map((d) => `
    <div class="doc">
      <div><div class="t">${esc(libType(d.type))}</div><div class="d">${esc(d.nom_fichier || '')} · ${dfr(d.created_at)}</div></div>
      <button class="btn btn-ghost btn-sm" onclick="voirDoc('${d.id}')">Ouvrir</button>
    </div>`).join('') : '<p class="note">Aucun document dans votre dossier.</p>';

  // messages
  renderMessages(msgs.messages || []);

  // documents à signer
  chargerSignatures();
}

function renderMessages(list) {
  const fil = $('#fil-messages');
  fil.innerHTML = list.length ? list.map((m) => `
    <div style="max-width:78%;align-self:${m.auteur === 'resident' ? 'flex-end' : 'flex-start'}">
      <div style="padding:10px 14px;border-radius:14px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-break:break-word;
        ${m.auteur === 'resident' ? 'background:#1A7A5E;color:#fff;border-bottom-right-radius:4px' : 'background:#fff;border:1px solid #E3E0D6;border-bottom-left-radius:4px'}">${esc(m.corps)}</div>
      <div style="font-size:10.5px;color:#999;margin-top:3px;text-align:${m.auteur === 'resident' ? 'right' : 'left'}">${m.auteur === 'resident' ? 'Vous' : 'Le camping'} · ${new Date(m.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
    </div>`).join('') : '<p class="note" style="margin:0">Aucun message. Une question ? Écrivez au camping ci-dessous.</p>';
  fil.scrollTop = fil.scrollHeight;
}

function libStatut(s) {
  return { emise: 'à régler', partielle: 'partiellement réglée', reglee: 'réglée', en_retard: 'en retard', avoir: 'avoir', annulee: 'annulée' }[s] || s;
}
function libType(t) {
  return { cni: "Pièce d'identité", piece_identite: "Pièce d'identité", attestation_assurance: "Attestation d'assurance",
    justificatif_domicile: 'Justificatif de domicile', depot_locataire: 'Document déposé', autre: 'Document' }[t] || (t || 'Document');
}

window.voirPdf = async (id) => {
  try { const { url } = await api(`/api/portail/factures/${id}/pdf`); window.open(url, '_blank'); }
  catch (e) { toast(e.message, true); }
};
window.voirDoc = async (id) => {
  try { const { url } = await api(`/api/portail/documents/${id}/url`); window.open(url, '_blank'); }
  catch (e) { toast(e.message, true); }
};
window.payer = async (id) => {
  try { const { url } = await api(`/api/portail/factures/${id}/payer`, { method: 'POST' }); location.href = url; }
  catch (e) { toast(e.message, true); }
};
window.payerPlusAncienne = () => {
  const f = (window._factures || []).filter((x) => x.reste > 0.004 && !['avoir', 'annulee'].includes(x.statut))
    .sort((a, b) => (a.date_emission || '').localeCompare(b.date_emission || ''))[0];
  if (f) window.payer(f.id); else toast('Aucune facture à régler');
};

/* ---------- upload document ---------- */
$('#doc-file').addEventListener('change', () => { $('#btn-doc').disabled = !$('#doc-file').files.length; 
  $('#doc-note').textContent = $('#doc-file').files.length ? `Fichier : ${$('#doc-file').files[0].name}` : ''; });
$('#form-doc').addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = $('#doc-file').files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  fd.append('type', $('#doc-type').value);
  const btn = $('#btn-doc'); btn.disabled = true;
  try {
    await api('/api/portail/documents', { method: 'POST', body: fd });
    toast('Document envoyé au camping');
    $('#doc-file').value = ''; $('#doc-note').textContent = '';
    await chargerEspace();
  } catch (err) { toast(err.message, true); }
  finally { btn.disabled = false; }
});

/* ---------- messages ---------- */
$('#form-msg').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#msg-corps');
  const corps = input.value.trim();
  if (!corps) return;
  const btn = $('#btn-msg'); btn.disabled = true;
  try {
    await api('/api/portail/messages', { method: 'POST', body: { corps } });
    input.value = '';
    const { messages } = await api('/api/portail/messages');
    renderMessages(messages || []);
  } catch (err) { toast(err.message, true); }
  finally { btn.disabled = false; }
});

$('#btn-mes-donnees').addEventListener('click', async () => {
  try {
    const r = await fetch(API + '/api/portail/mes-donnees', { headers: { Authorization: 'Bearer ' + RTOKEN } });
    if (!r.ok) throw new Error('Export indisponible');
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'mes_donnees.json';
    a.click(); URL.revokeObjectURL(a.href);
    toast('Vos données ont été téléchargées');
  } catch (e) { toast(e.message, true); }
});

$('#btn-logout').addEventListener('click', logout);
boot();

/* ==================== SIGNATURE ÉLECTRONIQUE ==================== */
let SIG = null;          // document en cours de signature
let sigTrace = false;    // le tracé manuscrit a-t-il commencé ?

async function chargerSignatures() {
  try {
    const { a_signer, signes } = await api('/api/portail/signatures');
    const sec = $('#sec-signer');
    if (!a_signer.length && !signes.length) { sec.classList.add('hidden'); return; }
    sec.classList.remove('hidden');

    $('#liste-signer').innerHTML = [
      ...a_signer.map((d) => `
        <div class="fac">
          <div>
            <div class="l1">${esc(d.titre)}</div>
            <div class="l2">${d.nb_pages || 1} page(s) · <strong style="color:var(--rouge)">signature requise</strong></div>
          </div>
          <div class="actions">
            <button class="btn btn-primary btn-sm" onclick="ouvrirSignature('${d.id}')">Lire et signer</button>
          </div>
        </div>`),
      ...signes.map((d) => `
        <div class="fac">
          <div>
            <div class="l1">${esc(d.titre)}</div>
            <div class="l2">Signé le ${dfr(d.date_signature)} · <span class="badge reglee">signé</span></div>
          </div>
          <div class="actions">
            <button class="btn btn-ghost btn-sm" onclick="ouvrirSignature('${d.id}')">Consulter</button>
          </div>
        </div>`),
    ].join('');
  } catch (e) { /* table absente : section masquée */ }
}

window.ouvrirSignature = async (id) => {
  try {
    SIG = await api('/api/portail/signatures/' + id);
    sigTrace = false;

    document.querySelectorAll('.content > section').forEach((s) => s.classList.add('hidden'));
    $('#sec-signature').classList.remove('hidden');
    window.scrollTo({ top: 0 });

    $('#sig-titre').textContent = SIG.titre;
    $('#sig-message').textContent = SIG.message || '';
    $('#sig-message').style.display = SIG.message ? '' : 'none';
    $('#sig-consent-txt').textContent = SIG.consentement;

    const dejaSigne = SIG.statut === 'signe';
    ['#sig-scroll-hint', '#sig-legal-note', '#sig-champs', '#sig-bloc-pad', '#sig-consent-txt', '#sig-signer'].forEach((s) => {
      const el = $(s); if (el) el.style.display = dejaSigne ? 'none' : '';
    });
    const cons = $('#sig-consent')?.closest('label');
    if (cons) cons.style.display = dejaSigne ? 'none' : '';

    await afficherPdfSignature(SIG.url);
    if (!dejaSigne) {
      construireChampsSignature(SIG.champs || []);
      initPadSignature();
      majBoutonSignature();
    }
  } catch (e) { toast(e.message, true); }
};

$('#sig-retour').addEventListener('click', (e) => {
  e.preventDefault();
  $('#sec-signature').classList.add('hidden');
  document.querySelectorAll('.content > section').forEach((s) => {
    if (s.id !== 'sec-signature') s.classList.remove('hidden');
  });
  chargerEspace();
});

async function afficherPdfSignature(url) {
  const zone = $('#sig-pdf');
  zone.innerHTML = '<p class="note" style="margin:0">Chargement du document…</p>';
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const pdf = await pdfjsLib.getDocument(url).promise;
    zone.innerHTML = '';
    const larg = Math.min(zone.clientWidth - 24, 720);
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: larg / base.width });
      const c = document.createElement('canvas');
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      c.width = vp.width * dpr; c.height = vp.height * dpr;
      c.style.cssText = 'width:100%;height:auto;display:block;margin:0 auto 10px;background:#fff;border-radius:4px;box-shadow:var(--shadow-s)';
      zone.appendChild(c);
      const ctx = c.getContext('2d');
      ctx.scale(dpr, dpr);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
    }
  } catch (e) {
    zone.innerHTML = `<p class="note" style="margin:0">Aperçu indisponible. <a href="${url}" target="_blank">Ouvrir le document</a></p>`;
  }
}

function construireChampsSignature(champs) {
  const box = $('#sig-champs');
  box.innerHTML = '';
  let sig = false;
  for (const c of champs) {
    if (c.type === 'signature') { sig = true; continue; }
    const d = document.createElement('div');
    d.style.marginBottom = '14px';
    if (c.type === 'case') {
      d.innerHTML = `<label style="display:flex;gap:11px;align-items:flex-start;background:#FDFBF7;
        border:1px solid var(--hairline);border-radius:11px;padding:13px">
        <input type="checkbox" data-id="${esc(c.id)}" ${c.requis ? 'data-requis="1"' : ''}
          style="width:20px;height:20px;accent-color:var(--sapin);margin-top:1px;flex-shrink:0">
        <span style="font-size:14px;line-height:1.5">${esc(c.label || 'J\u2019accepte')}${c.requis ? ' *' : ''}</span></label>`;
    } else {
      d.innerHTML = `<label style="display:block;font-size:11.5px;font-weight:700;letter-spacing:.07em;
        text-transform:uppercase;color:var(--brume);margin-bottom:6px">${esc(c.label || 'Votre réponse')}${c.requis ? ' *' : ''}</label>
        <input type="text" data-id="${esc(c.id)}" ${c.requis ? 'data-requis="1"' : ''} style="width:100%">`;
    }
    box.appendChild(d);
  }
  box.querySelectorAll('input').forEach((i) => i.addEventListener('input', majBoutonSignature));
  $('#sig-bloc-pad').classList.toggle('hidden', !sig);
}

function initPadSignature() {
  const c = $('#sig-pad');
  const ctx = c.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const dim = () => {
    const r = c.getBoundingClientRect();
    c.width = r.width * dpr; c.height = r.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#14283F';
  };
  dim();

  let trace = false;
  const pos = (e) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  c.addEventListener('pointerdown', (e) => {
    e.preventDefault(); c.setPointerCapture(e.pointerId); trace = true;
    const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y);
    if (!sigTrace) { sigTrace = true; $('#sig-hint').style.display = 'none'; majBoutonSignature(); }
  });
  c.addEventListener('pointermove', (e) => {
    if (!trace) return; e.preventDefault();
    const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke();
  });
  const fin = () => { trace = false; };
  c.addEventListener('pointerup', fin);
  c.addEventListener('pointercancel', fin);

  $('#sig-effacer').onclick = () => {
    const r = c.getBoundingClientRect();
    ctx.clearRect(0, 0, r.width, r.height);
    sigTrace = false;
    $('#sig-hint').style.display = 'flex';
    majBoutonSignature();
  };
}

function majBoutonSignature() {
  const consent = $('#sig-consent').checked;
  const besoinSig = !$('#sig-bloc-pad').classList.contains('hidden');
  let ok = true;
  document.querySelectorAll('#sig-champs input[data-requis]').forEach((i) => {
    if (i.type === 'checkbox' ? !i.checked : !i.value.trim()) ok = false;
  });
  $('#sig-signer').disabled = !(consent && ok && (!besoinSig || sigTrace));
}
$('#sig-consent').addEventListener('change', majBoutonSignature);

$('#sig-signer').addEventListener('click', async () => {
  const btn = $('#sig-signer');
  btn.disabled = true; btn.textContent = 'Signature en cours…';
  $('#sig-err').classList.add('hidden');

  const valeurs = {};
  document.querySelectorAll('#sig-champs input[data-id]').forEach((i) => {
    valeurs[i.dataset.id] = i.type === 'checkbox' ? i.checked : i.value.trim();
  });
  const besoinSig = !$('#sig-bloc-pad').classList.contains('hidden');

  try {
    const r = await api(`/api/portail/signatures/${SIG.id}/signer`, {
      method: 'POST',
      body: {
        valeurs,
        signature_png: besoinSig ? $('#sig-pad').toDataURL('image/png') : null,
        consentement: true,
      },
    });
    toast(r.message || 'Document signé');
    $('#sig-retour').click();
  } catch (e) {
    $('#sig-err').textContent = e.message;
    $('#sig-err').classList.remove('hidden');
    btn.disabled = false; btn.textContent = 'Signer le document';
  }
});

/* ==================== CLOCHE DE NOTIFICATIONS (portail locataire) ==================== */
/* Cloche dans la barre du haut ; au clic, panneau plein écran centré (overlay). */
(function () {
  let built = false;
  const ICONES = { paiement_confirme: '✅', nouvelle_facture: '🧾', nouveau_message: '💬' };
  function tempsRelatif(iso) {
    const d = new Date(iso), diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return "à l'instant";
    if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
    if (diff < 172800) return 'hier';
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  }
  function scrollVers(sel) { const el = $(sel); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

  function build() {
    if (built) return;
    const anchor = document.getElementById('btn-logout');
    if (!anchor) return;
    built = true;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = 'Notifications';
    btn.style.cssText = 'position:relative;background:none;border:none;cursor:pointer;padding:4px;line-height:1;font-size:20px;margin-right:8px';
    btn.innerHTML = '🔔<span id="pnotif-badge" class="hidden" style="position:absolute;top:-2px;right:-2px;min-width:16px;'
      + 'height:16px;padding:0 4px;border-radius:9px;background:#E5484D;color:#fff;font-size:10px;font-weight:700;'
      + 'display:flex;align-items:center;justify-content:center">0</span>';
    anchor.parentNode.insertBefore(btn, anchor);

    const ov = document.createElement('div');
    ov.id = 'pnotif-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(15,25,20,.45);'
      + 'display:none;align-items:flex-start;justify-content:center;padding:64px 14px 14px';
    ov.innerHTML = '<div id="pnotif-card" style="width:100%;max-width:440px;max-height:80vh;background:#fff;'
      + 'border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.3);display:flex;flex-direction:column;overflow:hidden"></div>';
    document.body.appendChild(ov);

    btn.onclick = (e) => { e.stopPropagation(); ouvrir(); };
    ov.addEventListener('click', (e) => { if (e.target === ov) fermer(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fermer(); });

    setInterval(majCompteur, 30000);
    majCompteur();
  }

  async function majCompteur() {
    if (!built || !RTOKEN) return;
    try {
      const { non_lues } = await api('/api/portail/notifications/compteur');
      const b = document.getElementById('pnotif-badge');
      if (!b) return;
      b.textContent = non_lues > 99 ? '99+' : non_lues;
      b.classList.toggle('hidden', !non_lues);
    } catch { /* silencieux */ }
  }

  function fermer() { const o = document.getElementById('pnotif-overlay'); if (o) o.style.display = 'none'; }

  async function ouvrir() {
    const o = document.getElementById('pnotif-overlay'); const card = document.getElementById('pnotif-card');
    if (!o || !card) return;
    o.style.display = 'flex';
    card.innerHTML = '<div style="padding:26px;color:#999;font-size:14px">Chargement…</div>';
    try {
      const { notifications } = await api('/api/portail/notifications?limit=40');
      rendre(notifications || []);
    } catch (e) {
      card.innerHTML = `<div style="padding:26px;color:#B3492F;font-size:14px">${esc(e.message)}</div>`;
    }
  }

  function rendre(list) {
    const card = document.getElementById('pnotif-card');
    const nonLues = list.filter((n) => !n.lu).length;
    let html = '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;'
      + 'padding:16px 18px;border-bottom:1px solid #EFEBE1;flex-shrink:0">'
      + '<strong style="font-size:16px">Notifications</strong>'
      + '<div style="display:flex;gap:14px;align-items:center">'
      + (nonLues ? '<a href="#" id="pnotif-tout-lu" style="font-size:13px;color:#1A7A5E;text-decoration:none">Tout marquer lu</a>' : '')
      + '<button id="pnotif-close" aria-label="Fermer" style="background:none;border:none;font-size:24px;line-height:1;cursor:pointer;color:#999;padding:0 2px">×</button>'
      + '</div></div><div style="overflow:auto;flex:1;-webkit-overflow-scrolling:touch">';

    if (!list.length) {
      html += '<div style="padding:44px 20px;text-align:center;color:#999;font-size:14px">Aucune notification</div>';
    } else {
      html += list.map((n) => `
        <div class="pnotif-item" data-id="${esc(n.id)}" style="display:flex;gap:12px;padding:14px 18px;cursor:pointer;
          border-bottom:1px solid #F4F1E9;${n.lu ? '' : 'background:#F5FBF8'}">
          <span style="font-size:21px;flex-shrink:0">${ICONES[n.type] || '🔔'}</span>
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

    document.getElementById('pnotif-close').onclick = fermer;
    const toutLu = document.getElementById('pnotif-tout-lu');
    if (toutLu) toutLu.onclick = async (e) => {
      e.preventDefault(); e.stopPropagation();
      try { await api('/api/portail/notifications/tout-lu', { method: 'POST' }); await ouvrir(); majCompteur(); } catch (err) { toast(err.message, true); }
    };
    card.querySelectorAll('.pnotif-item').forEach((el) => {
      el.onclick = () => activer(el.dataset.id, list.find((n) => String(n.id) === String(el.dataset.id)));
    });
  }

  async function activer(id, notif) {
    try { await api(`/api/portail/notifications/${id}/lu`, { method: 'POST' }); } catch { /* non bloquant */ }
    fermer(); majCompteur();
    if (!notif) return;
    if (notif.type === 'nouveau_message') scrollVers('#fil-messages');
    else if (notif.type === 'nouvelle_facture' || notif.type === 'paiement_confirme') scrollVers('#liste-factures');
  }

  if (typeof chargerEspace === 'function') {
    const _charger = chargerEspace;
    // eslint-disable-next-line no-global-assign
    chargerEspace = async function () { const r = await _charger.apply(this, arguments); build(); majCompteur(); return r; };
  }
  [1000, 3000].forEach((t) => setTimeout(() => { build(); majCompteur(); }, t));
  setInterval(() => { build(); majCompteur(); }, 25000);
})();

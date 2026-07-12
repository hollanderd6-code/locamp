/* ============ Portail locataire — logique ============ */
let RTOKEN = localStorage.getItem('lc_portail') || null;

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
  const r = await fetch(path, { ...opts, headers, body: opts.body instanceof FormData ? opts.body : (opts.body ? JSON.stringify(opts.body) : undefined) });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) { logout(); throw new Error('Session expirée, reconnectez-vous.'); }
  if (!r.ok) throw new Error(data.error || 'Erreur serveur');
  return data;
}

function show(id) {
  ['#ecran-email', '#ecran-envoye', '#espace'].forEach((s) => $(s).classList.add('hidden'));
  $(id).classList.remove('hidden');
}
function showEmail() { show('#ecran-email'); }
window.showEmail = showEmail;

function logout() { RTOKEN = null; localStorage.removeItem('lc_portail'); show('#ecran-email'); }

/* ---------- entrée : lien magique dans l'URL ? ---------- */
async function boot() {
  const params = new URLSearchParams(location.search);
  const magic = params.get('token');
  if (magic) {
    history.replaceState({}, '', '/portail/'); // nettoie l'URL
    try {
      const data = await api('/api/portail/session', { method: 'POST', body: { token: magic } });
      RTOKEN = data.token; localStorage.setItem('lc_portail', RTOKEN);
    } catch (e) { toast(e.message, true); }
  }
  if (RTOKEN) {
    try { await chargerEspace(); show('#espace'); return; }
    catch { logout(); }
  }
  show('#ecran-email');
}

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
  window._payok = !!paiement_en_ligne;

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
    const r = await fetch('/api/portail/mes-donnees', { headers: { Authorization: 'Bearer ' + RTOKEN } });
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
    ['#sig-champs', '#sig-bloc-pad', '#sig-consent-txt', '#sig-signer'].forEach((s) => {
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

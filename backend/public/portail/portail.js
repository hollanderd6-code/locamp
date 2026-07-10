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

$('#btn-logout').addEventListener('click', logout);
boot();

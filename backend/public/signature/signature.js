/* ============ Signature électronique — page du signataire ============ */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const JETON = new URLSearchParams(location.search).get('jeton');
let DOC = null;
let aSigne = false;   // le tracé manuscrit a-t-il été commencé ?
let otpRequis = false;   // une identification par SMS est-elle exigée ?
let otpEnvoye = false;

/* ---------- chargement ---------- */
async function charger() {
  if (!JETON) return erreur('Lien incomplet. Utilisez le lien reçu par e-mail.');
  try {
    const r = await fetch(`/api/signatures/signer/${JETON}`);
    const d = await r.json();
    if (!r.ok) return erreur(d.error || 'Lien invalide');

    DOC = d;
    $('#chargement').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#camping').textContent = d.camping;
    $('#titre').textContent = d.titre;
    $('#message').textContent = d.message || '';
    if (!d.message) $('#message').style.display = 'none';
    $('#consent-txt').textContent = d.consentement;

    await afficherPdf(d.url);
    construireChamps(d.champs || []);
    initPad();
    construireOtp(d);
    majBouton();
  } catch (e) {
    erreur('Impossible de charger le document. Réessayez plus tard.');
  }
}

function erreur(msg) {
  $('#chargement').classList.add('hidden');
  $('#app').classList.add('hidden');
  $('#erreur').classList.remove('hidden');
  $('#erreur-txt').textContent = msg;
}

/* ---------- rendu du PDF ---------- */
async function afficherPdf(url) {
  const zone = $('#pdf-zone');
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const pdf = await pdfjsLib.getDocument(url).promise;
    zone.innerHTML = '';
    const largeur = Math.min(zone.clientWidth - 28, 780);

    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: largeur / base.width });
      const canvas = document.createElement('canvas');
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = vp.width * dpr;
      canvas.height = vp.height * dpr;
      canvas.style.aspectRatio = `${vp.width} / ${vp.height}`;
      zone.appendChild(canvas);
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
    }
  } catch (e) {
    zone.innerHTML = `<p class="muted" style="margin:0">Aperçu indisponible. `
      + `<a href="${url}" target="_blank">Ouvrir le document dans un nouvel onglet</a></p>`;
  }
}

/* ---------- champs à remplir ---------- */
function construireChamps(champs) {
  const box = $('#champs');
  box.innerHTML = '';
  let signature = false;

  for (const c of champs) {
    if (c.type === 'signature') { signature = true; continue; }

    const div = document.createElement('div');
    div.className = 'champ';

    if (c.type === 'case') {
      div.innerHTML = `<label class="case">
        <input type="checkbox" data-id="${esc(c.id)}" ${c.requis ? 'data-requis="1"' : ''}>
        <span>${esc(c.label || 'J\u2019accepte')}${c.requis ? ' *' : ''}</span></label>`;
    } else {
      div.innerHTML = `<label class="lb">${esc(c.label || 'Votre réponse')}${c.requis ? ' *' : ''}</label>
        <input type="text" data-id="${esc(c.id)}" ${c.requis ? 'data-requis="1"' : ''}>`;
    }
    box.appendChild(div);
  }

  box.querySelectorAll('input').forEach((i) => i.addEventListener('input', majBouton));
  $('#bloc-signature').classList.toggle('hidden', !signature);
}

/* ---------- pad de signature manuscrite ---------- */
function initPad() {
  const canvas = $('#pad');
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const dimensionner = () => {
    const r = canvas.getBoundingClientRect();
    const data = aSigne ? canvas.toDataURL() : null;
    canvas.width = r.width * dpr;
    canvas.height = r.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#14283F';
    if (data) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, r.width, r.height); img.src = data; }
  };
  dimensionner();
  window.addEventListener('resize', dimensionner);

  let trace = false;
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    trace = true;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    if (!aSigne) { aSigne = true; $('#pad-hint').style.display = 'none'; majBouton(); }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!trace) return;
    e.preventDefault();
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  });
  const fin = () => { trace = false; };
  canvas.addEventListener('pointerup', fin);
  canvas.addEventListener('pointercancel', fin);
  canvas.addEventListener('pointerleave', fin);

  $('#effacer').addEventListener('click', () => {
    const r = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, r.width, r.height);
    aSigne = false;
    $('#pad-hint').style.display = 'flex';
    majBouton();
  });
}

/* ---------- identification par code SMS ---------- */
function construireOtp(d) {
  otpRequis = !!d.otp_requis && !d.otp_valide;
  if (!otpRequis) return;

  const html = `
    <div id="otp-bloc" style="margin:16px 0;padding:16px;background:#FDFBF7;border:1px solid var(--hairline);
      border-left:3px solid var(--sapin);border-radius:11px">
      <div style="font-size:11.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;
        color:var(--brume);margin-bottom:8px">Vérification de votre identité</div>
      <p class="note" style="margin:0 0 12px">Pour signer, saisissez le code à 6 chiffres que nous envoyons
        sur votre téléphone portable.</p>
      <button type="button" class="btn btn-ghost btn-sm" id="otp-envoyer">Recevoir le code par SMS</button>
      <div id="otp-saisie" class="hidden" style="margin-top:12px">
        <input id="otp-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6"
          placeholder="000000" style="width:100%;text-align:center;font-size:26px;letter-spacing:.42em;
          font-weight:600;padding:12px;border:1px solid var(--hairline);border-radius:10px;background:#fff">
      </div>
      <p id="otp-info" class="note hidden" style="margin-top:9px"></p>
    </div>`;
  $('#signer').insertAdjacentHTML('beforebegin', html);

  $('#otp-envoyer').addEventListener('click', envoyerOtp);
  $('#otp-code').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
    majBouton();
  });
}

async function envoyerOtp() {
  const btn = $('#otp-envoyer');
  const info = $('#otp-info');
  btn.disabled = true;
  btn.textContent = 'Envoi…';
  try {
    const r = await fetch(`/api/signatures/signer/${JETON}/otp`, { method: 'POST' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Envoi impossible');
    otpEnvoye = true;
    $('#otp-saisie').classList.remove('hidden');
    $('#otp-code').focus();
    info.textContent = `Code envoyé au ${d.telephone} — valable ${d.expire_dans_min} minutes.`;
    info.classList.remove('hidden');
    info.style.color = '';
    btn.textContent = 'Renvoyer le code';
  } catch (e) {
    info.textContent = e.message;
    info.style.color = 'var(--rouge)';
    info.classList.remove('hidden');
    btn.textContent = 'Recevoir le code par SMS';
  }
  btn.disabled = false;
  majBouton();
}

/* ---------- validation ---------- */
function majBouton() {
  const consent = $('#consent').checked;
  const besoinSig = !$('#bloc-signature').classList.contains('hidden');

  let complets = true;
  document.querySelectorAll('#champs input[data-requis]').forEach((i) => {
    if (i.type === 'checkbox' ? !i.checked : !i.value.trim()) complets = false;
  });

  const otpOk = !otpRequis || (otpEnvoye && ($('#otp-code')?.value || '').length === 6);
  $('#signer').disabled = !(consent && complets && (!besoinSig || aSigne) && otpOk);
}
$('#consent').addEventListener('change', majBouton);

/* ---------- envoi ---------- */
$('#signer').addEventListener('click', async () => {
  const btn = $('#signer');
  btn.disabled = true;
  btn.textContent = 'Signature en cours…';
  $('#err').classList.add('hidden');

  const valeurs = {};
  document.querySelectorAll('#champs input[data-id]').forEach((i) => {
    valeurs[i.dataset.id] = i.type === 'checkbox' ? i.checked : i.value.trim();
  });

  const besoinSig = !$('#bloc-signature').classList.contains('hidden');
  const signature_png = besoinSig ? $('#pad').toDataURL('image/png') : null;

  try {
    const r = await fetch(`/api/signatures/signer/${JETON}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ valeurs, signature_png, consentement: true, otp: otpRequis ? $('#otp-code').value : undefined }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Signature refusée');

    $('#app').classList.add('hidden');
    $('#fini').classList.remove('hidden');
    $('#fini-txt').textContent = d.message
      || 'Votre document a été signé. Une copie accompagnée de son certificat vous a été envoyée par e-mail.';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    $('#err').textContent = e.message;
    $('#err').classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Signer le document';
  }
});

charger();

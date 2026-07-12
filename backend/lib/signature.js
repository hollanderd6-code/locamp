/* ============ Signature électronique — page du signataire ============ */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const JETON = new URLSearchParams(location.search).get('jeton');
let DOC = null;
let aSigne = false;   // le tracé manuscrit a-t-il été commencé ?

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

/* ---------- validation ---------- */
function majBouton() {
  const consent = $('#consent').checked;
  const besoinSig = !$('#bloc-signature').classList.contains('hidden');

  let complets = true;
  document.querySelectorAll('#champs input[data-requis]').forEach((i) => {
    if (i.type === 'checkbox' ? !i.checked : !i.value.trim()) complets = false;
  });

  $('#signer').disabled = !(consent && complets && (!besoinSig || aSigne));
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
      body: JSON.stringify({ valeurs, signature_png, consentement: true }),
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

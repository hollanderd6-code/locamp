// ============================================================
//  Signature électronique — module Node (backend)
//  Règlement eIDAS (UE) n° 910/2014 · art. 1366-1367 du Code civil.
//  Signature simple : valeur juridique = faisceau de preuves
//  (identification, consentement exprès, intégrité SHA-256, horodatage, IP).
//
//  ⚠️ pdf-lib est chargé en LAZY-REQUIRE dans signerDocument : si la
//  dépendance venait à manquer, le module se charge quand même (le serveur
//  boote) et seule la signature renvoie une erreur propre.
// ============================================================
const crypto = require('crypto');

const CONSENTEMENT =
  "En cochant cette case et en signant, je reconnais avoir lu et compris le document, "
  + "et j'accepte de le signer par voie électronique. Je reconnais que ma signature "
  + "électronique a la même valeur juridique qu'une signature manuscrite (règlement "
  + "eIDAS n° 910/2014). J'accepte que la date, l'heure, mon adresse IP et mon navigateur "
  + "soient enregistrés à titre de preuve.";

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function nbPages(buffer) {
  try {
    const s = Buffer.isBuffer(buffer) ? buffer.toString('latin1') : String(buffer || '');
    const parType = [...s.matchAll(/\/Type\s*\/Pages\b[\s\S]{0,120}?\/Count\s+(\d+)/g)].map((m) => +m[1]);
    if (parType.length) return Math.max(...parType);
    const counts = [...s.matchAll(/\/Count\s+(\d+)/g)].map((m) => +m[1]);
    if (counts.length) return Math.max(...counts);
    const pages = (s.match(/\/Type\s*\/Page(?![s])/g) || []).length;
    return pages || 1;
  } catch { return 1; }
}

function normaliserChamps(champs) {
  if (!Array.isArray(champs)) return [];
  const TYPES = new Set(['signature', 'texte', 'case']);
  const num = (v) => (v == null || v === '' || isNaN(Number(v)) ? undefined : Number(v));
  return champs.slice(0, 100).map((c, i) => {
    const o = c && typeof c === 'object' ? c : {};
    let type = String(o.type || 'texte').toLowerCase();
    if (type === 'text') type = 'texte';
    if (type === 'checkbox') type = 'case';
    if (!TYPES.has(type)) type = 'texte';
    const out = {
      id: String(o.id || `z${i + 1}`).slice(0, 60),
      type,
      label: o.label != null ? String(o.label).slice(0, 300) : null,
      requis: o.requis === undefined ? true : !!o.requis,
    };
    for (const k of ['page', 'x', 'y', 'w', 'h']) { const n = num(o[k]); if (n !== undefined) out[k] = n; }
    if (out.page === undefined) out.page = 1;
    return out;
  });
}

/* ---------- helpers internes ---------- */
function toWinAnsi(s) {
  return String(s == null ? '' : s)
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ')
    .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, '');
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function slug(s) {
  return String(s || 'document').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'document';
}

async function apposerChamps(pdfDoc, lib, champs, valeurs, signaturePngBase64) {
  const { StandardFonts, rgb } = lib;
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();
  const vert = rgb(0.09, 0.32, 0.26);
  const encre = rgb(0.08, 0.16, 0.25);

  let sigImage = null;
  if (signaturePngBase64) {
    try { sigImage = await pdfDoc.embedPng(signaturePngBase64); }
    catch (e) { console.error('[signature] embedPng:', e.message); }
  }

  for (const c of (champs || [])) {
    const page = pages[(Number(c.page) || 1) - 1];
    if (!page) continue;
    const { width: W, height: H } = page.getSize();
    const bx = ((Number(c.x) || 0) / 100) * W;
    const bw = ((Number(c.w) || 0) / 100) * W;
    const bh = ((Number(c.h) || 0) / 100) * H;
    const by = H - ((Number(c.y) || 0) / 100) * H - bh;

    if (c.type === 'signature' && sigImage) {
      const ratio = sigImage.width / sigImage.height || 1;
      let dw = bw, dh = bw / ratio;
      if (dh > bh) { dh = bh; dw = bh * ratio; }
      page.drawImage(sigImage, { x: bx + (bw - dw) / 2, y: by + (bh - dh) / 2, width: dw, height: dh });
    } else if (c.type === 'case' && valeurs[c.id] === true) {
      const s = Math.max(8, Math.min(bh, 13));
      const cx = bx, cy = by + (bh - s) / 2;
      page.drawRectangle({ x: cx, y: cy, width: s, height: s, borderColor: vert, borderWidth: 1 });
      page.drawLine({ start: { x: cx + 2, y: cy + 2 }, end: { x: cx + s - 2, y: cy + s - 2 }, thickness: 1.4, color: vert });
      page.drawLine({ start: { x: cx + 2, y: cy + s - 2 }, end: { x: cx + s - 2, y: cy + 2 }, thickness: 1.4, color: vert });
    } else if (c.type === 'texte') {
      const val = toWinAnsi(valeurs[c.id]);
      if (val) {
        const size = Math.max(7, Math.min(bh * 0.75, 12));
        page.drawText(val, { x: bx + 2, y: by + (bh - size) / 2, size, font, color: encre, maxWidth: Math.max(10, bw - 4) });
      }
    }
  }
}

async function ajouterCertificat(pdfDoc, lib, infos) {
  const { StandardFonts, rgb } = lib;
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const page = pdfDoc.addPage([595.28, 841.89]);
  const M = 56;
  const larg = 595.28 - M * 2;
  let y = 841.89 - M;
  const vert = rgb(0.09, 0.32, 0.26);
  const gris = rgb(0.42, 0.42, 0.42);
  const noir = rgb(0.12, 0.16, 0.22);

  const line = (txt, { f = font, size = 10.5, color = noir, gap = 16, x = M } = {}) => {
    page.drawText(toWinAnsi(txt), { x, y, size, font: f, color, maxWidth: larg });
    y -= gap;
  };
  const paire = (k, v) => {
    page.drawText(toWinAnsi(k), { x: M, y, size: 10, font: bold, color: gris, maxWidth: 150 });
    page.drawText(toWinAnsi(v), { x: M + 155, y, size: 10, font, color: noir, maxWidth: larg - 155 });
    y -= 17;
  };

  line('Certificat de signature electronique', { f: bold, size: 17, color: vert, gap: 10 });
  line('Signature electronique simple — reglement eIDAS (UE) n\u00b0 910/2014', { size: 9, color: gris, gap: 22 });
  page.drawLine({ start: { x: M, y: y + 6 }, end: { x: 595.28 - M, y: y + 6 }, thickness: 0.8, color: rgb(0.85, 0.85, 0.8) });
  y -= 10;

  paire('Document', infos.titre);
  paire('Signataire', infos.signataireNom);
  if (infos.signataireEmail) paire('E-mail', infos.signataireEmail);
  paire('Date et heure', infos.dateStr);
  paire('Adresse IP', infos.ip);
  if (infos.userAgent) paire('Navigateur', String(infos.userAgent).slice(0, 90));
  y -= 6;
  paire('Empreinte (doc. presente)', '');
  line(infos.hashOriginal, { size: 8, color: gris, gap: 14, x: M });
  paire('Empreinte (doc. signe)', '');
  line(infos.hashSigne, { size: 8, color: gris, gap: 18, x: M });
  page.drawLine({ start: { x: M, y: y + 4 }, end: { x: 595.28 - M, y: y + 4 }, thickness: 0.8, color: rgb(0.85, 0.85, 0.8) });
  y -= 12;

  line('Consentement exprime par le signataire :', { f: bold, size: 10, gap: 15 });
  page.drawText(toWinAnsi(infos.consentement), { x: M, y, size: 9.5, font, color: noir, maxWidth: larg, lineHeight: 13 });
  y -= 72;

  if (infos.sigImage) {
    line('Signature manuscrite :', { f: bold, size: 10, gap: 8 });
    const ratio = infos.sigImage.width / infos.sigImage.height || 3;
    const dw = Math.min(200, larg), dh = dw / ratio;
    page.drawRectangle({ x: M, y: y - dh - 6, width: dw + 12, height: dh + 12, borderColor: rgb(0.85, 0.85, 0.8), borderWidth: 1 });
    page.drawImage(infos.sigImage, { x: M + 6, y: y - dh, width: dw, height: dh });
    y -= dh + 22;
  }

  page.drawText(toWinAnsi('Ce certificat atteste l\'integrite du document par empreinte SHA-256. '
    + 'Toute alteration ulterieure invaliderait cette empreinte.'), {
    x: M, y: M, size: 8, font, color: gris, maxWidth: larg, lineHeight: 11,
  });
}

/* ---------- Piste d'audit ---------- */
// Ajoute un événement horodaté au document (équivalent du « détail de la
// transaction » d'un prestataire de confiance). Best-effort : jamais bloquant.
async function tracer(docId, libelle, { ip = null, detail = null } = {}) {
  try {
    const { supabase } = require('./supabase');
    const { data } = await supabase.from('documents_signature')
      .select('evenements').eq('id', docId).maybeSingle();
    const evts = Array.isArray(data && data.evenements) ? data.evenements : [];
    evts.push({ date: new Date().toISOString(), libelle, ip, detail });
    await supabase.from('documents_signature')
      .update({ evenements: evts.slice(-100) }).eq('id', docId);
  } catch (e) { console.error('[signature:tracer]', e.message); }
}

/* ---------- Identification par code à usage unique (SMS) ---------- */
const OTP_VALIDITE_MIN = 10;
const OTP_MAX_TENTATIVES = 5;
const hashOtp = (code, docId) => crypto.createHash('sha256').update(`${docId}:${code}`).digest('hex');

// Masque un numéro pour l'affichage : +33612345678 -> +33 .. .. .. 78
function masquer(tel) {
  const t = String(tel || '').replace(/\s/g, '');
  return t.length < 4 ? '\u2022\u2022' : `${t.slice(0, 3)} \u2022\u2022 \u2022\u2022 \u2022\u2022 ${t.slice(-2)}`;
}

// Envoie un code à 6 chiffres sur le portable du signataire.
// Le code n'est JAMAIS stocké en clair : seule son empreinte est conservée.
async function envoyerOtp({ jeton, ip = null } = {}) {
  const { supabase } = require('./supabase');
  const { sendSms } = require('./sms');
  try {
    const { data: doc } = await supabase.from('documents_signature').select('*')
      .eq('jeton', jeton).maybeSingle();
    if (!doc) return { error: 'Lien invalide', code: 404 };
    if (doc.statut === 'signe') return { error: 'Ce document est déjà signé', code: 409 };
    if (doc.jeton_expire && new Date(doc.jeton_expire) < new Date()) return { error: 'Ce lien a expiré', code: 410 };

    const { data: r } = doc.resident_id
      ? await supabase.from('residents').select('telephone').eq('id', doc.resident_id).maybeSingle()
      : { data: null };
    const tel = r && r.telephone;
    if (!tel) return { error: "Aucun numéro de portable n'est enregistré pour vous. Contactez le camping.", code: 400 };

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const expire = new Date(Date.now() + OTP_VALIDITE_MIN * 60000).toISOString();
    await supabase.from('documents_signature').update({
      otp_code: hashOtp(code, doc.id), otp_expire: expire,
      otp_tentatives: 0, otp_valide_at: null, otp_telephone: tel,
    }).eq('id', doc.id);

    const out = await sendSms(tel, `Locamp \u2014 votre code de signature : ${code} (valable ${OTP_VALIDITE_MIN} min).`);
    if (out.error) return { error: out.error, code: 502 };

    await tracer(doc.id, "Envoi d'un code SMS", { ip, detail: masquer(tel) });
    if (out.skipped) console.log('[signature] SMS non configuré \u2014 code de test :', code);
    return { ok: true, telephone: masquer(tel), expire_dans_min: OTP_VALIDITE_MIN };
  } catch (e) { console.error('[signature:otp]', e.message); return { error: 'Erreur serveur', code: 500 }; }
}

// Vérifie le code saisi. Comparaison à temps constant + limite de tentatives.
async function verifierOtp(doc, code) {
  const { supabase } = require('./supabase');
  if (!doc.otp_code) return { error: "Demandez d'abord un code par SMS.", code: 400 };
  if (!doc.otp_expire || new Date(doc.otp_expire) < new Date()) {
    return { error: 'Code expiré. Demandez-en un nouveau.', code: 410 };
  }
  if ((doc.otp_tentatives || 0) >= OTP_MAX_TENTATIVES) {
    return { error: 'Trop de tentatives. Demandez un nouveau code.', code: 429 };
  }
  const attendu = Buffer.from(doc.otp_code);
  const fourni = Buffer.from(hashOtp(String(code || '').trim(), doc.id));
  const ok = attendu.length === fourni.length && crypto.timingSafeEqual(attendu, fourni);
  if (!ok) {
    await supabase.from('documents_signature')
      .update({ otp_tentatives: (doc.otp_tentatives || 0) + 1 }).eq('id', doc.id);
    return { error: 'Code incorrect.', code: 400 };
  }
  await supabase.from('documents_signature')
    .update({ otp_valide_at: new Date().toISOString(), otp_code: null }).eq('id', doc.id);
  return { ok: true };
}

async function signerDocument({ jeton, corps = {}, ip, userAgent, canal } = {}) {
  let lib;
  try { lib = require('pdf-lib'); }
  catch (e) {
    console.error('[signature] pdf-lib indisponible:', e.message);
    return { error: 'La signature en ligne est momentanement indisponible. Contactez le camping.', code: 503 };
  }
  const { PDFDocument } = lib;
  const { supabase } = require('./supabase');
  const { downloadDocument, uploadDocument } = require('./storage');
  const { sendEmail } = require('./email');

  try {
    if (!jeton) return { error: 'Lien invalide', code: 400 };

    const { data: doc } = await supabase.from('documents_signature').select('*').eq('jeton', jeton).maybeSingle();
    if (!doc) return { error: 'Lien invalide', code: 404 };
    if (doc.statut === 'signe') return { error: 'Ce document est déjà signé', code: 409 };
    if (doc.statut === 'annule' || doc.statut === 'refuse') return { error: 'Ce document n\u2019est plus disponible', code: 409 };
    if (doc.jeton_expire && new Date(doc.jeton_expire) < new Date()) return { error: 'Ce lien a expiré', code: 410 };

    const valeurs = (corps && typeof corps.valeurs === 'object' && corps.valeurs) ? corps.valeurs : {};
    if (!corps.consentement) return { error: 'Le consentement est requis pour signer', code: 400 };

    // Identification renforcée : un code SMS valide est exigé avant signature.
    // (Si aucun portable n'est enregistré, l'étape OTP est ignorée — signature simple.)
    if (corps.otp) {
      const v = await verifierOtp(doc, corps.otp);
      if (v.error) return v;
      doc.otp_valide_at = new Date().toISOString();
    } else if (doc.otp_telephone && !doc.otp_valide_at) {
      return { error: 'Validez le code reçu par SMS avant de signer.', code: 403 };
    }

    const champs = Array.isArray(doc.champs) ? doc.champs : [];
    const aSignature = champs.some((c) => c.type === 'signature');
    for (const c of champs) {
      if (!c.requis) continue;
      if (c.type === 'texte' && !String(valeurs[c.id] || '').trim()) return { error: 'Merci de remplir tous les champs requis.', code: 400 };
      if (c.type === 'case' && valeurs[c.id] !== true) return { error: 'Merci de cocher les cases requises.', code: 400 };
    }
    const sigBase64 = typeof corps.signature_png === 'string'
      ? corps.signature_png.replace(/^data:image\/png;base64,/, '') : null;
    if (aSignature && !sigBase64) return { error: 'Signature manuscrite requise.', code: 400 };

    let resident = null;
    if (doc.resident_id) {
      const { data } = await supabase.from('residents').select('nom,prenom,email').eq('id', doc.resident_id).maybeSingle();
      resident = data || null;
    }
    const premierTexte = champs.filter((c) => c.type === 'texte').map((c) => String(valeurs[c.id] || '').trim()).find(Boolean);
    const signataireNom = (resident ? `${resident.prenom || ''} ${resident.nom || ''}`.trim() : '') || premierTexte || 'Signataire';

    const origBytes = await downloadDocument(doc.storage_path);
    const pdfDoc = await PDFDocument.load(origBytes);
    await apposerChamps(pdfDoc, lib, champs, valeurs, sigBase64);

    const now = new Date();
    const dateStr = now.toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'long', timeStyle: 'medium' });
    const bytesAvantCert = Buffer.from(await pdfDoc.save());
    const hashSigne = sha256(bytesAvantCert);

    let sigImage = null;
    if (sigBase64) { try { sigImage = await pdfDoc.embedPng(sigBase64); } catch { /* déjà loggé */ } }

    await ajouterCertificat(pdfDoc, lib, {
      titre: doc.titre, signataireNom, signataireEmail: resident?.email || null,
      dateStr, ip: ip || 'inconnue', userAgent, hashOriginal: doc.hash_original, hashSigne,
      consentement: CONSENTEMENT, sigImage,
    });

    const sealedBytes = Buffer.from(await pdfDoc.save());
    const signePath = `signatures/${doc.camping_id}/${doc.id}_signe_${Date.now()}.pdf`;
    await uploadDocument(signePath, sealedBytes, 'application/pdf');

    // Piste d'audit complète : on fige les événements accumulés + la signature.
    await tracer(doc.id, 'Signature du document', { ip, detail: signataireNom });
    const { data: docFinal } = await supabase.from('documents_signature')
      .select('evenements').eq('id', doc.id).maybeSingle();
    const evenements = Array.isArray(docFinal && docFinal.evenements) ? docFinal.evenements
      : [{ date: now.toISOString(), libelle: 'Signature du document', ip: ip || null }];

    // Canal d'identification employé (SMS ou simple), conservé dans la preuve.
    const identification = doc.otp_valide_at
      ? { methode: 'otp_sms', telephone: masquer(doc.otp_telephone), valide_at: doc.otp_valide_at }
      : { methode: 'simple' };

    await supabase.from('signatures_preuves').insert({
      identification,
      camping_id: doc.camping_id, document_id: doc.id, resident_id: doc.resident_id || null,
      signataire_nom: signataireNom, signataire_email: resident?.email || null,
      ip: ip || 'inconnue', user_agent: userAgent || null,
      consentement: CONSENTEMENT, signature_png: corps.signature_png || null,
      valeurs, hash_original: doc.hash_original, hash_signe: hashSigne, evenements,
    });

    await supabase.from('documents_signature').update({
      statut: 'signe', date_signature: now.toISOString(),
      storage_signe: signePath, hash_signe: hashSigne, jeton: null, jeton_expire: null,
    }).eq('id', doc.id);

    // Boucle fermée : si ce document est un contrat natif parti en signature,
    // le contrat passe automatiquement en 'signe' avec le PDF scellé et la preuve.
    if (doc.contrat_id) {
      await supabase.from('contrats').update({
        statut: 'signe',
        pdf_signe_path: signePath,
        signature_meta: {
          via: 'eidas', document_signature_id: doc.id,
          signataire_nom: signataireNom, horodatage: now.toISOString(),
          hash_document: doc.hash_original, hash_signe: hashSigne,
        },
      }).eq('camping_id', doc.camping_id).eq('id', doc.contrat_id)
        .neq('statut', 'signe')
        .then(({ error }) => { if (error) console.error('[signature:contrat]', error.message); });
    }

    if (resident?.email) {
      const { data: camp } = await supabase.from('campings')
        .select('nom,raison_sociale,parametres').eq('id', doc.camping_id).maybeSingle();
      const nomCamping = camp?.nom || camp?.raison_sociale || 'Votre camping';
      sendEmail({
        to: resident.email,
        subject: `Document signé — ${doc.titre}`,
        html: `<p>Bonjour ${escapeHtml(resident.prenom || '')},</p>`
          + `<p>Votre document « <b>${escapeHtml(doc.titre)}</b> » a bien été signé le ${escapeHtml(dateStr)}.</p>`
          + `<p>Vous en trouverez la copie signée en pièce jointe, incluant son certificat de preuve.</p>`
          + `<p>Merci,<br>${escapeHtml(nomCamping)}</p>`,
        sender: camp?.parametres?.facturation?.email
          ? { email: camp.parametres.facturation.email, name: nomCamping } : { name: nomCamping },
        attachments: [{ name: `${slug(doc.titre)}_signe.pdf`, content: sealedBytes }],
      }).catch((e) => console.error('[signature:email]', e.message));
    }

    try {
      const { creerNotifsStaff } = require('./notifications');
      creerNotifsStaff(doc.camping_id, {
        type: 'document_signe', perm: 'gerer_residents',
        titre: `Document signé : ${doc.titre}`,
        corps: `${signataireNom} a signé « ${doc.titre} ».`,
        entite: 'documents_signature', entite_id: doc.id,
      }).catch(() => {});
    } catch { /* module notif absent : ignore */ }

    return { ok: true, message: 'Votre document a été signé. Une copie et son certificat vous ont été envoyés par e-mail.' };
  } catch (e) {
    console.error('[signature:signerDocument]', e.message);
    return { error: 'Une erreur est survenue lors de la signature. Réessayez ou contactez le camping.', code: 500 };
  }
}

module.exports = { sha256, nbPages, normaliserChamps, signerDocument, envoyerOtp, tracer, CONSENTEMENT };

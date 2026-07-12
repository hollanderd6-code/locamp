const crypto = require('crypto');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

/* ============================================================
   Signature électronique — eIDAS (UE) 910/2014, art. 1366-1367 du Code civil

   Signature SIMPLE : sa force probante ne vient pas d'un certificat qualifié,
   mais du FAISCEAU DE PREUVES qu'on constitue autour :
     • identification du signataire (compte portail + e-mail)
     • consentement exprès (case cochée, phrase enregistrée telle qu'affichée)
     • intégrité (empreinte SHA-256 du document avant / après signature)
     • horodatage serveur
     • adresse IP et navigateur
     • piste d'audit (envoi, ouverture, signature)
   Le tout figé dans un dossier de preuve inaltérable, et un certificat annexé au PDF.
   ============================================================ */

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** Un champ = { page, x, y, w, h, type, label, requis }  (coordonnées en % de la page) */
const TYPES_CHAMP = ['signature', 'texte', 'case', 'date', 'nom'];

/**
 * Appose les champs remplis sur le PDF d'origine, puis annexe le certificat de preuve.
 * @returns {Buffer} PDF signé
 */
async function apposerSignature({ pdfOriginal, champs = [], valeurs = {}, signaturePng, preuve }) {
  const doc = await PDFDocument.load(pdfOriginal);
  const pages = doc.getPages();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvB = await doc.embedFont(StandardFonts.HelveticaBold);

  let imgSig = null;
  if (signaturePng) {
    const b64 = String(signaturePng).replace(/^data:image\/png;base64,/, '');
    try { imgSig = await doc.embedPng(Buffer.from(b64, 'base64')); }
    catch (e) { console.error('[signature:png]', e.message); }
  }

  for (const c of champs) {
    const page = pages[Math.min(Number(c.page || 1) - 1, pages.length - 1)];
    if (!page) continue;
    const { width: W, height: H } = page.getSize();

    // les coordonnées sont en % (origine en haut à gauche) ; PDF a l'origine en bas à gauche
    const x = (Number(c.x) / 100) * W;
    const w = (Number(c.w) / 100) * W;
    const h = (Number(c.h) / 100) * H;
    const y = H - (Number(c.y) / 100) * H - h;
    const v = valeurs[c.id];

    if (c.type === 'signature' && imgSig) {
      // conserve le rapport d'aspect du tracé
      const r = Math.min(w / imgSig.width, h / imgSig.height);
      const iw = imgSig.width * r, ih = imgSig.height * r;
      page.drawImage(imgSig, { x: x + (w - iw) / 2, y: y + (h - ih) / 2, width: iw, height: ih });
      page.drawLine({ start: { x, y: y - 2 }, end: { x: x + w, y: y - 2 },
        thickness: 0.5, color: rgb(0.6, 0.6, 0.6) });
      page.drawText(`Signé électroniquement le ${new Date(preuve.horodatage).toLocaleString('fr-FR')}`,
        { x, y: y - 11, size: 6, font: helv, color: rgb(0.45, 0.45, 0.45) });
    } else if (c.type === 'case') {
      const s = Math.min(h, 12);
      page.drawRectangle({ x, y: y + h - s, width: s, height: s,
        borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 0.8 });
      if (v === true || v === 'true' || v === 'on') {
        page.drawText('X', { x: x + 2.5, y: y + h - s + 2.5, size: s - 4, font: helvB, color: rgb(0.1, 0.1, 0.1) });
      }
      if (c.label) {
        page.drawText(String(c.label), { x: x + s + 5, y: y + h - s + 2, size: 8, font: helv,
          color: rgb(0.15, 0.15, 0.15), maxWidth: Math.max(20, w - s - 8) });
      }
    } else if (v != null && String(v).trim() !== '') {
      page.drawText(String(v), { x, y: y + h - 10, size: 9.5, font: helv,
        color: rgb(0.1, 0.1, 0.1), maxWidth: Math.max(20, w), lineHeight: 11 });
    }
  }

  await annexerCertificat(doc, helv, helvB, preuve);
  return Buffer.from(await doc.save());
}

/** Page annexe : le certificat de preuve, produit en cas de contestation. */
async function annexerCertificat(doc, helv, helvB, p) {
  const page = doc.addPage([595.28, 841.89]);   // A4
  const { width: W, height: H } = page.getSize();
  const VERT = rgb(0.09, 0.32, 0.26);
  const GRIS = rgb(0.35, 0.35, 0.35);
  let y = H - 60;

  const t = (txt, { s = 9, f = helv, c = rgb(0.13, 0.13, 0.13), x = 50, dy = 14, max = W - 100 } = {}) => {
    page.drawText(String(txt), { x, y, size: s, font: f, color: c, maxWidth: max, lineHeight: s + 3 });
    y -= dy;
  };

  page.drawText('CERTIFICAT DE SIGNATURE ÉLECTRONIQUE', {
    x: 50, y, size: 15, font: helvB, color: VERT });
  y -= 18;
  t('Règlement eIDAS (UE) n° 910/2014 — articles 1366 et 1367 du Code civil', { s: 8, c: GRIS, dy: 26 });

  page.drawLine({ start: { x: 50, y }, end: { x: W - 50, y }, thickness: 0.6, color: rgb(0.85, 0.85, 0.85) });
  y -= 20;

  const bloc = (titre, lignes) => {
    page.drawText(titre, { x: 50, y, size: 9.5, font: helvB, color: VERT });
    y -= 15;
    for (const [k, v] of lignes) {
      page.drawText(k, { x: 58, y, size: 8, font: helvB, color: GRIS });
      page.drawText(String(v ?? '—'), { x: 175, y, size: 8, font: helv,
        color: rgb(0.1, 0.1, 0.1), maxWidth: W - 230 });
      y -= 13;
    }
    y -= 8;
  };

  // L'empreinte du fichier signé ne peut pas figurer DANS ce fichier (elle serait
  // circulaire) : elle est calculée après apposition et conservée au dossier de preuve.
  bloc('Document signé', [
    ['Titre', p.titre],
    ['Empreinte du document présenté', p.hash_original],
    ['Algorithme', 'SHA-256'],
  ]);

  bloc('Signataire', [
    ['Nom', p.signataire_nom],
    ['Adresse e-mail', p.signataire_email],
    ['Authentification', p.canal === 'portail'
      ? 'Espace locataire — session authentifiée (accès par lien à usage unique envoyé à cette adresse e-mail)'
      : 'Lien de signature personnel envoyé à l\u2019adresse e-mail ci-dessus'],
  ]);

  bloc('Preuves techniques', [
    ['Date et heure', new Date(p.horodatage).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }) + ' (heure de Paris)'],
    ['Adresse IP', p.ip],
    ['Navigateur', (p.user_agent || '—').slice(0, 90)],
  ]);

  page.drawText('Consentement recueilli', { x: 50, y, size: 9.5, font: helvB, color: VERT });
  y -= 15;
  page.drawText(`« ${p.consentement} »`, { x: 58, y, size: 8, font: helv,
    color: rgb(0.1, 0.1, 0.1), maxWidth: W - 116, lineHeight: 11 });
  y -= 34;

  if (Array.isArray(p.evenements) && p.evenements.length) {
    page.drawText('Piste d\u2019audit', { x: 50, y, size: 9.5, font: helvB, color: VERT });
    y -= 15;
    for (const e of p.evenements.slice(0, 8)) {
      page.drawText(`${new Date(e.date).toLocaleString('fr-FR')} — ${e.libelle}`,
        { x: 58, y, size: 7.5, font: helv, color: rgb(0.25, 0.25, 0.25) });
      y -= 11;
    }
    y -= 10;
  }

  // Encadré d'intégrité
  page.drawRectangle({ x: 50, y: y - 44, width: W - 100, height: 44,
    color: rgb(0.95, 0.94, 0.90) });
  page.drawText('Intégrité du document', { x: 60, y: y - 15, size: 8.5, font: helvB, color: rgb(0.1, 0.1, 0.1) });
  page.drawText('Toute modification ultérieure du document rendrait son empreinte SHA-256 différente '
    + 'de celle consignée ci-dessus, révélant l\u2019altération.',
    { x: 60, y: y - 30, size: 7.5, font: helv, color: GRIS, maxWidth: W - 120, lineHeight: 10 });

  page.drawText(`Certificat émis par Locamp le ${new Date().toLocaleString('fr-FR')}. `
    + 'Document conservé dans un dossier de preuve non modifiable.',
    { x: 50, y: 40, size: 6.5, font: helv, color: rgb(0.6, 0.6, 0.6), maxWidth: W - 100 });
}

/** Nombre de pages d'un PDF (pour l'éditeur de zones). */
async function nbPages(pdfBuffer) {
  try {
    const d = await PDFDocument.load(pdfBuffer);
    return d.getPageCount();
  } catch (e) { return 1; }
}

/** Normalise et valide les zones posées sur le document. */
function normaliserChamps(champs) {
  const out = [];
  for (const c of (Array.isArray(champs) ? champs : [])) {
    if (!TYPES_CHAMP.includes(c.type)) continue;
    out.push({
      id: String(c.id || crypto.randomUUID()),
      type: c.type,
      page: Math.max(1, Number(c.page || 1)),
      x: Math.min(100, Math.max(0, Number(c.x) || 0)),
      y: Math.min(100, Math.max(0, Number(c.y) || 0)),
      w: Math.min(100, Math.max(1, Number(c.w) || 20)),
      h: Math.min(100, Math.max(1, Number(c.h) || 6)),
      label: c.label ? String(c.label).slice(0, 120) : null,
      requis: c.requis !== false,
    });
  }
  return out;
}


/* ============================================================
   Signature d'un document — implémentation UNIQUE, appelée par :
     • le portail (résident authentifié)  -> preuve d'identité la plus forte
     • le lien à usage unique reçu par e-mail
   Une seule implémentation = un seul jeu de preuves, impossible de diverger.
   ============================================================ */
const CONSENTEMENT = 'En cochant cette case et en apposant ma signature, je reconnais avoir pris '
  + 'connaissance de l\u2019intégralité du document et j\u2019exprime mon consentement à être lié par celui-ci. '
  + 'Je reconnais à cette signature électronique la même valeur qu\u2019une signature manuscrite.';

async function signerDocument({ campingId, documentId, jeton, residentId, corps, ip, userAgent, canal }) {
  const { supabase } = require('./supabase');
  const { downloadDocument, BUCKET } = require('./storage');
  const { sendEmail } = require('./email');

  // 1. Le document
  let q = supabase.from('documents_signature').select('*');
  q = jeton ? q.eq('jeton', jeton) : q.eq('id', documentId).eq('camping_id', campingId);
  const { data: doc } = await q.maybeSingle();
  if (!doc) return { error: 'Document introuvable', code: 404 };
  if (doc.statut === 'signe') return { error: 'Ce document est déjà signé', code: 409 };
  if (doc.statut === 'annule') return { error: 'Ce document a été annulé', code: 409 };
  if (jeton && doc.jeton_expire && new Date(doc.jeton_expire) < new Date()) {
    return { error: 'Ce lien a expiré. Demandez-en un nouveau au camping.', code: 410 };
  }
  if (residentId && doc.resident_id && doc.resident_id !== residentId) {
    return { error: 'Ce document ne vous est pas destiné', code: 403 };
  }

  // 2. Consentement explicite — sans lui, pas de signature
  if (corps.consentement !== true) return { error: 'Le consentement explicite est requis', code: 400 };

  // 3. Champs obligatoires
  const champs = doc.champs || [];
  const valeurs = corps.valeurs || {};
  const signaturePng = corps.signature_png || null;
  if (champs.some((c) => c.type === 'signature') && !signaturePng) {
    return { error: 'La signature manuscrite est requise', code: 400 };
  }
  for (const c of champs) {
    if (!c.requis) continue;
    const v = valeurs[c.id];
    if (c.type === 'case' && v !== true) return { error: `Case obligatoire : ${c.label || ''}`, code: 400 };
    if (c.type === 'texte' && (!v || !String(v).trim())) return { error: `Champ obligatoire : ${c.label || ''}`, code: 400 };
  }

  // 4. INTÉGRITÉ : le document doit être identique à celui déposé.
  const pdfOriginal = await downloadDocument(doc.storage_path);
  const hashOriginal = sha256(pdfOriginal);
  if (hashOriginal !== doc.hash_original) {
    return { error: 'Le document a été altéré depuis son envoi — signature refusée.', code: 409 };
  }

  const { data: resident } = doc.resident_id
    ? await supabase.from('residents').select('nom,prenom,email').eq('id', doc.resident_id).maybeSingle()
    : { data: null };

  const horodatage = new Date().toISOString();
  const nom = resident ? `${resident.prenom || ''} ${resident.nom}`.trim() : (valeurs.nom || 'Signataire');

  const evenements = [
    { date: doc.date_envoi || doc.created_at, libelle: 'Document mis à disposition du signataire' },
    { date: horodatage,
      libelle: canal === 'portail'
        ? 'Signature depuis l\u2019espace locataire (session authentifiée)'
        : 'Signature via le lien personnel reçu par e-mail',
      ip },
  ];

  const preuve = {
    titre: doc.titre,
    hash_original: hashOriginal,
    signataire_nom: nom,
    signataire_email: resident?.email || null,
    ip, user_agent: userAgent, horodatage,
    consentement: CONSENTEMENT,
    canal,
    evenements,
  };

  // 5. Apposition + certificat
  const pdfSigne = await apposerSignature({ pdfOriginal, champs, valeurs, signaturePng, preuve });
  const hashSigne = sha256(pdfSigne);

  const cheminSigne = `signatures/${doc.camping_id}/${doc.id}_signe.pdf`;
  const { error: upErr } = await supabase.storage.from(BUCKET)
    .upload(cheminSigne, pdfSigne, { contentType: 'application/pdf', upsert: true });
  if (upErr) throw upErr;

  // 6. Dossier de preuve (table inaltérable)
  const { error: prErr } = await supabase.from('signatures_preuves').insert({
    camping_id: doc.camping_id, document_id: doc.id, resident_id: doc.resident_id,
    signataire_nom: nom, signataire_email: resident?.email || null,
    ip, user_agent: userAgent, horodatage,
    consentement: CONSENTEMENT, signature_png: signaturePng,
    valeurs, hash_original: hashOriginal, hash_signe: hashSigne,
    evenements,
  });
  if (prErr) throw prErr;

  await supabase.from('documents_signature').update({
    statut: 'signe', storage_signe: cheminSigne, hash_signe: hashSigne,
    date_signature: horodatage, jeton: null,       // le lien est consommé
  }).eq('id', doc.id);

  // 7. Copie au signataire
  if (resident?.email) {
    const { signedUrl } = require('./storage');
    const url = await signedUrl(cheminSigne, 604800);
    sendEmail({
      to: resident.email,
      subject: `Votre document signé — ${doc.titre}`,
      html: `<p>Bonjour ${resident.prenom || ''},</p>`
        + `<p>Votre document <b>${doc.titre}</b> a bien été signé le ${new Date(horodatage).toLocaleString('fr-FR')}.</p>`
        + `<p>Il est accompagné de son certificat de signature électronique (horodatage, adresse IP, empreinte du document).</p>`
        + `<p><a href="${url}">Télécharger le document signé</a> (lien valable 7 jours)</p>`,
    }).catch((e) => console.error('[sign:mail]', e.message));
  }

  return { ok: true, message: 'Document signé. Une copie vous a été envoyée par e-mail.' };
}

module.exports = { sha256, apposerSignature, nbPages, normaliserChamps, signerDocument, CONSENTEMENT, TYPES_CHAMP };

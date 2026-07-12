// ============================================================
//  Signature électronique — module Node (backend)
//  ⚠️ Ce fichier avait été écrasé par le SCRIPT NAVIGATEUR de la page
//     de signature (public/signature/signature.js), ce qui faisait planter
//     le serveur au démarrage (`location is not defined`).
//
//  Version de rétablissement : sha256 / nbPages / normaliserChamps /
//  CONSENTEMENT sont pleinement fonctionnels. signerDocument() renvoie une
//  erreur 503 « maintenance » propre (au lieu de crasher) tant que la
//  logique de scellement à valeur probante n'a pas été reconstruite à partir
//  du schéma réel (documents_signature / signatures_preuves).
// ============================================================
const crypto = require('crypto');

// Texte de consentement affiché au signataire et conservé dans la preuve.
// (règlement eIDAS — signature électronique simple). Ajuste la formulation
// si besoin : elle est purement déclarative.
const CONSENTEMENT =
  "En cochant cette case et en signant, je reconnais avoir lu et compris le document, "
  + "et j'accepte de le signer par voie électronique. Je reconnais que ma signature "
  + "électronique a la même valeur juridique qu'une signature manuscrite (règlement "
  + "eIDAS n° 910/2014). J'accepte que la date, l'heure, mon adresse IP et mon navigateur "
  + "soient enregistrés à titre de preuve.";

// Empreinte SHA-256 (hex) d'un buffer — sert à figer le document original et scellé.
function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// Nombre de pages d'un PDF (best-effort, sans dépendance externe).
// Utilisé comme métadonnée d'affichage : une estimation suffit.
async function nbPages(buffer) {
  try {
    const s = Buffer.isBuffer(buffer) ? buffer.toString('latin1') : String(buffer || '');
    // 1) /Count du nœud racine /Pages
    const parType = [...s.matchAll(/\/Type\s*\/Pages\b[\s\S]{0,120}?\/Count\s+(\d+)/g)].map((m) => +m[1]);
    if (parType.length) return Math.max(...parType);
    // 2) n'importe quel /Count (nœuds de l'arbre des pages)
    const counts = [...s.matchAll(/\/Count\s+(\d+)/g)].map((m) => +m[1]);
    if (counts.length) return Math.max(...counts);
    // 3) fallback : compter les objets /Type /Page (hors /Pages)
    const pages = (s.match(/\/Type\s*\/Page(?![s])/g) || []).length;
    return pages || 1;
  } catch {
    return 1;
  }
}

// Normalise/valide la liste des zones (champs) définies par l'éditeur admin.
// On préserve la géométrie éventuelle (page/x/y/w/h…) sans la dénaturer.
function normaliserChamps(champs) {
  if (!Array.isArray(champs)) return [];
  const TYPES = new Set(['signature', 'case', 'texte']);
  const num = (v) => (v == null || v === '' || isNaN(Number(v)) ? undefined : Number(v));

  return champs.slice(0, 100).map((c, i) => {
    const o = c && typeof c === 'object' ? c : {};
    let type = String(o.type || 'texte').toLowerCase();
    if (type === 'text') type = 'texte';
    if (type === 'checkbox') type = 'case';
    if (!TYPES.has(type)) type = 'texte';

    const out = {
      id: String(o.id || `c${i + 1}`).slice(0, 60),
      type,
      label: o.label != null ? String(o.label).slice(0, 200) : null,
      requis: !!o.requis,
    };
    // Géométrie / positionnement : conservés tels quels (coercés en nombre).
    for (const k of ['page', 'x', 'y', 'w', 'h', 'width', 'height', 'taille', 'font', 'size']) {
      const n = num(o[k]);
      if (n !== undefined) out[k] = n;
    }
    return out;
  });
}

// Scellement du document signé + dossier de preuve.
// ⚠️ NON RECONSTRUIT : nécessite le schéma réel (documents_signature /
//    signatures_preuves) et la géométrie des zones. Renvoie une erreur
//    exploitable (503) pour ne pas laisser croire à une signature réussie.
async function signerDocument(/* { jeton, corps, ip, userAgent, canal } */) {
  console.warn('[signature] signerDocument appelé mais non reconstruit — signature indisponible.');
  return {
    error: 'La signature en ligne est momentanément indisponible (maintenance). '
      + 'Merci de réessayer plus tard ou de contacter le camping.',
    code: 503,
  };
}

module.exports = { sha256, nbPages, normaliserChamps, signerDocument, CONSENTEMENT };

/* ============================================================================
   Facturation électronique — noyau "Opérateur de Dématérialisation" (OD).

   Locamp ne devient PAS une Plateforme Agréée (PA). Il pilote les flux et
   délègue la transmission réglementée à une PA, branchée via un "pilote"
   (driver) interchangeable. Le reste de l'appli ne connaît que cette interface,
   jamais une PA en particulier → 100 % PA-agnostique.

   ── Contrat d'un pilote PA ────────────────────────────────────────────────
   Un pilote exporte un objet :
   {
     code: 'demo',                      // identifiant stable
     nom: 'Bac à sable (démo)',
     description: '…',
     champs_config: [                   // décrit le formulaire de connexion
       { cle:'cle_api', libelle:'Clé API', type:'password', secret:true, requis:true }
     ],
     async connect(ctx, config)   → { statut, adresse_routage, message, config_public, secrets }
     async status(ctx)            → { statut, adresse_routage, message }
     async emettre(ctx, facture, facturx) → { doc_externe_id, statut, format }
     async recevoir(ctx)          → [ { doc_externe_id, emetteur, date, montant_ttc, … } ]
     async ereporting(ctx, lot)   → { doc_externe_id, statut }
     async disconnect(ctx)        → void
   }
   ctx = { campingId, camping, connexion }  (connexion.config = secrets déchiffrés)
   ========================================================================== */

const crypto = require('crypto');
const { supabase } = require('../supabase');

/* ---------- Registre des pilotes ---------- */
const drivers = {};
function register(driver) { drivers[driver.code] = driver; }

// Pilotes disponibles. Ajouter ici une vraie PA le moment venu.
register(require('./drivers/demo'));

function getDriver(code) {
  const d = drivers[code];
  if (!d) throw new Error(`Plateforme agréée inconnue : ${code}`);
  return d;
}
function listPlateformes() {
  return Object.values(drivers).map((d) => ({
    code: d.code, nom: d.nom, description: d.description || '',
    champs_config: d.champs_config || [],
  }));
}

/* ---------- Chiffrement des secrets (AES-256-GCM) ---------- */
function cle() {
  const source = process.env.EFACTURE_KEY || process.env.JWT_SECRET || 'locamp-efacture-dev';
  return crypto.scryptSync(source, 'efacture-salt-v1', 32);
}
function chiffrer(obj) {
  if (obj == null) return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', cle(), iv);
  const buf = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), buf.toString('base64')].join(':');
}
function dechiffrer(str) {
  if (!str) return {};
  try {
    const [iv, tag, data] = str.split(':');
    const d = crypto.createDecipheriv('aes-256-gcm', cle(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    const out = Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]);
    return JSON.parse(out.toString('utf8'));
  } catch (_) { return {}; }
}

/* ---------- Accès connexion (par camping) ---------- */
async function chargerConnexion(campingId) {
  const { data } = await supabase.from('efacture_connexions')
    .select('*').eq('camping_id', campingId).maybeSingle();
  if (!data) return null;
  return {
    pa_code: data.pa_code,
    statut: data.statut,
    adresse_routage: data.adresse_routage,
    message: data.message,
    connecte_at: data.connecte_at,
    config_public: data.config_public || {},
    // config = fusion (public + secrets déchiffrés) fournie aux pilotes uniquement
    config: { ...(data.config_public || {}), ...dechiffrer(data.config_chiffre) },
  };
}

async function enregistrerConnexion(campingId, { pa_code, statut, adresse_routage, message, config_public, secrets }) {
  const row = {
    camping_id: campingId,
    pa_code,
    statut: statut || 'connecte',
    adresse_routage: adresse_routage || null,
    message: message || null,
    config_public: config_public || {},
    config_chiffre: secrets ? chiffrer(secrets) : null,
    connecte_at: statut === 'connecte' ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from('efacture_connexions')
    .upsert(row, { onConflict: 'camping_id' }).select().maybeSingle();
  if (error) throw error;
  return data;
}

async function supprimerConnexion(campingId) {
  await supabase.from('efacture_connexions').delete().eq('camping_id', campingId);
}

/* Construit le contexte passé aux pilotes. */
async function contexte(campingId) {
  const { data: camping } = await supabase.from('campings')
    .select('id,nom,parametres').eq('id', campingId).maybeSingle();
  const connexion = await chargerConnexion(campingId);
  return { campingId, camping: camping || {}, connexion };
}

module.exports = {
  getDriver, listPlateformes,
  chargerConnexion, enregistrerConnexion, supprimerConnexion, contexte,
  chiffrer, dechiffrer,
};

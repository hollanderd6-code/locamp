const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { supabase } = require('./supabase');
const { sendEmail } = require('./email');

/* ============================================================
   Authentification du portail locataire.

   Principe : le résident ne crée pas son compte. Le camping le crée ;
   le résident reçoit un lien d'activation, ce qui PROUVE qu'il possède
   l'adresse e-mail, puis il choisit son mot de passe.

   Les jetons ne sont jamais stockés en clair : seule leur empreinte SHA-256
   est en base. Un jeton volé dans la base serait donc inutilisable.
   ============================================================ */

const JWT_SECRET = process.env.JWT_SECRET;
const SESSION_DUREE = process.env.PORTAIL_SESSION || '30d';   // app : on reste connecté
const ACTIVATION_JOURS = 14;
const RESET_MINUTES = 60;

const MDP_MIN = 8;
const TENTATIVES_MAX = 8;
const BLOCAGE_MINUTES = 15;

const hache = (t) => crypto.createHash('sha256').update(t).digest('hex');
const jeton = () => crypto.randomBytes(32).toString('hex');
const norm = (e) => String(e || '').toLowerCase().trim();

function validerMdp(mdp) {
  const m = String(mdp || '');
  if (m.length < MDP_MIN) return `Le mot de passe doit contenir au moins ${MDP_MIN} caractères.`;
  if (!/[a-zA-Z]/.test(m) || !/[0-9]/.test(m)) return 'Le mot de passe doit contenir au moins une lettre et un chiffre.';
  return null;
}

/** Jeton de session du portail. */
const creerSession = (r) => jwt.sign(
  { typ: 'resident', rid: r.id, cid: r.camping_id, email: r.email },
  JWT_SECRET, { expiresIn: SESSION_DUREE },
);

/* ------------------------- Activation ------------------------- */

/**
 * Envoie (ou renvoie) l'invitation d'activation. Appelé à la création d'un
 * résident, ou manuellement depuis sa fiche.
 */
async function envoyerActivation(residentId, { renvoi = false } = {}) {
  const { data: r } = await supabase.from('residents')
    .select('id,camping_id,nom,prenom,email,hash_mdp').eq('id', residentId).maybeSingle();
  if (!r) return { error: 'Résident introuvable' };
  if (!r.email) return { error: 'Ce résident n\u2019a pas d\u2019adresse e-mail' };
  if (r.hash_mdp && !renvoi) return { deja_actif: true };

  const t = jeton();
  const expire = new Date(Date.now() + ACTIVATION_JOURS * 86400000).toISOString();
  const { error } = await supabase.from('residents')
    .update({ activation_hash: hache(t), activation_expire: expire })
    .eq('id', r.id);
  if (error) throw error;

  const { data: camping } = await supabase.from('campings')
    .select('nom,raison_sociale').eq('id', r.camping_id).maybeSingle();
  const nomCamping = camping?.nom || camping?.raison_sociale || 'Votre camping';
  const base = process.env.PUBLIC_APP_URL || '';
  const lien = `${base}/portail/?activation=${t}`;

  const out = await sendEmail({
    to: r.email,
    subject: `Activez votre espace locataire — ${nomCamping}`,
    html: `<p>Bonjour ${r.prenom || ''},</p>`
      + `<p>${nomCamping} vous ouvre un espace personnel : vos factures, vos documents à signer `
      + `et vos échanges avec l\u2019accueil, au même endroit.</p>`
      + `<p>Pour l\u2019activer, choisissez votre mot de passe :</p>`
      + `<p><a href="${lien}" style="display:inline-block;padding:13px 26px;background:#175243;`
      + `color:#fff;border-radius:9px;text-decoration:none;font-weight:600">Activer mon espace</a></p>`
      + `<p style="font-size:12px;color:#666">Ce lien vous est personnel et expire dans ${ACTIVATION_JOURS} jours. `
      + `Si vous n\u2019êtes pas à l\u2019origine de cette demande, ignorez cet e-mail.</p>`,
  });

  return { ok: true, envoye_a: r.email, simule: !!out.skipped, lien_dev: out.skipped ? lien : undefined };
}

/** Vérifie un jeton d'activation (avant d'afficher le formulaire). */
async function verifierActivation(t) {
  if (!t) return { error: 'Lien invalide' };
  const { data: r } = await supabase.from('residents')
    .select('id,nom,prenom,email,activation_expire,hash_mdp')
    .eq('activation_hash', hache(t)).maybeSingle();
  if (!r) return { error: 'Ce lien d\u2019activation n\u2019est pas valide.' };
  if (r.activation_expire && new Date(r.activation_expire) < new Date()) {
    return { error: 'Ce lien a expiré. Demandez-en un nouveau à l\u2019accueil du camping.' };
  }
  return {
    ok: true,
    email: r.email,
    prenom: r.prenom,
    nom: r.nom,
    deja_actif: !!r.hash_mdp,
  };
}

/**
 * Active le compte : enregistre le mot de passe et VÉRIFIE l'adresse e-mail
 * (le résident a cliqué le lien reçu dans sa boîte : la preuve est faite).
 */
async function activerCompte(t, mdp) {
  const err = validerMdp(mdp);
  if (err) return { error: err, code: 400 };

  const { data: r } = await supabase.from('residents')
    .select('id,camping_id,email,activation_expire')
    .eq('activation_hash', hache(t)).maybeSingle();
  if (!r) return { error: 'Lien d\u2019activation invalide', code: 400 };
  if (r.activation_expire && new Date(r.activation_expire) < new Date()) {
    return { error: 'Lien expiré', code: 410 };
  }

  const { error } = await supabase.from('residents').update({
    hash_mdp: await bcrypt.hash(mdp, 12),
    email_verifie_at: new Date().toISOString(),
    activation_hash: null,          // jeton à usage unique
    activation_expire: null,
    tentatives_echouees: 0,
    bloque_jusqu_a: null,
    derniere_connexion: new Date().toISOString(),
  }).eq('id', r.id);
  if (error) throw error;

  return { ok: true, token: creerSession(r) };
}

/* ------------------------- Connexion ------------------------- */

async function connexion(email, mdp) {
  const e = norm(email);
  // message identique dans tous les cas : aucune énumération d'adresses possible
  const refus = { error: 'Adresse e-mail ou mot de passe incorrect.', code: 401 };
  if (!e || !mdp) return refus;

  const { data: r } = await supabase.from('residents')
    .select('id,camping_id,email,hash_mdp,actif,email_verifie_at,tentatives_echouees,bloque_jusqu_a')
    .ilike('email', e).maybeSingle();

  if (!r || !r.actif) {
    await bcrypt.compare(mdp, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva');  // temps constant
    return refus;
  }
  if (r.bloque_jusqu_a && new Date(r.bloque_jusqu_a) > new Date()) {
    const min = Math.ceil((new Date(r.bloque_jusqu_a) - Date.now()) / 60000);
    return { error: `Trop de tentatives. Réessayez dans ${min} minute(s).`, code: 429 };
  }
  if (!r.hash_mdp) {
    return { error: 'Votre espace n\u2019est pas encore activé. Utilisez le lien d\u2019activation reçu par e-mail, ou demandez-en un nouveau.', code: 403, non_active: true };
  }

  const ok = await bcrypt.compare(mdp, r.hash_mdp);
  if (!ok) {
    const n = (r.tentatives_echouees || 0) + 1;
    const patch = { tentatives_echouees: n };
    if (n >= TENTATIVES_MAX) {
      patch.bloque_jusqu_a = new Date(Date.now() + BLOCAGE_MINUTES * 60000).toISOString();
      patch.tentatives_echouees = 0;
    }
    await supabase.from('residents').update(patch).eq('id', r.id);
    return refus;
  }

  await supabase.from('residents').update({
    tentatives_echouees: 0, bloque_jusqu_a: null,
    derniere_connexion: new Date().toISOString(),
  }).eq('id', r.id);

  return { ok: true, token: creerSession(r) };
}

/* --------------------- Mot de passe oublié --------------------- */

async function demanderReset(email) {
  const e = norm(email);
  // réponse générique quoi qu'il arrive (pas d'énumération)
  const generic = { ok: true, message: 'Si un compte existe pour cette adresse, un e-mail vient d\u2019être envoyé.' };
  if (!e) return generic;

  const { data: r } = await supabase.from('residents')
    .select('id,camping_id,nom,prenom,email,actif,hash_mdp').ilike('email', e).maybeSingle();
  if (!r || !r.actif) return generic;

  // compte jamais activé : on renvoie plutôt l'activation
  if (!r.hash_mdp) {
    await envoyerActivation(r.id, { renvoi: true }).catch(() => {});
    return generic;
  }

  const t = jeton();
  await supabase.from('residents').update({
    reset_hash: hache(t),
    reset_expire: new Date(Date.now() + RESET_MINUTES * 60000).toISOString(),
  }).eq('id', r.id);

  const { data: camping } = await supabase.from('campings')
    .select('nom,raison_sociale').eq('id', r.camping_id).maybeSingle();
  const nomCamping = camping?.nom || camping?.raison_sociale || 'Votre camping';
  const base = process.env.PUBLIC_APP_URL || '';
  const lien = `${base}/portail/?reset=${t}`;

  await sendEmail({
    to: r.email,
    subject: `Réinitialisation de votre mot de passe — ${nomCamping}`,
    html: `<p>Bonjour ${r.prenom || ''},</p>`
      + `<p>Vous avez demandé à réinitialiser le mot de passe de votre espace locataire.</p>`
      + `<p><a href="${lien}" style="display:inline-block;padding:13px 26px;background:#175243;`
      + `color:#fff;border-radius:9px;text-decoration:none;font-weight:600">Choisir un nouveau mot de passe</a></p>`
      + `<p style="font-size:12px;color:#666">Ce lien expire dans ${RESET_MINUTES} minutes. `
      + `Si vous n\u2019êtes pas à l\u2019origine de cette demande, ignorez cet e-mail : votre mot de passe reste inchangé.</p>`,
  }).catch((err) => console.error('[portail:reset mail]', err.message));

  return generic;
}

async function reinitialiser(t, mdp) {
  const err = validerMdp(mdp);
  if (err) return { error: err, code: 400 };
  if (!t) return { error: 'Lien invalide', code: 400 };

  const { data: r } = await supabase.from('residents')
    .select('id,camping_id,email,reset_expire').eq('reset_hash', hache(t)).maybeSingle();
  if (!r) return { error: 'Ce lien n\u2019est pas valide.', code: 400 };
  if (r.reset_expire && new Date(r.reset_expire) < new Date()) {
    return { error: 'Ce lien a expiré. Refaites une demande.', code: 410 };
  }

  await supabase.from('residents').update({
    hash_mdp: await bcrypt.hash(mdp, 12),
    email_verifie_at: new Date().toISOString(),
    reset_hash: null, reset_expire: null,
    tentatives_echouees: 0, bloque_jusqu_a: null,
    derniere_connexion: new Date().toISOString(),
  }).eq('id', r.id);

  return { ok: true, token: creerSession(r) };
}

module.exports = {
  envoyerActivation, verifierActivation, activerCompte,
  connexion, demanderReset, reinitialiser,
  creerSession, validerMdp, MDP_MIN,
};

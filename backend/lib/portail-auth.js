// ============================================================
//  Authentification du portail locataire (mot de passe + activation)
//  L'accès est réservé aux résidents créés par le camping (table residents,
//  actif = true) : seul un e-mail déjà enregistré peut recevoir un lien de
//  création de mot de passe. Aucune auto-inscription possible.
// ============================================================
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { supabase } = require('./supabase');
const { sendEmail } = require('./email');

const JWT_SECRET = process.env.JWT_SECRET;

const norm = (e) => (e || '').toLowerCase().trim();
// 8 caractères minimum, au moins une lettre et un chiffre (cohérent avec le front).
const mdpValide = (m) => typeof m === 'string' && /^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(m);

function sessionToken(r) {
  return jwt.sign({ typ: 'resident', rid: r.id, cid: r.camping_id, email: r.email }, JWT_SECRET, { expiresIn: '7d' });
}
function motDePasseToken(r) {
  return jwt.sign({ typ: 'resident-pwd', rid: r.id, cid: r.camping_id, email: r.email }, JWT_SECRET, { expiresIn: '2h' });
}
function lirePwdJeton(jeton) {
  try { const p = jwt.verify(jeton, JWT_SECRET); return p.typ === 'resident-pwd' ? p : null; }
  catch { return null; }
}

const CH = 'id,camping_id,nom,prenom,email,actif,mot_de_passe_hash';
async function parEmail(email) {
  const { data } = await supabase.from('residents').select(CH)
    .eq('email', norm(email)).eq('actif', true).maybeSingle();
  return data || null;
}
async function parId(id) {
  const { data } = await supabase.from('residents').select(CH).eq('id', id).maybeSingle();
  return data || null;
}

// Envoi du lien de création/réinitialisation. Réponse TOUJOURS générique
// (pas d'énumération d'e-mails). N'envoie un mail que si l'e-mail est enregistré.
async function demanderReset(email) {
  const generic = {
    ok: true,
    message: 'Si votre adresse est enregistrée par le camping, vous allez recevoir un e-mail pour définir votre mot de passe.',
  };
  const r = await parEmail(email);
  if (!r) return generic;

  const creer = !r.mot_de_passe_hash;
  const tok = motDePasseToken(r);
  const base = (process.env.PUBLIC_APP_URL || '').replace(/\/$/, '');
  const lien = `${base}/portail/?${creer ? 'activation' : 'reset'}=${tok}`;
  const html = `<p>Bonjour ${r.prenom || ''},</p>`
    + `<p>Pour ${creer ? 'créer' : 'réinitialiser'} le mot de passe de votre espace locataire, `
    + `cliquez sur le bouton ci-dessous (lien valable 2 heures) :</p>`
    + `<p><a href="${lien}" style="display:inline-block;padding:12px 22px;background:#175243;color:#fff;`
    + `border-radius:8px;text-decoration:none;font-weight:600">Définir mon mot de passe</a></p>`
    + `<p style="font-size:13px;color:#444">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br>`
    + `<span style="word-break:break-all">${lien}</span></p>`;

  const out = await sendEmail({
    to: r.email,
    subject: creer ? 'Créez le mot de passe de votre espace locataire' : 'Réinitialisation de votre mot de passe',
    html,
  });
  if (process.env.PORTAIL_DEV === 'true' && out.skipped) return { ...generic, dev_lien: lien };
  return generic;
}

// Vérifie le lien avant d'afficher le formulaire (renvoie l'e-mail + statut).
async function verifierActivation(jeton) {
  const p = lirePwdJeton(jeton);
  if (!p) return { error: 'Lien invalide ou expiré. Redemandez-en un depuis « Mot de passe oublié ».' };
  const r = await parId(p.rid);
  if (!r || !r.actif) return { error: 'Compte introuvable.' };
  return { email: r.email, deja_actif: !!r.mot_de_passe_hash };
}

// Définit (ou redéfinit) le mot de passe puis ouvre la session.
async function definirMotDePasse(jeton, mot_de_passe) {
  const p = lirePwdJeton(jeton);
  if (!p) return { error: 'Lien invalide ou expiré. Redemandez-en un.', code: 410 };
  if (!mdpValide(mot_de_passe)) return { error: '8 caractères minimum, dont au moins une lettre et un chiffre.', code: 400 };
  const r = await parId(p.rid);
  if (!r || !r.actif) return { error: 'Compte introuvable.', code: 404 };
  const hash = await bcrypt.hash(mot_de_passe, 10);
  const { error } = await supabase.from('residents').update({ mot_de_passe_hash: hash }).eq('id', r.id);
  if (error) return { error: 'Enregistrement impossible. La migration db/15_portail_mdp.sql a-t-elle été exécutée ?', code: 500 };
  return { token: sessionToken(r) };
}

// Connexion e-mail + mot de passe (le mode principal dans l'app).
async function connexion(email, mot_de_passe) {
  const r = await parEmail(email);
  if (!r || !r.mot_de_passe_hash) {
    if (r && !r.mot_de_passe_hash) {
      return { error: 'Compte non activé. Cliquez sur « Mot de passe oublié » pour définir votre mot de passe.', code: 403, non_active: true };
    }
    return { error: 'E-mail ou mot de passe incorrect.', code: 401 };
  }
  const ok = await bcrypt.compare(mot_de_passe || '', r.mot_de_passe_hash);
  if (!ok) return { error: 'E-mail ou mot de passe incorrect.', code: 401 };
  return { token: sessionToken(r) };
}

module.exports = {
  demanderReset,
  verifierActivation,
  activerCompte: definirMotDePasse,
  reinitialiser: definirMotDePasse,
  connexion,
};

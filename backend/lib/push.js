// ============================================================
//  Notifications push (Firebase Cloud Messaging)
//
//  Deux projets Firebase distincts :
//    - canal 'portail' -> projet de l'app locataire  (FIREBASE_SA_PORTAIL)
//    - canal 'staff'   -> projet de l'app gestion    (FIREBASE_SA_GESTION)
//  Chaque variable contient le JSON du compte de service, sur une seule ligne.
//
//  Tout est « best-effort » : un push qui échoue ne doit jamais casser
//  l'action métier (facture, message, encaissement...).
// ============================================================
const { supabase } = require('./supabase');

const APPS = {};        // canal -> app firebase-admin (initialisée à la demande)
const ECHECS = {};      // canal -> true si l'init a déjà échoué (on n'insiste pas)

function getApp(canal) {
  if (APPS[canal]) return APPS[canal];
  if (ECHECS[canal]) return null;
  const raw = canal === 'portail' ? process.env.FIREBASE_SA_PORTAIL : process.env.FIREBASE_SA_GESTION;
  if (!raw) { ECHECS[canal] = true; return null; }   // push non configuré : silencieux
  try {
    // firebase-admin v13+ : API modulaire (plus de admin.credential / admin.messaging).
    const { initializeApp, getApp, cert } = require('firebase-admin/app');
    const cred = JSON.parse(raw);
    // Chaque projet a sa propre app NOMMÉE (les deux projets Firebase cohabitent).
    // getApp(nom) lève une exception tant que l'app n'existe pas.
    let app;
    try { app = getApp(canal); }
    catch { app = initializeApp({ credential: cert(cred) }, canal); }
    APPS[canal] = app;
    console.log(`[push] projet ${canal} initialisé (${cred.project_id})`);
    return app;
  } catch (e) {
    console.error(`[push] init ${canal} impossible :`, e.message);
    ECHECS[canal] = true;
    return null;
  }
}

// Supprime les jetons devenus invalides (app désinstallée, jeton périmé).
async function purgerTokens(tokens) {
  if (!tokens.length) return;
  try { await supabase.from('push_tokens').delete().in('token', tokens); }
  catch (e) { console.error('[push] purge :', e.message); }
}

// Envoi bas niveau vers une liste de jetons d'un même canal.
async function envoyer(canal, tokens, { titre, corps, donnees = {} }) {
  const app = getApp(canal);
  if (!app || !tokens.length) return { envoyes: 0 };
  try {
    const { getMessaging } = require('firebase-admin/messaging');
    // Les data FCM doivent être des chaînes.
    const data = {};
    for (const [k, v] of Object.entries(donnees || {})) {
      if (v !== null && v !== undefined) data[k] = String(v);
    }
    const res = await getMessaging(app).sendEachForMulticast({
      tokens,
      notification: { title: titre, body: corps || '' },
      data,
      apns: { payload: { aps: { sound: 'default', badge: 1 } } },
      // Pas de channelId : un canal inexistant fait jeter la notification
      // silencieusement par Android 8+. Le canal par defaut existe toujours.
      android: { priority: 'high', notification: { sound: 'default' } },
    });

    // Nettoyage des jetons refusés définitivement
    const morts = [];
    res.responses.forEach((r, i) => {
      const code = r.error && r.error.code;
      if (code === 'messaging/registration-token-not-registered'
        || code === 'messaging/invalid-registration-token'
        || code === 'messaging/invalid-argument') morts.push(tokens[i]);
    });
    if (morts.length) await purgerTokens(morts);

    return { envoyes: res.successCount, echecs: res.failureCount };
  } catch (e) {
    console.error(`[push] envoi ${canal} :`, e.message);
    return { envoyes: 0, error: e.message };
  }
}

// Push à un résident (app portail).
async function pushResident(residentId, { titre, corps, donnees } = {}) {
  try {
    if (!residentId || !titre) return { envoyes: 0 };
    const { data } = await supabase.from('push_tokens').select('token')
      .eq('canal', 'portail').eq('resident_id', residentId);
    const tokens = (data || []).map((t) => t.token);
    return await envoyer('portail', tokens, { titre, corps, donnees });
  } catch (e) { console.error('[push:resident]', e.message); return { envoyes: 0 }; }
}

// Push à une liste de membres du staff (app gestion).
async function pushStaff(userIds, { titre, corps, donnees } = {}) {
  try {
    const ids = (userIds || []).filter(Boolean);
    if (!ids.length || !titre) return { envoyes: 0 };
    const { data } = await supabase.from('push_tokens').select('token')
      .eq('canal', 'staff').in('user_id', ids);
    const tokens = [...new Set((data || []).map((t) => t.token))];
    return await envoyer('staff', tokens, { titre, corps, donnees });
  } catch (e) { console.error('[push:staff]', e.message); return { envoyes: 0 }; }
}

// Enregistre (ou rafraîchit) le jeton d'un appareil. Un même jeton = une seule ligne.
async function enregistrerToken({ campingId, canal, userId = null, residentId = null, token, platform, app }) {
  if (!token || !canal) return { error: 'token et canal requis' };
  const row = {
    camping_id: campingId || null, canal,
    user_id: canal === 'staff' ? userId : null,
    resident_id: canal === 'portail' ? residentId : null,
    token, platform: platform || null, app: app || null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('push_tokens').upsert(row, { onConflict: 'token' });
  if (error) return { error: error.message };
  return { ok: true };
}

module.exports = { pushResident, pushStaff, enregistrerToken };

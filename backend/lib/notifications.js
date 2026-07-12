// ============================================================
//  Notifications in-app — création (fan-out) côté staff et portail
//  Toutes les fonctions sont « best-effort » : elles n'échouent JAMAIS
//  vers l'appelant (une notif ratée ne doit pas casser un paiement ou un
//  message). On les appelle donc sans await bloquant si besoin.
// ============================================================
const { supabase } = require('./supabase');
const { droitsEffectifs } = require('../middleware/auth');

// Crée une notification pour CHAQUE membre du staff d'un camping.
// options :
//   type, titre, corps, entite, entite_id, lien, donnees
//   perm  -> ne notifier que les utilisateurs disposant de ce droit effectif
//            (ex : 'encaisser' pour un paiement, 'messagerie' pour un message)
async function creerNotifsStaff(campingId, {
  type, titre, corps = null, entite = null, entite_id = null, lien = null, donnees = {}, perm = null,
} = {}) {
  try {
    if (!campingId || !type || !titre) return { inserees: 0 };

    const { data: membres, error } = await supabase
      .from('user_campings')
      .select('user_id, role, permissions')
      .eq('camping_id', campingId);
    if (error) throw error;

    let cibles = (membres || []);
    if (perm) {
      cibles = cibles.filter((m) => {
        try { return !!droitsEffectifs(m.role, m.permissions || {})[perm]; }
        catch { return true; }
      });
    }
    if (!cibles.length) return { inserees: 0 };

    const rows = cibles.map((m) => ({
      camping_id: campingId, canal: 'staff', destinataire_user_id: m.user_id,
      type, titre, corps, entite, entite_id, lien, donnees: donnees || {},
    }));
    const { error: errIns } = await supabase.from('notifications').insert(rows);
    if (errIns) throw errIns;
    return { inserees: rows.length };
  } catch (e) {
    console.error('[notifications:staff]', e.message);
    return { inserees: 0, error: e.message };
  }
}

// Crée une notification pour un résident (portail locataire).
async function creerNotifResident(campingId, residentId, {
  type, titre, corps = null, entite = null, entite_id = null, lien = null, donnees = {},
} = {}) {
  try {
    if (!campingId || !residentId || !type || !titre) return { inseree: false };
    const { error } = await supabase.from('notifications').insert({
      camping_id: campingId, canal: 'portail', destinataire_resident_id: residentId,
      type, titre, corps, entite, entite_id, lien, donnees: donnees || {},
    });
    if (error) throw error;
    return { inseree: true };
  } catch (e) {
    console.error('[notifications:resident]', e.message);
    return { inseree: false, error: e.message };
  }
}

module.exports = { creerNotifsStaff, creerNotifResident };

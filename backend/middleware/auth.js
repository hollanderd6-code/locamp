const jwt = require('jsonwebtoken');
const { supabase } = require('../lib/supabase');

const JWT_SECRET = process.env.JWT_SECRET;

// 1) Vérifie le JWT (en-tête Authorization: Bearer ...) -> req.user = { uid, email }
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token manquant' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.typ === 'resident') return res.status(403).json({ error: 'Token non autorisé ici' });
    req.user = { uid: payload.uid, email: payload.email };
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

// 2) Charge les campings + rôles de l'utilisateur (source de vérité en base).
//    -> req.campings = [{ camping_id, role }], req.campingIds = [...]
//    Camping actif via l'en-tête optionnel x-camping-id ; sinon le premier.
async function campingScope(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('user_campings')
      .select('camping_id, role, permissions')
      .eq('user_id', req.user.uid);
    if (error) throw error;

    req.campings = data || [];
    req.campingIds = req.campings.map((c) => c.camping_id);

    const requested = req.headers['x-camping-id'];
    if (requested) {
      const match = req.campings.find((c) => c.camping_id === requested);
      if (!match) return res.status(403).json({ error: 'Accès refusé à ce camping' });
      req.activeCampingId = match.camping_id;
      req.activeRole = match.role;
      req.activePermissions = match.permissions || {};
    } else {
      req.activeCampingId = req.campingIds[0] || null;
      req.activeRole = req.campings[0]?.role || null;
      req.activePermissions = req.campings[0]?.permissions || {};
    }
    next();
  } catch (e) {
    console.error('[campingScope]', e.message);
    return res.status(500).json({ error: 'Erreur de contexte camping' });
  }
}

// 3) Exige un rôle sur le camping actif. À placer APRÈS campingScope.
//    Ex : requireRole('admin')  ou  requireRole('admin', 'gestionnaire')
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.activeRole) return res.status(403).json({ error: 'Aucun rôle sur ce camping' });
    if (!roles.includes(req.activeRole)) {
      return res.status(403).json({ error: 'Droits insuffisants' });
    }
    next();
  };
}

// 3bis) Droits fins. Le rôle donne une base ; `permissions` peut accorder ou retirer
//       explicitement un droit (true/false) pour cet utilisateur sur ce camping.
const DROITS = ['encaisser', 'facturer', 'gerer_residents', 'gerer_emplacements',
  'gerer_tarifs', 'relancer', 'messagerie', 'compta', 'admin'];

// Droits accordés par défaut selon le rôle.
const DROITS_ROLE = {
  admin:         { encaisser: true, facturer: true, gerer_residents: true, gerer_emplacements: true, gerer_tarifs: true, relancer: true, messagerie: true, compta: true, admin: true },
  gestionnaire:  { encaisser: true, facturer: true, gerer_residents: true, gerer_emplacements: true, gerer_tarifs: true, relancer: true, messagerie: true, compta: false, admin: false },
  comptabilite:  { encaisser: true, facturer: true, gerer_residents: false, gerer_emplacements: false, gerer_tarifs: false, relancer: true, messagerie: false, compta: true, admin: false },
  lecture:       { encaisser: false, facturer: false, gerer_residents: false, gerer_emplacements: false, gerer_tarifs: false, relancer: false, messagerie: false, compta: false, admin: false },
};

function droitsEffectifs(role, permissions) {
  const base = DROITS_ROLE[role] || DROITS_ROLE.lecture;
  const out = { ...base };
  for (const d of DROITS) {
    if (permissions && typeof permissions[d] === 'boolean') out[d] = permissions[d];
  }
  return out;
}

// Exige un droit précis sur le camping actif. À placer APRÈS campingScope.
function requirePerm(droit) {
  return (req, res, next) => {
    if (!req.activeRole) return res.status(403).json({ error: 'Aucun rôle sur ce camping' });
    const d = droitsEffectifs(req.activeRole, req.activePermissions);
    if (!d[droit]) return res.status(403).json({ error: `Droit requis : ${droit}` });
    next();
  };
}

// 4) Auth PORTAIL LOCATAIRE : vérifie un JWT de type 'resident'.
//    -> req.resident = { id, camping_id, email }
function authResident(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token manquant' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.typ !== 'resident') return res.status(403).json({ error: 'Token invalide' });
    req.resident = { id: payload.rid, camping_id: payload.cid, email: payload.email };
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

module.exports = { auth, campingScope, requireRole, requirePerm, droitsEffectifs, DROITS, DROITS_ROLE, authResident };

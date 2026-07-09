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
      .select('camping_id, role')
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
    } else {
      req.activeCampingId = req.campingIds[0] || null;
      req.activeRole = req.campings[0]?.role || null;
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

module.exports = { auth, campingScope, requireRole, authResident };

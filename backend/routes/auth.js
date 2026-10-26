const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { supabase } = require('../lib/supabase');
const { writeAudit } = require('../lib/audit');
const { auth, campingScope } = require('../middleware/auth');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES = process.env.JWT_EXPIRES || '30d';
const BOOTSTRAP_SECRET = process.env.BOOTSTRAP_SECRET;
const ROLES = ['admin', 'gestionnaire', 'comptabilite', 'lecture'];

// -----------------------------------------------------------------
// POST /api/auth/register
// Crée un utilisateur. Autorisé si :
//   - en-tête x-bootstrap-secret valide  (créer le tout premier admin), OU
//   - l'appelant est déjà 'admin' sur le camping ciblé (JWT admin).
// Body : { email, password, nom?, prenom?, camping_id?, role? }
// -----------------------------------------------------------------
router.post('/register', async (req, res) => {
  try {
    const { email, password, nom, prenom, camping_id, role } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email et password requis' });
    if (role && !ROLES.includes(role)) return res.status(400).json({ error: 'role invalide' });

    // --- autorisation ---
    let authorized = false;
    const bs = req.headers['x-bootstrap-secret'];
    if (BOOTSTRAP_SECRET && bs && bs === BOOTSTRAP_SECRET) {
      authorized = true;
    } else {
      const h = req.headers.authorization || '';
      const token = h.startsWith('Bearer ') ? h.slice(7) : null;
      if (token && camping_id) {
        try {
          const p = jwt.verify(token, JWT_SECRET);
          const { data } = await supabase
            .from('user_campings')
            .select('role')
            .eq('user_id', p.uid)
            .eq('camping_id', camping_id)
            .maybeSingle();
          if (data?.role === 'admin') {
            authorized = true;
            req.user = { uid: p.uid, email: p.email }; // pour l'audit
          }
        } catch { /* token invalide : non autorisé */ }
      }
    }
    if (!authorized) return res.status(403).json({ error: 'Non autorisé à créer un utilisateur' });

    // --- création ---
    const hash = await bcrypt.hash(password, 12);
    const { data: user, error } = await supabase
      .from('utilisateurs')
      .insert({ email: email.toLowerCase().trim(), hash_mdp: hash, nom, prenom })
      .select('id, email, nom, prenom')
      .single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Email déjà utilisé' });
      throw error;
    }

    if (camping_id && role) {
      const { error: linkErr } = await supabase
        .from('user_campings')
        .insert({ user_id: user.id, camping_id, role });
      if (linkErr) throw linkErr;
    }

    await writeAudit(req, {
      action: 'create',
      entite: 'utilisateurs',
      entite_id: user.id,
      apres: { email: user.email, camping_id: camping_id || null, role: role || null },
      camping_id: camping_id || null,
    });

    res.status(201).json({ user });
  } catch (e) {
    console.error('[register]', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// -----------------------------------------------------------------
// POST /api/auth/login   { email, password }
// -----------------------------------------------------------------
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email et password requis' });

    const { data: user, error } = await supabase
      .from('utilisateurs')
      .select('id, email, hash_mdp, nom, prenom, actif, doit_changer_mdp')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();
    if (error) throw error;
    if (!user || !user.actif) return res.status(401).json({ error: 'Identifiants invalides' });

    const ok = await bcrypt.compare(password, user.hash_mdp);
    if (!ok) return res.status(401).json({ error: 'Identifiants invalides' });

    const { data: campings } = await supabase
      .from('user_campings')
      .select('camping_id, role')
      .eq('user_id', user.id);

    const token = jwt.sign({ uid: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES });

    // renseigne l'auteur pour l'audit de connexion
    req.user = { uid: user.id, email: user.email };
    await writeAudit(req, {
      action: 'login',
      entite: 'utilisateurs',
      entite_id: user.id,
      camping_id: campings?.[0]?.camping_id || null,
    });

    res.json({
      token,
      user: { id: user.id, email: user.email, nom: user.nom, prenom: user.prenom,
              doit_changer_mdp: !!user.doit_changer_mdp },
      campings: campings || [],
    });
  } catch (e) {
    console.error('[login]', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// -----------------------------------------------------------------
// GET /api/auth/me   (JWT requis) -> profil + campings/rôles
// -----------------------------------------------------------------
router.get('/me', auth, campingScope, async (req, res) => {
  const { data: user } = await supabase
    .from('utilisateurs')
    .select('id, email, nom, prenom, doit_changer_mdp')
    .eq('id', req.user.uid)
    .maybeSingle();

  // noms des campings accessibles (pour le sélecteur d'espace)
  let campings = req.campings;
  if (req.campingIds?.length) {
    const { data: noms } = await supabase.from('campings')
      .select('id,nom,raison_sociale').in('id', req.campingIds);
    const map = {};
    (noms || []).forEach((c) => { map[c.id] = c.nom || c.raison_sociale || 'Camping'; });
    campings = req.campings.map((c) => ({ ...c, nom: map[c.camping_id] || 'Camping' }));
  }

  res.json({
    user,
    campings,
    activeCampingId: req.activeCampingId,
    activeRole: req.activeRole,
  });
});

// -----------------------------------------------------------------
// POST /api/auth/mot-de-passe   (JWT requis)  { actuel, nouveau }
// Change son propre mot de passe. Lève l'obligation posée sur un compte
// créé avec un mot de passe provisoire (doit_changer_mdp).
// -----------------------------------------------------------------
router.post('/mot-de-passe', auth, async (req, res) => {
  try {
    const { actuel, nouveau } = req.body || {};
    if (!actuel || !nouveau) return res.status(400).json({ error: 'Mot de passe actuel et nouveau requis' });
    if (String(nouveau).length < 8) return res.status(400).json({ error: 'Le nouveau mot de passe doit faire au moins 8 caractères' });
    if (nouveau === actuel) return res.status(400).json({ error: 'Le nouveau mot de passe doit être différent de l\u2019actuel' });

    const { data: user, error } = await supabase.from('utilisateurs')
      .select('id, hash_mdp').eq('id', req.user.uid).maybeSingle();
    if (error) throw error;
    if (!user) return res.status(404).json({ error: 'Compte introuvable' });
    if (!(await bcrypt.compare(actuel, user.hash_mdp))) {
      return res.status(400).json({ error: 'Mot de passe actuel incorrect' });
    }

    const hash = await bcrypt.hash(nouveau, 12);
    const { error: upErr } = await supabase.from('utilisateurs')
      .update({ hash_mdp: hash, doit_changer_mdp: false }).eq('id', user.id);
    if (upErr) throw upErr;

    await writeAudit(req, { action: 'update', entite: 'utilisateurs', entite_id: user.id,
      apres: { mot_de_passe: 'modifié' } });
    res.json({ ok: true });
  } catch (e) {
    console.error('[mot-de-passe]', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

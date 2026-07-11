const express = require('express');
const bcrypt = require('bcryptjs');
const { supabase } = require('../lib/supabase');
const { writeAudit } = require('../lib/audit');
const { sendEmail } = require('../lib/email');
const { auth, campingScope, requirePerm, droitsEffectifs, DROITS, DROITS_ROLE } = require('../middleware/auth');

const router = express.Router();
router.use(auth, campingScope);

const ROLES = ['admin', 'gestionnaire', 'comptabilite', 'lecture'];

/* ------------------------- Référentiel des droits ------------------------- */

// GET /api/admin/droits  -> libellés + matrice par rôle (pour l'écran d'admin)
router.get('/droits', requirePerm('admin'), (req, res) => {
  res.json({
    droits: DROITS,
    libelles: {
      encaisser: 'Encaisser des paiements',
      facturer: 'Créer et émettre des factures',
      gerer_residents: 'Gérer les résidents',
      gerer_emplacements: 'Gérer les emplacements et la carte',
      gerer_tarifs: 'Modifier les tarifs et paramètres',
      relancer: 'Envoyer des relances',
      messagerie: 'Écrire aux résidents',
      compta: 'Exporter la comptabilité',
      admin: 'Administrer les comptes',
    },
    roles: ROLES,
    droits_par_role: DROITS_ROLE,
  });
});

// GET /api/admin/mes-droits  -> droits de l'utilisateur courant (pour masquer l'UI)
router.get('/mes-droits', async (req, res) => {
  res.json({
    role: req.activeRole,
    droits: droitsEffectifs(req.activeRole, req.activePermissions),
  });
});

/* ------------------------------ Utilisateurs ------------------------------ */

// GET /api/admin/utilisateurs  -> comptes ayant accès au camping actif
router.get('/utilisateurs', requirePerm('admin'), async (req, res) => {
  try {
    const { data: liens, error } = await supabase.from('user_campings')
      .select('user_id, role, permissions').eq('camping_id', req.activeCampingId);
    if (error) throw error;
    const ids = (liens || []).map((l) => l.user_id);
    if (!ids.length) return res.json({ utilisateurs: [] });

    const { data: users } = await supabase.from('utilisateurs')
      .select('id,email,nom,prenom,actif,doit_changer_mdp,created_at').in('id', ids);
    const umap = {};
    (users || []).forEach((u) => { umap[u.id] = u; });

    const utilisateurs = (liens || []).map((l) => ({
      ...(umap[l.user_id] || { id: l.user_id }),
      role: l.role,
      permissions: l.permissions || {},
      droits: droitsEffectifs(l.role, l.permissions),
      est_moi: l.user_id === req.user.uid,
    })).sort((a, b) => (a.nom || '').localeCompare(b.nom || ''));

    res.json({ utilisateurs });
  } catch (e) { console.error('[admin:users]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/admin/utilisateurs  { email, nom, prenom, role, permissions }
// Crée le compte s'il n'existe pas, puis lui donne accès au camping actif.
router.post('/utilisateurs', requirePerm('admin'), async (req, res) => {
  try {
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'E-mail requis' });
    if (!ROLES.includes(b.role)) return res.status(400).json({ error: 'Rôle invalide' });

    let { data: user } = await supabase.from('utilisateurs').select('id,email,nom,prenom').eq('email', email).maybeSingle();
    let motDePasseTemp = null;

    if (!user) {
      motDePasseTemp = Math.random().toString(36).slice(2, 10) + 'A9!';
      const hash = await bcrypt.hash(motDePasseTemp, 12);
      const ins = await supabase.from('utilisateurs').insert({
        email, nom: b.nom || null, prenom: b.prenom || null,
        hash_mdp: hash, doit_changer_mdp: true, actif: true,
      }).select('id,email,nom,prenom').single();
      if (ins.error) throw ins.error;
      user = ins.data;
    }

    const { data: existant } = await supabase.from('user_campings')
      .select('user_id').eq('user_id', user.id).eq('camping_id', req.activeCampingId).maybeSingle();
    if (existant) return res.status(409).json({ error: 'Ce compte a déjà accès à ce camping' });

    const perms = {};
    for (const d of DROITS) if (typeof b.permissions?.[d] === 'boolean') perms[d] = b.permissions[d];

    const { error: linkErr } = await supabase.from('user_campings')
      .insert({ user_id: user.id, camping_id: req.activeCampingId, role: b.role, permissions: perms });
    if (linkErr) throw linkErr;

    await writeAudit(req, { action: 'create', entite: 'user_campings', entite_id: user.id,
      apres: { email, role: b.role, permissions: perms } });

    // envoi des identifiants si le compte vient d'être créé
    if (motDePasseTemp) {
      const { data: camp } = await supabase.from('campings').select('nom,raison_sociale').eq('id', req.activeCampingId).maybeSingle();
      const nomCamping = camp?.nom || camp?.raison_sociale || 'le camping';
      const base = process.env.PUBLIC_APP_URL || '';
      sendEmail({
        to: email,
        subject: `Votre accès à Locamp — ${nomCamping}`,
        html: `<p>Bonjour ${b.prenom || ''},</p><p>Un accès Locamp a été créé pour vous sur <b>${nomCamping}</b>.</p>`
          + `<p>Identifiant : <b>${email}</b><br>Mot de passe provisoire : <b>${motDePasseTemp}</b></p>`
          + `<p>Vous devrez le changer à la première connexion.</p>`
          + (base ? `<p><a href="${base}">Se connecter</a></p>` : ''),
      }).catch((e) => console.error('[admin:invite]', e.message));
    }

    res.status(201).json({
      utilisateur: { ...user, role: b.role, permissions: perms },
      mot_de_passe_temporaire: motDePasseTemp,   // affiché une seule fois si e-mail non configuré
    });
  } catch (e) { console.error('[admin:user-create]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// PUT /api/admin/utilisateurs/:id  { role?, permissions? }  -> sur le camping actif
router.put('/utilisateurs/:id', requirePerm('admin'), async (req, res) => {
  try {
    const b = req.body || {};
    if (req.params.id === req.user.uid && (b.role && b.role !== 'admin')) {
      return res.status(400).json({ error: 'Impossible de retirer son propre rôle admin' });
    }
    const patch = {};
    if (b.role) {
      if (!ROLES.includes(b.role)) return res.status(400).json({ error: 'Rôle invalide' });
      patch.role = b.role;
    }
    if (b.permissions && typeof b.permissions === 'object') {
      const perms = {};
      for (const d of DROITS) if (typeof b.permissions[d] === 'boolean') perms[d] = b.permissions[d];
      patch.permissions = perms;
    }
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'Rien à modifier' });

    const { data, error } = await supabase.from('user_campings').update(patch)
      .eq('user_id', req.params.id).eq('camping_id', req.activeCampingId).select().single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Accès introuvable' });

    await writeAudit(req, { action: 'update', entite: 'user_campings', entite_id: req.params.id, apres: patch });
    res.json({ ok: true });
  } catch (e) { console.error('[admin:user-update]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// DELETE /api/admin/utilisateurs/:id  -> retire l'accès AU CAMPING ACTIF (le compte subsiste)
router.delete('/utilisateurs/:id', requirePerm('admin'), async (req, res) => {
  try {
    if (req.params.id === req.user.uid) return res.status(400).json({ error: 'Impossible de retirer son propre accès' });
    const { error } = await supabase.from('user_campings')
      .delete().eq('user_id', req.params.id).eq('camping_id', req.activeCampingId);
    if (error) throw error;
    await writeAudit(req, { action: 'delete', entite: 'user_campings', entite_id: req.params.id });
    res.json({ ok: true });
  } catch (e) { console.error('[admin:user-delete]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

/* --------------------------- Journal d'activité --------------------------- */

const LIB_ACTION = {
  create: 'Création', update: 'Modification', delete: 'Suppression',
  login: 'Connexion', access: 'Consultation', email: 'Envoi e-mail',
  export: 'Export', run_relances: 'Relances',
};
const LIB_ENTITE = {
  reglements: 'Encaissement', factures: 'Facture', prestations: 'Prestation',
  residents: 'Résident', emplacements: 'Emplacement', articles: 'Article',
  messages: 'Message', campings: 'Camping', user_campings: 'Accès utilisateur',
  releves_compteurs: 'Relevé compteur', contrats: 'Contrat', documents: 'Document',
  remises: 'Remise en banque', compta: 'Comptabilité',
};

// GET /api/admin/journal?debut=&fin=&auteur=&entite=&action=&limit=
router.get('/journal', requirePerm('admin'), async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 200), 1000);
    let q = supabase.from('audit_log').select('*').eq('camping_id', req.activeCampingId);
    if (req.query.debut) q = q.gte('horodatage', req.query.debut);
    if (req.query.fin) q = q.lte('horodatage', req.query.fin + 'T23:59:59');
    if (req.query.auteur) q = q.eq('auteur_id', req.query.auteur);
    if (req.query.entite) q = q.eq('entite', req.query.entite);
    if (req.query.action) q = q.eq('action', req.query.action);

    const { data, error } = await q.order('horodatage', { ascending: false }).limit(limit);
    if (error) throw error;

    const entrees = (data || []).map((e) => ({
      ...e,
      action_lib: LIB_ACTION[e.action] || e.action,
      entite_lib: LIB_ENTITE[e.entite] || e.entite,
    }));
    res.json({ entrees, limite: limit, libelles: { actions: LIB_ACTION, entites: LIB_ENTITE } });
  } catch (e) { console.error('[admin:journal]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/admin/journal/export?debut=&fin=  -> CSV horodaté (contrôle fiscal)
// Trace l'export lui-même dans le journal (exigence d'auditabilité).
router.get('/journal/export', requirePerm('admin'), async (req, res) => {
  try {
    const debut = req.query.debut || '2000-01-01';
    const fin = req.query.fin || new Date().toISOString().slice(0, 10);

    const { data, error } = await supabase.from('audit_log').select('*')
      .eq('camping_id', req.activeCampingId)
      .gte('horodatage', debut).lte('horodatage', fin + 'T23:59:59')
      .order('horodatage', { ascending: true });
    if (error) throw error;

    const esc = (v) => {
      if (v == null) return '';
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return `"${s.replace(/"/g, '""')}"`;
    };
    const COLS = ['Horodatage', 'Auteur', 'Email', 'Action', 'Entite', 'Identifiant', 'Avant', 'Apres', 'IP'];
    const lignes = [COLS.join(';')];
    for (const e of (data || [])) {
      lignes.push([
        esc(new Date(e.horodatage).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })),
        esc(e.auteur_id), esc(e.auteur_email),
        esc(LIB_ACTION[e.action] || e.action),
        esc(LIB_ENTITE[e.entite] || e.entite),
        esc(e.entite_id), esc(e.avant), esc(e.apres), esc(e.ip),
      ].join(';'));
    }
    const csv = '\uFEFF' + lignes.join('\r\n');   // BOM : Excel FR

    await writeAudit(req, { action: 'export', entite: 'audit_log',
      apres: { debut, fin, lignes: (data || []).length } });

    const nom = `journal_activite_${debut}_${fin}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nom}"`);
    res.send(csv);
  } catch (e) { console.error('[admin:journal-export]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;

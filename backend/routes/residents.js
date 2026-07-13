const express = require('express');
const { supabase } = require('../lib/supabase');
const { writeAudit } = require('../lib/audit');
const { envoyerActivation } = require('../lib/portail-auth');
const { buildReleve } = require('../lib/releve');
const { buildRelevePdf } = require('../lib/pdf');
const { auth, campingScope, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(auth, campingScope);

const RES_FIELDS = ['emplacement_id', 'civilite', 'nom', 'prenom', 'date_naissance', 'nationalite',
  'email', 'telephone', 'adresse', 'foyer', 'notes_internes', 'actif'];

function pick(body, fields) {
  const out = {};
  for (const f of fields) if (body[f] !== undefined) out[f] = body[f];
  return out;
}

// Recalcule le statut d'un emplacement selon qu'un résident y est rattaché.
// Ne touche pas aux statuts 'reserve' / 'indisponible' (gérés manuellement).
async function reconcileStatut(campingId, empId) {
  if (!empId) return;
  const { data: emp } = await supabase.from('emplacements')
    .select('statut').eq('camping_id', campingId).eq('id', empId).maybeSingle();
  if (!emp || ['reserve', 'indisponible'].includes(emp.statut)) return;

  const { count } = await supabase.from('residents')
    .select('id', { count: 'exact', head: true })
    .eq('camping_id', campingId).eq('emplacement_id', empId).eq('actif', true);

  const nouveau = (count || 0) > 0 ? 'occupe' : 'libre';
  if (nouveau !== emp.statut) {
    await supabase.from('emplacements').update({ statut: nouveau })
      .eq('camping_id', campingId).eq('id', empId);
  }
}

// GET /api/residents  (recherche ?q= sur nom/prénom/email/téléphone)
router.get('/', async (req, res) => {
  try {
    let q = supabase.from('residents')
      .select('id,civilite,nom,prenom,email,telephone,emplacement_id,solde,actif,compte_comptable')
      .eq('camping_id', req.activeCampingId);
    const s = (req.query.q || '').trim();
    if (s) q = q.or(`nom.ilike.%${s}%,prenom.ilike.%${s}%,email.ilike.%${s}%,telephone.ilike.%${s}%`);
    const { data, error } = await q.order('nom');
    if (error) throw error;
    res.json({ residents: data });
  } catch (e) {
    console.error('[residents:list]', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/residents/:id  (vue 360 : résident + emplacement + documents)
router.get('/:id', async (req, res) => {
  try {
    const { data: resident, error } = await supabase.from('residents').select('*')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!resident) return res.status(404).json({ error: 'Résident introuvable' });

    let emplacement = null;
    if (resident.emplacement_id) {
      const { data } = await supabase.from('emplacements')
        .select('id,numero,secteur,type,statut,loyer_base')
        .eq('id', resident.emplacement_id).maybeSingle();
      emplacement = data || null;
    }
    const { data: documents } = await supabase.from('documents')
      .select('id,type,nom_fichier,date_expiration,created_at')
      .eq('camping_id', req.activeCampingId).eq('resident_id', resident.id)
      .order('created_at', { ascending: false });

    res.json({ resident, emplacement, documents: documents || [] });
  } catch (e) {
    console.error('[residents:get]', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/residents  (admin, gestionnaire)
// Génère le prochain compte auxiliaire client : racine + séquence paddée (ex. 411 + 00001)
async function nextCompteClient(campingId) {
  const { data: camp } = await supabase.from('campings').select('parametres').eq('id', campingId).maybeSingle();
  const cc = (camp?.parametres || {}).comptabilite || {};
  const racine = String(cc.racine_client || '411').replace(/[^0-9A-Za-z]/g, '');
  const lng = Math.min(Math.max(Number(cc.longueur_seq_client || 5), 2), 8);
  const { data: seqData, error } = await supabase.rpc('next_compteur', { p_camping: campingId, p_cle: 'compte_client' });
  if (error) throw error;
  const seq = Array.isArray(seqData) ? seqData[0] : seqData;
  return racine + String(seq).padStart(lng, '0');
}

router.post('/', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const body = pick(req.body || {}, RES_FIELDS);
    if (!body.nom) return res.status(400).json({ error: 'nom requis' });
    body.camping_id = req.activeCampingId;
    try { body.compte_comptable = await nextCompteClient(req.activeCampingId); }
    catch (e) { console.error('[residents:compte]', e.message); } // non bloquant (colonne absente, etc.)

    const { data, error } = await supabase.from('residents').insert(body).select().single();
    if (error) throw error;

    await reconcileStatut(req.activeCampingId, data.emplacement_id);
    await writeAudit(req, { action: 'create', entite: 'residents', entite_id: data.id, apres: data });

    // Invitation à activer l'espace locataire (le clic sur le lien vaut vérification
    // de l'adresse e-mail). Best-effort : n'empêche jamais la création du résident.
    let invitation = null;
    if (data.email) {
      try {
        const out = await envoyerActivation(data.id);
        invitation = out.ok ? { envoyee_a: out.envoye_a } : null;
      } catch (e) { console.error('[residents:invitation]', e.message); }
    }

    res.status(201).json({ resident: data, invitation });
  } catch (e) {
    console.error('[residents:create]', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/residents/:id  (admin, gestionnaire)
// Si l'emplacement change, on réconcilie le statut de l'ancien ET du nouveau.
router.put('/:id', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const { data: avant } = await supabase.from('residents').select('*')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).maybeSingle();
    if (!avant) return res.status(404).json({ error: 'Résident introuvable' });

    const patch = pick(req.body || {}, RES_FIELDS);
    const { data, error } = await supabase.from('residents').update(patch)
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).select().single();
    if (error) throw error;

    if ('emplacement_id' in patch && patch.emplacement_id !== avant.emplacement_id) {
      await reconcileStatut(req.activeCampingId, avant.emplacement_id);
      await reconcileStatut(req.activeCampingId, data.emplacement_id);
    } else if ('actif' in patch) {
      await reconcileStatut(req.activeCampingId, data.emplacement_id);
    }

    await writeAudit(req, { action: 'update', entite: 'residents', entite_id: data.id, avant, apres: data });
    res.json({ resident: data });
  } catch (e) {
    console.error('[residents:update]', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/residents/attribuer-comptes  (admin) — attribue un compte aux résidents qui n'en ont pas,
// par ordre de création (numérotation stable).
router.post('/attribuer-comptes', requireRole('admin'), async (req, res) => {
  try {
    const { data: sans, error } = await supabase.from('residents')
      .select('id,nom,prenom').eq('camping_id', req.activeCampingId)
      .is('compte_comptable', null).order('created_at');
    if (error) throw error;
    let attribues = 0;
    for (const r of (sans || [])) {
      const compte = await nextCompteClient(req.activeCampingId);
      const { error: upErr } = await supabase.from('residents').update({ compte_comptable: compte }).eq('id', r.id);
      if (!upErr) attribues++;
    }
    await writeAudit(req, { action: 'attribuer_comptes', entite: 'residents', apres: { attribues } });
    res.json({ attribues, restants: (sans || []).length - attribues });
  } catch (e) { console.error('[residents:attribuer]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/residents/:id/releve?annee=  -> relevé de compte (grand livre auxiliaire)
router.get('/:id/releve', async (req, res) => {
  try {
    const d = await buildReleve(req.activeCampingId, req.params.id, req.query.annee);
    if (!d) return res.status(404).json({ error: 'Résident introuvable' });
    res.json(d);
  } catch (e) { console.error('[residents:releve]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/residents/:id/releve.pdf?annee=  -> relevé à envoyer au client
router.get('/:id/releve.pdf', async (req, res) => {
  try {
    const d = await buildReleve(req.activeCampingId, req.params.id, req.query.annee);
    if (!d) return res.status(404).json({ error: 'Résident introuvable' });
    const { data: camping } = await supabase.from('campings')
      .select('nom,raison_sociale,adresse,siret,tva').eq('id', req.activeCampingId).maybeSingle();

    const pdf = await buildRelevePdf({ camping: camping || {}, ...d });
    await writeAudit(req, { action: 'access', entite: 'residents', entite_id: req.params.id,
      apres: { doc: 'releve', annee: d.annee } });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="releve_${d.annee}.pdf"`);
    res.send(pdf);
  } catch (e) { console.error('[residents:releve-pdf]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/residents/:id/invitation  -> (re)envoie l'invitation d'activation
router.post('/:id/invitation', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const { data: r } = await supabase.from('residents').select('id')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).maybeSingle();
    if (!r) return res.status(404).json({ error: 'Résident introuvable' });

    const out = await envoyerActivation(req.params.id, { renvoi: true });
    if (out.error) return res.status(400).json({ error: out.error });

    await writeAudit(req, { action: 'email', entite: 'residents', entite_id: req.params.id,
      apres: { invitation: out.envoye_a } });

    res.json({
      ok: true,
      envoye_a: out.envoye_a,
      message: out.simule
        ? 'Service e-mail non configuré — invitation non envoyée.'
        : `Invitation envoyée à ${out.envoye_a}`,
      lien_dev: out.lien_dev,
    });
  } catch (e) { console.error('[residents:invitation]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;

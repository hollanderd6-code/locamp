const express = require('express');
const { supabase } = require('../lib/supabase');
const { writeAudit } = require('../lib/audit');
const { sendEmail } = require('../lib/email');
const { auth, campingScope, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(auth, campingScope);

// GET /api/messages/non-lus  -> compteurs de messages résidents non lus (badge)
router.get('/non-lus', async (req, res) => {
  try {
    const { data, error } = await supabase.from('messages')
      .select('resident_id')
      .eq('camping_id', req.activeCampingId).eq('auteur', 'resident').eq('lu', false);
    if (error) throw error;
    const parResident = {};
    (data || []).forEach((m) => { parResident[m.resident_id] = (parResident[m.resident_id] || 0) + 1; });
    res.json({ total: (data || []).length, par_resident: parResident });
  } catch (e) { console.error('[messages:non-lus]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/messages?resident_id=  -> fil complet (et marque lus les messages du résident)
router.get('/', async (req, res) => {
  try {
    const rid = req.query.resident_id;
    if (!rid) return res.status(400).json({ error: 'resident_id requis' });
    const { data, error } = await supabase.from('messages').select('*')
      .eq('camping_id', req.activeCampingId).eq('resident_id', rid)
      .order('created_at', { ascending: true });
    if (error) throw error;
    // marquer lus les messages entrants
    await supabase.from('messages').update({ lu: true })
      .eq('camping_id', req.activeCampingId).eq('resident_id', rid)
      .eq('auteur', 'resident').eq('lu', false);
    res.json({ messages: data || [] });
  } catch (e) { console.error('[messages:list]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/messages  { resident_id, corps }  -> message du camping + notification e-mail
router.post('/', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const { resident_id, corps } = req.body || {};
    if (!resident_id || !corps || !String(corps).trim()) return res.status(400).json({ error: 'resident_id et corps requis' });
    const { data, error } = await supabase.from('messages').insert({
      camping_id: req.activeCampingId, resident_id, auteur: 'camping', corps: String(corps).trim(),
    }).select().single();
    if (error) throw error;
    await writeAudit(req, { action: 'create', entite: 'messages', entite_id: data.id, apres: { resident_id } });

    // notification e-mail au résident (best-effort)
    Promise.resolve().then(async () => {
      const [{ data: r }, { data: c }] = await Promise.all([
        supabase.from('residents').select('email,prenom,nom').eq('id', resident_id).maybeSingle(),
        supabase.from('campings').select('nom,raison_sociale,parametres').eq('id', req.activeCampingId).maybeSingle(),
      ]);
      if (!r?.email) return;
      const nomCamping = c?.nom || c?.raison_sociale || 'Votre camping';
      const base = process.env.PUBLIC_APP_URL || '';
      await sendEmail({
        to: r.email,
        subject: `Nouveau message de ${nomCamping}`,
        html: `<p>Bonjour ${r.prenom || ''},</p><p>Vous avez reçu un nouveau message de ${nomCamping} :</p>`
          + `<blockquote style="border-left:3px solid #1A7A5E;margin:8px 0;padding:4px 12px;color:#333">${String(corps).trim().replace(/</g, '&lt;').replace(/\n/g, '<br>')}</blockquote>`
          + (base ? `<p><a href="${base}/portail/">Répondre depuis mon espace locataire</a></p>` : ''),
        sender: c?.parametres?.facturation?.email ? { email: c.parametres.facturation.email, name: nomCamping } : { name: nomCamping },
      });
    }).catch((e) => console.error('[messages:notif]', e.message));

    res.status(201).json({ message: data });
  } catch (e) { console.error('[messages:create]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;

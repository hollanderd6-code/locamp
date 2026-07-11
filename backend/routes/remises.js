const express = require('express');
const { supabase } = require('../lib/supabase');
const { writeAudit } = require('../lib/audit');
const { buildRemisePdf } = require('../lib/pdf');
const { auth, campingScope, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(auth, campingScope);

// Chèques reçus non encore remis, avec le nom du tireur (résident)
async function chequesEnAttente(campingId) {
  const { data: regs, error } = await supabase.from('reglements')
    .select('id,resident_id,montant,date_reglement,reference,statut_cheque,remise_id')
    .eq('camping_id', campingId).eq('mode', 'cheque')
    .is('remise_id', null).order('date_reglement');
  if (error) throw error;
  const cheques = (regs || []).filter((r) => !r.statut_cheque || r.statut_cheque === 'recu');
  const ids = [...new Set(cheques.map((c) => c.resident_id).filter(Boolean))];
  let rmap = {};
  if (ids.length) {
    const { data: rs } = await supabase.from('residents').select('id,nom,prenom').in('id', ids);
    (rs || []).forEach((r) => { rmap[r.id] = `${r.prenom || ''} ${r.nom}`.trim(); });
  }
  return cheques.map((c) => ({ ...c, tireur: rmap[c.resident_id] || '—' }));
}

// GET /api/remises  -> { en_attente: [chèques], remises: [...] }
router.get('/', async (req, res) => {
  try {
    const [attente, remRes] = await Promise.all([
      chequesEnAttente(req.activeCampingId),
      supabase.from('remises_banque').select('*').eq('camping_id', req.activeCampingId)
        .order('date_remise', { ascending: false }).limit(50),
    ]);
    if (remRes.error) throw remRes.error;
    const remises = remRes.data || [];
    // total + nb chèques par remise
    for (const r of remises) {
      const { data: regs } = await supabase.from('reglements').select('montant').eq('remise_id', r.id);
      r.nb_cheques = (regs || []).length;
      r.total = Math.round((regs || []).reduce((s, x) => s + Number(x.montant || 0), 0) * 100) / 100;
    }
    res.json({ en_attente: attente, remises });
  } catch (e) { console.error('[remises:list]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/remises  { reglement_ids: [], banque?, date_remise? }
router.post('/', requireRole('admin', 'gestionnaire', 'comptabilite'), async (req, res) => {
  try {
    const { reglement_ids, banque, date_remise } = req.body || {};
    if (!Array.isArray(reglement_ids) || !reglement_ids.length) return res.status(400).json({ error: 'Aucun chèque sélectionné' });

    // vérifier que tous sont des chèques du camping, non remis
    const { data: regs, error } = await supabase.from('reglements')
      .select('id,mode,remise_id,statut_cheque').eq('camping_id', req.activeCampingId).in('id', reglement_ids);
    if (error) throw error;
    if ((regs || []).length !== reglement_ids.length) return res.status(400).json({ error: 'Chèque introuvable' });
    for (const r of regs) {
      if (r.mode !== 'cheque') return res.status(400).json({ error: 'Seuls les chèques peuvent être remis' });
      if (r.remise_id) return res.status(409).json({ error: 'Un chèque est déjà dans une remise' });
    }

    // numéro R-AAAA-NNN via compteur atomique
    const year = new Date().getFullYear();
    const { data: seqData, error: seqErr } = await supabase.rpc('next_compteur', { p_camping: req.activeCampingId, p_cle: `remise:${year}` });
    if (seqErr) throw seqErr;
    const seq = Array.isArray(seqData) ? seqData[0] : seqData;
    const numero = `R-${year}-${String(seq).padStart(3, '0')}`;

    const { data: remise, error: insErr } = await supabase.from('remises_banque').insert({
      camping_id: req.activeCampingId, numero, banque: banque || null,
      date_remise: date_remise || new Date().toISOString().slice(0, 10), auteur_id: req.user.uid,
    }).select().single();
    if (insErr) throw insErr;

    const { error: updErr } = await supabase.from('reglements')
      .update({ remise_id: remise.id, statut_cheque: 'remis' })
      .eq('camping_id', req.activeCampingId).in('id', reglement_ids);
    if (updErr) throw updErr;

    await writeAudit(req, { action: 'create', entite: 'remises_banque', entite_id: remise.id,
      apres: { numero, cheques: reglement_ids.length } });
    res.status(201).json({ remise });
  } catch (e) { console.error('[remises:create]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// PUT /api/remises/:id/encaisser  -> tous les chèques passent "encaisse"
router.put('/:id/encaisser', requireRole('admin', 'gestionnaire', 'comptabilite'), async (req, res) => {
  try {
    const { data: remise } = await supabase.from('remises_banque').select('*')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).maybeSingle();
    if (!remise) return res.status(404).json({ error: 'Remise introuvable' });
    if (remise.statut === 'encaissee') return res.status(409).json({ error: 'Remise déjà encaissée' });

    await supabase.from('reglements').update({ statut_cheque: 'encaisse' }).eq('remise_id', remise.id);
    const { data, error } = await supabase.from('remises_banque')
      .update({ statut: 'encaissee', date_encaissement: new Date().toISOString().slice(0, 10) })
      .eq('id', remise.id).select().single();
    if (error) throw error;
    await writeAudit(req, { action: 'update', entite: 'remises_banque', entite_id: remise.id, apres: { statut: 'encaissee' } });
    res.json({ remise: data });
  } catch (e) { console.error('[remises:encaisser]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/remises/:id/pdf  -> bordereau (généré à la volée, non stocké)
router.get('/:id/pdf', async (req, res) => {
  try {
    const { data: remise } = await supabase.from('remises_banque').select('*')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).maybeSingle();
    if (!remise) return res.status(404).json({ error: 'Remise introuvable' });
    const [{ data: camping }, { data: regs }] = await Promise.all([
      supabase.from('campings').select('nom,raison_sociale,adresse,siret').eq('id', req.activeCampingId).maybeSingle(),
      supabase.from('reglements').select('resident_id,montant,date_reglement,reference').eq('remise_id', remise.id).order('date_reglement'),
    ]);
    const ids = [...new Set((regs || []).map((r) => r.resident_id).filter(Boolean))];
    let rmap = {};
    if (ids.length) {
      const { data: rs } = await supabase.from('residents').select('id,nom,prenom').in('id', ids);
      (rs || []).forEach((r) => { rmap[r.id] = `${r.prenom || ''} ${r.nom}`.trim(); });
    }
    const cheques = (regs || []).map((r) => ({ ...r, tireur: rmap[r.resident_id] || '—' }));
    const pdf = await buildRemisePdf({ camping: camping || {}, remise, cheques });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="remise_${remise.numero}.pdf"`);
    res.send(pdf);
  } catch (e) { console.error('[remises:pdf]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;

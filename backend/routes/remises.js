const express = require('express');
const { supabase } = require('../lib/supabase');
const { writeAudit } = require('../lib/audit');
const { buildRemisePdf } = require('../lib/pdf');
const { auth, campingScope, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(auth, campingScope);

// Moyens de paiement remisables (chèques, ANCV…). Repli sur 'cheque' si la table n'existe pas encore.
async function moyensRemisables(campingId) {
  const { data, error } = await supabase.from('moyens_paiement')
    .select('code,libelle,remisable,actif').eq('camping_id', campingId).eq('remisable', true);
  if (error || !data || !data.length) return [{ code: 'cheque', libelle: 'Chèque' }];
  return data;
}

// Règlements remisables reçus, non encore remis, avec le nom du tireur.
async function enAttente(campingId, codes) {
  const { data: regs, error } = await supabase.from('reglements')
    .select('id,resident_id,montant,date_reglement,reference,statut_cheque,mode,remise_id')
    .eq('camping_id', campingId).in('mode', codes)
    .is('remise_id', null).order('date_reglement');
  if (error) throw error;
  const list = (regs || []).filter((r) => !r.statut_cheque || r.statut_cheque === 'recu');
  const ids = [...new Set(list.map((c) => c.resident_id).filter(Boolean))];
  const rmap = {};
  if (ids.length) {
    const { data: rs } = await supabase.from('residents').select('id,nom,prenom').in('id', ids);
    (rs || []).forEach((r) => { rmap[r.id] = `${r.prenom || ''} ${r.nom}`.trim(); });
  }
  return list.map((c) => ({ ...c, tireur: rmap[c.resident_id] || '—' }));
}

// GET /api/remises
router.get('/', async (req, res) => {
  try {
    const moyens = await moyensRemisables(req.activeCampingId);
    const codes = moyens.map((m) => m.code);

    const [attente, remRes] = await Promise.all([
      enAttente(req.activeCampingId, codes),
      supabase.from('remises_banque').select('*').eq('camping_id', req.activeCampingId)
        .order('date_remise', { ascending: false }).limit(60),
    ]);
    if (remRes.error) throw remRes.error;

    const remises = remRes.data || [];
    for (const r of remises) {
      const { data: regs } = await supabase.from('reglements').select('montant').eq('remise_id', r.id);
      r.nb_cheques = (regs || []).length;
      r.total = Math.round((regs || []).reduce((s, x) => s + Number(x.montant || 0), 0) * 100) / 100;
      r.moyen_libelle = moyens.find((m) => m.code === r.moyen_code)?.libelle || r.moyen_code || 'Chèque';
    }
    res.json({ moyens, en_attente: attente, remises });
  } catch (e) { console.error('[remises:list]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/remises  { reglement_ids: [], banque?, date_remise? }
// Un bordereau = UN SEUL moyen de paiement (chèques bancaires ≠ ANCV).
router.post('/', requireRole('admin', 'gestionnaire', 'comptabilite'), async (req, res) => {
  try {
    const { reglement_ids, banque, date_remise } = req.body || {};
    if (!Array.isArray(reglement_ids) || !reglement_ids.length) {
      return res.status(400).json({ error: 'Aucun règlement sélectionné' });
    }

    const moyens = await moyensRemisables(req.activeCampingId);
    const codes = moyens.map((m) => m.code);

    const { data: regs, error } = await supabase.from('reglements')
      .select('id,mode,remise_id,statut_cheque,montant')
      .eq('camping_id', req.activeCampingId).in('id', reglement_ids);
    if (error) throw error;
    if ((regs || []).length !== reglement_ids.length) return res.status(400).json({ error: 'Règlement introuvable' });

    for (const r of regs) {
      if (!codes.includes(r.mode)) return res.status(400).json({ error: 'Ce moyen de paiement ne se remet pas en banque' });
      if (r.remise_id) return res.status(409).json({ error: 'Un règlement est déjà dans une remise' });
      if (r.statut_cheque === 'encaisse') return res.status(409).json({ error: 'Un règlement est déjà encaissé' });
    }

    const codesSel = [...new Set(regs.map((r) => r.mode))];
    if (codesSel.length > 1) {
      return res.status(400).json({ error: 'Un bordereau ne peut mélanger plusieurs moyens de paiement (bordereau chèques ≠ bordereau ANCV)' });
    }
    const moyenCode = codesSel[0];
    const moyenLib = moyens.find((m) => m.code === moyenCode)?.libelle || moyenCode;

    const year = new Date().getFullYear();
    const { data: seqData, error: seqErr } = await supabase.rpc('next_compteur', { p_camping: req.activeCampingId, p_cle: `remise:${year}` });
    if (seqErr) throw seqErr;
    const seq = Array.isArray(seqData) ? seqData[0] : seqData;
    const numero = `R-${year}-${String(seq).padStart(3, '0')}`;

    const { data: remise, error: insErr } = await supabase.from('remises_banque').insert({
      camping_id: req.activeCampingId, numero, banque: banque || null, moyen_code: moyenCode,
      date_remise: date_remise || new Date().toISOString().slice(0, 10), auteur_id: req.user.uid,
    }).select().single();
    if (insErr) throw insErr;

    const { error: updErr } = await supabase.from('reglements')
      .update({ remise_id: remise.id, statut_cheque: 'remis' })
      .eq('camping_id', req.activeCampingId).in('id', reglement_ids);
    if (updErr) throw updErr;

    const total = Math.round(regs.reduce((s, r) => s + Number(r.montant || 0), 0) * 100) / 100;
    await writeAudit(req, { action: 'create', entite: 'remises_banque', entite_id: remise.id,
      apres: { numero, moyen: moyenLib, banque: banque || null, nb: reglement_ids.length, total, reglement_ids } });

    res.status(201).json({ remise });
  } catch (e) { console.error('[remises:create]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// PUT /api/remises/:id/encaisser
router.put('/:id/encaisser', requireRole('admin', 'gestionnaire', 'comptabilite'), async (req, res) => {
  try {
    const { data: remise } = await supabase.from('remises_banque').select('*')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).maybeSingle();
    if (!remise) return res.status(404).json({ error: 'Remise introuvable' });
    if (remise.statut === 'encaissee') return res.status(409).json({ error: 'Remise déjà encaissée' });
    if (remise.statut === 'annulee') return res.status(409).json({ error: 'Remise annulée — encaissement impossible' });

    const { data: regs } = await supabase.from('reglements').select('id,montant').eq('remise_id', remise.id);
    await supabase.from('reglements').update({ statut_cheque: 'encaisse' }).eq('remise_id', remise.id);

    const { data, error } = await supabase.from('remises_banque')
      .update({ statut: 'encaissee', date_encaissement: new Date().toISOString().slice(0, 10) })
      .eq('id', remise.id).select().single();
    if (error) throw error;

    const total = Math.round((regs || []).reduce((s, r) => s + Number(r.montant || 0), 0) * 100) / 100;
    await writeAudit(req, { action: 'update', entite: 'remises_banque', entite_id: remise.id,
      avant: { statut: remise.statut },
      apres: { statut: 'encaissee', numero: remise.numero, nb: (regs || []).length, total } });

    res.json({ remise: data });
  } catch (e) { console.error('[remises:encaisser]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// PUT /api/remises/:id/annuler  { motif }
// La remise n'est JAMAIS supprimée : statut « annulée », motif obligatoire, tout est tracé.
// Les règlements sont déliés et redeviennent « à remettre ».
router.put('/:id/annuler', requireRole('admin', 'gestionnaire', 'comptabilite'), async (req, res) => {
  try {
    const motif = String(req.body?.motif || '').trim();
    if (motif.length < 3) return res.status(400).json({ error: "Motif d'annulation obligatoire" });

    const { data: remise } = await supabase.from('remises_banque').select('*')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).maybeSingle();
    if (!remise) return res.status(404).json({ error: 'Remise introuvable' });
    if (remise.statut === 'annulee') return res.status(409).json({ error: 'Remise déjà annulée' });

    const { data: regs } = await supabase.from('reglements')
      .select('id,montant,mode').eq('remise_id', remise.id);
    const ids = (regs || []).map((r) => r.id);
    const total = Math.round((regs || []).reduce((s, r) => s + Number(r.montant || 0), 0) * 100) / 100;
    const etaitEncaissee = remise.statut === 'encaissee';

    if (ids.length) {
      const { error: relErr } = await supabase.from('reglements')
        .update({ remise_id: null, statut_cheque: 'recu' })
        .eq('camping_id', req.activeCampingId).in('id', ids);
      if (relErr) throw relErr;
    }

    const { data, error } = await supabase.from('remises_banque').update({
      statut: 'annulee',
      motif_annulation: motif,
      date_annulation: new Date().toISOString(),
      annule_par: req.user.uid,
    }).eq('id', remise.id).select().single();
    if (error) throw error;

    await writeAudit(req, { action: 'update', entite: 'remises_banque', entite_id: remise.id,
      avant: { statut: remise.statut, numero: remise.numero, date_encaissement: remise.date_encaissement },
      apres: {
        statut: 'annulee', numero: remise.numero, motif,
        etait_encaissee: etaitEncaissee,
        reglements_delies: ids.length, total, reglement_ids: ids,
      } });

    res.json({
      remise: data, reglements_delies: ids.length, etait_encaissee: etaitEncaissee,
      message: etaitEncaissee
        ? `Remise ${remise.numero} (déjà encaissée) annulée — ${ids.length} règlement(s) redeviennent à remettre. Pense à la contre-écriture en comptabilité.`
        : `Remise ${remise.numero} annulée — ${ids.length} règlement(s) redeviennent à remettre.`,
    });
  } catch (e) { console.error('[remises:annuler]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/remises/:id/pdf
router.get('/:id/pdf', async (req, res) => {
  try {
    const { data: remise } = await supabase.from('remises_banque').select('*')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).maybeSingle();
    if (!remise) return res.status(404).json({ error: 'Remise introuvable' });

    const [{ data: camping }, { data: regs }, moyens] = await Promise.all([
      supabase.from('campings').select('nom,raison_sociale,adresse,siret').eq('id', req.activeCampingId).maybeSingle(),
      supabase.from('reglements').select('resident_id,montant,date_reglement,reference')
        .eq('remise_id', remise.id).order('date_reglement'),
      moyensRemisables(req.activeCampingId),
    ]);

    const ids = [...new Set((regs || []).map((r) => r.resident_id).filter(Boolean))];
    const rmap = {};
    if (ids.length) {
      const { data: rs } = await supabase.from('residents').select('id,nom,prenom').in('id', ids);
      (rs || []).forEach((r) => { rmap[r.id] = `${r.prenom || ''} ${r.nom}`.trim(); });
    }
    const cheques = (regs || []).map((r) => ({ ...r, tireur: rmap[r.resident_id] || '—' }));
    const moyenLib = moyens.find((m) => m.code === remise.moyen_code)?.libelle || 'Chèque';

    const pdf = await buildRemisePdf({
      camping: camping || {},
      remise: { ...remise, moyen_libelle: moyenLib },
      cheques,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="remise_${remise.numero}.pdf"`);
    res.send(pdf);
  } catch (e) { console.error('[remises:pdf]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;

const express = require('express');
const { supabase } = require('../lib/supabase');
const { writeAudit } = require('../lib/audit');
const { signedUrl } = require('../lib/storage');
const { runFacturationMensuelle, creerFacture, genererPdfFacture, envoyerFactureEmail, currentPeriode } = require('../lib/facturation');
const { auth, campingScope, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(auth, campingScope);

// GET /api/factures  (filtres: resident_id, contrat_id, statut, periode)
router.get('/', async (req, res) => {
  try {
    let q = supabase.from('factures')
      .select('id,numero,resident_id,contrat_id,periode,date_emission,total_ttc,montant_regle,statut')
      .eq('camping_id', req.activeCampingId);
    for (const f of ['resident_id', 'contrat_id', 'statut', 'periode']) {
      if (req.query[f]) q = q.eq(f, req.query[f]);
    }
    const { data, error } = await q.order('date_emission', { ascending: false });
    if (error) throw error;
    res.json({ factures: data });
  } catch (e) { console.error('[factures:list]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/factures/run-mensuel  { periode?: 'YYYY-MM' }  (camping actif)
router.post('/run-mensuel', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const periode = (req.body && req.body.periode) || currentPeriode();
    const result = await runFacturationMensuelle(req.activeCampingId, periode);
    await writeAudit(req, { action: 'run_facturation', entite: 'factures',
      apres: { periode: result.periode, crees: result.crees, ignores: result.ignores, erreurs: result.erreurs } });
    res.json(result);
  } catch (e) { console.error('[factures:run]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/factures  facture ponctuelle manuelle  { resident_id, contrat_id?, periode?, lignes[] }
router.post('/', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const { resident_id, contrat_id, periode, lignes } = req.body || {};
    if (!resident_id) return res.status(400).json({ error: 'resident_id requis' });
    if (!Array.isArray(lignes) || !lignes.length) return res.status(400).json({ error: 'lignes requises' });
    const facture = await creerFacture({ campingId: req.activeCampingId, resident_id, contrat_id, periode, lignes, req });
    await writeAudit(req, { action: 'create', entite: 'factures', entite_id: facture.id,
      apres: { numero: facture.numero, total_ttc: facture.total_ttc } });
    res.status(201).json({ facture });
  } catch (e) { console.error('[factures:create]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/factures/:id
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('factures').select('*')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Facture introuvable' });
    res.json({ facture: data });
  } catch (e) { console.error('[factures:get]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/factures/:id/avoir  (correction : émet un avoir, annule la facture d'origine)
router.post('/:id/avoir', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const { data: src } = await supabase.from('factures').select('*')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).maybeSingle();
    if (!src) return res.status(404).json({ error: 'Facture introuvable' });
    if (src.statut === 'avoir' || src.statut === 'annulee') {
      return res.status(409).json({ error: 'Pièce non éligible à un avoir' });
    }
    // lignes négatives
    const lignesAvoir = (src.lignes || []).map((l) => ({
      designation: `Avoir — ${l.designation}`, quantite: l.quantite, pu_ht: -Math.abs(Number(l.pu_ht || 0)), taux_tva: l.taux_tva,
    }));
    const avoir = await creerFacture({
      campingId: req.activeCampingId, resident_id: src.resident_id, contrat_id: src.contrat_id,
      periode: src.periode, lignes: lignesAvoir, statut: 'avoir', avoir_de: src.id, req,
    });
    await supabase.from('factures').update({ statut: 'annulee' })
      .eq('camping_id', req.activeCampingId).eq('id', src.id);
    await writeAudit(req, { action: 'avoir', entite: 'factures', entite_id: avoir.id,
      apres: { numero: avoir.numero, avoir_de: src.numero } });
    res.status(201).json({ avoir });
  } catch (e) { console.error('[factures:avoir]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/factures/:id/email  -> (re)envoie la facture par e-mail au résident
router.post('/:id/email', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const out = await envoyerFactureEmail(req.activeCampingId, req.params.id, { force: true });
    if (out.error) return res.status(404).json({ error: 'Facture introuvable' });
    if (out.skipped === 'statut') return res.status(409).json({ error: 'Pièce non concernée (avoir/annulée)' });
    if (out.skipped === 'sans_email') return res.status(400).json({ error: 'Le résident n\'a pas d\'adresse e-mail' });
    if (out.skipped === 'email_non_configure') return res.status(400).json({ error: 'Service e-mail non configuré (Brevo)' });
    await writeAudit(req, { action: 'email', entite: 'factures', entite_id: req.params.id, apres: out });
    res.json({ ok: true, ...out });
  } catch (e) { console.error('[factures:email]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/factures/:id/pdf  (régénère toujours : logo + identité à jour)
router.get('/:id/pdf', async (req, res) => {
  try {
    const { data: facture } = await supabase.from('factures').select('*')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).maybeSingle();
    if (!facture) return res.status(404).json({ error: 'Facture introuvable' });
    const path = await genererPdfFacture(req.activeCampingId, facture);
    const url = await signedUrl(path, 120);
    await writeAudit(req, { action: 'access', entite: 'factures', entite_id: facture.id, apres: { numero: facture.numero } });
    res.json({ url, expires_in: 120 });
  } catch (e) { console.error('[factures:pdf]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;

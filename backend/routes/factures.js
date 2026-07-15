const express = require('express');
const { supabase } = require('../lib/supabase');
const { writeAudit } = require('../lib/audit');
const { signedUrl } = require('../lib/storage');
const { runFacturationMensuelle, runFacturationResident, emettreFacture, creerFacture, genererPdfFacture, envoyerFactureEmail, currentPeriode } = require('../lib/facturation');
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

// --- Configuration de facturation d'un résident (loyer + lignes récurrentes) ---
// Vit sur le RÉSIDENT (et non le contrat) : les tarifs évoluent, le contrat signé est figé.

// GET /api/factures/config/:resident_id
router.get('/config/:resident_id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('residents').select('id,facturation')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.resident_id).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Résident introuvable' });
    res.json({ facturation: data.facturation || {} });
  } catch (e) {
    console.error('[factures:config-get]', e.message);
    res.status(500).json({ error: 'Erreur serveur — la migration db/18_facturation_resident.sql a-t-elle été exécutée ?' });
  }
});

// PUT /api/factures/config/:resident_id  { loyer_mensuel, loyer_tva, loyer_prorata, lignes[] }
router.put('/config/:resident_id', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const { data: avant } = await supabase.from('residents').select('id,facturation')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.resident_id).maybeSingle();
    if (!avant) return res.status(404).json({ error: 'Résident introuvable' });

    const b = req.body || {};
    const lignes = (Array.isArray(b.lignes) ? b.lignes : []).slice(0, 50).map((l) => ({
      designation: String(l.designation || '').slice(0, 200).trim(),
      quantite: Number(l.quantite) > 0 ? Number(l.quantite) : 1,
      pu_ttc: Math.round(Number(l.pu_ttc || 0) * 100) / 100,
      taux_tva: Number(l.taux_tva || 0),
      prorata: l.prorata === true,
    })).filter((l) => l.designation && l.pu_ttc !== 0);

    const facturation = {
      loyer_mensuel: Math.round(Number(b.loyer_mensuel || 0) * 100) / 100,
      loyer_tva: Number(b.loyer_tva || 0),
      loyer_prorata: b.loyer_prorata !== false,
      lignes,
    };

    const { data, error } = await supabase.from('residents').update({ facturation })
      .eq('camping_id', req.activeCampingId).eq('id', req.params.resident_id)
      .select('id,facturation').single();
    if (error) throw error;

    await writeAudit(req, { action: 'update', entite: 'residents', entite_id: req.params.resident_id,
      avant: { facturation: avant.facturation }, apres: { facturation } });
    res.json({ facturation: data.facturation });
  } catch (e) { console.error('[factures:config-put]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/factures/run-resident  { resident_id, periode? }  -> facture du mois d'un résident
router.post('/run-resident', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const { resident_id } = req.body || {};
    if (!resident_id) return res.status(400).json({ error: 'resident_id requis' });
    const periode = (req.body && req.body.periode) || currentPeriode();
    const out = await runFacturationResident(req.activeCampingId, resident_id, periode);
    if (out.error) return res.status(out.code || 400).json({ error: out.error });
    await writeAudit(req, { action: 'create', entite: 'factures', entite_id: out.facture.id,
      apres: { numero: out.facture.numero, periode, total_ttc: out.facture.total_ttc } });
    res.status(201).json({ facture: out.facture });
  } catch (e) { console.error('[factures:run-resident]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
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

// --- Brouillons (proforma) : vérifier / ajuster / émettre ---

// POST /api/factures/:id/emettre  -> numéro définitif + chaîne fiscale + e-mail
router.post('/:id/emettre', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const out = await emettreFacture(req.activeCampingId, req.params.id, req);
    if (out.error) return res.status(out.code || 400).json({ error: out.error });
    await writeAudit(req, { action: 'create', entite: 'factures', entite_id: out.facture.id,
      apres: { numero: out.facture.numero, total_ttc: out.facture.total_ttc, emission: true } });
    res.json({ facture: out.facture });
  } catch (e) { console.error('[factures:emettre]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// PUT /api/factures/:id/lignes  { lignes[] }  -> BROUILLON uniquement
// Une facture émise est figée (inaltérabilité) : elle ne se corrige que par un avoir.
router.put('/:id/lignes', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const { data: f } = await supabase.from('factures').select('id,statut')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).maybeSingle();
    if (!f) return res.status(404).json({ error: 'Facture introuvable' });
    if (f.statut !== 'brouillon') {
      return res.status(409).json({ error: 'Facture déjà émise : elle ne peut plus être modifiée (utilisez un avoir).' });
    }
    const lignes = Array.isArray(req.body?.lignes) ? req.body.lignes : [];
    if (!lignes.length) return res.status(400).json({ error: 'Au moins une ligne est requise' });

    const { computeTotals } = require('../lib/facturation');
    const t = computeTotals(lignes);
    const { data, error } = await supabase.from('factures').update({
      lignes: t.lignes, total_ht: t.total_ht, total_tva: t.total_tva, total_ttc: t.total_ttc,
    }).eq('camping_id', req.activeCampingId).eq('id', req.params.id).select().single();
    if (error) throw error;

    await genererPdfFacture(req.activeCampingId, data).catch(() => {});
    await writeAudit(req, { action: 'update', entite: 'factures', entite_id: data.id,
      apres: { total_ttc: data.total_ttc, nb_lignes: t.lignes.length } });
    res.json({ facture: data });
  } catch (e) { console.error('[factures:lignes]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// DELETE /api/factures/:id  -> BROUILLON uniquement (libère les prestations reprises)
router.delete('/:id', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const { data: f } = await supabase.from('factures').select('id,statut,numero')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).maybeSingle();
    if (!f) return res.status(404).json({ error: 'Facture introuvable' });
    if (f.statut !== 'brouillon') {
      return res.status(409).json({ error: 'Seul un brouillon peut être supprimé. Une facture émise s\'annule par un avoir.' });
    }
    // libère les prestations rattachées au brouillon
    await supabase.from('prestations').update({ statut: 'prevue', facture_id: null })
      .eq('camping_id', req.activeCampingId).eq('facture_id', f.id);
    await supabase.from('factures').delete()
      .eq('camping_id', req.activeCampingId).eq('id', f.id);
    await writeAudit(req, { action: 'delete', entite: 'factures', entite_id: f.id, avant: { numero: f.numero } });
    res.json({ ok: true });
  } catch (e) { console.error('[factures:delete]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
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

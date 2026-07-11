const express = require('express');
const { supabase } = require('../lib/supabase');
const { writeAudit } = require('../lib/audit');
const { recomputeFacture, autoAffectations } = require('../lib/paiement');
const { getStripe } = require('../lib/stripe');
const { auth, campingScope, requireRole, requirePerm } = require('../middleware/auth');

const router = express.Router();
router.use(auth, campingScope);

// GET /api/reglements  (filtre: resident_id)
router.get('/', async (req, res) => {
  try {
    let q = supabase.from('reglements').select('*').eq('camping_id', req.activeCampingId);
    if (req.query.resident_id) q = q.eq('resident_id', req.query.resident_id);
    const { data, error } = await q.order('date_reglement', { ascending: false });
    if (error) throw error;
    res.json({ reglements: data });
  } catch (e) { console.error('[reglements:list]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/reglements  { resident_id?, mode, montant, date_reglement?, reference?, statut_cheque?, affectations?[] }
// Si affectations absentes et resident_id fourni -> lettrage auto (plus anciennes factures d'abord).
router.post('/', requirePerm('encaisser'), async (req, res) => {
  try {
    const { resident_id, mode, montant, date_reglement, reference, statut_cheque } = req.body || {};
    if (!mode || montant == null) return res.status(400).json({ error: 'mode et montant requis' });

    let affectations = Array.isArray(req.body.affectations) ? req.body.affectations : null;
    if (!affectations && resident_id) affectations = await autoAffectations(req.activeCampingId, resident_id, montant);
    affectations = affectations || [];

    const { data: reglement, error } = await supabase.from('reglements').insert({
      camping_id: req.activeCampingId, resident_id: resident_id || null, mode, montant,
      date_reglement: date_reglement || new Date().toISOString().slice(0, 10),
      reference: reference || null, statut_cheque: statut_cheque || null, affectations,
      auteur_id: req.user.uid,
    }).select().single();
    if (error) throw error;

    for (const a of affectations) await recomputeFacture(req.activeCampingId, a.facture_id);

    await writeAudit(req, { action: 'create', entite: 'reglements', entite_id: reglement.id,
      apres: { mode, montant, affectations: affectations.length } });
    res.status(201).json({ reglement });
  } catch (e) { console.error('[reglements:create]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// PUT /api/reglements/:id/statut-cheque  { statut_cheque }
router.put('/:id/statut-cheque', requirePerm('encaisser'), async (req, res) => {
  try {
    const { statut_cheque } = req.body || {};
    if (!['recu', 'remis', 'encaisse'].includes(statut_cheque)) return res.status(400).json({ error: 'statut_cheque invalide' });
    const { data, error } = await supabase.from('reglements').update({ statut_cheque })
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).select().single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Règlement introuvable' });
    res.json({ reglement: data });
  } catch (e) { console.error('[reglements:cheque]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// DELETE /api/reglements/:id  (admin) -> recalcule les factures affectées
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const { data: reg } = await supabase.from('reglements').select('*')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).maybeSingle();
    if (!reg) return res.status(404).json({ error: 'Règlement introuvable' });
    await supabase.from('reglements').delete().eq('camping_id', req.activeCampingId).eq('id', req.params.id);
    for (const a of (reg.affectations || [])) await recomputeFacture(req.activeCampingId, a.facture_id);
    await writeAudit(req, { action: 'delete', entite: 'reglements', entite_id: reg.id, avant: { mode: reg.mode, montant: reg.montant } });
    res.json({ ok: true });
  } catch (e) { console.error('[reglements:delete]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/reglements/facture/:id/lien-paiement  -> crée une session Stripe Checkout
router.post('/facture/:id/lien-paiement', requirePerm('encaisser'), async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) return res.status(400).json({ error: 'Stripe non configuré (STRIPE_SECRET_KEY manquant)' });
    const { data: f } = await supabase.from('factures').select('*')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).maybeSingle();
    if (!f) return res.status(404).json({ error: 'Facture introuvable' });
    const reste = Math.round((Number(f.total_ttc) - Number(f.montant_regle)) * 100) / 100;
    if (reste <= 0) return res.status(400).json({ error: 'Facture déjà réglée' });

    const base = process.env.PUBLIC_APP_URL || `https://${req.headers.host}`;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price_data: { currency: 'eur', product_data: { name: `Facture ${f.numero}` }, unit_amount: Math.round(reste * 100) }, quantity: 1 }],
      metadata: { camping_id: req.activeCampingId, facture_id: f.id, resident_id: f.resident_id || '' },
      success_url: `${base}/paiement-ok`,
      cancel_url: `${base}/paiement-annule`,
    });
    await writeAudit(req, { action: 'create', entite: 'stripe_session', entite_id: session.id, apres: { facture: f.numero, montant: reste } });
    res.json({ url: session.url });
  } catch (e) { console.error('[reglements:lien]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;

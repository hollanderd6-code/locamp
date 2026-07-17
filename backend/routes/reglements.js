const express = require('express');
const { supabase } = require('../lib/supabase');
const { writeAudit } = require('../lib/audit');
const { inscrireReglement } = require('../lib/fiscal');
const { recomputeFacture, autoAffectations } = require('../lib/paiement');
const { getStripe } = require('../lib/stripe');
const { auth, campingScope, requireRole, requirePerm } = require('../middleware/auth');

const router = express.Router();
router.use(auth, campingScope);

// GET /api/reglements  (filtre: resident_id)
// GET /api/reglements/journal?du=&au=  -> encaissements agrégés par mode de paiement.
router.get('/journal', async (req, res) => {
  try {
    const { du, au } = req.query;
    const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
    let q = supabase.from('reglements').select('mode,montant,date_reglement').eq('camping_id', req.activeCampingId);
    if (du) q = q.gte('date_reglement', du);
    if (au) q = q.lte('date_reglement', au);
    const { data, error } = await q;
    if (error) throw error;
    const { data: moyens } = await supabase.from('moyens_paiement').select('code,libelle').eq('camping_id', req.activeCampingId);
    const lib = {}; (moyens || []).forEach((m) => { lib[m.code] = m.libelle; });

    const parMode = {};
    let tMontant = 0, tNb = 0;
    for (const g of (data || [])) {
      const k = g.mode || '—';
      if (!parMode[k]) parMode[k] = { mode: k, libelle: lib[k] || k, nb: 0, montant: 0 };
      parMode[k].nb += 1; parMode[k].montant += Number(g.montant || 0);
      tNb += 1; tMontant += Number(g.montant || 0);
    }
    const lignes = Object.values(parMode)
      .map((m) => ({ ...m, montant: r2(m.montant) }))
      .sort((a, b) => b.montant - a.montant);
    res.json({ du: du || null, au: au || null, lignes, total: { nb: tNb, montant: r2(tMontant) } });
  } catch (e) { console.error('[reglements:journal]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

router.get('/', async (req, res) => {
  try {
    let q = supabase.from('reglements').select('*').eq('camping_id', req.activeCampingId);
    if (req.query.resident_id) q = q.eq('resident_id', req.query.resident_id);
    if (req.query.debut) q = q.gte('date_reglement', req.query.debut);   // plage exercice (facultatif)
    if (req.query.fin) q = q.lte('date_reglement', req.query.fin);
    const { data, error } = await q.order('date_reglement', { ascending: false });
    if (error) throw error;
    res.json({ reglements: data });
  } catch (e) { console.error('[reglements:list]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/reglements  { resident_id?, mode, montant, date_reglement?, reference?, statut_cheque?, affectations?[] }
// Si affectations absentes et resident_id fourni -> lettrage auto (plus anciennes factures d'abord).
// POST /api/reglements/lettrer  { resident_id } — applique le crédit d'avance aux factures impayées
router.post('/lettrer', requirePerm('encaisser'), async (req, res) => {
  try {
    const residentId = req.body && req.body.resident_id;
    if (!residentId) return res.status(400).json({ error: 'resident_id requis' });
    const { appliquerCredit } = require('../lib/lettrage');
    const r = await appliquerCredit(req.activeCampingId, residentId);
    await writeAudit(req, { action: 'update', entite: 'residents', entite_id: residentId,
      apres: { lettrage: 'credit', factures: r.factures, montant: r.affecte } });
    res.json(r);
  } catch (e) { console.error('[reglements:lettrer]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

router.post('/', requirePerm('encaisser'), async (req, res) => {
  try {
    const { resident_id, mode, montant, date_reglement, reference, statut_cheque } = req.body || {};
    if (!mode || montant == null) return res.status(400).json({ error: 'mode et montant requis' });

    // Le mode doit correspondre à un moyen de paiement actif du camping.
    let moyen = null;
    const { data: moyens } = await supabase.from('moyens_paiement')
      .select('code,libelle,remisable,actif').eq('camping_id', req.activeCampingId).eq('code', mode).maybeSingle()
      .then((r) => r, () => ({ data: null }));
    moyen = moyens || null;
    if (moyen && moyen.actif === false) return res.status(400).json({ error: `Moyen de paiement « ${moyen.libelle} » désactivé` });

    const autoMode = !Array.isArray(req.body.affectations);
    let affectations = autoMode ? null : req.body.affectations;
    if (!affectations && resident_id) affectations = await autoAffectations(req.activeCampingId, resident_id, montant);
    affectations = affectations || [];

    // Un moyen remisable (chèque, ANCV…) entre dans le circuit des remises : statut « reçu ».
    const remisable = moyen ? !!moyen.remisable : mode === 'cheque';
    const statut = statut_cheque || (remisable ? 'recu' : null);

    const { data: reglement, error } = await supabase.from('reglements').insert({
      camping_id: req.activeCampingId, resident_id: resident_id || null, mode, montant,
      date_reglement: date_reglement || new Date().toISOString().slice(0, 10),
      reference: reference || null, statut_cheque: statut, affectations,
      auteur_id: req.user.uid,
    }).select().single();
    if (error) throw error;

    // Inaltérabilité (art. 286-I-3° bis du CGI) : l'encaissement entre dans la chaîne fiscale.
    await inscrireReglement(req.activeCampingId, reglement, req);

    for (const a of affectations) await recomputeFacture(req.activeCampingId, a.facture_id);

    // Balayage auto-réparateur : en encaissement automatique, on lettre tout crédit non
    // affecté restant (ce paiement + avances antérieures bloquées) sur les factures ouvertes,
    // des plus anciennes aux plus récentes. Rend inutile toute affectation manuelle ultérieure.
    // (Ignoré si l'appelant a fourni des affectations explicites : on respecte son intention.)
    if (autoMode && resident_id) {
      try { await require('../lib/lettrage').appliquerCredit(req.activeCampingId, resident_id); }
      catch (e) { console.error('[reglement:auto-lettrage]', e.message); }
    }

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

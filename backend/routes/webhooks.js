const { getStripe } = require('../lib/stripe');
const { supabase } = require('../lib/supabase');
const { recomputeFacture } = require('../lib/paiement');

// Handler du webhook Stripe (monté AVANT express.json, avec express.raw).
async function stripeWebhook(req, res) {
  const stripe = getStripe();
  if (!stripe) return res.status(400).json({ error: 'Stripe non configuré' });
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], whSecret);
  } catch (e) {
    console.error('[stripe webhook] signature invalide:', e.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const s = event.data.object;
    const { camping_id, facture_id, resident_id } = s.metadata || {};
    if (camping_id && facture_id) {
      try {
        const { data: exist } = await supabase.from('reglements').select('id').eq('stripe_session_id', s.id).maybeSingle();
        if (!exist) {
          const montant = Math.round((s.amount_total || 0)) / 100;
          await supabase.from('reglements').insert({
            camping_id, resident_id: resident_id || null, mode: 'stripe', montant,
            reference: s.payment_intent || s.id, affectations: [{ facture_id, montant }], stripe_session_id: s.id,
          });
          await recomputeFacture(camping_id, facture_id);
        }
      } catch (e) { console.error('[stripe webhook] traitement:', e.message); }
    }
  }
  res.json({ received: true });
}

module.exports = { stripeWebhook };

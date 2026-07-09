// Client Stripe optionnel : null si STRIPE_SECRET_KEY absent.
let _stripe = null;
function getStripe() {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  _stripe = require('stripe')(key);
  return _stripe;
}

// Crée une session Stripe Checkout pour le reste dû d'une facture.
// Renvoie { url } ou { error } (ou null si Stripe non configuré).
async function checkoutFacture(facture, campingId, baseUrl) {
  const stripe = getStripe();
  if (!stripe) return null;
  const reste = Math.round((Number(facture.total_ttc) - Number(facture.montant_regle)) * 100) / 100;
  if (reste <= 0) return { error: 'Facture déjà réglée' };
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price_data: { currency: 'eur', product_data: { name: `Facture ${facture.numero}` }, unit_amount: Math.round(reste * 100) }, quantity: 1 }],
    metadata: { camping_id: campingId, facture_id: facture.id, resident_id: facture.resident_id || '' },
    success_url: `${baseUrl}/paiement-ok`,
    cancel_url: `${baseUrl}/paiement-annule`,
  });
  return { url: session.url };
}

module.exports = { getStripe, checkoutFacture };

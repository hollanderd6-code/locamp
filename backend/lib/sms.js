// ============================================================
//  Envoi de SMS via SMSGate (sms-gate.app)
//
//  Variables d'environnement attendues :
//    SMSGATE_URL       (optionnel, défaut : API cloud officielle)
//    SMSGATE_USER      identifiant
//    SMSGATE_PASSWORD  mot de passe
//
//  Non configuré -> { skipped: true } (jamais d'exception vers l'appelant).
// ============================================================

const URL_DEFAUT = 'https://api.sms-gate.app/3rdparty/v1/message';

// Normalise un numéro français au format international E.164 (+33…).
// SMSGate exige un numéro international ; un « 06… » brut serait rejeté.
function normaliserNumero(tel) {
  if (!tel) return null;
  let n = String(tel).replace(/[\s.\-()]/g, '');
  if (n.startsWith('+')) return n;
  if (n.startsWith('00')) return `+${n.slice(2)}`;
  if (/^0[1-9]\d{8}$/.test(n)) return `+33${n.slice(1)}`;   // 0612345678 -> +33612345678
  if (/^[1-9]\d{8}$/.test(n)) return `+33${n}`;             // 612345678  -> +33612345678
  return n.startsWith('+') ? n : `+${n}`;
}

async function sendSms(telephone, message) {
  const user = process.env.SMSGATE_USER;
  const pass = process.env.SMSGATE_PASSWORD;
  const url = process.env.SMSGATE_URL || URL_DEFAUT;

  const numero = normaliserNumero(telephone);
  if (!numero) return { error: 'Numéro de téléphone invalide' };

  if (!user || !pass) {
    console.log('[sms] non configuré — simulation :', numero, '/', message.slice(0, 40));
    return { skipped: true };
  }

  try {
    const auth = Buffer.from(`${user}:${pass}`).toString('base64');
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, phoneNumbers: [numero] }),
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      console.error(`[sms] SMSGate ${r.status}:`, txt.slice(0, 200));
      return { error: `Envoi SMS impossible (${r.status})` };
    }
    console.log('[sms] envoyé à', numero.replace(/\d(?=\d{2})/g, '•'));   // numéro masqué dans les logs
    return { sent: true, numero };
  } catch (e) {
    console.error('[sms] échec :', e.message);
    return { error: 'Service SMS injoignable' };
  }
}

module.exports = { sendSms, normaliserNumero };

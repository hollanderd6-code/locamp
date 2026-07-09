// Envoi d'e-mail via Brevo. Si non configuré, simule (log) sans erreur.
async function sendEmail({ to, subject, html, sender }) {
  const key = process.env.BREVO_API_KEY;
  const senderEmail = (sender && sender.email) || process.env.BREVO_SENDER_EMAIL;
  const senderName = (sender && sender.name) || process.env.BREVO_SENDER_NAME || 'Locamp';
  if (!key || !senderEmail) {
    console.log('[email] non configuré — simulation :', to, '/', subject);
    return { skipped: true };
  }
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': key, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender: { email: senderEmail, name: senderName }, to: [{ email: to }], subject, htmlContent: html }),
  });
  if (!r.ok) throw new Error(`Brevo ${r.status}: ${await r.text()}`);
  return { sent: true };
}
module.exports = { sendEmail };

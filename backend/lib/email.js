// Envoi d'e-mail via Brevo. Si non configuré, simule (log) sans erreur.
// attachments: [{ name, content }] où content est un Buffer ou une chaîne base64.
async function sendEmail({ to, subject, html, sender, attachments }) {
  const key = process.env.BREVO_API_KEY;
  const senderEmail = (sender && sender.email) || process.env.BREVO_SENDER_EMAIL;
  const senderName = (sender && sender.name) || process.env.BREVO_SENDER_NAME || 'Locamp';
  if (!key || !senderEmail) {
    console.log('[email] non configuré — simulation :', to, '/', subject);
    return { skipped: true };
  }
  // Désactive la réécriture des liens par Brevo (le suivi des clics transforme
  // les liens à jeton, ex. signature ?jeton=..., en liens sendibt* qui tronquent
  // le jeton -> 404). On coupe le tracking à plusieurs niveaux car, selon les
  // comptes, l'API n'honore pas toujours le même champ :
  const payload = {
    sender: { email: senderEmail, name: senderName },
    to: [{ email: to }],
    subject,
    htmlContent: html,
    disableClickTracking: true,
    headers: { 'X-Mailin-custom': 'click_tracking:false', 'X-Mailin-Track-Clicks': '0' },
  };
  if (Array.isArray(attachments) && attachments.length) {
    payload.attachment = attachments.map((a) => ({
      name: a.name,
      content: Buffer.isBuffer(a.content) ? a.content.toString('base64') : a.content,
    }));
  }
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': key, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`Brevo ${r.status}: ${await r.text()}`);
  return { sent: true };
}
module.exports = { sendEmail };

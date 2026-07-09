const { supabase } = require('./supabase');

// Écrit une entrée dans le journal d'audit (table append-only).
// Ne bloque jamais la requête principale : en cas d'échec, on log sans throw.
async function writeAudit(req, {
  action,
  entite = null,
  entite_id = null,
  avant = null,
  apres = null,
  camping_id = null,
}) {
  try {
    await supabase.from('audit_log').insert({
      camping_id: camping_id || req?.activeCampingId || null,
      auteur_id: req?.user?.uid || null,
      auteur_email: req?.user?.email || null,
      action,
      entite,
      entite_id: entite_id != null ? String(entite_id) : null,
      avant,
      apres,
      ip: req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req?.ip || null,
    });
  } catch (e) {
    console.error('[audit] échec écriture:', e.message);
  }
}

module.exports = { writeAudit };

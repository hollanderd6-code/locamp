// Client Supabase avec la clé SERVICE_ROLE (backend de confiance).
// Cette clé bypasse la RLS : le filtrage par camping_id est fait en code applicatif.
// NE JAMAIS exposer cette clé côté client / front.
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('[config] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants dans l\'environnement');
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

module.exports = { supabase };

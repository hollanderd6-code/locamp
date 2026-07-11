// Faux client Supabase minimal pour tester la logique métier sans vraie base.
// Supporte : from().select().eq().in().order().contains().maybeSingle()/then, update().eq().
function makeSupabaseMock(store) {
  function query(table) {
    let rows = [...(store[table] || [])];
    const api = {
      select() { return api; },
      eq(k, v) { rows = rows.filter((r) => r[k] === v); return api; },
      in(k, vals) { rows = rows.filter((r) => vals.includes(r[k])); return api; },
      is(k, v) { rows = rows.filter((r) => (v === null ? r[k] == null : r[k] === v)); return api; },
      gte(k, v) { rows = rows.filter((r) => String(r[k]) >= String(v)); return api; },
      lte(k, v) { rows = rows.filter((r) => String(r[k]) <= String(v)); return api; },
      order(k, opts) { const asc = !opts || opts.ascending !== false; rows.sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (asc ? 1 : -1)); return api; },
      contains(k, val) { // jsonb contains [{facture_id}]
        const needle = val[0];
        rows = rows.filter((r) => Array.isArray(r[k]) && r[k].some((x) => Object.entries(needle).every(([kk, vv]) => x[kk] === vv)));
        return api;
      },
      maybeSingle() { return Promise.resolve({ data: rows[0] || null, error: null }); },
      single() { return Promise.resolve({ data: rows[0] || null, error: null }); },
      then(res) { return Promise.resolve({ data: rows, error: null }).then(res); },
      update(patch) {
        const targets = rows;
        return {
          eq(k, v) { (store[table] || []).filter((r) => r[k] === v && targets.includes(r)).forEach((r) => Object.assign(r, patch)); return { then: (res) => Promise.resolve({ data: null, error: null }).then(res) }; },
        };
      },
    };
    return api;
  }
  return { from: query, rpc: () => Promise.resolve({ data: 1, error: null }) };
}
module.exports = { makeSupabaseMock };

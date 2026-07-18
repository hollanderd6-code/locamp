/* ============================================================================
   MODÈLE de pilote « Plateforme Agréée » RÉEL (à dupliquer et remplir).

   Copier ce fichier en `drivers/<ma-pa>.js`, remplir les zones TODO avec les
   endpoints réels de la plateforme choisie, puis l'enregistrer dans index.js :
       register(require('./drivers/<ma-pa>'));
   Le reste de Locamp n'a RIEN à changer : il ne connaît que ce contrat.

   Contrat (voir lib/efacture/index.js) :
     connect(ctx, config) -> { statut, adresse_routage, message, config_public, secrets }
     status(ctx)          -> { statut, adresse_routage, message }
     emettre(ctx, facture, facturx) -> { doc_externe_id, statut, format }
     recevoir(ctx)        -> [ { doc_externe_id, emetteur_nom, emetteur_siren, numero,
                                 date_facture, total_ht, total_tva, total_ttc, devise, format, payload } ]
     ereporting(ctx, lot) -> { doc_externe_id, statut }
     notifierStatut(ctx, doc) -> void
     disconnect(ctx)      -> void
   ========================================================================== */

const sirenDe = (v) => { const x = String(v || '').replace(/\D/g, ''); return x ? x.slice(0, 9) : ''; };

// Appel HTTP générique authentifié. Adapte l'auth (clé API vs OAuth Bearer) à ta PA.
async function appel(cx, chemin, { method = 'GET', body = null, headers = {} } = {}) {
  const base = (cx && cx.config && cx.config.base_url) || 'https://api.exemple-pa.fr';
  const cle = (cx && cx.config && cx.config.cle_api) || '';
  const res = await fetch(base.replace(/\/$/, '') + chemin, {
    method,
    headers: {
      'Authorization': `Bearer ${cle}`,          // TODO: ou 'X-API-Key', ou OAuth
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
  const txt = await res.text();
  let data; try { data = txt ? JSON.parse(txt) : {}; } catch (_) { data = { raw: txt }; }
  if (!res.ok) throw new Error(data.message || data.error || `PA a répondu ${res.status}`);
  return data;
}

module.exports = {
  code: 'modele-reel',                 // TODO: identifiant stable, ex: 'b2brouter'
  nom: 'Modèle PA (à configurer)',      // TODO: nom affiché
  description: 'Squelette de pilote pour une vraie plateforme agréée — à compléter avec son API.',
  champs_config: [
    { cle: 'base_url', libelle: 'URL de l’API', type: 'text', secret: false, requis: true },
    { cle: 'cle_api', libelle: 'Clé API / token', type: 'password', secret: true, requis: true },
    // TODO: pour OAuth, remplacer par client_id / client_secret.
  ],

  async connect(ctx, config = {}) {
    const cx = { ...ctx, config: { ...(ctx.connexion && ctx.connexion.config), ...config } };
    // TODO: vérifier les identifiants (ex: GET /me) et récupérer/valider l'adresse de routage.
    // const me = await appel(cx, '/v1/account');
    const siren = sirenDe((ctx.camping.parametres || {}).siret || (ctx.camping.parametres || {}).siren);
    return {
      statut: 'connectee',
      adresse_routage: siren || null,     // TODO: souvent renvoyé par la PA (adresse annuaire)
      message: 'Connexion établie.',
      config_public: { base_url: config.base_url },
      secrets: config.cle_api ? { cle_api: config.cle_api, base_url: config.base_url } : null,
    };
  },

  async status(ctx) {
    const c = ctx.connexion;
    if (!c) return { statut: 'deconnecte', adresse_routage: null, message: 'Aucune connexion.' };
    try {
      // await appel(ctx, '/v1/health');       // TODO: ping léger
      return { statut: 'connectee', adresse_routage: c.adresse_routage, message: 'OK.' };
    } catch (e) {
      return { statut: 'erreur', adresse_routage: c.adresse_routage, message: e.message };
    }
  },

  async emettre(ctx, facture, facturx) {
    // facturx = Buffer du PDF/A-3 (Factur-X) fourni par lib/efacture/facturx.js.
    // TODO: POST du document à la PA (souvent multipart ou base64).
    // const r = await appel(ctx, '/v1/invoices', { method: 'POST', body: {
    //   format: 'facturx', content_base64: Buffer.from(facturx).toString('base64'),
    // }});
    // return { doc_externe_id: r.id, statut: r.status || 'deposee', format: 'factur-x' };
    void facturx;
    return { doc_externe_id: `TODO-${facture.id}`, statut: 'deposee', format: 'factur-x' };
  },

  async recevoir(ctx) {
    // TODO: GET des factures entrantes non encore importées.
    // const r = await appel(ctx, '/v1/invoices/received?status=new');
    // return (r.items || []).map((d) => ({
    //   doc_externe_id: d.id, emetteur_nom: d.supplier_name, emetteur_siren: d.supplier_siren,
    //   numero: d.number, date_facture: d.issue_date,
    //   total_ht: d.total_excl_tax, total_tva: d.total_tax, total_ttc: d.total_incl_tax,
    //   devise: d.currency || 'EUR', format: d.format, payload: d,
    // }));
    void ctx;
    return [];
  },

  async ereporting(ctx, lot) {
    // TODO: POST des données de transaction/encaissement B2C agrégées.
    // const r = await appel(ctx, '/v1/ereporting', { method: 'POST', body: lot });
    // return { doc_externe_id: r.id, statut: r.status || 'transmis' };
    void lot;
    return { doc_externe_id: `TODO-erep-${Date.now()}`, statut: 'transmis' };
  },

  async notifierStatut(ctx, doc) {
    // TODO: renvoyer à l'émetteur le statut posé côté acheteur (accepté / refusé…).
    // await appel(ctx, `/v1/invoices/received/${doc.doc_externe_id}/status`, {
    //   method: 'POST', body: { status: doc.statut, reason: doc.motif || undefined },
    // });
    void ctx; void doc;
  },

  async disconnect(/* ctx */) { /* TODO: révoquer le token si l'API le permet */ },
};

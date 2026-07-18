/* ============================================================================
   Pilote « Plateforme Agréée » : PENNYLANE (API externe v2).

   Modèle d'intégration : chaque camping possède un compte Pennylane. Locamp y
   POUSSE ses factures (import e-invoice) ; Pennylane, en tant que plateforme
   agréée, assure la transmission réglementaire et l'e-reporting. Locamp LIT les
   factures fournisseurs reçues dans Pennylane.

   Auth : Bearer token « Company API » (Paramètres → Développeurs dans Pennylane).
   Suffisant en bac à sable et pour un compte unique. Pour une intégration
   multi-campings en PRODUCTION publiée sur la marketplace, Pennylane impose
   OAuth 2.0 — à mettre en place le moment venu (le contrat de ce pilote ne change pas).

   Scopes requis : e_invoices:all (import), customer_invoices:all / supplier_invoices
   (lecture). Endpoint d'import : BETA côté Pennylane — susceptible d'évoluer.
   Réf. : https://pennylane.readme.io (v2).
   ========================================================================== */

const BASE = 'https://app.pennylane.com/api/external/v2';
const sirenDe = (v) => { const x = String(v || '').replace(/\D/g, ''); return x ? x.slice(0, 9) : ''; };

function token(cx) { return (cx && cx.config && cx.config.cle_api) || ''; }

// Appel JSON authentifié.
async function appel(cx, chemin, { method = 'GET', body = null, headers = {} } = {}) {
  const res = await fetch(BASE + chemin, {
    method,
    headers: { Authorization: `Bearer ${token(cx)}`, 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  let data; try { data = txt ? JSON.parse(txt) : {}; } catch (_) { data = { raw: txt }; }
  if (res.status === 401) throw new Error('Token Pennylane invalide ou expiré.');
  if (res.status === 403) throw new Error('Scopes Pennylane insuffisants (e_invoices:all, customer/supplier_invoices).');
  if (res.status === 429) throw new Error('Trop de requêtes Pennylane (5/s) — réessayez.');
  if (!res.ok) throw new Error(data.message || data.error || `Pennylane a répondu ${res.status}`);
  return data;
}

module.exports = {
  code: 'pennylane',
  nom: 'Pennylane',
  description: "Plateforme agréée Pennylane (API externe v2). Locamp pousse les factures ; "
    + "Pennylane assure la transmission et l'e-reporting.",
  champs_config: [
    { cle: 'cle_api', libelle: 'Token API Pennylane (Company)', type: 'password', secret: true, requis: true },
  ],

  async connect(ctx, config = {}) {
    const cx = { config: { ...(ctx.connexion && ctx.connexion.config), ...config } };
    // Vérifie le token via un appel léger (liste 1 facture). 401/403 => message clair.
    await appel(cx, '/supplier_invoices?limit=1');
    const siren = sirenDe((ctx.camping.parametres || {}).siret || (ctx.camping.parametres || {}).siren);
    return {
      statut: 'connectee',
      adresse_routage: siren || null,
      message: 'Compte Pennylane connecté.',
      config_public: {},
      secrets: { cle_api: config.cle_api },
    };
  },

  async status(ctx) {
    const c = ctx.connexion;
    if (!c) return { statut: 'deconnecte', adresse_routage: null, message: 'Aucune connexion.' };
    try {
      await appel(ctx, '/supplier_invoices?limit=1');
      return { statut: 'connectee', adresse_routage: c.adresse_routage, message: 'OK.' };
    } catch (e) {
      return { statut: 'erreur', adresse_routage: c.adresse_routage, message: e.message };
    }
  },

  // Émission : on envoie le Factur-X (PDF/A-3 déjà généré) à l'import e-invoice.
  async emettre(ctx, facture, facturx) {
    if (!facturx) throw new Error('Factur-X manquant pour l’émission.');
    const fd = new FormData();
    fd.append('file', new Blob([facturx], { type: 'application/pdf' }), `facturx-${facture.numero || facture.id}.pdf`);
    fd.append('type', 'customer');
    const res = await fetch(`${BASE}/e-invoices/imports`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token(ctx)}` },   // pas de Content-Type : le boundary multipart est posé par fetch
      body: fd,
    });
    const txt = await res.text();
    let data; try { data = txt ? JSON.parse(txt) : {}; } catch (_) { data = { raw: txt }; }
    if (!res.ok) throw new Error(data.message || data.error || `Import Pennylane a répondu ${res.status}`);
    const id = String(data.url || '').split('/').pop() || null;   // .../customer_invoices/12345
    return { doc_externe_id: id, statut: 'deposee', format: 'factur-x' };
  },

  // Réception : lecture des factures fournisseurs présentes dans Pennylane.
  async recevoir(ctx) {
    const data = await appel(ctx, '/supplier_invoices?limit=50');
    const items = data.items || data.supplier_invoices || [];
    return items.map((d) => {
      // Mapping défensif : les noms de champs Pennylane peuvent varier — on garde le brut dans payload.
      const four = d.supplier || d.company_supplier || {};
      return {
        doc_externe_id: String(d.id),
        emetteur_nom: four.name || d.supplier_name || null,
        emetteur_siren: sirenDe(four.registration_number || four.siren || four.siret) || null,
        numero: d.invoice_number || d.number || null,
        date_facture: d.date || d.invoice_date || null,
        total_ht: d.amount != null ? Number(d.amount) : (d.currency_amount != null ? Number(d.currency_amount) : null),
        total_tva: d.tax != null ? Number(d.tax) : (d.currency_tax != null ? Number(d.currency_tax) : null),
        total_ttc: d.amount_with_tax != null ? Number(d.amount_with_tax) : (d.total != null ? Number(d.total) : null),
        devise: d.currency || 'EUR',
        format: 'pennylane',
        payload: d,
      };
    });
  },

  // E-reporting : géré par Pennylane à partir des factures synchronisées (rien à pousser ici).
  // NB : pour que Pennylane e-reporte le B2C, les factures aux particuliers doivent aussi
  // être synchronisées dans Pennylane (import e-invoice type=customer).
  async ereporting(/* ctx, lot */) {
    return { doc_externe_id: null, statut: 'gere_par_pennylane' };
  },

  // Statut renvoyé à l'émetteur (accepté/refusé) — endpoint à confirmer dans la doc Pennylane.
  async notifierStatut(/* ctx, doc */) {
    // TODO Pennylane : poser le statut d'une facture fournisseur (accept/refus) via l'API.
  },

  async disconnect(/* ctx */) { /* le token se révoque dans Pennylane (Paramètres → Développeurs) */ },
};

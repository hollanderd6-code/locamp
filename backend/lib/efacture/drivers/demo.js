/* ============================================================================
   Pilote PA "démo" (bac à sable).

   Implémente le contrat complet SANS appeler de vraie plateforme : il simule la
   connexion, l'émission, la réception et l'e-reporting. Objectif : permettre de
   développer et tester tout le parcours dans Locamp avant de brancher une vraie
   Plateforme Agréée. Aucune donnée ne quitte le serveur.
   ========================================================================== */

// Cycle de vie standard d'une facture électronique (statuts DGFiP simplifiés).
const CYCLE = ['deposee', 'recue_par_pa', 'mise_a_disposition', 'approuvee', 'encaissee'];

function sirenDe(camping) {
  const p = camping && camping.parametres ? camping.parametres : {};
  const raw = p.siret || p.siren || '';
  const digits = String(raw).replace(/\D/g, '');
  return digits ? digits.slice(0, 9) : null;
}

module.exports = {
  code: 'demo',
  nom: 'Bac à sable (démo)',
  description:
    "Plateforme simulée, sans transmission réelle. Sert à tester le parcours "
    + "complet dans Locamp avant de connecter une vraie plateforme agréée.",
  champs_config: [
    { cle: 'compte', libelle: 'Nom du compte (optionnel)', type: 'text', secret: false, requis: false },
    { cle: 'cle_api', libelle: 'Clé API (fictive en démo)', type: 'password', secret: true, requis: false },
  ],

  async connect(ctx, config = {}) {
    const siren = sirenDe(ctx.camping);
    return {
      statut: 'connecte',
      adresse_routage: siren || 'SIREN-non-renseigne',
      message: siren
        ? 'Connexion simulée réussie.'
        : "Connexion simulée — renseignez le SIRET du camping (Identité) pour l'adresse de routage.",
      config_public: { compte: config.compte || 'demo' },
      secrets: config.cle_api ? { cle_api: config.cle_api } : null,
    };
  },

  async status(ctx) {
    const c = ctx.connexion;
    if (!c) return { statut: 'deconnecte', adresse_routage: null, message: 'Aucune connexion.' };
    return { statut: c.statut, adresse_routage: c.adresse_routage, message: c.message || 'OK (démo).' };
  },

  async emettre(ctx, facture /*, facturx */) {
    return {
      doc_externe_id: 'demo-' + (facture && facture.id ? String(facture.id).slice(0, 8) : Date.now()),
      statut: 'deposee',
      format: 'factur-x',
    };
  },

  // Fait avancer un flux au statut suivant (utile pour simuler le cycle de vie).
  statutSuivant(courant) {
    const i = CYCLE.indexOf(courant);
    return i < 0 ? CYCLE[0] : CYCLE[Math.min(i + 1, CYCLE.length - 1)];
  },

  async recevoir(/* ctx */) {
    return []; // en démo, pas de factures fournisseurs entrantes
  },

  async ereporting(ctx, lot = {}) {
    return {
      doc_externe_id: 'demo-erep-' + Date.now(),
      statut: 'transmis',
      resume: { nb: lot.nb || 0, total_ttc: lot.total_ttc || 0 },
    };
  },

  async disconnect(/* ctx */) { /* rien à faire en démo */ },

  CYCLE,
};

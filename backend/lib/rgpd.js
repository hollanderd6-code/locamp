const { supabase } = require('./supabase');
const { BUCKET } = require('./storage');

/* ============================================================
   Conformité RGPD

   Point clé : le droit à l'effacement (art. 17) ne s'applique pas lorsque le
   traitement est nécessaire au respect d'une obligation légale (art. 17.3.b).
   Les factures, encaissements et le journal fiscal doivent être conservés
   (10 ans en comptabilité, 6 ans en fiscalité) et sont, chez nous,
   techniquement inaltérables.

   => « Effacer » un résident = ANONYMISER : on purge l'identité, les contacts,
      les documents et les messages ; on conserve les pièces comptables,
      rattachées à un identifiant technique non nominatif.
   ============================================================ */

const ANONYME = 'Résident anonymisé';

/** Durées de conservation par défaut (surchargeables : parametres.rgpd). */
const DUREES_DEFAUT = {
  resident_inactif_ans: 3,      // après départ, avant anonymisation
  pieces_comptables_ans: 10,    // obligation légale (Code de commerce)
  donnees_fiscales_ans: 6,      // obligation légale (LPF)
  messages_ans: 3,
  journal_audit_ans: 6,
  documents_ans: 5,
};

/**
 * Export complet des données d'un résident (art. 15 accès / art. 20 portabilité).
 * Format structuré, lisible et réutilisable.
 */
async function exporterDonnees(campingId, residentId) {
  const [res, emp, fact, regl, pres, docs, msgs, contrats] = await Promise.all([
    supabase.from('residents').select('*').eq('camping_id', campingId).eq('id', residentId).maybeSingle(),
    supabase.from('emplacements').select('numero,secteur,type').eq('camping_id', campingId),
    supabase.from('factures').select('numero,date_emission,periode,statut,total_ht,total_tva,total_ttc,montant_regle,lignes')
      .eq('camping_id', campingId).eq('resident_id', residentId).order('date_emission'),
    supabase.from('reglements').select('date_reglement,mode,montant,reference')
      .eq('camping_id', campingId).eq('resident_id', residentId).order('date_reglement'),
    supabase.from('prestations').select('type,designation,date_debut,date_fin,montant_ttc,statut')
      .eq('camping_id', campingId).eq('resident_id', residentId).order('date_debut')
      .then((r) => r, () => ({ data: [] })),
    supabase.from('documents').select('type,nom_fichier,created_at')
      .eq('camping_id', campingId).eq('resident_id', residentId),
    supabase.from('messages').select('auteur,corps,created_at')
      .eq('camping_id', campingId).eq('resident_id', residentId).order('created_at')
      .then((r) => r, () => ({ data: [] })),
    supabase.from('contrats').select('numero,date_debut,date_fin,statut,montant_mensuel')
      .eq('camping_id', campingId).eq('resident_id', residentId)
      .then((r) => r, () => ({ data: [] })),
  ]);

  const r = res.data;
  if (!r) return null;

  const emplacement = (emp.data || []).find((e) => e.id === r.emplacement_id) || null;

  return {
    document: 'Export de vos données personnelles',
    base_legale: 'Articles 15 (droit d\u2019accès) et 20 (droit à la portabilité) du RGPD',
    genere_le: new Date().toISOString(),
    identite: {
      civilite: r.civilite, nom: r.nom, prenom: r.prenom,
      date_naissance: r.date_naissance, nationalite: r.nationalite,
      email: r.email, telephone: r.telephone, adresse: r.adresse,
      foyer: r.foyer, actif: r.actif,
      cree_le: r.created_at,
      anonymise_le: r.anonymise_at || null,
    },
    emplacement,
    contrats: contrats.data || [],
    prestations: pres.data || [],
    factures: fact.data || [],
    reglements: regl.data || [],
    documents: (docs.data || []).map((d) => ({ type: d.type, nom: d.nom_fichier, depose_le: d.created_at })),
    messages: msgs.data || [],
    information: 'Les données de facturation et d\u2019encaissement sont conservées au titre '
      + 'des obligations légales de conservation comptable (10 ans) et fiscale (6 ans), '
      + 'conformément à l\u2019article 17.3.b du RGPD.',
  };
}

/**
 * Anonymisation d'un résident (droit à l'effacement, art. 17).
 * Purge l'identité, les contacts, les documents et les messages.
 * CONSERVE les factures, encaissements et le journal fiscal (obligation légale).
 */
async function anonymiserResident(campingId, residentId, req) {
  const { data: r } = await supabase.from('residents').select('id,nom,prenom,anonymise_at')
    .eq('camping_id', campingId).eq('id', residentId).maybeSingle();
  if (!r) return { error: 'introuvable' };
  if (r.anonymise_at) return { deja: true };

  const suffixe = residentId.slice(0, 8).toUpperCase();

  // 1. Identité et contacts
  const { error } = await supabase.from('residents').update({
    civilite: null,
    nom: `${ANONYME} ${suffixe}`,
    prenom: null,
    date_naissance: null,
    nationalite: null,
    email: null,
    telephone: null,
    adresse: null,
    foyer: {},
    notes_internes: null,
    emplacement_id: null,
    actif: false,
    anonymise_at: new Date().toISOString(),
    anonymise_par: req?.user?.uid || null,
    updated_at: new Date().toISOString(),
  }).eq('camping_id', campingId).eq('id', residentId);
  if (error) throw error;

  // 2. Documents (pièces d'identité, justificatifs) — supprimés du stockage
  let docsSupprimes = 0;
  const { data: docs } = await supabase.from('documents').select('id,storage_path')
    .eq('camping_id', campingId).eq('resident_id', residentId);
  for (const d of (docs || [])) {
    try {
      if (d.storage_path) await supabase.storage.from(BUCKET).remove([d.storage_path]);
      await supabase.from('documents').delete().eq('id', d.id);
      docsSupprimes += 1;
    } catch (e) { console.error('[rgpd:doc]', e.message); }
  }

  // 3. Messages (contenu conversationnel, non comptable)
  let msgsSupprimes = 0;
  try {
    const { count } = await supabase.from('messages').select('id', { count: 'exact', head: true })
      .eq('camping_id', campingId).eq('resident_id', residentId);
    await supabase.from('messages').delete().eq('camping_id', campingId).eq('resident_id', residentId);
    msgsSupprimes = count || 0;
  } catch (e) { console.error('[rgpd:messages]', e.message); }

  // 4. Les factures/règlements/journal fiscal sont CONSERVÉS (obligation légale).
  const [{ count: nbFact }, { count: nbRegl }] = await Promise.all([
    supabase.from('factures').select('id', { count: 'exact', head: true })
      .eq('camping_id', campingId).eq('resident_id', residentId),
    supabase.from('reglements').select('id', { count: 'exact', head: true })
      .eq('camping_id', campingId).eq('resident_id', residentId),
  ]);

  return {
    anonymise: true,
    nom_precedent: `${r.prenom || ''} ${r.nom}`.trim(),
    documents_supprimes: docsSupprimes,
    messages_supprimes: msgsSupprimes,
    pieces_conservees: { factures: nbFact || 0, reglements: nbRegl || 0 },
  };
}

/** Résidents inactifs au-delà de la durée de conservation : candidats à l'anonymisation. */
async function candidatsPurge(campingId) {
  const { data: camp } = await supabase.from('campings').select('parametres').eq('id', campingId).maybeSingle();
  const durees = { ...DUREES_DEFAUT, ...((camp?.parametres || {}).rgpd?.durees || {}) };
  const limite = new Date();
  limite.setFullYear(limite.getFullYear() - Number(durees.resident_inactif_ans || 3));
  const limiteISO = limite.toISOString();

  const { data } = await supabase.from('residents')
    .select('id,nom,prenom,updated_at,actif,anonymise_at')
    .eq('camping_id', campingId).eq('actif', false).is('anonymise_at', null)
    .lt('updated_at', limiteISO);

  return {
    durees,
    seuil: limiteISO.slice(0, 10),
    candidats: (data || []).map((r) => ({
      id: r.id, nom: `${r.prenom || ''} ${r.nom}`.trim(), inactif_depuis: r.updated_at,
    })),
  };
}

/** Registre des traitements (art. 30 du RGPD). */
function registreTraitements(camping) {
  const p = camping?.parametres || {};
  const rgpd = p.rgpd || {};
  const durees = { ...DUREES_DEFAUT, ...(rgpd.durees || {}) };
  const nom = camping?.raison_sociale || camping?.nom || '—';

  return {
    responsable: {
      organisme: nom,
      siret: camping?.siret || '—',
      adresse: camping?.adresse || '—',
      contact: rgpd.contact || camping?.email || '—',
      dpo: rgpd.dpo || 'Non désigné (non obligatoire — pas de traitement à grande échelle de données sensibles)',
    },
    traitements: [
      {
        nom: 'Gestion locative des résidents',
        finalite: 'Gestion des contrats de location d\u2019emplacement, de l\u2019occupation et de la relation client',
        base_legale: 'Exécution du contrat (art. 6.1.b du RGPD)',
        personnes: 'Résidents et occupants du camping',
        donnees: 'Identité, coordonnées, date de naissance, nationalité, composition du foyer, emplacement',
        destinataires: 'Personnel autorisé du camping (droits par utilisateur)',
        conservation: `Durée du contrat, puis ${durees.resident_inactif_ans} ans après le départ (anonymisation ensuite)`,
        securite: 'Authentification individuelle, droits par utilisateur et par établissement, journal d\u2019audit, chiffrement en transit (TLS) et au repos',
      },
      {
        nom: 'Facturation et encaissements',
        finalite: 'Établissement des factures, suivi des règlements, recouvrement, comptabilité',
        base_legale: 'Exécution du contrat et obligation légale (art. 6.1.b et 6.1.c)',
        personnes: 'Résidents',
        donnees: 'Identité, montants facturés et réglés, moyens de paiement, historique',
        destinataires: 'Personnel autorisé, expert-comptable, administration fiscale sur demande',
        conservation: `${durees.pieces_comptables_ans} ans (Code de commerce, art. L123-22) ; ${durees.donnees_fiscales_ans} ans (LPF, art. L102 B)`,
        securite: 'Journal fiscal inaltérable chaîné par empreinte SHA-256 (art. 286-I-3° bis du CGI)',
      },
      {
        nom: 'Taxe de séjour',
        finalite: 'Collecte, déclaration et reversement de la taxe de séjour',
        base_legale: 'Obligation légale (art. L2333-29 et suivants du CGCT)',
        personnes: 'Résidents et occupants',
        donnees: 'Nombre de personnes, nuitées, périodes de séjour, montants',
        destinataires: 'Collectivité percevant la taxe',
        conservation: `${durees.donnees_fiscales_ans} ans`,
        securite: 'Accès restreint aux profils comptables',
      },
      {
        nom: 'Portail locataire et messagerie',
        finalite: 'Mise à disposition des factures, échanges avec le camping',
        base_legale: 'Exécution du contrat (art. 6.1.b)',
        personnes: 'Résidents',
        donnees: 'Adresse e-mail, messages échangés, connexions',
        destinataires: 'Personnel autorisé du camping',
        conservation: `${durees.messages_ans} ans`,
        securite: 'Connexion par lien à usage unique et durée limitée, aucun mot de passe stocké',
      },
      {
        nom: 'Journalisation et sécurité',
        finalite: 'Traçabilité des opérations, preuve en cas de contrôle, sécurité du système',
        base_legale: 'Intérêt légitime et obligation légale (art. 6.1.f et 6.1.c)',
        personnes: 'Utilisateurs du logiciel, résidents',
        donnees: 'Auteur, horodatage, adresse IP, nature de l\u2019opération',
        destinataires: 'Administrateurs, administration fiscale sur demande',
        conservation: `${durees.journal_audit_ans} ans`,
        securite: 'Journal en écriture seule (non modifiable, non supprimable)',
      },
    ],
    sous_traitants: [
      { nom: 'Supabase', role: 'Hébergement de la base de données', localisation: rgpd.region_bdd || 'Union européenne (à confirmer selon la région du projet)' },
      { nom: 'Render', role: 'Hébergement applicatif', localisation: rgpd.region_app || 'Union européenne (à confirmer selon la région du service)' },
      { nom: 'Brevo', role: 'Envoi des e-mails transactionnels', localisation: 'France / Union européenne' },
      { nom: 'Stripe', role: 'Paiement en ligne (si activé)', localisation: 'Irlande / Union européenne — certifié PCI-DSS' },
    ],
    droits: 'Accès, rectification, effacement (dans la limite des obligations légales de conservation), '
      + 'portabilité, opposition, limitation. Demande à adresser au responsable de traitement. '
      + 'Réclamation possible auprès de la CNIL (www.cnil.fr).',
    genere_le: new Date().toISOString(),
  };
}

module.exports = {
  exporterDonnees, anonymiserResident, candidatsPurge, registreTraitements,
  DUREES_DEFAUT, ANONYME,
};

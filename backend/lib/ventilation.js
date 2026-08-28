const { supabase } = require('./supabase');

/* ============================================================
   Ventilation comptable — une seule table pour tous les exports
   ============================================================
   « Ce qui est ecrit sur la ligne de facture » -> « compte comptable ».

   Avant ce module, export-compta.js ventilait par mot-cle et
   comptabilite.js (le FEC) mettait tout en 706000 : deux fichiers
   comptables qui se contredisaient. Les deux lisent maintenant ici.

   Surcharge : campings.parametres.ventilation. A defaut, on relit
   l'ancien emplacement (parametres.compta) pour qu'un camping deja
   configure ne change pas de comportement du jour au lendemain.
   ============================================================ */

// Comptes seeds : ceux qui etaient deja en place dans export-compta.js,
// c'est-a-dire le plan reellement utilise par le camping.
const DEFAUT = {
  compte_defaut: '706000',
  libelle_defaut: 'Camping',
  // Ce qui ne correspond a aucune regle : soit on le laisse sur le compte
  // par defaut (comportement d'origine), soit on l'isole sur un compte
  // d'attente pour le ventiler ensuite. Desactive par defaut : activer
  // change ce que recoit votre comptable.
  compte_attente: '471000',
  libelle_attente: "Compte d'attente",
  attente_active: false,
  comptes_tva: { 20: '445717', 10: '445716', 5.5: '445715', 2.1: '445714' },
  compte_tva_defaut: '445710',
  regles: [
    { contient: 'taxe de séjour', compte: '708021', libelle: 'Taxes de séjour' },
    { contient: 'électricité', compte: '708011', libelle: 'Electricité Maison' },
    { contient: 'electricite', compte: '708011', libelle: 'Electricité Maison' },
    { contient: 'energie', compte: '708004', libelle: 'Energies' },
    { contient: 'énergie', compte: '708004', libelle: 'Energies' },
    { contient: 'gaz', compte: '707001', libelle: 'Vente gaz' },
    { contient: 'lave', compte: '708002', libelle: 'Lave Linge' },
    { contient: 'internet', compte: '706007', libelle: 'Internet' },
    { contient: 'loyer', compte: '706000', libelle: 'Résident' },
    { contient: 'séjour', compte: '706000', libelle: 'Résident' },
  ],
};

// Comparaison sans accents ni casse : « Electricité » et « electricite »
// doivent tomber sur la meme regle. On ne touche PAS au texte ecrit dans
// les fichiers, seulement a la comparaison.
const sansAccents = (s) => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function fusionner(parametres) {
  const p = parametres || {};
  const v = p.ventilation || {};
  // Retro-compatibilite : l'ancien emplacement des regles et des comptes de TVA.
  const legacy = p.compta || {};
  const plan = {
    ...DEFAUT,
    ...(legacy.compte_produit_defaut ? { compte_defaut: legacy.compte_produit_defaut } : {}),
    ...(legacy.libelle_produit_defaut ? { libelle_defaut: legacy.libelle_produit_defaut } : {}),
    ...v,
  };
  plan.comptes_tva = { ...DEFAUT.comptes_tva, ...(legacy.comptes_tva || {}), ...(v.comptes_tva || {}) };
  const regles = (v.regles && v.regles.length) ? v.regles
    : ((legacy.regles && legacy.regles.length) ? legacy.regles : DEFAUT.regles);
  plan.regles = regles.filter((r) => r && r.contient && r.compte);
  return plan;
}

async function chargerPlan(campingId) {
  try {
    const { data } = await supabase.from('campings').select('parametres')
      .eq('id', campingId).maybeSingle();
    return fusionner(data && data.parametres);
  } catch (e) {
    console.error('[ventilation] plan illisible, valeurs par defaut :', e.message);
    return fusionner(null);
  }
}

/**
 * A quel compte va cette ligne de facture ?
 * @returns {{compte:string, libelle:string, mot:string|null, attente:boolean}}
 *   mot = la regle qui a repondu ; null quand rien n'a repondu.
 */
function ventilerLigne(designation, plan) {
  const p = plan || DEFAUT;
  const d = sansAccents(designation);
  for (const r of (p.regles || [])) {
    if (d.includes(sansAccents(r.contient))) {
      return { compte: r.compte, libelle: r.libelle || r.compte, mot: r.contient, attente: false };
    }
  }
  // Rien ne correspond. C'est le cas d'une nature nouvelle (vente de
  // mobil-home, commission, hivernage) : on le dit au lieu de la ranger
  // silencieusement en loyer.
  if (p.attente_active && p.compte_attente) {
    return { compte: p.compte_attente, libelle: p.libelle_attente || "Compte d'attente", mot: null, attente: true };
  }
  return { compte: p.compte_defaut, libelle: p.libelle_defaut || p.compte_defaut, mot: null, attente: true };
}

/** Compte de TVA collectee pour un taux donne. */
function compteTva(taux, plan) {
  const p = plan || DEFAUT;
  const t = Number(taux);
  return p.comptes_tva[t] || p.comptes_tva[String(t)] || p.comptes_tva[t.toFixed(1)]
    || p.compte_tva_defaut || '445710';
}

/** Montant HT d'une ligne, quelle que soit la facon dont elle a ete stockee. */
function ligneHt(l) {
  return Number(l.montant_ht != null ? l.montant_ht : (Number(l.quantite || 1) * Number(l.pu_ht || 0)));
}

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;

/**
 * Ventile les lignes d'une facture : produits par compte et TVA par taux.
 * L'equilibre est garanti : la somme des produits et de la TVA egale
 * exactement le TTC de la facture. Sans cette garantie, un centime
 * d'arrondi fait rejeter le FEC.
 */
function ventilerFacture(facture, plan) {
  const produits = {};   // "compte|libelle" -> HT
  const tva = {};        // taux -> TVA
  let aVentiler = 0;     // HT tombe sur le compte par defaut / d'attente

  for (const l of (facture.lignes || [])) {
    const ht = ligneHt(l);
    const v = ventilerLigne(l.designation, plan);
    const k = v.compte + '|' + v.libelle;
    produits[k] = r2((produits[k] || 0) + ht);
    if (v.attente) aVentiler = r2(aVentiler + ht);
    const taux = Number(l.taux_tva || 0);
    if (taux > 0) tva[taux] = r2((tva[taux] || 0) + r2(ht * taux / 100));
  }

  // Rattrapage d'arrondi : on aligne sur les totaux stockes de la facture,
  // qui sont la reference (le PDF et le client les ont deja vus).
  const ttcRef = r2(facture.total_ttc);
  const tvaRef = facture.total_tva != null ? r2(facture.total_tva) : null;

  if (tvaRef != null) {
    const somTva = r2(Object.values(tva).reduce((s, v) => s + v, 0));
    const ecart = r2(tvaRef - somTva);
    if (Math.abs(ecart) >= 0.005) {
      const plusGros = Object.keys(tva).sort((a, b) => Math.abs(tva[b]) - Math.abs(tva[a]))[0];
      if (plusGros) tva[plusGros] = r2(tva[plusGros] + ecart);
      else tva[20] = ecart;
    }
  }
  const somTva2 = r2(Object.values(tva).reduce((s, v) => s + v, 0));
  const htAttendu = r2(ttcRef - somTva2);
  const somHt = r2(Object.values(produits).reduce((s, v) => s + v, 0));
  const ecartHt = r2(htAttendu - somHt);
  if (Math.abs(ecartHt) >= 0.005) {
    const plusGros = Object.keys(produits).sort((a, b) => Math.abs(produits[b]) - Math.abs(produits[a]))[0];
    if (plusGros) produits[plusGros] = r2(produits[plusGros] + ecartHt);
  }

  return { produits, tva, a_ventiler: aVentiler };
}

module.exports = {
  DEFAUT, fusionner, chargerPlan, ventilerLigne, compteTva, ligneHt, ventilerFacture, sansAccents,
};

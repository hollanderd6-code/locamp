#!/usr/bin/env node
/* ============================================================
   outils/ventilation-compta.js   (1/2 — le moteur)
   Une seule ventilation comptable, editable depuis l'app
   ============================================================
   Cibles : backend/lib/ventilation.js (nouveau)
            backend/lib/export-compta.js
            backend/lib/comptabilite.js
            backend/routes/compta.js

   ── LE PROBLEME ─────────────────────────────────────────────────
   Deux generateurs comptables coexistent et ne disent pas la meme
   chose :

   · export-compta.js (import du logiciel comptable) ventile par
     mot-cle : « gaz » -> 707001, « loyer » -> 706000, dix regles.
     Tout ce qui ne correspond a aucune regle tombe en 706000
     « Locations emplacements ».

   · comptabilite.js (le FEC — le fichier legalement exigible) ne
     ventile PAS. Il isole la taxe de sejour, et met TOUT LE RESTE en
     compte_loyer 706000 : le gaz, l'electricite, le menage, une vente
     de mobil-home a 35 000 EUR. Il utilise aussi un seul compte de TVA
     (445710) la ou l'autre en a un par taux.

   Consequence : ajouter une nature de facture (vente de mobil-home,
   commission, hivernage) produit une comptabilite fausse, en silence,
   dans les deux fichiers mais pas de la meme facon.

   ── CE QUE FAIT CE CORRECTIF ────────────────────────────────────
   1. Cree backend/lib/ventilation.js : UNE table de correspondance
      « ce qui est ecrit sur la ligne » -> « compte comptable », plus
      les comptes de TVA par taux. Les deux generateurs s'en servent.
   2. Le plan est surchargeable par campings.parametres.ventilation,
      et retombe sur parametres.compta puis sur les valeurs d'origine :
      un camping deja configure ne change pas de comportement.
   3. Ce qui ne correspond a aucune regle est desormais MARQUE comme
      « a ventiler » — au lieu d'etre range en loyer sans le dire. Vous
      pouvez l'envoyer vers un compte d'attente (471000) en activant
      l'option, ou le laisser sur le compte par defaut.
   4. Ajoute GET/PUT /api/compta/ventilation : lire les lignes d'une
      periode avec le compte que chacune recoit, et enregistrer les
      regles. L'ecran arrive dans le second script.

   ── CE QUI CHANGE DANS LE FEC (a savoir) ────────────────────────
   · Les produits sont ventiles par compte au lieu d'un seul 706000.
     C'est la correction visee.
   · La TVA est eclatee par taux (445717 / 445716 / 445715) au lieu du
     seul 445710. Un controle de TVA attend cette distinction.
   · L'equilibre debit/credit est verifie a l'euro : la difference
     d'arrondi eventuelle est reportee sur le plus gros compte, sinon
     le FEC serait rejete.
   · La TAXE DE SEJOUR n'est PAS touchee : elle reste en 447100 dans le
     FEC et en 708021 dans l'import logiciel, comme aujourd'hui. Les
     deux ne peuvent pas avoir raison — une taxe collectee pour la
     commune est une dette, pas un produit — mais trancher modifierait
     un fichier qui fonctionne chez votre comptable. A decider avec lui,
     puis a corriger en une ligne dans les regles.

   Usage :
     node outils/ventilation-compta.js --essai
     node outils/ventilation-compta.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const LIB = path.join(process.cwd(), 'backend', 'lib');
const VENT = path.join(LIB, 'ventilation.js');
const EXPO = path.join(LIB, 'export-compta.js');
const COMPTA = path.join(LIB, 'comptabilite.js');
const ROUTE = path.join(process.cwd(), 'backend', 'routes', 'compta.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}
function unique(src, aiguille, quoi) {
  const n = src.split(aiguille).length - 1;
  if (n !== 1) echec(`${quoi} : ${n} occurrence(s) au lieu d'une. Le fichier a change.`);
}

for (const f of [EXPO, COMPTA, ROUTE]) {
  if (!fs.existsSync(f)) echec(`${f} introuvable. Lancez depuis la racine du projet.`);
}

let expo = fs.readFileSync(EXPO, 'utf8');
let compta = fs.readFileSync(COMPTA, 'utf8');
let route = fs.readFileSync(ROUTE, 'utf8');

if (fs.existsSync(VENT) || expo.indexOf("require('./ventilation')") !== -1) {
  console.log('\n  La ventilation partagee existe deja — rien a faire.\n');
  process.exit(0);
}

/* ============================================================
   1. Le module partage
   ============================================================ */
const MODULE = `const { supabase } = require('./supabase');

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
  .normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');

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
`;

/* ============================================================
   2. export-compta.js — deleguer la ventilation
   ============================================================ */
unique(expo, "const { supabase } = require('./supabase');", 'require de export-compta');
expo = expo.replace("const { supabase } = require('./supabase');",
  "const { supabase } = require('./supabase');\n"
  + "// Ventilation partagee avec le FEC : une seule table de correspondance.\n"
  + "const { chargerPlan: chargerPlanVent, ventilerLigne, compteTva } = require('./ventilation');");

const EXPO_VENT_ANCIEN = `function ventiler(designation, plan) {
  const d = sansAccents(designation);
  for (const r of (plan.regles || [])) {
    if (d.includes(sansAccents(r.contient))) return { compte: r.compte, libelle: r.libelle };
  }
  return { compte: plan.compte_produit_defaut, libelle: plan.libelle_produit_defaut };
}`;
const EXPO_VENT_NOUVEAU = `function ventiler(designation, plan) {
  // Delegue au module partage. La signature est conservee : ventiler() est
  // exportee et utilisee ailleurs.
  return ventilerLigne(designation, plan.ventilation || plan);
}`;
unique(expo, EXPO_VENT_ANCIEN, 'fonction ventiler');
expo = expo.split(EXPO_VENT_ANCIEN).join(EXPO_VENT_NOUVEAU);

const EXPO_PLAN = "  const plan = { ...PLAN_DEFAUT, ...((camping?.parametres || {}).compta || {}) };";
unique(expo, EXPO_PLAN, 'construction du plan');
expo = expo.split(EXPO_PLAN).join(EXPO_PLAN
  + "\n  // Le plan de ventilation vient du module partage (parametres.ventilation,\n"
  + "  // a defaut parametres.compta) : le FEC et cet export ne peuvent plus diverger.\n"
  + "  plan.ventilation = await chargerPlanVent(campingId);");

const EXPO_TVA = "      const compte = plan.comptes_tva[taux] || plan.comptes_tva[Number(taux)] || '445710';";
unique(expo, EXPO_TVA, 'compte de TVA');
expo = expo.split(EXPO_TVA).join("      const compte = compteTva(taux, plan.ventilation);");

/* ============================================================
   3. comptabilite.js — ventiler le FEC
   ============================================================ */
unique(compta, "const { supabase } = require('./supabase');", 'require de comptabilite');
compta = compta.replace("const { supabase } = require('./supabase');",
  "const { supabase } = require('./supabase');\n"
  + "// Meme ventilation que l'import logiciel : voir lib/ventilation.js.\n"
  + "const { chargerPlan: chargerPlanVent, ventilerLigne, compteTva, ligneHt } = require('./ventilation');");

const CP_PLAN = "  const P = { ...DEFAULTS, ...((camp?.parametres || {}).comptabilite || {}) };";
unique(compta, CP_PLAN, 'construction de P');
compta = compta.split(CP_PLAN).join(CP_PLAN
  + "\n  const V = await chargerPlanVent(campingId);   // ventilation des produits + TVA par taux");

const CP_ANCIEN = `    let htTaxe = 0, htAutre = 0;
    for (const l of (f.lignes || [])) {
      const mHt = Number(l.montant_ht != null ? l.montant_ht : (l.quantite || 1) * (l.pu_ht || 0));
      if (String(l.designation || '').toLowerCase().startsWith('taxe de séjour')) htTaxe += mHt; else htAutre += mHt;
    }
    const tva = Number(f.total_tva || 0);
    const ttc = Number(f.total_ttc || 0);
    const lt = lettreOf[f.id], dl = dateLetOf[f.id];

    // Client au débit (TTC), produits + TVA au crédit
    leg(base, P.compte_client, P.compte_client_lib, ttc, { auxNum: aN, auxLib: auxL, let: lt, dateLet: dl });
    if (Math.abs(htAutre) > 0.0001) leg(base, P.compte_loyer, P.compte_loyer_lib, -htAutre);
    if (Math.abs(htTaxe) > 0.0001) leg(base, P.compte_taxe_sejour, P.compte_taxe_sejour_lib, -htTaxe);
    if (Math.abs(tva) > 0.0001) leg(base, P.compte_tva, P.compte_tva_lib, -tva);`;

const CP_NOUVEAU = `    /* Ventilation des produits.
       Avant : tout sauf la taxe de sejour partait en compte_loyer 706000 —
       le gaz, l'electricite, le menage, une vente de mobil-home. Desormais
       chaque ligne va au compte que lui donne lib/ventilation.js, le meme
       que l'import du logiciel comptable.

       La taxe de sejour reste traitee a part, en 447100 : une taxe
       collectee pour la commune est une dette, pas un produit. C'est le
       seul point ou ce fichier et l'import logiciel divergent encore
       (celui-ci la met en 708021) — a arbitrer avec le comptable. */
    let htTaxe = 0;
    const produits = {};   // "compte|libelle" -> HT
    const tvaParTaux = {}; // taux -> TVA
    for (const l of (f.lignes || [])) {
      const mHt = ligneHt(l);
      if (String(l.designation || '').toLowerCase().startsWith('taxe de séjour')) { htTaxe += mHt; continue; }
      const v = ventilerLigne(l.designation, V);
      const k = v.compte + '|' + v.libelle;
      produits[k] = r2c((produits[k] || 0) + mHt);
      const t = Number(l.taux_tva || 0);
      if (t > 0) tvaParTaux[t] = r2c((tvaParTaux[t] || 0) + r2c(mHt * t / 100));
    }

    const tva = Number(f.total_tva || 0);
    const ttc = Number(f.total_ttc || 0);
    const lt = lettreOf[f.id], dl = dateLetOf[f.id];

    /* Equilibre : le FEC est rejete si debit != credit, et une TVA
       recalculee ligne par ligne peut s'ecarter d'un centime du total
       stocke sur la facture. Le total de la facture fait foi : l'ecart
       est reporte sur le plus gros poste. */
    const somTva = r2c(Object.values(tvaParTaux).reduce((s, v) => s + v, 0));
    const ecartTva = r2c(tva - somTva);
    if (Math.abs(ecartTva) >= 0.005) {
      const gros = Object.keys(tvaParTaux).sort((a, b) => Math.abs(tvaParTaux[b]) - Math.abs(tvaParTaux[a]))[0];
      if (gros) tvaParTaux[gros] = r2c(tvaParTaux[gros] + ecartTva); else tvaParTaux[20] = ecartTva;
    }
    const htAttendu = r2c(ttc - tva - htTaxe);
    const somHt = r2c(Object.values(produits).reduce((s, v) => s + v, 0));
    const ecartHt = r2c(htAttendu - somHt);
    if (Math.abs(ecartHt) >= 0.005) {
      const gros = Object.keys(produits).sort((a, b) => Math.abs(produits[b]) - Math.abs(produits[a]))[0];
      if (gros) produits[gros] = r2c(produits[gros] + ecartHt);
      else produits[P.compte_loyer + '|' + P.compte_loyer_lib] = ecartHt;
    }

    // Client au débit (TTC), produits + TVA au crédit
    leg(base, P.compte_client, P.compte_client_lib, ttc, { auxNum: aN, auxLib: auxL, let: lt, dateLet: dl });
    for (const k of Object.keys(produits)) {
      const mt = produits[k];
      if (Math.abs(mt) <= 0.0001) continue;
      const [cpt, lib] = k.split('|');
      leg(base, cpt, lib, -mt);
    }
    if (Math.abs(htTaxe) > 0.0001) leg(base, P.compte_taxe_sejour, P.compte_taxe_sejour_lib, -htTaxe);
    for (const t of Object.keys(tvaParTaux).sort((a, b) => Number(a) - Number(b))) {
      const mt = tvaParTaux[t];
      if (Math.abs(mt) <= 0.0001) continue;
      leg(base, compteTva(t, V), \`TVA collectée \${t} %\`, -mt);
    }`;

unique(compta, CP_ANCIEN, 'bloc de ventilation du FEC');
compta = compta.split(CP_ANCIEN).join(CP_NOUVEAU);

/* r2c : l'arrondi au centime, absent de ce fichier. */
const CP_FMT = "function fmtNum(n) { return (Math.round(Number(n || 0) * 100) / 100).toFixed(2).replace('.', ','); }";
unique(compta, CP_FMT, 'fmtNum');
compta = compta.split(CP_FMT).join(CP_FMT
  + "\n// Arrondi au centime : les ventilations se cumulent, l'ecart doit etre borne a chaque etape.\nconst r2c = (n) => Math.round(Number(n || 0) * 100) / 100;");

/* ============================================================
   4. routes/compta.js — lire et enregistrer les regles
   ============================================================ */
unique(route, "const { exportCompta } = require('../lib/export-compta');", 'require de export-compta');
route = route.replace("const { exportCompta } = require('../lib/export-compta');",
  "const { exportCompta } = require('../lib/export-compta');\n"
  + "const { chargerPlan, fusionner, ventilerLigne, ligneHt, DEFAUT: VENT_DEFAUT } = require('../lib/ventilation');");

const ROUTES = `
// GET /api/compta/ventilation?debut&fin
// Ce que recoit chaque nature facturee sur la periode : le compte, la regle
// qui a repondu, et le montant. « a_ventiler » liste ce qui ne correspond a
// AUCUNE regle — c'est la seule chose a regler, et elle etait invisible.
router.get('/ventilation', requireRole('admin', 'comptabilite'), async (req, res) => {
  try {
    const { debut, fin } = periode(req);
    const plan = await chargerPlan(req.activeCampingId);
    const { data: factures, error } = await supabase.from('factures')
      .select('id,numero,date_emission,statut,lignes')
      .eq('camping_id', req.activeCampingId)
      .gte('date_emission', debut).lte('date_emission', fin);
    if (error) throw error;

    const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
    // Regroupement par designation : le gestionnaire pense « le menage »,
    // pas « la ligne 3 de la facture 412 ».
    const parDesignation = new Map();
    for (const f of (factures || [])) {
      for (const l of (f.lignes || [])) {
        const nom = String(l.designation || '(sans désignation)').trim();
        const v = ventilerLigne(nom, plan);
        const cle = nom.toLowerCase();
        const e = parDesignation.get(cle) || {
          designation: nom, compte: v.compte, libelle: v.libelle,
          regle: v.mot, a_ventiler: v.attente, ht: 0, lignes: 0,
          taux: new Set(), exemples: [],
        };
        e.ht = r2(e.ht + ligneHt(l));
        e.lignes += 1;
        e.taux.add(Number(l.taux_tva || 0));
        if (e.exemples.length < 3 && f.numero) e.exemples.push(f.numero);
        parDesignation.set(cle, e);
      }
    }
    const lignes = [...parDesignation.values()]
      .map((e) => ({ ...e, taux: [...e.taux].sort((a, b) => a - b) }))
      .sort((a, b) => (b.a_ventiler - a.a_ventiler) || (Math.abs(b.ht) - Math.abs(a.ht)));

    const aVentiler = lignes.filter((l) => l.a_ventiler);
    res.json({
      debut, fin, plan, lignes,
      a_ventiler: { nombre: aVentiler.length, ht: r2(aVentiler.reduce((s, l) => s + l.ht, 0)) },
      defaut: VENT_DEFAUT,
    });
  } catch (e) {
    console.error('[compta:ventilation]', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/compta/ventilation  { regles[], compte_defaut, libelle_defaut,
//                                compte_attente, attente_active, comptes_tva }
// Enregistre dans campings.parametres.ventilation. Les deux exports le
// relisent au prochain telechargement : rien n'est fige dans le code.
router.put('/ventilation', requireRole('admin', 'comptabilite'), async (req, res) => {
  try {
    const b = req.body || {};
    const { data: camp } = await supabase.from('campings').select('parametres')
      .eq('id', req.activeCampingId).maybeSingle();
    const parametres = (camp && camp.parametres) || {};

    // On n'accepte que des regles utilisables : un mot vide attraperait
    // TOUTES les lignes (indexOf('') === 0), un compte vide casserait le fichier.
    const regles = Array.isArray(b.regles) ? b.regles
      .map((r) => ({
        contient: String((r && r.contient) || '').trim(),
        compte: String((r && r.compte) || '').trim(),
        libelle: String((r && r.libelle) || '').trim(),
      }))
      .filter((r) => r.contient && r.compte) : [];
    if (Array.isArray(b.regles) && !regles.length && b.regles.length) {
      return res.status(400).json({ error: 'Chaque règle demande un mot-clé et un compte.' });
    }

    const comptes_tva = {};
    for (const [k, v] of Object.entries(b.comptes_tva || {})) {
      const t = Number(k);
      if (!Number.isFinite(t)) continue;
      const c = String(v || '').trim();
      if (c) comptes_tva[t] = c;
    }

    const ventilation = {
      regles,
      compte_defaut: String(b.compte_defaut || '').trim() || VENT_DEFAUT.compte_defaut,
      libelle_defaut: String(b.libelle_defaut || '').trim() || VENT_DEFAUT.libelle_defaut,
      compte_attente: String(b.compte_attente || '').trim() || VENT_DEFAUT.compte_attente,
      libelle_attente: String(b.libelle_attente || '').trim() || VENT_DEFAUT.libelle_attente,
      attente_active: !!b.attente_active,
      ...(Object.keys(comptes_tva).length ? { comptes_tva } : {}),
    };

    const { error } = await supabase.from('campings')
      .update({ parametres: { ...parametres, ventilation } })
      .eq('id', req.activeCampingId);
    if (error) throw error;

    await writeAudit(req, { action: 'update', entite: 'compta_ventilation',
      avant: parametres.ventilation || null, apres: ventilation });
    res.json({ ok: true, plan: fusionner({ ...parametres, ventilation }) });
  } catch (e) {
    console.error('[compta:ventilation-put]', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;`;

unique(route, 'module.exports = router;', 'export du routeur compta');
route = route.replace('module.exports = router;', ROUTES.replace(/^\n/, ''));

/* ---- Verifications ---- */
for (const [nom, src] of [['export-compta.js', expo], ['comptabilite.js', compta], ['routes/compta.js', route], ['ventilation.js', MODULE]]) {
  try { new Function(src); }
  catch (e) { echec(`${nom} resultant n'est pas du JavaScript valide — ${e.message}`); }
}
for (const [quoi, aiguille, ou] of [
  ['le module partage', 'module.exports = {\n  DEFAUT, fusionner, chargerPlan', MODULE],
  ['la delegation dans export-compta', 'return ventilerLigne(designation, plan.ventilation || plan);', expo],
  ['le plan dans export-compta', 'plan.ventilation = await chargerPlanVent(campingId);', expo],
  ['le compte de TVA partage', 'compteTva(taux, plan.ventilation)', expo],
  ['la ventilation du FEC', 'const v = ventilerLigne(l.designation, V);', compta],
  ['la TVA par taux dans le FEC', 'leg(base, compteTva(t, V),', compta],
  ['l\'arrondi r2c', 'const r2c =', compta],
  ['la route de lecture', "router.get('/ventilation'", route],
  ['la route d\'enregistrement', "router.put('/ventilation'", route],
]) if (ou.indexOf(aiguille) === -1) echec(`Verification : ${quoi} est absent du resultat.`);

/* Le FEC ne doit plus tout envoyer en compte_loyer. */
if (compta.indexOf('leg(base, P.compte_loyer, P.compte_loyer_lib, -htAutre)') !== -1) {
  echec('L\'ancienne ventilation unique du FEC subsiste.');
}
/* La taxe de sejour doit rester intacte. */
if (compta.indexOf('P.compte_taxe_sejour, P.compte_taxe_sejour_lib, -htTaxe') === -1) {
  echec('Le traitement de la taxe de sejour a ete perdu.');
}
if (route.split('module.exports = router;').length - 1 !== 1) echec('L\'export du routeur est en double.');

if (!ESSAI) {
  fs.writeFileSync(VENT, MODULE, 'utf8');
  fs.writeFileSync(EXPO, expo, 'utf8');
  fs.writeFileSync(COMPTA, compta, 'utf8');
  fs.writeFileSync(ROUTE, route, 'utf8');
  if (!fs.existsSync(VENT) || fs.readFileSync(ROUTE, 'utf8').indexOf("router.put('/ventilation'") === -1) {
    echec('L\'ajout est absent apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  lib/ventilation.js : une seule table « designation -> compte », + TVA par taux.');
console.log('  export-compta.js et comptabilite.js (FEC) la partagent : plus de divergence.');
console.log('  Le FEC ventile enfin ses produits (avant : tout en 706000) et eclate la TVA par taux.');
console.log('  Equilibre debit/credit garanti : l\'ecart d\'arrondi va sur le plus gros poste.');
console.log('  Taxe de sejour : inchangee (447100 au FEC, 708021 a l\'import) — a arbitrer.');
console.log('  API : GET/PUT /api/compta/ventilation (regles editables, liste des non ventilees).');
console.log('');
console.log('  Redemarrez le serveur, puis controlez AVANT de livrer a votre comptable :');
console.log('    GET /api/compta/ecritures?debut=2026-01-01&fin=2026-12-31');
console.log('    -> total_debit doit egaler total_credit.');
console.log('');
console.log('  L\'ecran de reglage arrive dans le second script.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

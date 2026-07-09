const { supabase } = require('./supabase');
const { buildFacturePdf } = require('./pdf');
const { uploadDocument } = require('./storage');

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }        // m : 1-12
function currentPeriode() { return new Date().toISOString().slice(0, 7); } // 'YYYY-MM'
function periodeLabel(p) { const [y, m] = p.split('-').map(Number); return `${MOIS[m - 1]} ${y}`; }

// Calcule montant_ht par ligne + totaux HT/TVA/TTC (arrondi 2 décimales).
function computeTotals(lignes) {
  let ht = 0, tva = 0;
  const out = (lignes || []).map((l) => {
    const q = Number(l.quantite || 1);
    const pu = Number(l.pu_ht || 0);
    const taux = Number(l.taux_tva || 0);
    const mHt = Math.round(q * pu * 100) / 100;
    ht += mHt;
    tva += Math.round(mHt * taux) / 100;
    return { designation: l.designation, quantite: q, pu_ht: pu, taux_tva: taux, montant_ht: mHt };
  });
  ht = Math.round(ht * 100) / 100;
  tva = Math.round(tva * 100) / 100;
  return { lignes: out, total_ht: ht, total_tva: tva, total_ttc: Math.round((ht + tva) * 100) / 100 };
}

// Construit les lignes d'un contrat pour une période (prorata entrée/sortie + taxe de séjour).
function buildLignes(contrat, resident, periode, parametres) {
  const [y, m] = periode.split('-').map(Number);
  const dim = daysInMonth(y, m);
  const start = `${periode}-01`;
  const end = `${periode}-${String(dim).padStart(2, '0')}`;

  let first = 1, last = dim;
  if (contrat.date_debut && contrat.date_debut > start && contrat.date_debut <= end) first = Number(contrat.date_debut.slice(8, 10));
  if (contrat.date_fin && contrat.date_fin >= start && contrat.date_fin < end) last = Number(contrat.date_fin.slice(8, 10));
  const activeDays = last - first + 1;
  const factor = (activeDays > 0 && activeDays < dim) ? activeDays / dim : 1;

  const lignes = [];
  const loyer = Number(contrat.montant_mensuel || 0);
  const tvaLoyer = Number(parametres?.facturation?.tva_taux_loyer || 0);
  if (loyer > 0) {
    const montant = Math.round(loyer * factor * 100) / 100;
    lignes.push({
      designation: factor < 1
        ? `Loyer emplacement — ${periodeLabel(periode)} (prorata ${activeDays}/${dim} j)`
        : `Loyer emplacement — ${periodeLabel(periode)}`,
      quantite: 1, pu_ht: montant, taux_tva: tvaLoyer,
    });
  }

  const ts = parametres?.taxe_sejour;
  if (ts && ts.actif && Number(ts.tarif_nuit_personne) > 0) {
    const occ = resident?.foyer?.occupants ?? resident?.foyer?.personnes ?? 1;
    const personnes = Number(occ) || 1;
    const nuits = activeDays;
    const montant = Math.round(Number(ts.tarif_nuit_personne) * personnes * nuits * 100) / 100;
    if (montant > 0) {
      lignes.push({
        designation: `Taxe de séjour (${personnes} pers. × ${nuits} nuits)`,
        quantite: 1, pu_ht: montant, taux_tva: 0,
      });
    }
  }
  return lignes;
}

// Numéro de facture atomique et continu : F-AAAA-NNNNN
async function nextNumeroFacture(campingId) {
  const year = new Date().getFullYear();
  const { data, error } = await supabase.rpc('next_compteur', { p_camping: campingId, p_cle: `facture:${year}` });
  if (error) throw error;
  const seq = Array.isArray(data) ? data[0] : data;
  return `F-${year}-${String(seq).padStart(5, '0')}`;
}

// Génère le PDF d'une facture, l'archive, met à jour pdf_path.
async function genererPdfFacture(campingId, facture) {
  const [camping, resident] = await Promise.all([
    supabase.from('campings').select('nom,raison_sociale,adresse,siret,tva,parametres').eq('id', campingId).maybeSingle(),
    facture.resident_id
      ? supabase.from('residents').select('civilite,nom,prenom,adresse,email').eq('id', facture.resident_id).maybeSingle()
      : Promise.resolve({ data: {} }),
  ]);
  const pdf = await buildFacturePdf({ camping: camping.data || {}, resident: resident.data || {}, facture });
  const path = `factures/${campingId}/${facture.id}.pdf`;
  await uploadDocument(path, pdf, 'application/pdf');
  await supabase.from('factures').update({ pdf_path: path }).eq('id', facture.id);
  return path;
}

// Crée une facture à partir de lignes déjà prêtes. Renvoie la facture (avec PDF).
async function creerFacture({ campingId, resident_id, contrat_id, periode, lignes, statut = 'emise', avoir_de = null }) {
  const t = computeTotals(lignes);
  const numero = await nextNumeroFacture(campingId);
  const { data: facture, error } = await supabase.from('factures').insert({
    camping_id: campingId, resident_id: resident_id || null, contrat_id: contrat_id || null,
    numero, periode: periode || null, date_emission: new Date().toISOString().slice(0, 10),
    lignes: t.lignes, total_ht: t.total_ht, total_tva: t.total_tva, total_ttc: t.total_ttc,
    statut, avoir_de,
  }).select().single();
  if (error) throw error;
  await genererPdfFacture(campingId, facture).catch((e) => console.error('[pdf facture]', e.message));
  return facture;
}

// Facturation mensuelle d'un camping pour une période.
async function runFacturationMensuelle(campingId, periode) {
  periode = periode || currentPeriode();
  const [y, m] = periode.split('-').map(Number);
  const dim = daysInMonth(y, m);
  const start = `${periode}-01`;
  const end = `${periode}-${String(dim).padStart(2, '0')}`;

  const { data: camp } = await supabase.from('campings').select('parametres').eq('id', campingId).maybeSingle();
  const parametres = camp?.parametres || {};

  const { data: contrats, error } = await supabase.from('contrats').select('*')
    .eq('camping_id', campingId).in('statut', ['signe', 'actif']).not('resident_id', 'is', null);
  if (error) throw error;

  const res = { periode, crees: 0, ignores: 0, erreurs: 0, factures: [] };
  for (const c of (contrats || [])) {
    if (c.date_debut && c.date_debut > end) { res.ignores++; continue; }
    if (c.date_fin && c.date_fin < start) { res.ignores++; continue; }

    const { data: existing } = await supabase.from('factures').select('id')
      .eq('camping_id', campingId).eq('contrat_id', c.id).eq('periode', periode)
      .neq('statut', 'avoir').maybeSingle();
    if (existing) { res.ignores++; continue; }

    const { data: resident } = await supabase.from('residents')
      .select('foyer').eq('id', c.resident_id).maybeSingle();

    const lignes = buildLignes(c, resident || {}, periode, parametres);
    if (!lignes.length) { res.ignores++; continue; }

    try {
      const f = await creerFacture({ campingId, resident_id: c.resident_id, contrat_id: c.id, periode, lignes });
      res.crees++;
      res.factures.push({ id: f.id, numero: f.numero, total_ttc: f.total_ttc, resident_id: c.resident_id });
    } catch (e) {
      console.error('[facturation]', c.id, e.message);
      res.erreurs++;
    }
  }
  return res;
}

module.exports = { runFacturationMensuelle, creerFacture, buildLignes, computeTotals, genererPdfFacture, currentPeriode };

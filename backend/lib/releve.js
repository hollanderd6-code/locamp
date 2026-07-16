const { supabase } = require('./supabase');

/* ============================================================
   Relevé de compte client (grand livre auxiliaire), par EXERCICE FISCAL.

   Convention : le SOLDE est ce que le client DOIT.
     • Facture      → débit  (augmente le solde)
     • Avoir        → montant déjà négatif → réduit le solde
     • Encaissement → crédit (réduit le solde)

   L'exercice fiscal débute au mois `parametres.exercice_debut_mois` (1-12) et dure
   12 mois. Chaque exercice s'ouvre sur un « report à nouveau » = solde de clôture de
   l'exercice précédent. Si cet exercice précédent a été CLÔTURÉ (scellé dans
   `cloture_soldes`), on utilise la valeur scellée (immuable) ; sinon on la calcule.
   ============================================================ */

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;

// Année de début de l'exercice contenant `dateISO` (mois >= dm -> même année, sinon année-1).
function exStart(dateISO, dm) {
  const y = Number(String(dateISO).slice(0, 4));
  const mo = Number(String(dateISO).slice(5, 7));
  return mo >= dm ? y : y - 1;
}
// Libellé lisible de l'exercice : "2026" si année civile, sinon "2025/26".
function exLabel(startYear, dm) {
  return dm === 1 ? String(startYear) : `${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`;
}
// Bornes ISO {debut, fin} de l'exercice débutant l'année `startYear`.
function exBornes(startYear, dm) {
  const debut = `${startYear}-${String(dm).padStart(2, '0')}-01`;
  // Fin = dernier jour du mois précédant le mois de début, 12 mois plus tard.
  //   dm=1 (année civile)  -> 31 déc. de startYear
  //   dm=4 (avril→mars)    -> 31 mars de startYear+1
  const finYear = dm === 1 ? startYear : startYear + 1;
  const finMonth = dm === 1 ? 12 : dm - 1;          // mois de fin, 1-indexé
  const finD = new Date(finYear, finMonth, 0);      // jour 0 => dernier jour du mois finMonth
  const fin = `${finD.getFullYear()}-${String(finD.getMonth() + 1).padStart(2, '0')}-${String(finD.getDate()).padStart(2, '0')}`;
  return { debut, fin };
}

async function buildReleve(campingId, residentId, exercice = null) {
  const [resRes, factRes, reglRes, moyRes, campRes, cloRes] = await Promise.all([
    supabase.from('residents').select('id,civilite,nom,prenom,email,adresse,compte_comptable,emplacement_id')
      .eq('camping_id', campingId).eq('id', residentId).maybeSingle(),
    supabase.from('factures')
      .select('id,numero,date_emission,periode,statut,total_ttc,montant_regle,avoir_de')
      .eq('camping_id', campingId).eq('resident_id', residentId)
      .neq('statut', 'brouillon')   // un proforma n'est pas une écriture : hors relevé et hors solde
      .order('date_emission'),
    supabase.from('reglements')
      .select('id,date_reglement,mode,montant,reference,statut_cheque')
      .eq('camping_id', campingId).eq('resident_id', residentId).order('date_reglement'),
    supabase.from('moyens_paiement').select('code,libelle').eq('camping_id', campingId)
      .then((r) => r, () => ({ data: [] })),
    supabase.from('campings').select('parametres').eq('id', campingId).maybeSingle(),
    supabase.from('cloture_soldes').select('exercice,solde').eq('camping_id', campingId).eq('resident_id', residentId)
      .then((r) => r, () => ({ data: [] })),
  ]);

  const resident = resRes.data;
  if (!resident) return null;

  const dm = Math.min(Math.max(Number((campRes.data?.parametres || {}).exercice_debut_mois || 1), 1), 12);
  const scelle = {};   // exercice (année de début) -> solde de clôture scellé
  (cloRes.data || []).forEach((c) => { scelle[Number(c.exercice)] = r2(c.solde); });
  const mlib = {}; (moyRes.data || []).forEach((m) => { mlib[m.code] = m.libelle; });

  // ---- Mouvements ----
  const mouvements = [];
  for (const f of (factRes.data || [])) {
    const avoir = f.statut === 'avoir';
    mouvements.push({
      date: String(f.date_emission).slice(0, 10),
      type: avoir ? 'avoir' : 'facture',
      libelle: avoir ? `Avoir ${f.numero}` : `Facture ${f.numero}${f.periode ? ` — ${f.periode}` : ''}`,
      reference: f.numero, debit: r2(f.total_ttc), credit: 0, facture_id: f.id, statut: f.statut,
    });
  }
  for (const g of (reglRes.data || [])) {
    mouvements.push({
      date: String(g.date_reglement).slice(0, 10), type: 'reglement',
      libelle: `Paiement — ${mlib[g.mode] || g.mode}${g.reference ? ` (${g.reference})` : ''}`,
      reference: g.reference || null, debit: 0, credit: r2(g.montant), reglement_id: g.id, mode: g.mode,
    });
  }
  mouvements.forEach((m) => { m.ex = exStart(m.date, dm); });
  const rang = { facture: 0, avoir: 1, reglement: 2 };
  mouvements.sort((a, b) => a.date.localeCompare(b.date) || (rang[a.type] - rang[b.type]));

  // ---- Exercices disponibles (+ ceux scellés même sans mouvement) ----
  const exSet = new Set(mouvements.map((m) => m.ex));
  Object.keys(scelle).forEach((e) => exSet.add(Number(e)));
  const exercicesYears = [...exSet].sort((a, b) => b - a);
  const selYear = (exercice != null && exercicesYears.includes(Number(exercice)))
    ? Number(exercice)
    : (exercicesYears[0] ?? exStart(new Date().toISOString(), dm));

  // ---- Report à nouveau : solde scellé de l'exercice précédent, sinon calculé ----
  let report;
  if (scelle[selYear - 1] != null) {
    report = scelle[selYear - 1];
  } else {
    report = 0;
    for (const m of mouvements) if (m.ex < selYear) report = r2(report + m.debit - m.credit);
  }

  // ---- Mouvements de l'exercice, solde progressif ----
  const lignes = [];
  let solde = report, totalDebit = 0, totalCredit = 0;
  for (const m of mouvements) {
    if (m.ex !== selYear) continue;
    solde = r2(solde + m.debit - m.credit);
    totalDebit = r2(totalDebit + m.debit);
    totalCredit = r2(totalCredit + m.credit);
    lignes.push({ ...m, solde });
  }

  // ---- Solde global (toutes années) ----
  const soldeTotal = r2(mouvements.reduce((s, m) => s + m.debit - m.credit, 0));

  // ---- Synthèse par exercice (respecte les seaux) ----
  const parAnnee = {};
  for (const m of mouvements) {
    const a = m.ex;
    parAnnee[a] = parAnnee[a] || { facture: 0, regle: 0, solde: 0 };
    parAnnee[a].facture = r2(parAnnee[a].facture + m.debit);
    parAnnee[a].regle = r2(parAnnee[a].regle + m.credit);
  }
  let cumul = 0;
  for (const a of Object.keys(parAnnee).map(Number).sort((x, y) => x - y)) {
    const rep = scelle[a - 1] != null ? scelle[a - 1] : cumul;
    cumul = r2(rep + parAnnee[a].facture - parAnnee[a].regle);
    parAnnee[a].solde = cumul;
  }

  const { debut, fin } = exBornes(selYear, dm);
  return {
    resident,
    annee: selYear,
    exercice_label: exLabel(selYear, dm),
    exercice_debut: debut,
    exercice_fin: fin,
    exercice_debut_mois: dm,
    scelle: scelle[selYear] != null,
    annees: exercicesYears,
    exercices: exercicesYears.map((y) => ({ annee: y, label: exLabel(y, dm), scelle: scelle[y] != null })),
    report_a_nouveau: report,
    lignes,
    totaux: { facture: totalDebit, regle: totalCredit, solde_fin: solde },
    solde_total: soldeTotal,
    par_annee: parAnnee,
  };
}

module.exports = { buildReleve, exStart, exLabel, exBornes };

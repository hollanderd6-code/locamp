const { supabase } = require('./supabase');

/* ============================================================
   Relevé de compte client (grand livre auxiliaire)

   Convention : le SOLDE est ce que le client DOIT.
     • Facture           → débit  (augmente le solde)
     • Avoir             → montant déjà négatif → réduit le solde
     • Encaissement      → crédit (réduit le solde)

   Une facture annulée par un avoir reste au relevé : elle a bien été émise,
   et c'est l'avoir qui la contrepasse. Les deux s'annulent — les retirer
   fausserait le solde.
   ============================================================ */

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;

async function buildReleve(campingId, residentId, annee = null) {
  const [resRes, factRes, reglRes, moyRes] = await Promise.all([
    supabase.from('residents').select('id,civilite,nom,prenom,email,adresse,compte_comptable,emplacement_id')
      .eq('camping_id', campingId).eq('id', residentId).maybeSingle(),
    supabase.from('factures')
      .select('id,numero,date_emission,periode,statut,total_ttc,montant_regle,avoir_de')
      .eq('camping_id', campingId).eq('resident_id', residentId).order('date_emission'),
    supabase.from('reglements')
      .select('id,date_reglement,mode,montant,reference,statut_cheque')
      .eq('camping_id', campingId).eq('resident_id', residentId).order('date_reglement'),
    supabase.from('moyens_paiement').select('code,libelle').eq('camping_id', campingId)
      .then((r) => r, () => ({ data: [] })),
  ]);

  const resident = resRes.data;
  if (!resident) return null;

  const mlib = {};
  (moyRes.data || []).forEach((m) => { mlib[m.code] = m.libelle; });

  // ---- Construction des mouvements ----
  const mouvements = [];

  for (const f of (factRes.data || [])) {
    const avoir = f.statut === 'avoir';
    mouvements.push({
      date: String(f.date_emission).slice(0, 10),
      type: avoir ? 'avoir' : 'facture',
      libelle: avoir
        ? `Avoir ${f.numero}`
        : `Facture ${f.numero}${f.periode ? ` — ${f.periode}` : ''}`,
      reference: f.numero,
      // le montant d'un avoir est déjà négatif : il vient naturellement en diminution
      debit: r2(f.total_ttc),
      credit: 0,
      facture_id: f.id,
      statut: f.statut,
    });
  }

  for (const g of (reglRes.data || [])) {
    mouvements.push({
      date: String(g.date_reglement).slice(0, 10),
      type: 'reglement',
      libelle: `Paiement — ${mlib[g.mode] || g.mode}${g.reference ? ` (${g.reference})` : ''}`,
      reference: g.reference || null,
      debit: 0,
      credit: r2(g.montant),
      reglement_id: g.id,
      mode: g.mode,
    });
  }

  // ordre chronologique ; à date égale, la facture précède le paiement
  const rang = { facture: 0, avoir: 1, reglement: 2 };
  mouvements.sort((a, b) => a.date.localeCompare(b.date) || (rang[a.type] - rang[b.type]));

  // ---- Années disponibles ----
  const annees = [...new Set(mouvements.map((m) => m.date.slice(0, 4)))].sort().reverse();
  const an = annee && annees.includes(String(annee)) ? String(annee) : (annees[0] || String(new Date().getFullYear()));

  // ---- Report à nouveau : solde à l'ouverture de l'année ----
  let report = 0;
  for (const m of mouvements) {
    if (m.date.slice(0, 4) < an) report = r2(report + m.debit - m.credit);
  }

  // ---- Mouvements de l'année, avec solde progressif ----
  const lignes = [];
  let solde = report;
  let totalDebit = 0, totalCredit = 0;

  for (const m of mouvements) {
    if (m.date.slice(0, 4) !== an) continue;
    solde = r2(solde + m.debit - m.credit);
    totalDebit = r2(totalDebit + m.debit);
    totalCredit = r2(totalCredit + m.credit);
    lignes.push({ ...m, solde });
  }

  // ---- Solde global, toutes années confondues ----
  const soldeTotal = r2(mouvements.reduce((s, m) => s + m.debit - m.credit, 0));

  // ---- Synthèse par année ----
  const parAnnee = {};
  for (const m of mouvements) {
    const a = m.date.slice(0, 4);
    parAnnee[a] = parAnnee[a] || { facture: 0, regle: 0, solde: 0 };
    parAnnee[a].facture = r2(parAnnee[a].facture + m.debit);
    parAnnee[a].regle = r2(parAnnee[a].regle + m.credit);
  }
  let cumul = 0;
  for (const a of Object.keys(parAnnee).sort()) {
    cumul = r2(cumul + parAnnee[a].facture - parAnnee[a].regle);
    parAnnee[a].solde = cumul;   // solde à la clôture de l'année
  }

  return {
    resident,
    annee: an,
    annees,
    report_a_nouveau: report,
    lignes,
    totaux: {
      facture: totalDebit,
      regle: totalCredit,
      solde_fin: solde,        // solde à la fin de l'année sélectionnée
    },
    solde_total: soldeTotal,   // ce que le client doit aujourd'hui, toutes années
    par_annee: parAnnee,
  };
}

module.exports = { buildReleve };

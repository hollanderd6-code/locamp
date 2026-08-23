// ============================================================
//  Lettrage du crédit d'avance
//  Applique le crédit non affecté d'un résident (règlements encaissés mais
//  non rattachés à des factures) sur ses factures impayées, plus anciennes
//  d'abord. Ne touche PAS la chaîne d'inaltérabilité : les `affectations`
//  ne sont pas scellées par inscrireReglement (seuls mode/date/montant/réf le sont).
// ============================================================
const { supabase } = require('./supabase');
const { recomputeFacture } = require('./paiement');

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;

// Renvoie { affecte, factures } : montant total nouvellement affecté et nb de factures touchées.
async function appliquerCredit(campingId, residentId, factureId = null) {
  if (!campingId || !residentId) return { affecte: 0, factures: 0 };

  // Règlements du résident (plus anciens d'abord) — on lira leur crédit non affecté.
  const { data: regs } = await supabase.from('reglements')
    .select('id,montant,affectations,date_reglement')
    .eq('camping_id', campingId).eq('resident_id', residentId)
    .order('date_reglement', { ascending: true });
  if (!regs || !regs.length) return { affecte: 0, factures: 0 };

  // Factures impayées ciblées (toutes, ou une précise), plus anciennes d'abord.
  let q = supabase.from('factures')
    .select('id,total_ttc,montant_regle,date_emission')
    .eq('camping_id', campingId).eq('resident_id', residentId)
    .in('statut', ['emise', 'partielle', 'en_retard']);
  if (factureId) q = q.eq('id', factureId);
  const { data: factures } = await q.order('date_emission', { ascending: true });

  const cibles = (factures || [])
    .map((f) => ({ id: f.id, reste: r2(Number(f.total_ttc) - Number(f.montant_regle || 0)) }))
    .filter((x) => x.reste > 0.004);
  if (!cibles.length) return { affecte: 0, factures: 0 };

  const touchees = new Set();
  let total = 0;

  for (const r of regs) {
    const deja = (r.affectations || []).reduce((s, a) => s + Number(a.montant || 0), 0);
    let credit = r2(Number(r.montant) - deja);
    if (credit <= 0.004) continue;

    const aff = Array.isArray(r.affectations) ? [...r.affectations] : [];
    let modifie = false;

    for (const f of cibles) {
      if (credit <= 0.004) break;
      if (f.reste <= 0.004) continue;
      const m = r2(Math.min(credit, f.reste));
      const ex = aff.find((a) => a.facture_id === f.id);
      if (ex) ex.montant = r2(Number(ex.montant || 0) + m);
      else aff.push({ facture_id: f.id, montant: m });
      credit = r2(credit - m);
      f.reste = r2(f.reste - m);
      total = r2(total + m);
      touchees.add(f.id);
      modifie = true;
    }
    if (modifie) await supabase.from('reglements').update({ affectations: aff }).eq('id', r.id);
  }

  for (const fid of touchees) await recomputeFacture(campingId, fid);
  return { affecte: total, factures: touchees.size };
}

/* Remet a plat l'imputation d'un resident : vide les affectations de tous
   ses reglements, puis les refait dans l'ordre chronologique.

   Les MONTANTS encaisses ne bougent pas — seule leur imputation change. La
   chaine d'inalterabilite scelle mode, date, montant et reference, pas les
   affectations (voir l'en-tete de ce fichier). Rien de fiscal n'est touche.

   C'est ce qui repare les dossiers ou le meme paiement a ete impute
   plusieurs fois faute de montant_regle a jour. */
async function relettrerResident(campingId, residentId) {
  if (!campingId || !residentId) return { remis: 0, affecte: 0, factures: 0 };

  const { data: regs, error } = await supabase.from('reglements')
    .select('id,affectations').eq('camping_id', campingId).eq('resident_id', residentId);
  if (error) throw error;

  /* Les factures a recalculer : celles que les anciennes affectations
     touchaient, plus celles que les nouvelles toucheront. Sans la premiere
     moitie, une facture qui perd son imputation garderait son ancien solde. */
  const aRecalculer = new Set();
  for (const r of (regs || [])) {
    for (const a of (r.affectations || [])) if (a.facture_id) aRecalculer.add(a.facture_id);
    if ((r.affectations || []).length) {
      await supabase.from('reglements').update({ affectations: [] }).eq('id', r.id);
    }
  }
  for (const fid of aRecalculer) await recomputeFacture(campingId, fid);

  const r = await appliquerCredit(campingId, residentId);
  return { remis: (regs || []).length, affecte: r.affecte, factures: r.factures };
}

module.exports = { appliquerCredit, relettrerResident };

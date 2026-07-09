const { supabase } = require('./supabase');

// Recalcule montant_regle + statut d'une facture à partir de tous les règlements qui l'affectent.
async function recomputeFacture(campingId, factureId) {
  const { data: facture } = await supabase.from('factures')
    .select('id,total_ttc,statut').eq('camping_id', campingId).eq('id', factureId).maybeSingle();
  if (!facture || ['avoir', 'annulee'].includes(facture.statut)) return;

  const { data: regs } = await supabase.from('reglements')
    .select('affectations').eq('camping_id', campingId)
    .contains('affectations', [{ facture_id: factureId }]);

  let regle = 0;
  for (const r of (regs || [])) {
    for (const a of (r.affectations || [])) {
      if (a.facture_id === factureId) regle += Number(a.montant || 0);
    }
  }
  regle = Math.round(regle * 100) / 100;
  const ttc = Number(facture.total_ttc || 0);
  let statut = 'emise';
  if (ttc > 0 && regle >= ttc) statut = 'reglee';
  else if (regle > 0) statut = 'partielle';
  await supabase.from('factures').update({ montant_regle: regle, statut }).eq('id', factureId);
  return { regle, statut };
}

// Répartit automatiquement un montant sur les factures impayées d'un résident (plus anciennes d'abord).
async function autoAffectations(campingId, residentId, montant) {
  const { data: factures } = await supabase.from('factures')
    .select('id,total_ttc,montant_regle').eq('camping_id', campingId).eq('resident_id', residentId)
    .in('statut', ['emise', 'partielle', 'en_retard']).order('date_emission', { ascending: true });

  let reste = Math.round(Number(montant) * 100) / 100;
  const aff = [];
  for (const f of (factures || [])) {
    if (reste <= 0) break;
    const du = Math.round((Number(f.total_ttc) - Number(f.montant_regle)) * 100) / 100;
    if (du <= 0) continue;
    const m = Math.min(reste, du);
    aff.push({ facture_id: f.id, montant: Math.round(m * 100) / 100 });
    reste = Math.round((reste - m) * 100) / 100;
  }
  return aff;
}

module.exports = { recomputeFacture, autoAffectations };

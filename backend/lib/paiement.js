const { supabase } = require('./supabase');

// Recalcule montant_regle + statut d'une facture à partir de tous les règlements qui l'affectent.
async function recomputeFacture(campingId, factureId) {
  const { data: facture } = await supabase.from('factures')
    .select('id,total_ttc,statut').eq('camping_id', campingId).eq('id', factureId).maybeSingle();
  if (!facture || ['avoir', 'annulee'].includes(facture.statut)) return;

  /* .contains() avec un TABLEAU JS serialise en tableau Postgres —
     join(',') sur des objets donne « cs.{[object Object]} », qui ne
     matche jamais. .filter(…, 'cs', …) passe la valeur telle quelle :
     affectations=cs.[{"facture_id":"…"}], la syntaxe du containment JSONB. */
  const { data: regs, error: errRegs } = await supabase.from('reglements')
    .select('affectations').eq('camping_id', campingId)
    .filter('affectations', 'cs', JSON.stringify([{ facture_id: factureId }]));

  /* Ce bug a vecu parce qu'il ne disait rien : la requete echouait, le
     resultat valait zero, et zero est un montant plausible. */
  if (errRegs) {
    console.error('[paiement:recompute] lecture des reglements impossible —',
      'facture', factureId, ':', errRegs.message);
    return;
  }

  let regle = 0;
  for (const r of (regs || [])) {
    for (const a of (r.affectations || [])) {
      if (a.facture_id === factureId) regle += Number(a.montant || 0);
    }
  }
  regle = Math.round(regle * 100) / 100;
  const ttc = Number(facture.total_ttc || 0);

  /* Plafond : on n'impute jamais plus que le du. Un calcul juste n'en a pas
     besoin — c'est pour le jour ou il cessera de l'etre. Sans lui, un
     trop-percu passe la facture en « soldee » et on cesse de la relancer. */
  if (ttc > 0 && regle > ttc) {
    console.warn('[paiement:recompute] affectations superieures au du —',
      'facture', factureId, ':', regle, '>', ttc);
    regle = Math.round(ttc * 100) / 100;
  }
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

const express = require('express');
const { supabase } = require('../lib/supabase');
const { listImpayes } = require('../lib/relances');
const { auth, campingScope } = require('../middleware/auth');

const router = express.Router();
router.use(auth, campingScope);

// GET /api/dashboard -> indicateurs clés du camping actif
router.get('/', async (req, res) => {
  try {
    const cid = req.activeCampingId;
    const now = new Date();
    const mois = now.toISOString().slice(0, 7);
    const dans30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const today = now.toISOString().slice(0, 10);

    // Exercice sélectionné (facultatif). Si fourni, CA/encaissements/impayés sont
    // cadrés sur [debut, fin] ; sinon comportement historique (mois courant).
    const exDebut = req.query.debut || null;
    const exFin = req.query.fin || null;
    const scoped = !!(exDebut && exFin);

    let factQ = supabase.from('factures').select('total_ttc,statut,date_emission').eq('camping_id', cid);
    factQ = scoped ? factQ.gte('date_emission', exDebut).lte('date_emission', exFin) : factQ.eq('periode', mois);
    let reglQ = supabase.from('reglements').select('mode,montant,date_reglement').eq('camping_id', cid);
    reglQ = scoped ? reglQ.gte('date_reglement', exDebut).lte('date_reglement', exFin) : reglQ.gte('date_reglement', `${mois}-01`);

    const [emps, facturesMois, reglesMois, impayesData, docsExp, contratsRenouv] = await Promise.all([
      supabase.from('emplacements').select('statut').eq('camping_id', cid),
      factQ,
      reglQ,
      listImpayes(cid, scoped ? { debut: exDebut, fin: exFin } : null),
      supabase.from('documents').select('id,type,date_expiration,resident_id').eq('camping_id', cid)
        .not('date_expiration', 'is', null).lte('date_expiration', dans30),
      supabase.from('contrats').select('id,numero,date_fin,resident_id').eq('camping_id', cid)
        .in('statut', ['signe', 'actif']).not('date_fin', 'is', null).lte('date_fin', dans30),
    ]);

    const emplacements = emps.data || [];
    const occ = emplacements.filter((e) => e.statut === 'occupe').length;
    const total = emplacements.length;

    const fmois = facturesMois.data || [];
    const caMois = Math.round(fmois.filter((f) => !['avoir', 'annulee', 'brouillon'].includes(f.statut))
      .reduce((s, f) => s + Number(f.total_ttc || 0), 0) * 100) / 100;
    const parStatut = {};
    fmois.forEach((f) => { parStatut[f.statut] = (parStatut[f.statut] || 0) + 1; });

    const parMode = {};
    (reglesMois.data || []).forEach((r) => { parMode[r.mode] = Math.round(((parMode[r.mode] || 0) + Number(r.montant || 0)) * 100) / 100; });

    res.json({
      occupation: { occupes: occ, total, taux: total ? Math.round((occ / total) * 100) : 0 },
      scoped,
      periode: scoped ? { debut: exDebut, fin: exFin } : null,
      ca_mois: caMois,
      factures_mois: { total: fmois.length, par_statut: parStatut },
      encaissements_mois: parMode,
      impayes: { total_du: impayesData.total_du, nombre: impayesData.impayes.length, balance_agee: impayesData.aging },
      alertes: {
        documents_expirant: (docsExp.data || []).length,
        contrats_a_renouveler: (contratsRenouv.data || []).map((c) => ({ id: c.id, numero: c.numero, date_fin: c.date_fin })),
      },
      genere_le: today,
    });
  } catch (e) { console.error('[dashboard]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;

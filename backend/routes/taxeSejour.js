const express = require('express');
const { supabase } = require('../lib/supabase');
const { auth, campingScope } = require('../middleware/auth');

const router = express.Router();
router.use(auth, campingScope);

// GET /api/taxe-sejour/etat?annee=2026  -> total collecté (lignes "Taxe de séjour") par mois
router.get('/etat', async (req, res) => {
  try {
    const annee = req.query.annee || String(new Date().getFullYear());
    const { data: factures, error } = await supabase.from('factures')
      .select('periode,lignes,statut')
      .eq('camping_id', req.activeCampingId)
      .like('periode', `${annee}-%`)
      .neq('statut', 'annulee');
    if (error) throw error;

    const parMois = {};
    let total = 0;
    for (const f of (factures || [])) {
      for (const l of (f.lignes || [])) {
        if (String(l.designation || '').toLowerCase().startsWith('taxe de séjour')) {
          const m = f.periode || 'inconnu';
          const mt = Number(l.montant_ht != null ? l.montant_ht : (l.quantite || 1) * (l.pu_ht || 0));
          parMois[m] = Math.round(((parMois[m] || 0) + mt) * 100) / 100;
          total = Math.round((total + mt) * 100) / 100;
        }
      }
    }
    res.json({ annee, total, par_mois: parMois });
  } catch (e) { console.error('[taxe:etat]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;

const express = require('express');
const { supabase } = require('../lib/supabase');
const { writeAudit } = require('../lib/audit');
const { buildEcritures, toFEC, toCSV } = require('../lib/comptabilite');
const { auth, campingScope, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(auth, campingScope);

function periode(req) {
  const fin = req.query.fin || new Date().toISOString().slice(0, 10);
  const debut = req.query.debut || `${fin.slice(0, 4)}-01-01`;
  return { debut, fin };
}

// GET /api/compta/ecritures?debut=YYYY-MM-DD&fin=YYYY-MM-DD  (JSON, inspection)
router.get('/ecritures', requireRole('admin', 'comptabilite'), async (req, res) => {
  try {
    const { debut, fin } = periode(req);
    const lignes = await buildEcritures(req.activeCampingId, debut, fin);
    const totDebit = lignes.reduce((s, l) => s + Number(String(l.Debit).replace(',', '.')), 0);
    const totCredit = lignes.reduce((s, l) => s + Number(String(l.Credit).replace(',', '.')), 0);
    res.json({ debut, fin, lignes, total_debit: Math.round(totDebit * 100) / 100, total_credit: Math.round(totCredit * 100) / 100 });
  } catch (e) { console.error('[compta:ecritures]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/compta/fec?debut&fin  -> fichier FEC (téléchargement)
router.get('/fec', requireRole('admin', 'comptabilite'), async (req, res) => {
  try {
    const { debut, fin } = periode(req);
    const lignes = await buildEcritures(req.activeCampingId, debut, fin);
    const { data: camp } = await supabase.from('campings').select('siret').eq('id', req.activeCampingId).maybeSingle();
    const siren = (camp?.siret || 'SIREN').replace(/\s/g, '').slice(0, 9);
    const fichier = `${siren}FEC${fin.replace(/-/g, '')}.txt`;
    await writeAudit(req, { action: 'export', entite: 'compta_fec', apres: { debut, fin, lignes: lignes.length } });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fichier}"`);
    res.send(toFEC(lignes));
  } catch (e) { console.error('[compta:fec]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/compta/export.csv?debut&fin  -> écritures en CSV générique
router.get('/export.csv', requireRole('admin', 'comptabilite'), async (req, res) => {
  try {
    const { debut, fin } = periode(req);
    const lignes = await buildEcritures(req.activeCampingId, debut, fin);
    await writeAudit(req, { action: 'export', entite: 'compta_csv', apres: { debut, fin, lignes: lignes.length } });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ecritures_${debut}_${fin}.csv"`);
    res.send(toCSV(lignes));
  } catch (e) { console.error('[compta:csv]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/compta/tva-encaissements?debut=YYYY-MM-DD&fin=YYYY-MM-DD
// Régime "TVA sur les encaissements" : la TVA est exigible au paiement.
// Ventile chaque règlement de la période par taux de TVA, au prorata des factures lettrées.
router.get('/tva-encaissements', requireRole('admin', 'comptabilite'), async (req, res) => {
  try {
    const { debut, fin } = periode(req);
    const [{ data: regs, error: e1 }, { data: factures, error: e2 }] = await Promise.all([
      supabase.from('reglements').select('id,resident_id,mode,montant,date_reglement,affectations')
        .eq('camping_id', req.activeCampingId).gte('date_reglement', debut).lte('date_reglement', fin)
        .order('date_reglement'),
      supabase.from('factures').select('id,numero,lignes,total_ttc,total_tva')
        .eq('camping_id', req.activeCampingId),
    ]);
    if (e1) throw e1; if (e2) throw e2;
    const fmap = {}; (factures || []).forEach((f) => { fmap[f.id] = f; });

    const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
    // Répartition TTC par taux d'une facture (à partir de ses lignes)
    function ttcParTaux(f) {
      const out = {};
      for (const l of (f.lignes || [])) {
        const ht = Number(l.montant_ht != null ? l.montant_ht : (l.quantite || 1) * (l.pu_ht || 0));
        const taux = Number(l.taux_tva || 0);
        out[taux] = (out[taux] || 0) + ht * (1 + taux / 100);
      }
      return out;
    }

    const parTaux = {};      // taux -> { base_ht, tva, ttc }
    const detail = [];
    let nonVentile = 0;      // encaissements sans lettrage (TVA indéterminable)
    for (const g of (regs || [])) {
      const affs = Array.isArray(g.affectations) ? g.affectations : [];
      let resteRegl = Number(g.montant || 0);
      const dSplit = {};
      for (const a of affs) {
        const f = fmap[a.facture_id];
        if (!f || !Number(f.total_ttc)) continue;
        const part = Math.min(Number(a.montant || 0), resteRegl);
        resteRegl = r2(resteRegl - part);
        const repart = ttcParTaux(f);
        const totTtc = Object.values(repart).reduce((s2, v) => s2 + v, 0) || Number(f.total_ttc);
        for (const [taux, ttcTaux] of Object.entries(repart)) {
          const ratio = ttcTaux / totTtc;
          const encaisseTaux = part * ratio;
          const t = Number(taux);
          const ht = encaisseTaux / (1 + t / 100);
          const tva = encaisseTaux - ht;
          if (!parTaux[t]) parTaux[t] = { base_ht: 0, tva: 0, ttc: 0 };
          parTaux[t].base_ht += ht; parTaux[t].tva += tva; parTaux[t].ttc += encaisseTaux;
          dSplit[t] = r2((dSplit[t] || 0) + encaisseTaux);
        }
      }
      if (resteRegl > 0.004) nonVentile = r2(nonVentile + resteRegl);
      detail.push({ id: g.id, date: g.date_reglement, mode: g.mode, montant: g.montant, ventilation: dSplit,
        non_ventile: resteRegl > 0.004 ? resteRegl : 0 });
    }
    for (const t in parTaux) { parTaux[t].base_ht = r2(parTaux[t].base_ht); parTaux[t].tva = r2(parTaux[t].tva); parTaux[t].ttc = r2(parTaux[t].ttc); }
    const totalTva = r2(Object.values(parTaux).reduce((s2, v) => s2 + v.tva, 0));
    res.json({ debut, fin, par_taux: parTaux, total_tva_exigible: totalTva, non_ventile: nonVentile, reglements: detail });
  } catch (e) { console.error('[compta:tva-enc]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;

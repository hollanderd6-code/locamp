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

module.exports = router;

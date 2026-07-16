const express = require('express');
const PDFDocument = require('pdfkit');
const { supabase } = require('../lib/supabase');
const { writeAudit } = require('../lib/audit');
const { exStart, exLabel, exBornes } = require('../lib/releve');
const { auth, campingScope, requirePerm } = require('../middleware/auth');

const router = express.Router();
router.use(auth, campingScope);

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const fmtD = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '');

async function debutMois(campingId) {
  const { data } = await supabase.from('campings').select('parametres').eq('id', campingId).maybeSingle();
  return Math.min(Math.max(Number((data?.parametres || {}).exercice_debut_mois || 1), 1), 12);
}

// Calcule, en bulk, les soldes de clôture de tous les résidents pour l'exercice `annee`
// (année de début de l'exercice). Respecte les seaux de l'exercice précédent.
async function soldesExercice(campingId, annee, dm) {
  const [{ data: residents }, { data: factures }, { data: reglements }, { data: prevSeal }, { data: selfSeal }] = await Promise.all([
    supabase.from('residents').select('id,nom,prenom,compte_comptable').eq('camping_id', campingId),
    supabase.from('factures').select('resident_id,date_emission,total_ttc,statut')
      .eq('camping_id', campingId).neq('statut', 'brouillon'),
    supabase.from('reglements').select('resident_id,date_reglement,montant').eq('camping_id', campingId),
    supabase.from('cloture_soldes').select('resident_id,solde').eq('camping_id', campingId).eq('exercice', annee - 1)
      .then((r) => r, () => ({ data: [] })),
    supabase.from('cloture_soldes').select('resident_id').eq('camping_id', campingId).eq('exercice', annee)
      .then((r) => r, () => ({ data: [] })),
  ]);
  const prev = {}; (prevSeal || []).forEach((c) => { prev[c.resident_id] = r2(c.solde); });
  const scelle = (selfSeal || []).length > 0;

  // Agrégats par résident : sumPrev (ex<annee), factEx et regleEx (ex==annee)
  const agg = {};
  const acc = (rid) => (agg[rid] = agg[rid] || { sumPrev: 0, factEx: 0, regleEx: 0 });
  for (const f of (factures || [])) {
    if (!f.resident_id) continue;
    const ex = exStart(f.date_emission, dm);
    const a = acc(f.resident_id);
    if (ex < annee) a.sumPrev = r2(a.sumPrev + Number(f.total_ttc || 0));
    else if (ex === annee) a.factEx = r2(a.factEx + Number(f.total_ttc || 0));
  }
  for (const g of (reglements || [])) {
    if (!g.resident_id) continue;
    const ex = exStart(g.date_reglement, dm);
    const a = acc(g.resident_id);
    if (ex < annee) a.sumPrev = r2(a.sumPrev - Number(g.montant || 0));
    else if (ex === annee) a.regleEx = r2(a.regleEx + Number(g.montant || 0));
  }

  const lignes = [];
  for (const rr of (residents || [])) {
    const a = agg[rr.id] || { sumPrev: 0, factEx: 0, regleEx: 0 };
    const ouverture = prev[rr.id] != null ? prev[rr.id] : r2(a.sumPrev);
    const cloture = r2(ouverture + a.factEx - a.regleEx);
    // On retient les résidents ayant un solde ou de l'activité sur l'exercice.
    if (Math.abs(ouverture) < 0.005 && a.factEx < 0.005 && a.regleEx < 0.005 && Math.abs(cloture) < 0.005) continue;
    lignes.push({
      resident_id: rr.id,
      nom: `${rr.prenom ? rr.prenom + ' ' : ''}${rr.nom || ''}`.trim(),
      compte_comptable: rr.compte_comptable || null,
      report_ouverture: ouverture, facture: a.factEx, regle: a.regleEx, solde_cloture: cloture,
    });
  }
  lignes.sort((x, y) => x.nom.localeCompare(y.nom));
  const totaux = lignes.reduce((t, l) => ({
    report_ouverture: r2(t.report_ouverture + l.report_ouverture),
    facture: r2(t.facture + l.facture), regle: r2(t.regle + l.regle),
    solde_cloture: r2(t.solde_cloture + l.solde_cloture),
  }), { report_ouverture: 0, facture: 0, regle: 0, solde_cloture: 0 });
  return { lignes, totaux, scelle };
}

// GET /api/exercices  -> liste des exercices connus + statut de clôture
router.get('/', requirePerm('compta'), async (req, res) => {
  try {
    const dm = await debutMois(req.activeCampingId);
    const [{ data: f }, { data: g }, { data: clo }] = await Promise.all([
      supabase.from('factures').select('date_emission').eq('camping_id', req.activeCampingId).neq('statut', 'brouillon'),
      supabase.from('reglements').select('date_reglement').eq('camping_id', req.activeCampingId),
      supabase.from('cloture_soldes').select('exercice,scellee_at').eq('camping_id', req.activeCampingId)
        .then((r) => r, () => ({ data: [] })),
    ]);
    const set = new Set();
    (f || []).forEach((x) => set.add(exStart(x.date_emission, dm)));
    (g || []).forEach((x) => set.add(exStart(x.date_reglement, dm)));
    const sealMap = {};
    (clo || []).forEach((c) => { sealMap[c.exercice] = sealMap[c.exercice] || c.scellee_at; set.add(Number(c.exercice)); });
    const now = exStart(new Date().toISOString(), dm);
    set.add(now);
    const exercices = [...set].sort((a, b) => b - a).map((y) => {
      const { debut, fin } = exBornes(y, dm);
      return { annee: y, label: exLabel(y, dm), debut, fin, scelle: !!sealMap[y], scellee_at: sealMap[y] || null,
        courant: y === now };
    });
    res.json({ debut_mois: dm, exercices });
  } catch (e) { console.error('[exercices:list]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/exercices/:annee/soldes  -> soldes de clôture par résident (aperçu ou scellé)
router.get('/:annee/soldes', requirePerm('compta'), async (req, res) => {
  try {
    const annee = Number(req.params.annee);
    const dm = await debutMois(req.activeCampingId);
    const { lignes, totaux, scelle } = await soldesExercice(req.activeCampingId, annee, dm);
    const { debut, fin } = exBornes(annee, dm);
    res.json({ annee, label: exLabel(annee, dm), debut, fin, scelle, lignes, totaux });
  } catch (e) { console.error('[exercices:soldes]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/exercices/:annee/cloturer  -> scelle les soldes de l'exercice (immuable)
router.post('/:annee/cloturer', requirePerm('compta'), async (req, res) => {
  try {
    const annee = Number(req.params.annee);
    const dm = await debutMois(req.activeCampingId);
    const { data: deja } = await supabase.from('cloture_soldes').select('id')
      .eq('camping_id', req.activeCampingId).eq('exercice', annee).limit(1)
      .then((r) => r, () => ({ data: [] }));
    if ((deja || []).length) return res.status(409).json({ error: `Exercice ${exLabel(annee, dm)} déjà clôturé.` });

    const { lignes, totaux } = await soldesExercice(req.activeCampingId, annee, dm);
    const now = new Date().toISOString();
    const rows = lignes.map((l) => ({
      camping_id: req.activeCampingId, exercice: annee, resident_id: l.resident_id,
      resident_nom: l.nom, compte_comptable: l.compte_comptable,
      solde: l.solde_cloture, scellee_at: now,
    }));
    if (rows.length) {
      const { error } = await supabase.from('cloture_soldes').insert(rows);
      if (error) throw error;
    }
    await writeAudit(req, { action: 'cloture', entite: 'cloture_soldes', entite_id: null,
      apres: { exercice: annee, residents: rows.length, solde_total: totaux.solde_cloture } });
    res.json({ ok: true, annee, label: exLabel(annee, dm), residents: rows.length, totaux });
  } catch (e) { console.error('[exercices:cloturer]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/exercices/:annee/soldes.csv
router.get('/:annee/soldes.csv', requirePerm('compta'), async (req, res) => {
  try {
    const annee = Number(req.params.annee);
    const dm = await debutMois(req.activeCampingId);
    const { lignes, totaux } = await soldesExercice(req.activeCampingId, annee, dm);
    const esc = (s) => `"${String(s == null ? '' : s).replace(/"/g, '""')}"`;
    const rows = [['Compte', 'Client', 'Report ouverture', 'Facturé', 'Réglé', 'Solde clôture']
      .map(esc).join(';')];
    for (const l of lignes) {
      rows.push([l.compte_comptable, l.nom, l.report_ouverture, l.facture, l.regle, l.solde_cloture]
        .map((v, i) => (i < 2 ? esc(v) : String(v).replace('.', ',')))
        .join(';'));
    }
    rows.push(['', 'TOTAL', totaux.report_ouverture, totaux.facture, totaux.regle, totaux.solde_cloture]
      .map((v, i) => (i < 2 ? esc(v) : String(v).replace('.', ','))).join(';'));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="soldes_${exLabel(annee, dm).replace('/', '-')}.csv"`);
    res.send('\uFEFF' + rows.join('\r\n'));
  } catch (e) { console.error('[exercices:csv]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/exercices/:annee/soldes.pdf
router.get('/:annee/soldes.pdf', requirePerm('compta'), async (req, res) => {
  try {
    const annee = Number(req.params.annee);
    const dm = await debutMois(req.activeCampingId);
    const [{ lignes, totaux, scelle }, { data: camp }] = await Promise.all([
      soldesExercice(req.activeCampingId, annee, dm),
      supabase.from('campings').select('nom,raison_sociale,adresse,siret').eq('id', req.activeCampingId).maybeSingle(),
    ]);
    const { debut, fin } = exBornes(annee, dm);
    const c = camp || {};
    const GREEN = '#175243';
    const eur = (n) => `${Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = []; doc.on('data', (x) => chunks.push(x));
    const done = new Promise((r) => doc.on('end', r));

    doc.fillColor('#111').font('Helvetica-Bold').fontSize(13).text(c.nom || c.raison_sociale || 'Camping', 40, 40);
    doc.font('Helvetica').fontSize(8.5).fillColor('#666')
      .text(`Édité le ${new Date().toLocaleDateString('fr-FR')} par Locamp`, 300, 42, { width: 255, align: 'right' });
    if (c.siret) doc.fillColor('#555').fontSize(8.5).text(`SIRET ${c.siret}`, 40, 58);

    doc.moveDown(1.6);
    doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(13)
      .text(`Soldes clients — exercice ${exLabel(annee, dm)} (${fmtD(debut)} → ${fmtD(fin)})`, 40, doc.y, { width: 515, align: 'center' });
    if (scelle) doc.font('Helvetica').fontSize(9).fillColor('#888').text('Exercice clôturé (soldes scellés)', 40, doc.y + 2, { width: 515, align: 'center' });
    doc.moveDown(1);

    const X = { cpt: 42, nom: 110, rep: 300, fac: 372, reg: 444, sol: 553 };
    const enTete = () => {
      const yy = doc.y;
      doc.rect(40, yy, 515, 16).fill(GREEN);
      doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8);
      doc.text('Compte', X.cpt, yy + 4); doc.text('Client', X.nom, yy + 4);
      doc.text('Report', X.rep - 40, yy + 4, { width: 62, align: 'right' });
      doc.text('Facturé', X.fac - 40, yy + 4, { width: 62, align: 'right' });
      doc.text('Réglé', X.reg - 40, yy + 4, { width: 62, align: 'right' });
      doc.text('Solde', X.sol - 62, yy + 4, { width: 62, align: 'right' });
      doc.y = yy + 18;
    };
    enTete();
    doc.font('Helvetica').fontSize(8.5).fillColor('#222');
    for (const l of lignes) {
      if (doc.y > 780) { doc.addPage(); enTete(); doc.font('Helvetica').fontSize(8.5).fillColor('#222'); }
      const y = doc.y;
      doc.text(l.compte_comptable || '—', X.cpt, y, { width: 66 });
      doc.text(l.nom, X.nom, y, { width: 185 });
      doc.text(eur(l.report_ouverture), X.rep - 40, y, { width: 62, align: 'right' });
      doc.text(eur(l.facture), X.fac - 40, y, { width: 62, align: 'right' });
      doc.text(eur(l.regle), X.reg - 40, y, { width: 62, align: 'right' });
      doc.font('Helvetica-Bold').text(eur(l.solde_cloture), X.sol - 62, y, { width: 62, align: 'right' });
      doc.font('Helvetica');
      doc.y = y + 14;
    }
    doc.moveDown(0.3);
    const yt = doc.y;
    doc.rect(40, yt, 515, 16).fill('#EFEAE0');
    doc.fillColor('#111').font('Helvetica-Bold').fontSize(8.5);
    doc.text('TOTAL', X.nom, yt + 4);
    doc.text(eur(totaux.report_ouverture), X.rep - 40, yt + 4, { width: 62, align: 'right' });
    doc.text(eur(totaux.facture), X.fac - 40, yt + 4, { width: 62, align: 'right' });
    doc.text(eur(totaux.regle), X.reg - 40, yt + 4, { width: 62, align: 'right' });
    doc.text(eur(totaux.solde_cloture), X.sol - 62, yt + 4, { width: 62, align: 'right' });

    doc.end(); await done;
    const pdf = Buffer.concat(chunks);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="soldes_${exLabel(annee, dm).replace('/', '-')}.pdf"`);
    res.send(pdf);
  } catch (e) { console.error('[exercices:pdf]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;

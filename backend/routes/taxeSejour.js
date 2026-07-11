const express = require('express');
const PDFDocument = require('pdfkit');
const { supabase } = require('../lib/supabase');
const { writeAudit } = require('../lib/audit');
const { auth, campingScope } = require('../middleware/auth');

const router = express.Router();
router.use(auth, campingScope);

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const estTaxe = (d) => String(d || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').startsWith('taxe de sejour');

const fmtD = (d) => {
  if (!d) return '';
  const [a, m, j] = String(d).slice(0, 10).split('-');
  return `${j}/${m}/${a}`;
};

// Reconstruit le détail d'une ligne de taxe : personnes, nuits, tarif, nuitées.
function detailTaxe(ligne, tarifDefaut) {
  const m = String(ligne.designation || '').match(/\((\d+)\s*pers[^0-9]*(\d+)\s*nuit/i);
  let personnes = m ? Number(m[1]) : null;
  let nuits = m ? Number(m[2]) : (ligne.nuits != null ? Number(ligne.nuits) : null);

  const montant = r2(ligne.montant_ht != null ? ligne.montant_ht
    : Number(ligne.quantite || 1) * Number(ligne.pu_ht || 0));

  if (nuits == null && ligne.date_debut && ligne.date_fin) {
    const d = Math.round((new Date(ligne.date_fin) - new Date(ligne.date_debut)) / 86400000);
    nuits = d > 0 ? d : null;
  }

  let tarif = Number(tarifDefaut || 0);
  let nuitees = (personnes != null && nuits != null) ? personnes * nuits : null;
  if (tarif > 0) {
    const calc = montant / tarif;
    if (nuitees == null || Math.abs(calc - nuitees) > 0.5) nuitees = Math.round(calc);
  } else if (nuitees) {
    tarif = r2(montant / nuitees);
  }
  if (personnes == null && nuitees != null && nuits) personnes = Math.max(1, Math.round(nuitees / nuits));

  return { personnes, nuits, nuitees, tarif, montant };
}

async function releve(campingId, debut, fin) {
  const [{ data: camping }, { data: factures }, { data: residents }] = await Promise.all([
    supabase.from('campings').select('nom,raison_sociale,adresse,siret,parametres').eq('id', campingId).maybeSingle(),
    supabase.from('factures').select('id,numero,date_emission,statut,resident_id,lignes')
      .eq('camping_id', campingId).neq('statut', 'annulee').order('numero'),
    supabase.from('residents').select('id,nom,prenom').eq('camping_id', campingId),
  ]);

  const rmap = {};
  (residents || []).forEach((r) => { rmap[r.id] = `${r.nom || ''}${r.prenom ? ' ' + r.prenom : ''}`.trim(); });
  const tarif = Number(camping?.parametres?.taxe_sejour?.tarif_nuit_personne || 0);

  const lignes = [];
  for (const f of (factures || [])) {
    const avoir = f.statut === 'avoir';
    for (const l of (f.lignes || [])) {
      if (!estTaxe(l.designation)) continue;
      // Période de SÉJOUR (et non date de facture) : c'est ce que demande la collectivité.
      const du = String(l.date_debut || f.date_emission).slice(0, 10);
      const au = String(l.date_fin || l.date_debut || f.date_emission).slice(0, 10);
      if (du < debut || du > fin) continue;

      const d = detailTaxe(l, tarif);
      const signe = avoir ? -1 : 1;
      lignes.push({
        type: avoir ? 'AV' : 'FA',
        numero: f.numero,
        resident: rmap[f.resident_id] || '—',
        du, au,
        tarif: d.tarif,
        personnes: d.personnes != null ? signe * d.personnes : null,
        nuitees: d.nuitees != null ? signe * d.nuitees : null,
        montant: signe * d.montant,
      });
    }
  }

  lignes.sort((a, b) => String(a.numero).localeCompare(String(b.numero), 'fr', { numeric: true }));

  const totaux = lignes.reduce((t, l) => ({
    personnes: t.personnes + (l.personnes || 0),
    nuitees: t.nuitees + (l.nuitees || 0),
    montant: r2(t.montant + l.montant),
  }), { personnes: 0, nuitees: 0, montant: 0 });

  return { camping: camping || {}, tarif, debut, fin, lignes, totaux };
}

// GET /api/taxe-sejour/releve?debut=&fin=
router.get('/releve', async (req, res) => {
  try {
    const debut = req.query.debut || `${new Date().getFullYear()}-01-01`;
    const fin = req.query.fin || new Date().toISOString().slice(0, 10);
    const d = await releve(req.activeCampingId, debut, fin);
    res.json({ debut, fin, tarif: d.tarif, lignes: d.lignes, totaux: d.totaux });
  } catch (e) { console.error('[taxe:releve]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/taxe-sejour/releve.csv?debut=&fin=
router.get('/releve.csv', async (req, res) => {
  try {
    const debut = req.query.debut || `${new Date().getFullYear()}-01-01`;
    const fin = req.query.fin || new Date().toISOString().slice(0, 10);
    const d = await releve(req.activeCampingId, debut, fin);

    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const num = (v) => esc(Number(v || 0).toFixed(2).replace('.', ','));
    const out = [['Type', 'N° facture', 'Nom Prénom', 'Taxe', 'P.U', 'Du', 'Au', 'Nb pers.', 'Nuitées', 'Montant'].join(';')];
    for (const l of d.lignes) {
      out.push([esc(l.type), esc(l.numero), esc(l.resident), esc('Taxe de séjour'),
        num(l.tarif), esc(fmtD(l.du)), esc(fmtD(l.au)),
        esc(l.personnes ?? ''), esc(l.nuitees ?? ''), num(l.montant)].join(';'));
    }
    out.push(['', '', '', '', '', '', esc('TOTAL'), esc(d.totaux.personnes), esc(d.totaux.nuitees),
      num(d.totaux.montant)].join(';'));

    await writeAudit(req, { action: 'export', entite: 'taxe_sejour',
      apres: { debut, fin, lignes: d.lignes.length, total: d.totaux.montant } });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="taxe_sejour_${debut}_${fin}.csv"`);
    res.send('\uFEFF' + out.join('\r\n'));
  } catch (e) { console.error('[taxe:csv]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/taxe-sejour/releve.pdf  -> justificatif pour la collectivité
router.get('/releve.pdf', async (req, res) => {
  try {
    const debut = req.query.debut || `${new Date().getFullYear()}-01-01`;
    const fin = req.query.fin || new Date().toISOString().slice(0, 10);
    const d = await releve(req.activeCampingId, debut, fin);
    const c = d.camping;

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', (x) => chunks.push(x));
    const done = new Promise((r) => doc.on('end', r));

    const GREEN = '#175243';
    const nomCamping = c.nom || c.raison_sociale || 'Camping';

    doc.fillColor('#111').font('Helvetica-Bold').fontSize(13).text(nomCamping, 40, 40);
    doc.font('Helvetica').fontSize(8.5).fillColor('#666')
      .text(`Édité le ${new Date().toLocaleDateString('fr-FR')} par Locamp`, 300, 42, { width: 255, align: 'right' });
    doc.fillColor('#555').fontSize(8.5);
    if (c.adresse) doc.text(c.adresse, 40, 58);
    if (c.siret) doc.text(`SIRET ${c.siret}`, 40, doc.y);

    doc.moveDown(1.5);
    doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(13)
      .text(`Relevé des taxes de séjour du ${fmtD(debut)} au ${fmtD(fin)}`, 40, doc.y, { width: 515, align: 'center' });
    doc.moveDown(0.9);

    // colonnes (x de fin pour les nombres cadrés à droite)
    const X = { type: 42, num: 66, nom: 112, taxe: 244, pu: 322, du: 352, au: 404, pers: 462, nuit: 500, mt: 555 };
    const enTete = () => {
      const yy = doc.y;
      doc.rect(40, yy, 515, 16).fill(GREEN);
      doc.fillColor('#fff').font('Helvetica-Bold').fontSize(7);
      doc.text('N° facture', X.num, yy + 5, { width: 44 });
      doc.text('Nom Prénom', X.nom, yy + 5, { width: 130 });
      doc.text('Taxe', X.taxe, yy + 5, { width: 68 });
      doc.text('P.U', X.pu - 12, yy + 5, { width: 30, align: 'right' });
      doc.text('Du', X.du, yy + 5, { width: 46 });
      doc.text('Au', X.au, yy + 5, { width: 46 });
      doc.text('Nb pers.', X.pers - 40, yy + 5, { width: 40, align: 'right' });
      doc.text('Nuitées', X.nuit - 38, yy + 5, { width: 38, align: 'right' });
      doc.text('Montant', X.mt - 52, yy + 5, { width: 52, align: 'right' });
      doc.y = yy + 20;
    };
    enTete();

    doc.font('Helvetica').fontSize(7.5);
    let alt = false;
    for (const l of d.lignes) {
      if (doc.y > 755) { doc.addPage(); doc.y = 40; enTete(); doc.font('Helvetica').fontSize(7.5); }
      const yy = doc.y;
      if (alt) doc.rect(40, yy - 2, 515, 12).fillOpacity(0.05).fill(GREEN).fillOpacity(1);
      alt = !alt;
      doc.fillColor(l.type === 'AV' ? '#A8402A' : '#666').text(l.type, X.type, yy, { width: 20 });
      doc.fillColor('#222').text(String(l.numero || ''), X.num, yy, { width: 44 });
      doc.text(l.resident, X.nom, yy, { width: 132 });
      doc.fillColor('#555').text('Taxe de séjour', X.taxe, yy, { width: 70 });
      doc.text(l.tarif ? l.tarif.toFixed(2).replace('.', ',') : '', X.pu - 12, yy, { width: 30, align: 'right' });
      doc.text(fmtD(l.du), X.du, yy, { width: 48 });
      doc.text(fmtD(l.au), X.au, yy, { width: 48 });
      doc.text(l.personnes != null ? String(l.personnes) : '', X.pers - 40, yy, { width: 40, align: 'right' });
      doc.text(l.nuitees != null ? String(l.nuitees) : '', X.nuit - 38, yy, { width: 38, align: 'right' });
      doc.fillColor('#111').text(l.montant.toFixed(2).replace('.', ','), X.mt - 52, yy, { width: 52, align: 'right' });
      doc.y = yy + 11;
    }

    const yy = doc.y + 5;
    doc.rect(350, yy, 205, 18).fill('#EFEAE0');
    doc.fillColor('#111').font('Helvetica-Bold').fontSize(8);
    doc.text('TOTAL', 358, yy + 5, { width: 60 });
    doc.text(String(d.totaux.personnes), X.pers - 40, yy + 5, { width: 40, align: 'right' });
    doc.text(String(d.totaux.nuitees), X.nuit - 38, yy + 5, { width: 38, align: 'right' });
    doc.text(d.totaux.montant.toFixed(2).replace('.', ',') + ' €', X.mt - 62, yy + 5, { width: 62, align: 'right' });
    doc.y = yy + 28;

    doc.font('Helvetica').fontSize(7).fillColor('#888')
      .text(`${d.lignes.length} ligne(s). Document justificatif établi par ${nomCamping} à l'attention de la collectivité percevant la taxe de séjour. Tarif appliqué : ${d.tarif.toFixed(2).replace('.', ',')} € par nuitée et par personne.`,
        40, doc.y, { width: 515 });

    doc.end();
    await done;

    await writeAudit(req, { action: 'export', entite: 'taxe_sejour',
      apres: { debut, fin, doc: 'pdf', total: d.totaux.montant } });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="taxe_sejour_${debut}_${fin}.pdf"`);
    res.send(Buffer.concat(chunks));
  } catch (e) { console.error('[taxe:pdf]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/taxe-sejour/etat?annee=  (totaux par mois)
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
        if (!estTaxe(l.designation)) continue;
        const m = f.periode || 'inconnu';
        const mt = Number(l.montant_ht != null ? l.montant_ht : (l.quantite || 1) * (l.pu_ht || 0));
        const signe = f.statut === 'avoir' ? -1 : 1;
        parMois[m] = r2((parMois[m] || 0) + signe * mt);
        total = r2(total + signe * mt);
      }
    }
    res.json({ annee, total, par_mois: parMois });
  } catch (e) { console.error('[taxe:etat]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;

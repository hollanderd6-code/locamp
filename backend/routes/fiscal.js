const express = require('express');
const PDFDocument = require('pdfkit');
const { supabase } = require('../lib/supabase');
const { writeAudit } = require('../lib/audit');
const { verifierChaine, cloturer } = require('../lib/fiscal');
const { auth, campingScope, requirePerm } = require('../middleware/auth');

const router = express.Router();
router.use(auth, campingScope);

const eur = (n) => Number(n || 0).toFixed(2).replace('.', ',') + ' €';
const dt = (d) => (d ? new Date(d).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }) : '—');

// GET /api/fiscal/etat  -> intégrité de la chaîne + dernières clôtures
router.get('/etat', requirePerm('compta'), async (req, res) => {
  try {
    const [chaine, clotRes] = await Promise.all([
      verifierChaine(req.activeCampingId),
      supabase.from('clotures_fiscales').select('*')
        .eq('camping_id', req.activeCampingId).order('horodatage', { ascending: false }).limit(24),
    ]);
    const clotures = clotRes.data || [];
    res.json({
      chaine,
      clotures,
      cumul_perpetuel: clotures[0]?.cumul_perpetuel ?? 0,
    });
  } catch (e) {
    console.error('[fiscal:etat]', e.message);
    res.status(500).json({ error: 'Conformité fiscale indisponible — la migration db/17_conformite_fiscale.sql a-t-elle été exécutée ?' });
  }
});

// GET /api/fiscal/journal?limit=  -> derniers événements de la chaîne
router.get('/journal', requirePerm('compta'), async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 100), 500);
    const { data, error } = await supabase.from('journal_fiscal')
      .select('seq,type,entite,entite_id,donnees,montant,hash,hash_precedent,auteur_email,horodatage')
      .eq('camping_id', req.activeCampingId).order('seq', { ascending: false }).limit(limit);
    if (error) throw error;
    res.json({ evenements: data || [] });
  } catch (e) { console.error('[fiscal:journal]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/fiscal/cloturer  { type, periode }
router.post('/cloturer', requirePerm('compta'), async (req, res) => {
  try {
    const { type, periode } = req.body || {};
    if (!['journaliere', 'mensuelle', 'annuelle'].includes(type)) {
      return res.status(400).json({ error: 'Type de clôture invalide' });
    }
    if (!periode) return res.status(400).json({ error: 'Période requise' });

    const out = await cloturer(req.activeCampingId, type, periode, req);
    if (out.deja_cloturee) {
      return res.status(409).json({ error: `Période ${periode} déjà clôturée — une clôture est définitive.` });
    }
    await writeAudit(req, { action: 'create', entite: 'clotures_fiscales', entite_id: out.cloture.id,
      apres: { type, periode, total_ttc: out.cloture.total_ttc, hash: out.cloture.hash } });
    res.status(201).json({ cloture: out.cloture });
  } catch (e) { console.error('[fiscal:cloturer]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/fiscal/archive?debut=&fin=  -> archive JSON signée (conservation 6 ans)
router.get('/archive', requirePerm('compta'), async (req, res) => {
  try {
    const debut = req.query.debut || '2000-01-01';
    const fin = req.query.fin || new Date().toISOString().slice(0, 10);

    const [{ data: camping }, { data: evts }, { data: clots }, chaine] = await Promise.all([
      supabase.from('campings').select('nom,raison_sociale,siret').eq('id', req.activeCampingId).maybeSingle(),
      supabase.from('journal_fiscal').select('*').eq('camping_id', req.activeCampingId)
        .gte('horodatage', debut).lte('horodatage', fin + 'T23:59:59').order('seq'),
      supabase.from('clotures_fiscales').select('*').eq('camping_id', req.activeCampingId)
        .gte('horodatage', debut).lte('horodatage', fin + 'T23:59:59').order('horodatage'),
      verifierChaine(req.activeCampingId),
    ]);

    const archive = {
      logiciel: 'Locamp',
      reference_legale: 'Article 286-I-3° bis du CGI — inaltérabilité, sécurisation, conservation, archivage',
      camping: camping || {},
      periode: { debut, fin },
      genere_le: new Date().toISOString(),
      integrite: { chaine_intacte: chaine.integre, anomalies: chaine.anomalies,
        empreinte_finale: chaine.empreinte_finale },
      journal_fiscal: evts || [],
      clotures: clots || [],
    };

    await writeAudit(req, { action: 'export', entite: 'journal_fiscal',
      apres: { debut, fin, evenements: (evts || []).length, doc: 'archive' } });

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="archive_fiscale_${debut}_${fin}.json"`);
    res.send(JSON.stringify(archive, null, 2));
  } catch (e) { console.error('[fiscal:archive]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/fiscal/attestation.pdf  -> attestation individuelle de l'éditeur
// (rétablie par l'art. 125 de la loi de finances 2026 — loi n° 2026-103 du 19 février 2026)
router.get('/attestation.pdf', requirePerm('compta'), async (req, res) => {
  try {
    const [{ data: camping }, chaine] = await Promise.all([
      supabase.from('campings').select('nom,raison_sociale,adresse,siret,tva,parametres')
        .eq('id', req.activeCampingId).maybeSingle(),
      verifierChaine(req.activeCampingId),
    ]);
    const c = camping || {};
    const ed = (c.parametres || {}).editeur || {};
    const nomEditeur = ed.nom || c.raison_sociale || c.nom || '—';
    const siretEditeur = ed.siret || c.siret || '—';

    const doc = new PDFDocument({ size: 'A4', margin: 56 });
    const chunks = [];
    doc.on('data', (x) => chunks.push(x));
    const fini = new Promise((r) => doc.on('end', r));
    const GREEN = '#175243';

    doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(17)
      .text('ATTESTATION INDIVIDUELLE DE CONFORMITÉ', { align: 'center' });
    doc.fillColor('#555').font('Helvetica').fontSize(9)
      .text('Logiciel de gestion et d\u2019encaissement — article 286-I-3° bis du code général des impôts',
        { align: 'center' });
    doc.moveDown(2);

    const p = (t, o = {}) => { doc.fillColor('#222').font(o.b ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(o.s || 10).text(t, { align: o.a || 'left', width: 483 }); doc.moveDown(o.md ?? 0.6); };

    p('L\u2019éditeur soussigné,', { md: 0.8 });
    p(`${nomEditeur}${siretEditeur !== '—' ? `, SIRET ${siretEditeur}` : ''}`, { b: true, md: 1.2 });

    p('atteste que le logiciel :', { md: 0.5 });
    p('Locamp — gestion de camping résidentiel (facturation, encaissements, comptabilité)', { b: true, md: 1.2 });

    p('utilisé par :', { md: 0.5 });
    p(`${c.raison_sociale || c.nom || '—'}${c.siret ? `, SIRET ${c.siret}` : ''}`
      + `${c.adresse ? `\n${c.adresse}` : ''}`, { b: true, md: 1.4 });

    p('satisfait aux conditions d\u2019inaltérabilité, de sécurisation, de conservation et d\u2019archivage '
      + 'des données prévues au 3° bis du I de l\u2019article 286 du code général des impôts, selon les '
      + 'modalités suivantes :', { md: 1 });

    const item = (titre, txt) => {
      doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(10).text('•  ' + titre, { continued: false });
      doc.fillColor('#333').font('Helvetica').fontSize(9.5).text(txt, { indent: 14, width: 469 });
      doc.moveDown(0.55);
    };
    item('Inaltérabilité',
      'Chaque facture, avoir et encaissement est inscrit dans un journal fiscal en écriture seule. '
      + 'Les enregistrements sont numérotés de façon continue et chaînés par empreinte cryptographique '
      + 'SHA-256 : l\u2019empreinte de chaque enregistrement intègre celle du précédent. Toute modification '
      + 'ou suppression rompt la chaîne et devient immédiatement détectable. La base de données interdit '
      + 'techniquement toute mise à jour ou suppression de ces enregistrements. Une correction ne peut '
      + 'être opérée que par une écriture inverse (avoir), elle-même tracée.');
    item('Sécurisation',
      'Accès par authentification individuelle, droits par utilisateur et par établissement. '
      + 'Chaque opération est journalisée (auteur, horodatage, adresse IP). Le calcul des empreintes '
      + 'est réalisé côté serveur, sous verrou transactionnel, garantissant l\u2019absence de rupture '
      + 'de chaîne en cas d\u2019accès simultanés.');
    item('Conservation',
      'Les données fiscales sont conservées au minimum six ans, sans purge ni écrasement. '
      + 'Les clôtures (journalières, mensuelles, annuelles) sont figées et définitives.');
    item('Archivage',
      'Clôtures horodatées avec cumuls et grand total perpétuel, elles-mêmes chaînées. '
      + 'Export d\u2019archive intègre, vérifiable et remis à l\u2019administration sur demande.');

    doc.moveDown(0.8);
    doc.rect(56, doc.y, 483, 54).fill('#F4F1E9');
    const yy = doc.y - 48;
    doc.fillColor('#222').font('Helvetica-Bold').fontSize(9).text('État de la chaîne à la date d\u2019édition', 66, yy + 8);
    doc.font('Helvetica').fontSize(8.5).fillColor(chaine.integre ? GREEN : '#A8402A')
      .text(chaine.integre
        ? `Chaîne intègre — ${chaine.enregistrements} enregistrement(s) vérifié(s), aucune anomalie.`
        : `ANOMALIE DÉTECTÉE — ${chaine.anomalies.length} rupture(s) sur ${chaine.enregistrements} enregistrement(s).`,
        66, yy + 22, { width: 463 });
    doc.fillColor('#666').fontSize(7)
      .text(`Empreinte finale : ${chaine.empreinte_finale}`, 66, yy + 34, { width: 463 });
    doc.y = yy + 62;

    doc.moveDown(1.2);
    doc.fillColor('#222').font('Helvetica').fontSize(9.5)
      .text(`Fait le ${new Date().toLocaleDateString('fr-FR')}.`, 56, doc.y, { width: 483 });
    doc.moveDown(2.4);
    doc.text('Signature de l\u2019éditeur', 330, doc.y, { width: 209 });
    doc.moveTo(330, doc.y + 4).lineTo(539, doc.y + 4).lineWidth(0.6).stroke('#999');

    doc.fontSize(7).fillColor('#999')
      .text('Le mécanisme d\u2019attestation individuelle par l\u2019éditeur a été rétabli par l\u2019article 125 '
        + 'de la loi n° 2026-103 du 19 février 2026 de finances pour 2026. Ce document doit être présenté '
        + 'à l\u2019administration fiscale en cas de contrôle.', 56, 762, { width: 483, align: 'center' });

    doc.end();
    await fini;

    await writeAudit(req, { action: 'export', entite: 'journal_fiscal',
      apres: { doc: 'attestation', chaine_intacte: chaine.integre } });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="attestation_conformite_locamp.pdf"');
    res.send(Buffer.concat(chunks));
  } catch (e) { console.error('[fiscal:attestation]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;

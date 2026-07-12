const express = require('express');
const PDFDocument = require('pdfkit');
const { supabase } = require('../lib/supabase');
const { writeAudit } = require('../lib/audit');
const { exporterDonnees, anonymiserResident, candidatsPurge, registreTraitements } = require('../lib/rgpd');
const { auth, campingScope, requirePerm } = require('../middleware/auth');

const router = express.Router();
router.use(auth, campingScope);

// Trace toute demande d'exercice de droits (art. 12 : le responsable doit pouvoir la démontrer)
async function tracerDemande(req, { resident_id, type, origine = 'admin', statut = 'traitee', detail }) {
  try {
    await supabase.from('demandes_rgpd').insert({
      camping_id: req.activeCampingId, resident_id: resident_id || null,
      type, origine, statut, detail: detail || null, auteur_id: req.user?.uid || null,
    });
  } catch (e) { console.error('[rgpd:demande]', e.message); }
}

// GET /api/rgpd/etat  -> tableau de bord conformité
router.get('/etat', requirePerm('admin'), async (req, res) => {
  try {
    const [purge, demRes, violRes, anonRes] = await Promise.all([
      candidatsPurge(req.activeCampingId),
      supabase.from('demandes_rgpd').select('*').eq('camping_id', req.activeCampingId)
        .order('created_at', { ascending: false }).limit(20).then((r) => r, () => ({ data: [] })),
      supabase.from('violations_donnees').select('*').eq('camping_id', req.activeCampingId)
        .order('date_incident', { ascending: false }).limit(10).then((r) => r, () => ({ data: [] })),
      supabase.from('residents').select('id', { count: 'exact', head: true })
        .eq('camping_id', req.activeCampingId).not('anonymise_at', 'is', null),
    ]);
    res.json({
      durees: purge.durees,
      seuil_purge: purge.seuil,
      candidats_purge: purge.candidats,
      anonymises: anonRes.count || 0,
      demandes: demRes.data || [],
      violations: violRes.data || [],
    });
  } catch (e) {
    console.error('[rgpd:etat]', e.message);
    res.status(500).json({ error: 'RGPD indisponible — la migration db/18_rgpd.sql a-t-elle été exécutée ?' });
  }
});

// GET /api/rgpd/resident/:id/export  -> droit d'accès / portabilité (art. 15 & 20)
router.get('/resident/:id/export', requirePerm('gerer_residents'), async (req, res) => {
  try {
    const data = await exporterDonnees(req.activeCampingId, req.params.id);
    if (!data) return res.status(404).json({ error: 'Résident introuvable' });

    await tracerDemande(req, { resident_id: req.params.id, type: 'acces',
      detail: { factures: data.factures.length, reglements: data.reglements.length } });
    await writeAudit(req, { action: 'export', entite: 'residents', entite_id: req.params.id,
      apres: { rgpd: 'export_donnees' } });

    const nom = `${(data.identite.nom || 'resident').replace(/[^a-zA-Z0-9]/g, '_')}`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="donnees_${nom}.json"`);
    res.send(JSON.stringify(data, null, 2));
  } catch (e) { console.error('[rgpd:export]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/rgpd/resident/:id/anonymiser  { confirmation }
// Droit à l'effacement (art. 17) : anonymisation, les pièces comptables sont conservées.
router.post('/resident/:id/anonymiser', requirePerm('admin'), async (req, res) => {
  try {
    if (req.body?.confirmation !== 'ANONYMISER') {
      return res.status(400).json({ error: 'Confirmation requise' });
    }
    const out = await anonymiserResident(req.activeCampingId, req.params.id, req);
    if (out.error) return res.status(404).json({ error: 'Résident introuvable' });
    if (out.deja) return res.status(409).json({ error: 'Ce résident est déjà anonymisé' });

    await tracerDemande(req, { resident_id: req.params.id, type: 'effacement', detail: out });
    await writeAudit(req, { action: 'update', entite: 'residents', entite_id: req.params.id,
      apres: { rgpd: 'anonymisation', ...out } });

    res.json({
      ...out,
      message: `Résident anonymisé. ${out.documents_supprimes} document(s) et ${out.messages_supprimes} message(s) supprimés. `
        + `${out.pieces_conservees.factures} facture(s) et ${out.pieces_conservees.reglements} encaissement(s) conservés `
        + `au titre des obligations légales de conservation (art. 17.3.b du RGPD).`,
    });
  } catch (e) { console.error('[rgpd:anonymiser]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/rgpd/registre.pdf  -> registre des traitements (art. 30)
router.get('/registre.pdf', requirePerm('admin'), async (req, res) => {
  try {
    const { data: camping } = await supabase.from('campings')
      .select('nom,raison_sociale,adresse,siret,email,parametres').eq('id', req.activeCampingId).maybeSingle();
    const reg = registreTraitements(camping || {});

    const doc = new PDFDocument({ size: 'A4', margin: 46 });
    const chunks = [];
    doc.on('data', (x) => chunks.push(x));
    const fini = new Promise((r) => doc.on('end', r));
    const GREEN = '#175243';

    doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(16)
      .text('REGISTRE DES ACTIVITÉS DE TRAITEMENT', { align: 'center' });
    doc.fillColor('#555').font('Helvetica').fontSize(9)
      .text('Article 30 du règlement (UE) 2016/679 (RGPD)', { align: 'center' });
    doc.moveDown(1.4);

    doc.fillColor('#111').font('Helvetica-Bold').fontSize(11).text('Responsable du traitement');
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(9).fillColor('#333');
    const R = reg.responsable;
    [['Organisme', R.organisme], ['SIRET', R.siret], ['Adresse', R.adresse],
     ['Contact', R.contact], ['Délégué à la protection des données', R.dpo]].forEach(([k, v]) => {
      doc.font('Helvetica-Bold').text(k + ' : ', { continued: true }).font('Helvetica').text(String(v));
    });
    doc.moveDown(1);

    doc.fillColor('#111').font('Helvetica-Bold').fontSize(11).text('Traitements');
    doc.moveDown(0.4);

    reg.traitements.forEach((t, i) => {
      if (doc.y > 690) { doc.addPage(); doc.y = 46; }
      doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(10).text(`${i + 1}. ${t.nom}`);
      doc.moveDown(0.2);
      doc.fontSize(8.5);
      [['Finalité', t.finalite], ['Base légale', t.base_legale], ['Personnes concernées', t.personnes],
       ['Données traitées', t.donnees], ['Destinataires', t.destinataires],
       ['Durée de conservation', t.conservation], ['Mesures de sécurité', t.securite]].forEach(([k, v]) => {
        doc.fillColor('#666').font('Helvetica-Bold').text(k + ' : ', { continued: true, indent: 10 })
          .fillColor('#222').font('Helvetica').text(String(v), { width: 490 });
      });
      doc.moveDown(0.7);
    });

    if (doc.y > 620) { doc.addPage(); doc.y = 46; }
    doc.fillColor('#111').font('Helvetica-Bold').fontSize(11).text('Sous-traitants');
    doc.moveDown(0.3);
    doc.fontSize(8.5);
    reg.sous_traitants.forEach((s) => {
      doc.fillColor('#222').font('Helvetica-Bold').text('• ' + s.nom + ' — ', { continued: true })
        .font('Helvetica').fillColor('#444').text(`${s.role}. Localisation : ${s.localisation}`, { width: 490 });
    });
    doc.moveDown(1);

    doc.fillColor('#111').font('Helvetica-Bold').fontSize(11).text('Droits des personnes');
    doc.moveDown(0.3);
    doc.fillColor('#333').font('Helvetica').fontSize(8.5).text(reg.droits, { width: 503 });

    doc.moveDown(1.4);
    doc.fillColor('#999').fontSize(7.5)
      .text(`Registre établi le ${new Date().toLocaleDateString('fr-FR')} — Locamp. `
        + 'Document à tenir à jour et à présenter à la CNIL en cas de contrôle.', { width: 503 });

    doc.end();
    await fini;

    await writeAudit(req, { action: 'export', entite: 'campings', entite_id: req.activeCampingId,
      apres: { rgpd: 'registre_traitements' } });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="registre_traitements_rgpd.pdf"');
    res.send(Buffer.concat(chunks));
  } catch (e) { console.error('[rgpd:registre]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/rgpd/violations  -> registre des violations (art. 33)
router.post('/violations', requirePerm('admin'), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.description || !b.date_incident) {
      return res.status(400).json({ error: 'Date de l\u2019incident et description requises' });
    }
    const { data, error } = await supabase.from('violations_donnees').insert({
      camping_id: req.activeCampingId,
      date_incident: b.date_incident,
      nature: b.nature || 'confidentialite',
      description: b.description,
      personnes_touchees: b.personnes_touchees ? Number(b.personnes_touchees) : null,
      donnees_touchees: b.donnees_touchees || null,
      consequences: b.consequences || null,
      mesures: b.mesures || null,
      cnil_notifiee: !!b.cnil_notifiee,
      date_notif_cnil: b.cnil_notifiee ? (b.date_notif_cnil || new Date().toISOString()) : null,
      personnes_informees: !!b.personnes_informees,
      auteur_id: req.user.uid,
    }).select().single();
    if (error) throw error;

    await writeAudit(req, { action: 'create', entite: 'violations_donnees', entite_id: data.id,
      apres: { nature: data.nature, cnil_notifiee: data.cnil_notifiee } });

    res.status(201).json({
      violation: data,
      rappel: data.cnil_notifiee ? null
        : 'Une violation susceptible d\u2019engendrer un risque pour les personnes doit être notifiée à la CNIL '
          + 'dans les 72 heures suivant sa découverte (art. 33 du RGPD).',
    });
  } catch (e) { console.error('[rgpd:violation]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;

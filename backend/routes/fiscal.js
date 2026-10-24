const express = require('express');
const PDFDocument = require('pdfkit');
const { supabase } = require('../lib/supabase');
const { writeAudit } = require('../lib/audit');
const crypto = require('crypto');
const { verifierChaine, cloturer, inscrire, schemaVersion, jourParis } = require('../lib/fiscal');
const V = require('../lib/version');
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
    const version = await schemaVersion();
    res.json({
      chaine,
      clotures,
      cumul_perpetuel: clotures[0]?.cumul_perpetuel ?? 0,
      logiciel: { nom: V.NOM_LOGICIEL, version: V.VERSION, build: V.BUILD },
      // false tant que db/16_inalterabilite.sql n'a pas tourné : la base ne
      // protège pas encore le journal, et l'attestation ne doit pas être délivrée.
      protection_base: version >= 16,
      editeur_complet: !manquantsEditeur(editeurDe({})).length,
    });
  } catch (e) {
    console.error('[fiscal:etat]', e.message);
    res.status(500).json({ error: 'Conformité fiscale indisponible — les migrations db/10 et db/16 ont-elles été exécutées ?' });
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

// GET /api/fiscal/archive?debut=&fin=  -> archive JSON scellée (conservation 6 ans)
// Scellement : l'empreinte SHA-256 du fichier remis est elle-même inscrite dans
// la chaîne fiscale (événement « archive »). Pour vérifier une archive plus tard :
// recalculer le SHA-256 du fichier (sha256sum) et le comparer à l'événement.
router.get('/archive', requirePerm('compta'), async (req, res) => {
  try {
    const debut = req.query.debut || '2000-01-01';
    const fin = req.query.fin || jourParis();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(debut) || !/^\d{4}-\d{2}-\d{2}$/.test(fin)) {
      return res.status(400).json({ error: 'Dates au format AAAA-MM-JJ' });
    }

    const [{ data: camping }, { data: evts }, { data: clots }, chaine] = await Promise.all([
      supabase.from('campings').select('nom,raison_sociale,siret').eq('id', req.activeCampingId).maybeSingle(),
      supabase.from('journal_fiscal').select('*').eq('camping_id', req.activeCampingId)
        .gte('horodatage', debut).lte('horodatage', fin + 'T23:59:59').order('seq'),
      supabase.from('clotures_fiscales').select('*').eq('camping_id', req.activeCampingId)
        .gte('horodatage', debut).lte('horodatage', fin + 'T23:59:59').order('horodatage'),
      verifierChaine(req.activeCampingId),
    ]);

    const archive = {
      logiciel: V.NOM_LOGICIEL,
      version: V.VERSION,
      build: V.BUILD,
      reference_legale: 'Article 286-I-3° bis du CGI — inaltérabilité, sécurisation, conservation, archivage',
      camping: camping || {},
      periode: { debut, fin },
      genere_le: new Date().toISOString(),
      genere_par: req.user?.email || null,
      integrite: { chaine_intacte: chaine.integre, anomalies: chaine.anomalies,
        empreinte_finale: chaine.empreinte_finale },
      journal_fiscal: evts || [],
      clotures: clots || [],
    };
    const contenu = JSON.stringify(archive, null, 2);
    const empreinte = crypto.createHash('sha256').update(contenu, 'utf8').digest('hex');

    // L'archive n'est remise que si son empreinte a pu être scellée.
    const scelle = await inscrire(req.activeCampingId, {
      type: 'archive', entite: 'journal_fiscal', entite_id: null,
      donnees: { debut, fin, evenements: (evts || []).length, clotures: (clots || []).length,
        empreinte_sha256: empreinte, version: V.VERSION },
      montant: null, auteur_id: req.user?.uid, auteur_email: req.user?.email,
    });
    if (!scelle) return res.status(500).json({ error: 'Archive non scellée (journal fiscal indisponible) — réessayer' });

    await writeAudit(req, { action: 'export', entite: 'journal_fiscal',
      apres: { debut, fin, evenements: (evts || []).length, doc: 'archive', empreinte_sha256: empreinte, seq: scelle.seq } });

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="archive_fiscale_${debut}_${fin}.json"`);
    res.setHeader('X-Empreinte-SHA256', empreinte);
    res.setHeader('X-Sceau-Seq', String(scelle.seq));
    res.send(contenu);
  } catch (e) { console.error('[fiscal:archive]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

/* ---------- Éditeur du logiciel ----------
   L'éditeur est le même pour tous les campings : il vient de l'environnement
   (LOCAMP_EDITEUR_*), à défaut de parametres.editeur du camping. Ce n'est PAS
   le camping : c'est la personne qui atteste, et qui en répond. */
function editeurDe(parametres) {
  const p = (parametres || {}).editeur || {};
  const env = process.env;
  return {
    nom: env.LOCAMP_EDITEUR_NOM || p.nom || '',
    siren: env.LOCAMP_EDITEUR_SIREN || p.siren || p.siret || '',
    adresse: env.LOCAMP_EDITEUR_ADRESSE || p.adresse || '',
    representant: env.LOCAMP_EDITEUR_REPRESENTANT || p.representant || '',
    qualite: env.LOCAMP_EDITEUR_QUALITE || p.qualite || '',
    ville: env.LOCAMP_EDITEUR_VILLE || p.ville || '',
  };
}
const CHAMPS_EDITEUR = { nom: 'raison sociale', siren: 'SIREN', adresse: 'adresse',
  representant: 'nom du représentant légal', qualite: 'qualité du représentant' };
const manquantsEditeur = (ed) => Object.keys(CHAMPS_EDITEUR).filter((k) => !String(ed[k] || '').trim());

// GET /api/fiscal/attestation.pdf  -> attestation individuelle de l'éditeur
// (rétablie par l'art. 125 de la loi de finances 2026 — loi n° 2026-103 du 19 février 2026)
//
// Structure calquée sur le modèle de l'administration (BOFiP, BOI-LETTRE-000242) :
// éditeur et signataire, logiciel et version majeure, client nominatif, engagement
// sur les quatre conditions. ⚠ Avant de la signer, comparer mot à mot avec la
// version en vigueur du modèle sur bofip.impots.gouv.fr.
//
// Elle est REFUSÉE tant que la base ne protège pas le journal (db/16) ou que la
// chaîne est rompue : une attestation qui affirme une protection absente engage
// la responsabilité de l'éditeur.
router.get('/attestation.pdf', requirePerm('compta'), async (req, res) => {
  try {
    const [{ data: camping }, chaine, version] = await Promise.all([
      supabase.from('campings').select('nom,raison_sociale,adresse,siret,tva,parametres,created_at')
        .eq('id', req.activeCampingId).maybeSingle(),
      verifierChaine(req.activeCampingId),
      schemaVersion(),
    ]);
    const c = camping || {};
    const ed = editeurDe(c.parametres);

    if (version < 16) {
      return res.status(409).json({ error: 'Attestation indisponible : exécuter d\'abord db/16_inalterabilite.sql (protection du journal en base).' });
    }
    if (!chaine.integre) {
      return res.status(409).json({ error: `Attestation indisponible : la chaîne fiscale présente ${chaine.anomalies.length} anomalie(s). Les documenter et les traiter d'abord.` });
    }
    const manque = manquantsEditeur(ed);
    if (manque.length) {
      return res.status(409).json({ error: `Attestation indisponible : identité de l'éditeur incomplète (${manque.map((k) => CHAMPS_EDITEUR[k]).join(', ')}). Renseigner les variables LOCAMP_EDITEUR_* sur le serveur.` });
    }

    const mise_en_service = ((c.parametres || {}).fiscal || {}).date_mise_en_service
      || (c.created_at ? String(c.created_at).slice(0, 10) : null);
    const frDate = (d) => (d ? new Date(d + 'T12:00:00Z').toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' }) : '—');

    const doc = new PDFDocument({ size: 'A4', margin: 56 });
    const chunks = [];
    doc.on('data', (x) => chunks.push(x));
    const fini = new Promise((r) => doc.on('end', r));
    const GREEN = '#175243';

    doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(16)
      .text('ATTESTATION INDIVIDUELLE', { align: 'center' });
    doc.fillColor('#555').font('Helvetica').fontSize(9)
      .text('relative à l’obligation prévue au 3° bis du I de l’article 286 du code général des impôts '
        + '(logiciels et systèmes de caisse)', { align: 'center' });
    doc.moveDown(2);

    const p = (t, o = {}) => { doc.fillColor('#222').font(o.b ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(o.s || 10).text(t, { align: o.a || 'left', width: 483 }); doc.moveDown(o.md ?? 0.6); };

    p(`Je soussigné(e) ${ed.representant}, ${ed.qualite} de la société ${ed.nom}, `
      + `SIREN ${ed.siren}, dont le siège est situé ${ed.adresse}, éditrice du logiciel désigné ci-dessous,`, { md: 1 });

    p('atteste que le logiciel :', { md: 0.4 });
    p(`${V.NOM_LOGICIEL} — gestion de camping résidentiel (facturation, encaissements, comptabilité)`, { b: true, md: 0.2 });
    p(`dans sa version majeure ${V.VERSION_MAJEURE} (version installée : ${V.VERSION_MINEURE}${V.BUILD ? `, build ${V.BUILD}` : ''})`,
      { md: 1 });

    p('mis à la disposition de :', { md: 0.4 });
    p(`${c.raison_sociale || c.nom || '—'}${c.siret ? `, SIRET ${c.siret}` : ''}`
      + `${c.adresse ? `\n${c.adresse}` : ''}`, { b: true, md: 0.2 });
    p(`depuis le ${frDate(mise_en_service)},`, { md: 1 });

    p('satisfait aux conditions d’inaltérabilité, de sécurisation, de conservation et d’archivage '
      + 'des données en vue du contrôle de l’administration fiscale, prévues au 3° bis du I de '
      + 'l’article 286 du code général des impôts, selon les modalités suivantes :', { md: 0.9 });

    const item = (titre, txt) => {
      doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(9.5).text('•  ' + titre);
      doc.fillColor('#333').font('Helvetica').fontSize(9).text(txt, { indent: 14, width: 469 });
      doc.moveDown(0.45);
    };
    item('Inaltérabilité',
      'Factures, avoirs, encaissements et annulations d’encaissement sont inscrits par la base de données, '
      + 'dans la même transaction que l’opération, dans un journal numéroté sans rupture et chaîné par '
      + 'empreinte SHA-256. La base refuse toute modification ou suppression du journal, des clôtures, '
      + 'des factures émises et des encaissements. Une correction ne se fait que par une écriture inverse '
      + '(avoir, annulation motivée), elle-même chaînée.');
    item('Sécurisation',
      'Accès par authentification individuelle, droits par utilisateur et par établissement, '
      + 'journal d’audit (auteur, horodatage, adresse IP). Vérification de la chaîne à la demande.');
    item('Conservation',
      'Clôtures journalières, mensuelles et annuelles figées, avec cumul perpétuel. Données fiscales '
      + 'conservées au minimum six ans, sans purge.');
    item('Archivage',
      'Archive exportable, dont l’empreinte SHA-256 est elle-même inscrite dans la chaîne au moment '
      + 'de sa génération, ce qui permet d’en prouver l’intégrité.');

    p('Les versions mineures ultérieures de cette version majeure, qui ne modifient pas ces modalités, '
      + 'sont couvertes par la présente attestation.', { s: 9, md: 0.8 });

    const yBox = doc.y;
    doc.rect(56, yBox, 483, 46).fill('#F4F1E9');
    doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(8.5)
      .text(`Chaîne vérifiée à l’édition : intègre — ${chaine.enregistrements} enregistrement(s).`, 66, yBox + 9, { width: 463 });
    doc.fillColor('#666').font('Helvetica').fontSize(7)
      .text(`Empreinte finale : ${chaine.empreinte_finale}`, 66, yBox + 24, { width: 463 });
    doc.y = yBox + 58;

    doc.fillColor('#222').font('Helvetica').fontSize(9.5)
      .text(`Fait${ed.ville ? ` à ${ed.ville}` : ''}, le ${new Date().toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })}.`,
        56, doc.y, { width: 483 });
    doc.moveDown(1.6);
    doc.text(`${ed.representant}, ${ed.qualite}`, 330, doc.y, { width: 209 });
    doc.moveDown(0.3);
    doc.text('Signature :', 330, doc.y, { width: 209 });
    doc.moveTo(330, doc.y + 30).lineTo(539, doc.y + 30).lineWidth(0.6).stroke('#999');

    // pied de page sous la marge basse : sans cela, pdfkit ouvre une page 2 pour deux lignes
    doc.page.margins.bottom = 0;
    doc.fontSize(7).fillColor('#999')
      .text('Attestation individuelle de l’éditeur (art. 286-I-3° bis du CGI, rédaction issue de l’article 125 '
        + 'de la loi n° 2026-103 du 19 février 2026). À conserver et à présenter à l’administration fiscale '
        + 'en cas de contrôle.', 56, 790, { width: 483, align: 'center' });

    doc.end();
    await fini;

    await writeAudit(req, { action: 'export', entite: 'journal_fiscal',
      apres: { doc: 'attestation', version: V.VERSION, chaine_intacte: chaine.integre } });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="attestation_locamp_v${V.VERSION_MAJEURE}.pdf"`);
    res.send(Buffer.concat(chunks));
  } catch (e) { console.error('[fiscal:attestation]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;

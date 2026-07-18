const express = require('express');
const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { writeAudit } = require('../lib/audit');
const { uploadDocument, signedUrl, removeDocument } = require('../lib/storage');
const { buildContratPdf, mergeClauses } = require('../lib/pdf');
const { auth, campingScope, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(auth, campingScope);

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Charge le contrat + camping + resident + emplacement (pour le PDF)
async function loadFullContrat(campingId, id) {
  const { data: contrat } = await supabase.from('contrats').select('*')
    .eq('camping_id', campingId).eq('id', id).maybeSingle();
  if (!contrat) return null;
  const [camping, resident, emplacement] = await Promise.all([
    supabase.from('campings').select('nom,raison_sociale,adresse,siret,tva').eq('id', campingId).maybeSingle(),
    contrat.resident_id
      ? supabase.from('residents').select('civilite,nom,prenom,date_naissance,adresse,email,telephone').eq('id', contrat.resident_id).maybeSingle()
      : Promise.resolve({ data: {} }),
    contrat.emplacement_id
      ? supabase.from('emplacements').select('numero,secteur,type').eq('id', contrat.emplacement_id).maybeSingle()
      : Promise.resolve({ data: {} }),
  ]);
  return { contrat, camping: camping.data || {}, resident: resident.data || {}, emplacement: emplacement.data || {} };
}

// Génère un numéro C-AAAA-NNNN séquentiel par camping et par année
async function nextNumero(campingId) {
  const year = new Date().getFullYear();
  const { count } = await supabase.from('contrats')
    .select('id', { count: 'exact', head: true })
    .eq('camping_id', campingId).like('numero', `C-${year}-%`);
  return `C-${year}-${String((count || 0) + 1).padStart(4, '0')}`;
}

// (Re)génère le PDF non signé, calcule l'empreinte, met à jour le contrat.
async function genererPdfNonSigne(full) {
  const { contrat, camping, resident, emplacement } = full;
  const pdf = await buildContratPdf({ camping, resident, emplacement, contrat, signature: null });
  const hash = sha256(pdf);
  const path = `contrats/${contrat.camping_id}/${contrat.id}/contrat.pdf`;
  // upsert : on retire l'ancien puis on remet
  await removeDocument(path).catch(() => {});
  await uploadDocument(path, pdf, 'application/pdf');
  return { path, hash };
}

// ---------- GET liste ----------
router.get('/', async (req, res) => {
  try {
    let q = supabase.from('contrats')
      .select('id,numero,resident_id,emplacement_id,date_debut,date_fin,montant_mensuel,statut,created_at')
      .eq('camping_id', req.activeCampingId);
    if (req.query.resident_id) q = q.eq('resident_id', req.query.resident_id);
    if (req.query.statut) q = q.eq('statut', req.query.statut);
    const { data, error } = await q.order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ contrats: data });
  } catch (e) { console.error('[contrats:list]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// ---------- GET détail ----------
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('contrats').select('*')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Contrat introuvable' });
    res.json({ contrat: data });
  } catch (e) { console.error('[contrats:get]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// ---------- POST créer (génère le PDF automatiquement) ----------
router.post('/', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const { resident_id, emplacement_id, modele_id, date_debut, date_fin,
      montant_mensuel, reglement_interieur_ver } = req.body || {};
    if (!resident_id) return res.status(400).json({ error: 'resident_id requis' });

    // résident + emplacement du camping
    const { data: resident } = await supabase.from('residents')
      .select('id,nom,prenom,civilite,adresse,email,telephone,date_naissance,emplacement_id')
      .eq('camping_id', req.activeCampingId).eq('id', resident_id).maybeSingle();
    if (!resident) return res.status(404).json({ error: 'Résident introuvable' });
    const empId = emplacement_id || resident.emplacement_id || null;

    // clauses depuis le modèle, fusionnées
    let clauses = '';
    if (modele_id) {
      const { data: modele } = await supabase.from('contrat_modeles').select('clauses')
        .eq('camping_id', req.activeCampingId).eq('id', modele_id).maybeSingle();
      const { data: emp } = empId
        ? await supabase.from('emplacements').select('numero,secteur').eq('id', empId).maybeSingle()
        : { data: {} };
      clauses = mergeClauses(modele?.clauses, {
        nom: resident.nom, prenom: resident.prenom,
        emplacement: emp?.numero, secteur: emp?.secteur,
        montant: montant_mensuel, date_debut, date_fin,
      });
    }

    const numero = await nextNumero(req.activeCampingId);
    const { data: contrat, error } = await supabase.from('contrats').insert({
      camping_id: req.activeCampingId, resident_id, emplacement_id: empId, modele_id: modele_id || null,
      numero, date_debut: date_debut || null, date_fin: date_fin || null,
      montant_mensuel: montant_mensuel || 0, clauses, reglement_interieur_ver: reglement_interieur_ver || null,
      statut: 'brouillon',
    }).select().single();
    if (error) throw error;

    // génération PDF
    const full = await loadFullContrat(req.activeCampingId, contrat.id);
    const { path, hash } = await genererPdfNonSigne(full);
    const { data: updated } = await supabase.from('contrats')
      .update({ pdf_path: path, hash_document: hash, statut: 'emis' })
      .eq('id', contrat.id).select().single();

    await writeAudit(req, { action: 'create', entite: 'contrats', entite_id: contrat.id,
      apres: { numero, resident_id, statut: 'emis' } });
    res.status(201).json({ contrat: updated });
  } catch (e) { console.error('[contrats:create]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// ---------- PUT modifier (interdit après signature) ----------
router.put('/:id', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const { data: avant } = await supabase.from('contrats').select('*')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).maybeSingle();
    if (!avant) return res.status(404).json({ error: 'Contrat introuvable' });

    const body = req.body || {};
    // transitions de statut autorisées à part
    const statutOnly = ['actif', 'resilie', 'echu'];
    const contentFields = ['date_debut', 'date_fin', 'montant_mensuel', 'clauses', 'reglement_interieur_ver'];
    const wantsContent = contentFields.some((f) => f in body);

    if (['signe', 'actif', 'resilie', 'echu'].includes(avant.statut) && wantsContent) {
      return res.status(409).json({ error: 'Contrat déjà signé/finalisé : contenu non modifiable' });
    }

    const patch = {};
    for (const f of contentFields) if (f in body) patch[f] = body[f];
    if (body.statut && statutOnly.includes(body.statut)) patch.statut = body.statut;

    const { data, error } = await supabase.from('contrats').update(patch)
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).select().single();
    if (error) throw error;

    // si le contenu a changé et pas encore signé, on régénère le PDF
    if (wantsContent && !['signe'].includes(avant.statut)) {
      const full = await loadFullContrat(req.activeCampingId, data.id);
      const { path, hash } = await genererPdfNonSigne(full);
      await supabase.from('contrats').update({ pdf_path: path, hash_document: hash }).eq('id', data.id);
    }

    await writeAudit(req, { action: 'update', entite: 'contrats', entite_id: data.id, avant, apres: data });
    res.json({ contrat: data });
  } catch (e) { console.error('[contrats:update]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// ---------- POST signer (signature simple + PDF scellé) ----------
router.post('/:id/signer', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const { consentement, signataire_nom } = req.body || {};
    if (consentement !== true) {
      return res.status(400).json({ error: 'consentement explicite requis (consentement: true)' });
    }
    const full = await loadFullContrat(req.activeCampingId, req.params.id);
    if (!full) return res.status(404).json({ error: 'Contrat introuvable' });
    if (['signe', 'actif', 'resilie', 'echu'].includes(full.contrat.statut)) {
      return res.status(409).json({ error: 'Contrat déjà signé ou finalisé' });
    }

    // s'assurer d'avoir un PDF non signé + son empreinte
    let hashDoc = full.contrat.hash_document;
    if (!hashDoc || !full.contrat.pdf_path) {
      const g = await genererPdfNonSigne(full);
      hashDoc = g.hash;
      full.contrat.pdf_path = g.path;
      await supabase.from('contrats').update({ pdf_path: g.path, hash_document: g.hash }).eq('id', full.contrat.id);
    }

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || null;
    const horodatage = new Date().toISOString();
    const nom = signataire_nom || `${full.resident.prenom || ''} ${full.resident.nom || ''}`.trim();

    // PDF signé
    const pdfSigne = await buildContratPdf({
      ...full,
      signature: { signataire_nom: nom, horodatage, ip, hash_document: hashDoc },
    });
    const hashSigne = sha256(pdfSigne);
    const pathSigne = `contrats/${req.activeCampingId}/${full.contrat.id}/contrat_signe.pdf`;
    await removeDocument(pathSigne).catch(() => {});
    await uploadDocument(pathSigne, pdfSigne, 'application/pdf');

    const signature_meta = { signataire_nom: nom, consentement: true, horodatage, ip, hash_document: hashDoc, hash_signe: hashSigne };
    const { data: updated, error } = await supabase.from('contrats')
      .update({ statut: 'signe', pdf_signe_path: pathSigne, signature_meta })
      .eq('camping_id', req.activeCampingId).eq('id', full.contrat.id).select().single();
    if (error) throw error;

    await writeAudit(req, { action: 'sign', entite: 'contrats', entite_id: full.contrat.id,
      apres: { numero: full.contrat.numero, signataire: nom, hash_signe: hashSigne } });
    res.json({ contrat: updated });
  } catch (e) { console.error('[contrats:signer]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// ---------- GET lien PDF (signé si dispo, sinon non signé) ----------
router.get('/:id/pdf', async (req, res) => {
  try {
    const { data: c } = await supabase.from('contrats').select('pdf_path,pdf_signe_path,numero')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).maybeSingle();
    if (!c) return res.status(404).json({ error: 'Contrat introuvable' });
    const path = c.pdf_signe_path || c.pdf_path;
    if (!path) return res.status(404).json({ error: 'PDF non généré' });
    const url = await signedUrl(path, 120);
    await writeAudit(req, { action: 'access', entite: 'contrats', entite_id: req.params.id, apres: { numero: c.numero } });
    res.json({ url, signe: !!c.pdf_signe_path, expires_in: 120 });
  } catch (e) { console.error('[contrats:pdf]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// ---------- POST renouveler : duplique le contrat pour la période suivante ----------
// Nouveau contrat en brouillon (mêmes clauses/montant, dates décalées d'un an par
// défaut ou fournies), PDF généré — prêt à partir en signature.
router.post('/:id/renouveler', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const full = await loadFullContrat(req.activeCampingId, req.params.id);
    if (!full) return res.status(404).json({ error: 'Contrat introuvable' });
    const anc = full.contrat;

    const plusUnAn = (d) => { if (!d) return null; const x = new Date(d + 'T00:00:00'); x.setFullYear(x.getFullYear() + 1); return x.toISOString().slice(0, 10); };
    const date_debut = (req.body && req.body.date_debut) || plusUnAn(anc.date_debut) || null;
    const date_fin = (req.body && req.body.date_fin) || plusUnAn(anc.date_fin) || null;
    const montant_mensuel = (req.body && req.body.montant_mensuel != null) ? req.body.montant_mensuel : anc.montant_mensuel;

    const numero = await nextNumero(req.activeCampingId);
    const { data: neuf, error } = await supabase.from('contrats').insert({
      camping_id: req.activeCampingId, resident_id: anc.resident_id, emplacement_id: anc.emplacement_id,
      modele_id: anc.modele_id || null, numero, date_debut, date_fin,
      montant_mensuel: montant_mensuel || 0, clauses: anc.clauses || '',
      reglement_interieur_ver: anc.reglement_interieur_ver || null, statut: 'brouillon',
    }).select().single();
    if (error) throw error;

    const full2 = await loadFullContrat(req.activeCampingId, neuf.id);
    const { path, hash } = await genererPdfNonSigne(full2);
    await supabase.from('contrats').update({ pdf_path: path, hash_document: hash, statut: 'emis' })
      .eq('id', neuf.id);

    await writeAudit(req, { action: 'contrat.renouvellement', entite: 'contrats', entite_id: neuf.id,
      avant: { ancien: anc.id, numero: anc.numero }, apres: { numero, date_debut, date_fin, montant_mensuel } });
    res.status(201).json({ contrat: { ...neuf, pdf_path: path, statut: 'emis' } });
  } catch (e) { console.error('[contrats:renouveler]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// ---------- POST envoyer-signature : bascule le PDF du contrat dans le circuit eIDAS ----------
// Crée un documents_signature (brouillon) depuis le PDF du contrat ; on place ensuite
// les zones dans l'éditeur existant puis on envoie au résident (jeton par e-mail).
router.post('/:id/envoyer-signature', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const full = await loadFullContrat(req.activeCampingId, req.params.id);
    if (!full) return res.status(404).json({ error: 'Contrat introuvable' });
    const c = full.contrat;
    if (!c.pdf_path) return res.status(400).json({ error: 'Ce contrat n\u2019a pas encore de PDF.' });
    if (c.statut === 'signe') return res.status(409).json({ error: 'Contrat déjà signé.' });

    const { downloadDocument } = require('../lib/storage');
    const buffer = await downloadDocument(c.pdf_path);

    const id = crypto.randomUUID();
    const path = `signatures/${req.activeCampingId}/${id}.pdf`;
    await uploadDocument(path, buffer, 'application/pdf');

    // nb de pages : approximation robuste par comptage des objets /Page du PDF
    let nb_pages = 1;
    try { nb_pages = Math.max(1, (buffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length); } catch (_) {}

    const { data: doc, error } = await supabase.from('documents_signature').insert({
      id, camping_id: req.activeCampingId, resident_id: c.resident_id,
      titre: `Contrat ${c.numero || ''}`.trim(),
      message: (req.body && req.body.message) || 'Merci de signer votre contrat de location.',
      storage_path: path, hash_original: sha256(buffer), nb_pages,
      champs: [], statut: 'brouillon', auteur_id: req.user.uid,
    }).select().single();
    if (error) throw error;

    await writeAudit(req, { action: 'contrat.envoi-signature', entite: 'documents_signature', entite_id: doc.id,
      avant: { contrat: c.id, numero: c.numero }, apres: { hash: doc.hash_original } });
    res.status(201).json({ document: doc });
  } catch (e) { console.error('[contrats:envoyer-signature]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;

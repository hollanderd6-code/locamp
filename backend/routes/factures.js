const express = require('express');
const { supabase } = require('../lib/supabase');
const { writeAudit } = require('../lib/audit');
const { signedUrl } = require('../lib/storage');
const { runFacturationMensuelle, runFacturationResident, emettreFacture, creerFacture, genererPdfFacture, envoyerFactureEmail, currentPeriode } = require('../lib/facturation');
const { auth, campingScope, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(auth, campingScope);

// GET /api/factures  (filtres: resident_id, contrat_id, statut, periode)
router.get('/', async (req, res) => {
  try {
    let q = supabase.from('factures')
      .select('id,numero,resident_id,contrat_id,periode,date_emission,total_ttc,montant_regle,statut')
      .eq('camping_id', req.activeCampingId);
    for (const f of ['resident_id', 'contrat_id', 'statut', 'periode']) {
      if (req.query[f]) q = q.eq(f, req.query[f]);
    }
    if (req.query.debut) q = q.gte('date_emission', req.query.debut);   // plage exercice (facultatif)
    if (req.query.fin) q = q.lte('date_emission', req.query.fin);
    const { data, error } = await q.order('date_emission', { ascending: false });
    if (error) throw error;
    res.json({ factures: data });
  } catch (e) { console.error('[factures:list]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/factures/rapprochement?du=&au=  -> état de rapprochement factures / règlements.
// Pour chaque facture émise sur la plage, ses règlements affectés (mode, montant, date) et son solde.
router.get('/rapprochement', async (req, res) => {
  try {
    const { du, au } = req.query;
    const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
    let q = supabase.from('factures')
      .select('id,numero,resident_id,date_emission,total_ttc,montant_regle,statut')
      .eq('camping_id', req.activeCampingId).neq('statut', 'annulee').neq('statut', 'avoir');
    if (du) q = q.gte('date_emission', du);
    if (au) q = q.lte('date_emission', au);
    const { data: factures, error } = await q.order('date_emission', { ascending: true }).order('numero', { ascending: true });
    if (error) throw error;

    const fids = (factures || []).map((f) => f.id);
    const [{ data: regs }, { data: moyens }] = await Promise.all([
      supabase.from('reglements').select('id,resident_id,mode,montant,date_reglement,reference,affectations').eq('camping_id', req.activeCampingId),
      supabase.from('moyens_paiement').select('code,libelle').eq('camping_id', req.activeCampingId),
    ]);
    const lib = {}; (moyens || []).forEach((m) => { lib[m.code] = m.libelle; });

    // Règlements affectés à ces factures (via le tableau jsonb affectations).
    const parFacture = {};
    for (const g of (regs || [])) {
      for (const a of (g.affectations || [])) {
        if (!a || !fids.includes(a.facture_id)) continue;
        (parFacture[a.facture_id] ||= []).push({
          mode: lib[g.mode] || g.mode, montant: r2(a.montant), date_reglement: g.date_reglement, reference: g.reference || null,
        });
      }
    }

    // Règlements NON affectés (part non lettrée) encaissés sur la période : rien ne se perd.
    const nonAffectesRaw = [];
    for (const g of (regs || [])) {
      if (du && String(g.date_reglement) < du) continue;
      if (au && String(g.date_reglement) > au) continue;
      const affecte = (g.affectations || []).reduce((s, a) => s + Number((a && a.montant) || 0), 0);
      const reste = r2(Number(g.montant || 0) - affecte);
      if (reste > 0.005) nonAffectesRaw.push({ ...g, affecte: r2(affecte), reste });
    }

    // Résidents : ceux des factures + ceux des règlements non affectés.
    const rids = [...new Set([
      ...(factures || []).map((f) => f.resident_id),
      ...nonAffectesRaw.map((g) => g.resident_id),
    ].filter(Boolean))];
    const { data: residents } = rids.length
      ? await supabase.from('residents').select('id,nom,prenom,compte_comptable').eq('camping_id', req.activeCampingId).in('id', rids)
      : { data: [] };
    const rmap = {}; (residents || []).forEach((r) => { rmap[r.id] = r; });
    const nomClient = (id) => { const r = rmap[id] || {}; return `${r.prenom ? r.prenom + ' ' : ''}${r.nom || ''}`.trim() || '—'; };

    let tFactures = 0, tRegles = 0, tSolde = 0;
    const lignes = (factures || []).map((f) => {
      const r = rmap[f.resident_id] || {};
      const solde = r2(Number(f.total_ttc) - Number(f.montant_regle || 0));
      tFactures += Number(f.total_ttc || 0); tRegles += Number(f.montant_regle || 0); tSolde += solde;
      return {
        id: f.id, numero: f.numero, date_emission: f.date_emission, statut: f.statut,
        client: nomClient(f.resident_id), compte_client: r.compte_comptable || null,
        total_ttc: r2(f.total_ttc), montant_regle: r2(f.montant_regle || 0), solde,
        reglements: (parFacture[f.id] || []).sort((a, b) => String(a.date_reglement).localeCompare(String(b.date_reglement))),
      };
    });

    const non_affectes = nonAffectesRaw
      .map((g) => ({
        client: nomClient(g.resident_id), mode: lib[g.mode] || g.mode, reference: g.reference || null,
        date_reglement: g.date_reglement, montant: r2(g.montant), affecte: g.affecte, reste: g.reste,
      }))
      .sort((a, b) => String(a.date_reglement).localeCompare(String(b.date_reglement)));
    const totalNonAffecte = r2(non_affectes.reduce((s, g) => s + g.reste, 0));

    res.json({
      du: du || null, au: au || null, lignes, non_affectes,
      total: { factures: r2(tFactures), regles: r2(tRegles), solde: r2(tSolde), nb: lignes.length, non_affecte: totalNonAffecte },
    });
  } catch (e) { console.error('[factures:rapprochement]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/factures/run-mensuel  { periode?: 'YYYY-MM' }  (camping actif)
router.post('/run-mensuel', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const periode = (req.body && req.body.periode) || currentPeriode();
    const result = await runFacturationMensuelle(req.activeCampingId, periode);
    await writeAudit(req, { action: 'run_facturation', entite: 'factures',
      apres: { periode: result.periode, crees: result.crees, ignores: result.ignores, erreurs: result.erreurs } });
    res.json(result);
  } catch (e) { console.error('[factures:run]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// --- Configuration de facturation d'un résident (loyer + lignes récurrentes) ---
// Vit sur le RÉSIDENT (et non le contrat) : les tarifs évoluent, le contrat signé est figé.

// GET /api/factures/config/:resident_id
router.get('/config/:resident_id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('residents').select('id,facturation,emplacement_id')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.resident_id).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Résident introuvable' });

    // Config effective = config propre du résident (override) sinon modèle du logement (live).
    const own = data.facturation || {};
    const aOwn = Number(own.loyer_mensuel || 0) > 0 || (own.lignes || []).length > 0;
    let effective = own, source = aOwn ? 'resident' : 'aucun', modele = null;
    if (!aOwn && data.emplacement_id) {
      const [empR, campR] = await Promise.all([
        supabase.from('emplacements').select('meta').eq('camping_id', req.activeCampingId).eq('id', data.emplacement_id).maybeSingle(),
        supabase.from('campings').select('parametres').eq('id', req.activeCampingId).maybeSingle(),
      ]);
      const typeId = empR.data?.meta?.facture_type_id;
      const t = typeId && (campR.data?.parametres?.factures_types || []).find((x) => x && x.id === typeId);
      if (t) {
        modele = { id: t.id, nom: t.nom };
        effective = {
          loyer_mensuel: Number(t.loyer_mensuel || 0), loyer_tva: Number(t.loyer_tva || 0),
          loyer_prorata: t.loyer_prorata !== false, lignes: Array.isArray(t.lignes) ? t.lignes : [],
        };
        source = 'modele';
      }
    }
    res.json({ facturation: own, effective, source, modele });
  } catch (e) {
    console.error('[factures:config-get]', e.message);
    res.status(500).json({ error: 'Erreur serveur — la migration db/18_facturation_resident.sql a-t-elle été exécutée ?' });
  }
});

// PUT /api/factures/config/:resident_id  { loyer_mensuel, loyer_tva, loyer_prorata, lignes[] }
router.put('/config/:resident_id', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const { data: avant } = await supabase.from('residents').select('id,facturation')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.resident_id).maybeSingle();
    if (!avant) return res.status(404).json({ error: 'Résident introuvable' });

    const b = req.body || {};
    const lignes = (Array.isArray(b.lignes) ? b.lignes : []).slice(0, 50).map((l) => ({
      designation: String(l.designation || '').slice(0, 200).trim(),
      quantite: Number(l.quantite) > 0 ? Number(l.quantite) : 1,
      pu_ttc: Math.round(Number(l.pu_ttc || 0) * 100) / 100,
      taux_tva: Number(l.taux_tva || 0),
      prorata: l.prorata === true,
    })).filter((l) => l.designation && l.pu_ttc !== 0);

    const facturation = {
      loyer_mensuel: Math.round(Number(b.loyer_mensuel || 0) * 100) / 100,
      loyer_tva: Number(b.loyer_tva || 0),
      loyer_prorata: b.loyer_prorata !== false,
      lignes,
    };

    const { data, error } = await supabase.from('residents').update({ facturation })
      .eq('camping_id', req.activeCampingId).eq('id', req.params.resident_id)
      .select('id,facturation').single();
    if (error) throw error;

    await writeAudit(req, { action: 'update', entite: 'residents', entite_id: req.params.resident_id,
      avant: { facturation: avant.facturation }, apres: { facturation } });
    res.json({ facturation: data.facturation });
  } catch (e) { console.error('[factures:config-put]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/factures/run-resident  { resident_id, periode? }  -> facture du mois d'un résident
router.post('/run-resident', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const { resident_id } = req.body || {};
    if (!resident_id) return res.status(400).json({ error: 'resident_id requis' });
    const periode = (req.body && req.body.periode) || currentPeriode();
    const out = await runFacturationResident(req.activeCampingId, resident_id, periode);
    if (out.error) return res.status(out.code || 400).json({ error: out.error });
    await writeAudit(req, { action: 'create', entite: 'factures', entite_id: out.facture.id,
      apres: { numero: out.facture.numero, periode, total_ttc: out.facture.total_ttc } });
    res.status(201).json({ facture: out.facture });
  } catch (e) { console.error('[factures:run-resident]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/factures  facture ponctuelle manuelle  { resident_id, contrat_id?, periode?, lignes[] }
router.post('/', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const { resident_id, contrat_id, periode, lignes } = req.body || {};
    if (!resident_id) return res.status(400).json({ error: 'resident_id requis' });
    if (!Array.isArray(lignes) || !lignes.length) return res.status(400).json({ error: 'lignes requises' });
    const facture = await creerFacture({ campingId: req.activeCampingId, resident_id, contrat_id, periode, lignes, req });
    await writeAudit(req, { action: 'create', entite: 'factures', entite_id: facture.id,
      apres: { numero: facture.numero, total_ttc: facture.total_ttc } });
    res.status(201).json({ facture });
  } catch (e) { console.error('[factures:create]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// --- Brouillons (proforma) : vérifier / ajuster / émettre ---

// POST /api/factures/:id/emettre  -> numéro définitif + chaîne fiscale + e-mail
router.post('/:id/emettre', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const out = await emettreFacture(req.activeCampingId, req.params.id, req);
    if (out.error) return res.status(out.code || 400).json({ error: out.error });
    await writeAudit(req, { action: 'create', entite: 'factures', entite_id: out.facture.id,
      apres: { numero: out.facture.numero, total_ttc: out.facture.total_ttc, emission: true } });
    res.json({ facture: out.facture });
  } catch (e) { console.error('[factures:emettre]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// PUT /api/factures/:id/lignes  { lignes[] }  -> BROUILLON uniquement
// Une facture émise est figée (inaltérabilité) : elle ne se corrige que par un avoir.
router.put('/:id/lignes', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const { data: f } = await supabase.from('factures').select('id,statut')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).maybeSingle();
    if (!f) return res.status(404).json({ error: 'Facture introuvable' });
    if (f.statut !== 'brouillon') {
      return res.status(409).json({ error: 'Facture déjà émise : elle ne peut plus être modifiée (utilisez un avoir).' });
    }
    const lignes = Array.isArray(req.body?.lignes) ? req.body.lignes : [];
    if (!lignes.length) return res.status(400).json({ error: 'Au moins une ligne est requise' });

    const { computeTotals } = require('../lib/facturation');
    const t = computeTotals(lignes);
    const { data, error } = await supabase.from('factures').update({
      lignes: t.lignes, total_ht: t.total_ht, total_tva: t.total_tva, total_ttc: t.total_ttc,
    }).eq('camping_id', req.activeCampingId).eq('id', req.params.id).select().single();
    if (error) throw error;

    await genererPdfFacture(req.activeCampingId, data).catch(() => {});
    await writeAudit(req, { action: 'update', entite: 'factures', entite_id: data.id,
      apres: { total_ttc: data.total_ttc, nb_lignes: t.lignes.length } });
    res.json({ facture: data });
  } catch (e) { console.error('[factures:lignes]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/factures/:id/prestations  { prestation_ids[] }  -> ajoute des prestations EN COURS
// à un BROUILLON existant. Additif : les lignes déjà présentes ne sont pas recalculées
// (leurs montants stockés sont préservés), on ne fait qu'ajouter celles des prestations.
router.post('/:id/prestations', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const { data: f } = await supabase.from('factures').select('id,statut,resident_id,lignes,total_ht,total_tva,total_ttc')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).maybeSingle();
    if (!f) return res.status(404).json({ error: 'Facture introuvable' });
    if (f.statut !== 'brouillon') {
      return res.status(409).json({ error: 'Seul un brouillon peut être complété (une facture émise se corrige par un avoir).' });
    }
    const ids = Array.isArray(req.body?.prestation_ids) ? req.body.prestation_ids : [];
    if (!ids.length) return res.status(400).json({ error: 'Aucune prestation sélectionnée' });

    const { data: prestas, error: pErr } = await supabase.from('prestations')
      .select('id,type,designation,quantite,pu_ht,taux_tva,montant_ttc,date_debut,date_fin,statut,resident_id')
      .eq('camping_id', req.activeCampingId).in('id', ids);
    if (pErr) throw pErr;
    if (!prestas || prestas.length !== ids.length) return res.status(400).json({ error: 'Sélection invalide (prestation introuvable)' });
    if (prestas.some((p) => p.resident_id !== f.resident_id)) return res.status(400).json({ error: 'Une prestation appartient à un autre résident' });
    if (prestas.some((p) => p.type === 'caution')) return res.status(400).json({ error: 'Les cautions ne se facturent pas — retire-les de la sélection' });
    if (prestas.some((p) => p.statut !== 'en_cours')) return res.status(409).json({ error: 'Certaines prestations sont déjà facturées ou annulées' });

    // Chaque prestation -> ligne. Le montant TTC stocké est la source de vérité :
    // on en redéduit le PU TTC pour que computeTotals redérive le HT sans dérive d'arrondi.
    const nouvelles = prestas.map((p) => {
      const q = Number(p.quantite || 1);
      const ttc = Number(p.montant_ttc);
      const l = {
        designation: p.designation, quantite: q, taux_tva: Number(p.taux_tva || 0),
        date_debut: p.date_debut || null, date_fin: p.date_fin || null,
      };
      if (Number.isFinite(ttc) && ttc > 0) l.pu_ttc = Math.round((ttc / q) * 10000) / 10000;
      else l.pu_ht = Number(p.pu_ht || 0);
      return l;
    });

    const { computeTotals } = require('../lib/facturation');
    const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
    const tNew = computeTotals(nouvelles);   // ne recalcule QUE les lignes ajoutées
    const lignes = [...(f.lignes || []), ...tNew.lignes];
    const total_ht = r2(Number(f.total_ht) + tNew.total_ht);
    const total_tva = r2(Number(f.total_tva) + tNew.total_tva);
    const total_ttc = r2(Number(f.total_ttc) + tNew.total_ttc);

    const { data, error } = await supabase.from('factures').update({ lignes, total_ht, total_tva, total_ttc })
      .eq('camping_id', req.activeCampingId).eq('id', f.id).select().single();
    if (error) throw error;

    // rattache les prestations au brouillon (libérées s'il est supprimé)
    await supabase.from('prestations').update({ statut: 'facturee', facture_id: f.id, updated_at: new Date().toISOString() })
      .eq('camping_id', req.activeCampingId).in('id', ids);

    await genererPdfFacture(req.activeCampingId, data).catch(() => {});
    await writeAudit(req, { action: 'update', entite: 'factures', entite_id: data.id,
      apres: { total_ttc: data.total_ttc, prestations_ajoutees: ids } });
    res.json({ facture: data, prestations_ajoutees: ids.length });
  } catch (e) { console.error('[factures:add-prestations]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// DELETE /api/factures/:id  -> BROUILLON uniquement (libère les prestations reprises)
router.delete('/:id', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const { data: f } = await supabase.from('factures').select('id,statut,numero')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).maybeSingle();
    if (!f) return res.status(404).json({ error: 'Facture introuvable' });
    if (f.statut !== 'brouillon') {
      return res.status(409).json({ error: 'Seul un brouillon peut être supprimé. Une facture émise s\'annule par un avoir.' });
    }
    // libère les prestations rattachées au brouillon -> redeviennent facturables (en_cours)
    await supabase.from('prestations').update({ statut: 'en_cours', facture_id: null })
      .eq('camping_id', req.activeCampingId).eq('facture_id', f.id);
    await supabase.from('factures').delete()
      .eq('camping_id', req.activeCampingId).eq('id', f.id);
    await writeAudit(req, { action: 'delete', entite: 'factures', entite_id: f.id, avant: { numero: f.numero } });
    res.json({ ok: true });
  } catch (e) { console.error('[factures:delete]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/factures/:id
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('factures').select('*')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Facture introuvable' });
    res.json({ facture: data });
  } catch (e) { console.error('[factures:get]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/factures/:id/avoir  (correction : émet un avoir, annule la facture d'origine)
router.post('/:id/avoir', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const { data: src } = await supabase.from('factures').select('*')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).maybeSingle();
    if (!src) return res.status(404).json({ error: 'Facture introuvable' });
    if (src.statut === 'avoir' || src.statut === 'annulee') {
      return res.status(409).json({ error: 'Pièce non éligible à un avoir' });
    }
    // lignes négatives
    const lignesAvoir = (src.lignes || []).map((l) => ({
      designation: `Avoir — ${l.designation}`, quantite: l.quantite, pu_ht: -Math.abs(Number(l.pu_ht || 0)), taux_tva: l.taux_tva,
    }));
    const avoir = await creerFacture({
      campingId: req.activeCampingId, resident_id: src.resident_id, contrat_id: src.contrat_id,
      periode: src.periode, lignes: lignesAvoir, statut: 'avoir', avoir_de: src.id, req,
    });
    await supabase.from('factures').update({ statut: 'annulee' })
      .eq('camping_id', req.activeCampingId).eq('id', src.id);
    await writeAudit(req, { action: 'avoir', entite: 'factures', entite_id: avoir.id,
      apres: { numero: avoir.numero, avoir_de: src.numero } });
    res.status(201).json({ avoir });
  } catch (e) { console.error('[factures:avoir]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/factures/:id/email  -> (re)envoie la facture par e-mail au résident
router.post('/:id/email', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const out = await envoyerFactureEmail(req.activeCampingId, req.params.id, { force: true });
    if (out.error) return res.status(404).json({ error: 'Facture introuvable' });
    if (out.skipped === 'statut') return res.status(409).json({ error: 'Pièce non concernée (avoir/annulée)' });
    if (out.skipped === 'sans_email') return res.status(400).json({ error: 'Le résident n\'a pas d\'adresse e-mail' });
    if (out.skipped === 'email_non_configure') return res.status(400).json({ error: 'Service e-mail non configuré (Brevo)' });
    await writeAudit(req, { action: 'email', entite: 'factures', entite_id: req.params.id, apres: out });
    res.json({ ok: true, ...out });
  } catch (e) { console.error('[factures:email]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/factures/:id/pdf  (régénère toujours : logo + identité à jour)
router.get('/:id/pdf', async (req, res) => {
  try {
    const { data: facture } = await supabase.from('factures').select('*')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).maybeSingle();
    if (!facture) return res.status(404).json({ error: 'Facture introuvable' });
    const path = await genererPdfFacture(req.activeCampingId, facture);
    const url = await signedUrl(path, 120);
    await writeAudit(req, { action: 'access', entite: 'factures', entite_id: facture.id, apres: { numero: facture.numero } });
    res.json({ url, expires_in: 120 });
  } catch (e) { console.error('[factures:pdf]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;

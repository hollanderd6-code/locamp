const express = require('express');
const { supabase } = require('../lib/supabase');
const { writeAudit } = require('../lib/audit');
const { creerFacture, genererProformaPdf } = require('../lib/facturation');
const { signedUrl } = require('../lib/storage');
const { auth, campingScope, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(auth, campingScope);

const TYPES = ['sejour', 'vente', 'charge', 'caution'];
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;

// HT dérivé d'un TTC saisi. Le PU HT reste la valeur stockée (facture, TVA, compta).
const htDepuisTtc = (ttc, taux) => r2(Number(ttc || 0) / (1 + Number(taux || 0) / 100));

function computeMontants(p) {
  const q = Number(p.quantite || 1);
  const taux = Number(p.taux_tva || 0);
  const pu = (p.pu_ttc !== undefined && p.pu_ttc !== null && p.pu_ttc !== '')
    ? htDepuisTtc(p.pu_ttc, taux)
    : Number(p.pu_ht || 0);
  const ht = r2(q * pu);
  return { pu_ht: pu, montant_ht: ht, montant_ttc: r2(ht * (1 + taux / 100)) };
}

// GET /api/prestations?resident_id=&statut=&type=
router.get('/', async (req, res) => {
  try {
    let q = supabase.from('prestations').select('*').eq('camping_id', req.activeCampingId);
    if (req.query.resident_id) q = q.eq('resident_id', req.query.resident_id);
    if (req.query.statut) q = q.eq('statut', req.query.statut);
    if (req.query.type) q = q.eq('type', req.query.type);
    const { data, error } = await q.order('date_debut', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ prestations: data });
  } catch (e) { console.error('[prestations:list]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/prestations/synthese/:residentId  -> bandeau fiche client
router.get('/synthese/:residentId', async (req, res) => {
  try {
    const rid = req.params.residentId;
    const [pRes, fRes] = await Promise.all([
      supabase.from('prestations').select('type,designation,date_debut,date_fin,montant_ttc,statut')
        .eq('camping_id', req.activeCampingId).eq('resident_id', rid).neq('statut', 'annulee'),
      supabase.from('factures').select('total_ttc,montant_regle,statut')
        .eq('camping_id', req.activeCampingId).eq('resident_id', rid),
    ]);
    const prestations = pRes.data || [];
    const factures = (fRes.data || []).filter((f) => !['avoir', 'annulee'].includes(f.statut));

    const enCours = prestations.filter((p) => p.statut === 'en_cours');
    const aFacturer = r2(enCours.filter((p) => p.type !== 'caution').reduce((s, p) => s + Number(p.montant_ttc), 0));
    const totalPresta = r2(prestations.filter((p) => p.type !== 'caution').reduce((s, p) => s + Number(p.montant_ttc), 0));
    const totalRegle = r2(factures.reduce((s, f) => s + Number(f.montant_regle), 0));
    const aRegler = r2(factures.reduce((s, f) => s + (Number(f.total_ttc) - Number(f.montant_regle)), 0));

    const sejours = prestations.filter((p) => p.type === 'sejour' && p.date_debut)
      .sort((a, b) => (b.date_debut || '').localeCompare(a.date_debut || ''));
    const nuits = sejours.reduce((s, p) => {
      if (!p.date_debut || !p.date_fin) return s;
      const d = Math.round((new Date(p.date_fin) - new Date(p.date_debut)) / 86400000);
      return s + (d > 0 ? d : 0);
    }, 0);
    const cautions = r2(prestations.filter((p) => p.type === 'caution' && p.statut !== 'annulee')
      .reduce((s, p) => s + Number(p.montant_ttc), 0));

    res.json({
      synthese: {
        prestations_total: totalPresta,
        regle_total: totalRegle,
        a_facturer: aFacturer,
        a_regler: aRegler,
        nb_sejours: sejours.length,
        nb_nuits: nuits,
        dernier_sejour: sejours[0] ? { du: sejours[0].date_debut, au: sejours[0].date_fin } : null,
        cautions_en_cours: cautions,
      },
    });
  } catch (e) { console.error('[prestations:synthese]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/prestations
router.post('/', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.resident_id) return res.status(400).json({ error: 'resident_id requis' });
    if (!TYPES.includes(b.type)) return res.status(400).json({ error: 'Type invalide' });
    if (!b.designation) return res.status(400).json({ error: 'Désignation requise' });
    const row = {
      camping_id: req.activeCampingId,
      resident_id: b.resident_id,
      emplacement_id: b.emplacement_id || null,
      type: b.type,
      designation: String(b.designation),
      date_debut: b.date_debut || null,
      date_fin: b.date_fin || null,
      quantite: Number(b.quantite || 1),
      taux_tva: Number(b.taux_tva || 0),
      notes: b.notes || null,
      ...computeMontants(b),   // fournit pu_ht (dérivé du TTC si fourni), montant_ht, montant_ttc
    };
    const { data, error } = await supabase.from('prestations').insert(row).select().single();
    if (error) throw error;
    await writeAudit(req, { action: 'create', entite: 'prestations', entite_id: data.id, apres: data });
    res.status(201).json({ prestation: data });
  } catch (e) { console.error('[prestations:create]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// PUT /api/prestations/:id  (uniquement en_cours)
router.put('/:id', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const { data: cur } = await supabase.from('prestations').select('*')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).maybeSingle();
    if (!cur) return res.status(404).json({ error: 'Prestation introuvable' });
    if (cur.statut !== 'en_cours') return res.status(409).json({ error: 'Prestation déjà facturée — non modifiable' });
    const b = req.body || {};
    const patch = {};
    for (const f of ['designation', 'date_debut', 'date_fin', 'notes', 'emplacement_id']) {
      if (b[f] !== undefined) patch[f] = b[f] === '' ? null : b[f];
    }
    for (const f of ['quantite', 'pu_ht', 'pu_ttc', 'taux_tva']) if (b[f] !== undefined) patch[f] = Number(b[f]);
    const merged = { ...cur, ...patch };
    if (patch.pu_ttc !== undefined) delete merged.pu_ht;   // le TTC saisi prime
    Object.assign(patch, computeMontants(merged));
    delete patch.pu_ttc;                                   // colonne inexistante en base
    patch.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('prestations').update(patch)
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).select().single();
    if (error) throw error;
    await writeAudit(req, { action: 'update', entite: 'prestations', entite_id: data.id, avant: cur, apres: data });
    res.json({ prestation: data });
  } catch (e) { console.error('[prestations:update]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// DELETE /api/prestations/:id  (annulation logique, uniquement en_cours)
router.delete('/:id', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const { data: cur } = await supabase.from('prestations').select('id,statut')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).maybeSingle();
    if (!cur) return res.status(404).json({ error: 'Prestation introuvable' });
    if (cur.statut !== 'en_cours') return res.status(409).json({ error: 'Prestation déjà facturée — passer par un avoir' });
    const { error } = await supabase.from('prestations').update({ statut: 'annulee', updated_at: new Date().toISOString() })
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id);
    if (error) throw error;
    await writeAudit(req, { action: 'delete', entite: 'prestations', entite_id: req.params.id });
    res.json({ ok: true });
  } catch (e) { console.error('[prestations:delete]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// Charge et valide une sélection de prestations d'un même résident.
async function chargerSelection(req, res) {
  const b = req.body || {};
  const ids = Array.isArray(b.prestation_ids) ? b.prestation_ids : [];
  if (!b.resident_id || !ids.length) {
    res.status(400).json({ error: 'resident_id et prestation_ids requis' });
    return null;
  }
  const { data: prestas, error } = await supabase.from('prestations').select('*')
    .eq('camping_id', req.activeCampingId).eq('resident_id', b.resident_id).in('id', ids);
  if (error) throw error;
  if (!prestas || prestas.length !== ids.length) {
    res.status(400).json({ error: 'Sélection invalide (prestation introuvable)' });
    return null;
  }
  return prestas;
}

const prestaToLigne = (p) => ({
  designation: p.designation + (p.type === 'caution' ? '' : ''),
  date_debut: p.date_debut, date_fin: p.date_fin,
  quantite: Number(p.quantite), pu_ht: Number(p.pu_ht), taux_tva: Number(p.taux_tva),
});

// POST /api/prestations/facturer  { resident_id, prestation_ids[] }
// Transforme les prestations en_cours sélectionnées en facture ; elles passent à "facturee".
router.post('/facturer', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const prestas = await chargerSelection(req, res);
    if (!prestas) return;
    const nonFacturables = prestas.filter((p) => p.statut !== 'en_cours');
    if (nonFacturables.length) return res.status(409).json({ error: 'Certaines prestations sont déjà facturées ou annulées' });
    const cautions = prestas.filter((p) => p.type === 'caution');
    if (cautions.length) return res.status(400).json({ error: 'Les cautions ne se facturent pas — retire-les de la sélection' });

    const lignes = prestas.map(prestaToLigne);
    const facture = await creerFacture({
      campingId: req.activeCampingId,
      resident_id: req.body.resident_id,
      periode: req.body.periode || new Date().toISOString().slice(0, 7),
      lignes, req,
    });
    const ids = prestas.map((p) => p.id);
    const { error: upErr } = await supabase.from('prestations')
      .update({ statut: 'facturee', facture_id: facture.id, updated_at: new Date().toISOString() })
      .eq('camping_id', req.activeCampingId).in('id', ids);
    if (upErr) throw upErr;
    await writeAudit(req, { action: 'create', entite: 'factures', entite_id: facture.id, apres: { numero: facture.numero, prestations: ids } });
    res.status(201).json({ facture, prestations_facturees: ids.length });
  } catch (e) { console.error('[prestations:facturer]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/prestations/proforma  { resident_id, prestation_ids[] }
// PDF proforma des prestations sélectionnées — aucune écriture comptable.
router.post('/proforma', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const prestas = await chargerSelection(req, res);
    if (!prestas) return;
    const lignes = prestas.filter((p) => p.type !== 'caution').map(prestaToLigne);
    if (!lignes.length) return res.status(400).json({ error: 'Aucune prestation facturable dans la sélection' });
    const path = await genererProformaPdf(req.activeCampingId, req.body.resident_id, lignes);
    const url = await signedUrl(path, 300);
    res.json({ url, expires_in: 300 });
  } catch (e) { console.error('[prestations:proforma]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;

const express = require('express');
const { supabase } = require('../lib/supabase');
const { writeAudit } = require('../lib/audit');
const { auth, campingScope, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(auth, campingScope);

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;

// GET /api/compteurs  -> tournée : emplacements + résident + dernier relevé
router.get('/', async (req, res) => {
  try {
    const [empRes, resRes, relRes, campRes] = await Promise.all([
      supabase.from('emplacements').select('id,numero,secteur').eq('camping_id', req.activeCampingId).order('numero'),
      supabase.from('residents').select('id,nom,prenom,emplacement_id').eq('camping_id', req.activeCampingId).eq('actif', true),
      supabase.from('releves_compteurs').select('emplacement_id,date_releve,index_kwh,conso_kwh,created_at')
        .eq('camping_id', req.activeCampingId).order('date_releve', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('campings').select('parametres').eq('id', req.activeCampingId).maybeSingle(),
    ]);
    const residents = {};
    (resRes.data || []).forEach((r) => { if (r.emplacement_id && !residents[r.emplacement_id]) residents[r.emplacement_id] = r; });
    const dernier = {};
    (relRes.data || []).forEach((rl) => { if (!dernier[rl.emplacement_id]) dernier[rl.emplacement_id] = rl; });
    const energie = campRes.data?.parametres?.energie || {};
    res.json({
      prix_kwh: energie.prix_kwh != null ? Number(energie.prix_kwh) : null,
      taux_tva: energie.taux_tva != null ? Number(energie.taux_tva) : 10,
      emplacements: (empRes.data || []).map((e) => ({
        ...e,
        resident: residents[e.id] ? { id: residents[e.id].id, nom: residents[e.id].nom, prenom: residents[e.id].prenom } : null,
        dernier_releve: dernier[e.id] || null,
      })),
    });
  } catch (e) { console.error('[compteurs:list]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/compteurs/:emplacementId/historique
router.get('/:emplacementId/historique', async (req, res) => {
  try {
    const { data, error } = await supabase.from('releves_compteurs').select('*')
      .eq('camping_id', req.activeCampingId).eq('emplacement_id', req.params.emplacementId)
      .order('date_releve', { ascending: false }).order('created_at', { ascending: false }).limit(24);
    if (error) throw error;
    res.json({ releves: data || [] });
  } catch (e) { console.error('[compteurs:histo]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/compteurs/releve  { emplacement_id, index_kwh, date_releve? }
// Enregistre le relevé ; si un relevé précédent existe + résident rattaché + prix kWh configuré,
// crée automatiquement une prestation "charge" (conso × prix kWh) en_cours.
router.post('/releve', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.emplacement_id) return res.status(400).json({ error: 'emplacement_id requis' });
    const index_kwh = Number(b.index_kwh);
    if (!Number.isFinite(index_kwh) || index_kwh < 0) return res.status(400).json({ error: 'Index invalide' });
    const date_releve = b.date_releve || new Date().toISOString().slice(0, 10);

    const { data: prec } = await supabase.from('releves_compteurs')
      .select('date_releve,index_kwh')
      .eq('camping_id', req.activeCampingId).eq('emplacement_id', b.emplacement_id)
      .order('date_releve', { ascending: false }).order('created_at', { ascending: false }).limit(1).maybeSingle();

    if (prec && index_kwh < Number(prec.index_kwh)) {
      return res.status(400).json({ error: `Index inférieur au précédent (${prec.index_kwh}). Compteur remplacé ? Corrige ou contacte le support.` });
    }
    const conso = prec ? r2(index_kwh - Number(prec.index_kwh)) : null;

    // prestation auto si possible
    let prestation = null, info = null;
    if (conso != null && conso > 0) {
      const [{ data: resident }, { data: camp }, { data: emp }] = await Promise.all([
        supabase.from('residents').select('id').eq('camping_id', req.activeCampingId)
          .eq('emplacement_id', b.emplacement_id).eq('actif', true).limit(1).maybeSingle(),
        supabase.from('campings').select('parametres').eq('id', req.activeCampingId).maybeSingle(),
        supabase.from('emplacements').select('numero').eq('id', b.emplacement_id).maybeSingle(),
      ]);
      const energie = camp?.parametres?.energie || {};
      const prixTtc = Number(energie.prix_kwh);   // prix du kWh saisi en TTC
      if (!resident) info = 'Relevé enregistré — aucun résident rattaché, pas de charge créée.';
      else if (!Number.isFinite(prixTtc) || prixTtc <= 0) info = 'Relevé enregistré — prix du kWh non configuré (Paramètres → Énergie), pas de charge créée.';
      else {
        const taux = Number(energie.taux_tva ?? 10);
        const prix = r2(prixTtc / (1 + taux / 100));   // PU HT dérivé du TTC
        const ht = r2(conso * prix);
        const ins = await supabase.from('prestations').insert({
          camping_id: req.activeCampingId, resident_id: resident.id, emplacement_id: b.emplacement_id,
          type: 'charge',
          designation: `Charges [${Number(prec.index_kwh)}\u203a${index_kwh}|${conso} kWh]`,
          date_debut: prec.date_releve, date_fin: date_releve,
          quantite: conso, pu_ht: prix, taux_tva: taux,
          montant_ht: ht, montant_ttc: r2(ht * (1 + taux / 100)),
        }).select().single();
        if (ins.error) throw ins.error;
        prestation = ins.data;
      }
    } else if (conso == null) {
      info = 'Premier relevé enregistré (index de départ) — la prochaine saisie calculera la consommation.';
    } else {
      info = 'Relevé enregistré — consommation nulle, pas de charge créée.';
    }

    const { data: releve, error } = await supabase.from('releves_compteurs').insert({
      camping_id: req.activeCampingId, emplacement_id: b.emplacement_id,
      date_releve, index_kwh, conso_kwh: conso, prestation_id: prestation?.id || null,
    }).select().single();
    if (error) throw error;

    await writeAudit(req, { action: 'create', entite: 'releves_compteurs', entite_id: releve.id, apres: { index_kwh, conso, prestation_id: prestation?.id || null } });
    res.status(201).json({ releve, prestation, info });
  } catch (e) { console.error('[compteurs:releve]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;

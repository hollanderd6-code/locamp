const express = require('express');
const { supabase } = require('../lib/supabase');
const { writeAudit } = require('../lib/audit');
const { auth, campingScope, requirePerm } = require('../middleware/auth');

const router = express.Router();
router.use(auth, campingScope);

const TYPES = ['espece', 'cheque', 'virement', 'carte', 'ancv', 'autre'];

const slug = (s) => String(s || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

// GET /api/moyens-paiement  (?tous=1 pour inclure les inactifs)
// Accessible à tous : le formulaire de règlement en a besoin.
router.get('/', async (req, res) => {
  try {
    let q = supabase.from('moyens_paiement').select('*').eq('camping_id', req.activeCampingId);
    if (req.query.tous !== '1') q = q.eq('actif', true);
    const { data, error } = await q.order('ordre').order('libelle');
    if (error) throw error;
    res.json({ moyens: data || [] });
  } catch (e) {
    console.error('[moyens:list]', e.message);
    // table absente : repli sur les moyens historiques pour ne rien casser
    res.json({
      moyens: [
        { code: 'espece', libelle: 'Espèces', type: 'espece', remisable: false, actif: true },
        { code: 'cheque', libelle: 'Chèque', type: 'cheque', remisable: true, actif: true },
        { code: 'virement', libelle: 'Virement', type: 'virement', remisable: false, actif: true },
        { code: 'tpe', libelle: 'Carte bancaire (TPE)', type: 'carte', remisable: false, actif: true },
      ],
      migration_manquante: true,
    });
  }
});

// POST /api/moyens-paiement
router.post('/', requirePerm('admin'), async (req, res) => {
  try {
    const b = req.body || {};
    const libelle = String(b.libelle || '').trim();
    if (!libelle) return res.status(400).json({ error: 'Libellé requis' });
    if (b.type && !TYPES.includes(b.type)) return res.status(400).json({ error: 'Type invalide' });

    const code = slug(b.code || libelle);
    if (!code) return res.status(400).json({ error: 'Code invalide' });

    const row = {
      camping_id: req.activeCampingId,
      code, libelle,
      type: b.type || 'autre',
      compte_comptable: b.compte_comptable || null,
      remisable: !!b.remisable,
      actif: b.actif !== false,
      ordre: Number(b.ordre || 99),
    };
    const { data, error } = await supabase.from('moyens_paiement').insert(row).select().single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Ce code existe déjà' });
      throw error;
    }
    await writeAudit(req, { action: 'create', entite: 'moyens_paiement', entite_id: data.id, apres: row });
    res.status(201).json({ moyen: data });
  } catch (e) { console.error('[moyens:create]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// PUT /api/moyens-paiement/:id  (le code n'est jamais modifiable : il est gravé dans l'historique)
router.put('/:id', requirePerm('admin'), async (req, res) => {
  try {
    const b = req.body || {};
    const patch = {};
    if (b.libelle !== undefined) patch.libelle = String(b.libelle).trim();
    if (b.type !== undefined) {
      if (!TYPES.includes(b.type)) return res.status(400).json({ error: 'Type invalide' });
      patch.type = b.type;
    }
    if (b.compte_comptable !== undefined) patch.compte_comptable = b.compte_comptable || null;
    if (b.remisable !== undefined) patch.remisable = !!b.remisable;
    if (b.actif !== undefined) patch.actif = !!b.actif;
    if (b.ordre !== undefined) patch.ordre = Number(b.ordre);
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'Rien à modifier' });
    patch.updated_at = new Date().toISOString();

    const { data: avant } = await supabase.from('moyens_paiement').select('*')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).maybeSingle();
    if (!avant) return res.status(404).json({ error: 'Moyen de paiement introuvable' });

    const { data, error } = await supabase.from('moyens_paiement').update(patch)
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).select().single();
    if (error) throw error;
    await writeAudit(req, { action: 'update', entite: 'moyens_paiement', entite_id: data.id, avant, apres: patch });
    res.json({ moyen: data });
  } catch (e) { console.error('[moyens:update]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// DELETE /api/moyens-paiement/:id
// Jamais de suppression si déjà utilisé : on désactive, pour préserver l'historique comptable.
router.delete('/:id', requirePerm('admin'), async (req, res) => {
  try {
    const { data: moyen } = await supabase.from('moyens_paiement').select('*')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).maybeSingle();
    if (!moyen) return res.status(404).json({ error: 'Moyen de paiement introuvable' });

    const { count } = await supabase.from('reglements').select('id', { count: 'exact', head: true })
      .eq('camping_id', req.activeCampingId).eq('mode', moyen.code);

    if (count > 0) {
      await supabase.from('moyens_paiement').update({ actif: false, updated_at: new Date().toISOString() })
        .eq('id', moyen.id);
      await writeAudit(req, { action: 'update', entite: 'moyens_paiement', entite_id: moyen.id,
        apres: { actif: false, raison: 'desactive_car_utilise', reglements: count } });
      return res.json({ ok: true, desactive: true, reglements: count,
        message: `Utilisé par ${count} règlement(s) : désactivé (historique préservé) plutôt que supprimé.` });
    }

    const { error } = await supabase.from('moyens_paiement').delete()
      .eq('camping_id', req.activeCampingId).eq('id', moyen.id);
    if (error) throw error;
    await writeAudit(req, { action: 'delete', entite: 'moyens_paiement', entite_id: moyen.id, avant: moyen });
    res.json({ ok: true, supprime: true });
  } catch (e) { console.error('[moyens:delete]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;

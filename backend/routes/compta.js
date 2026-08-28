const express = require('express');
const { supabase } = require('../lib/supabase');
const { writeAudit } = require('../lib/audit');
const { buildEcritures, toFEC, toCSV } = require('../lib/comptabilite');
const { auth, campingScope, requireRole } = require('../middleware/auth');

const { exportCompta } = require('../lib/export-compta');
const { chargerPlan, fusionner, ventilerLigne, ligneHt, DEFAUT: VENT_DEFAUT } = require('../lib/ventilation');

const router = express.Router();
router.use(auth, campingScope);

function periode(req) {
  const fin = req.query.fin || new Date().toISOString().slice(0, 10);
  const debut = req.query.debut || `${fin.slice(0, 4)}-01-01`;
  return { debut, fin };
}

// GET /api/compta/ecritures?debut=YYYY-MM-DD&fin=YYYY-MM-DD  (JSON, inspection)
router.get('/ecritures', requireRole('admin', 'comptabilite'), async (req, res) => {
  try {
    const { debut, fin } = periode(req);
    const lignes = await buildEcritures(req.activeCampingId, debut, fin);
    const totDebit = lignes.reduce((s, l) => s + Number(String(l.Debit).replace(',', '.')), 0);
    const totCredit = lignes.reduce((s, l) => s + Number(String(l.Credit).replace(',', '.')), 0);
    res.json({ debut, fin, lignes, total_debit: Math.round(totDebit * 100) / 100, total_credit: Math.round(totCredit * 100) / 100 });
  } catch (e) { console.error('[compta:ecritures]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/compta/fec?debut&fin  -> fichier FEC (téléchargement)
router.get('/fec', requireRole('admin', 'comptabilite'), async (req, res) => {
  try {
    const { debut, fin } = periode(req);
    const lignes = await buildEcritures(req.activeCampingId, debut, fin);
    const { data: camp } = await supabase.from('campings').select('siret').eq('id', req.activeCampingId).maybeSingle();
    const siren = (camp?.siret || 'SIREN').replace(/\s/g, '').slice(0, 9);
    const fichier = `${siren}FEC${fin.replace(/-/g, '')}.txt`;
    await writeAudit(req, { action: 'export', entite: 'compta_fec', apres: { debut, fin, lignes: lignes.length } });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fichier}"`);
    res.send(toFEC(lignes));
  } catch (e) { console.error('[compta:fec]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/compta/export.csv?debut&fin  -> écritures en CSV générique
router.get('/export.csv', requireRole('admin', 'comptabilite'), async (req, res) => {
  try {
    const { debut, fin } = periode(req);
    const lignes = await buildEcritures(req.activeCampingId, debut, fin);
    await writeAudit(req, { action: 'export', entite: 'compta_csv', apres: { debut, fin, lignes: lignes.length } });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ecritures_${debut}_${fin}.csv"`);
    res.send(toCSV(lignes));
  } catch (e) { console.error('[compta:csv]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/compta/tva-encaissements?debut=YYYY-MM-DD&fin=YYYY-MM-DD
// Régime "TVA sur les encaissements" : la TVA est exigible au paiement.
// Ventile chaque règlement de la période par taux de TVA, au prorata des factures lettrées.
router.get('/tva-encaissements', requireRole('admin', 'comptabilite'), async (req, res) => {
  try {
    const { debut, fin } = periode(req);
    const [{ data: regs, error: e1 }, { data: factures, error: e2 }] = await Promise.all([
      supabase.from('reglements').select('id,resident_id,mode,montant,date_reglement,affectations')
        .eq('camping_id', req.activeCampingId).gte('date_reglement', debut).lte('date_reglement', fin)
        .order('date_reglement'),
      supabase.from('factures').select('id,numero,lignes,total_ttc,total_tva')
        .eq('camping_id', req.activeCampingId),
    ]);
    if (e1) throw e1; if (e2) throw e2;
    const fmap = {}; (factures || []).forEach((f) => { fmap[f.id] = f; });

    const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
    // Répartition TTC par taux d'une facture (à partir de ses lignes)
    function ttcParTaux(f) {
      const out = {};
      for (const l of (f.lignes || [])) {
        const ht = Number(l.montant_ht != null ? l.montant_ht : (l.quantite || 1) * (l.pu_ht || 0));
        const taux = Number(l.taux_tva || 0);
        out[taux] = (out[taux] || 0) + ht * (1 + taux / 100);
      }
      return out;
    }

    const parTaux = {};      // taux -> { base_ht, tva, ttc }
    const detail = [];
    let nonVentile = 0;      // encaissements sans lettrage (TVA indéterminable)
    for (const g of (regs || [])) {
      const affs = Array.isArray(g.affectations) ? g.affectations : [];
      let resteRegl = Number(g.montant || 0);
      const dSplit = {};
      for (const a of affs) {
        const f = fmap[a.facture_id];
        if (!f || !Number(f.total_ttc)) continue;
        const part = Math.min(Number(a.montant || 0), resteRegl);
        resteRegl = r2(resteRegl - part);
        const repart = ttcParTaux(f);
        const totTtc = Object.values(repart).reduce((s2, v) => s2 + v, 0) || Number(f.total_ttc);
        for (const [taux, ttcTaux] of Object.entries(repart)) {
          const ratio = ttcTaux / totTtc;
          const encaisseTaux = part * ratio;
          const t = Number(taux);
          const ht = encaisseTaux / (1 + t / 100);
          const tva = encaisseTaux - ht;
          if (!parTaux[t]) parTaux[t] = { base_ht: 0, tva: 0, ttc: 0 };
          parTaux[t].base_ht += ht; parTaux[t].tva += tva; parTaux[t].ttc += encaisseTaux;
          dSplit[t] = r2((dSplit[t] || 0) + encaisseTaux);
        }
      }
      if (resteRegl > 0.004) nonVentile = r2(nonVentile + resteRegl);
      detail.push({ id: g.id, date: g.date_reglement, mode: g.mode, montant: g.montant, ventilation: dSplit,
        non_ventile: resteRegl > 0.004 ? resteRegl : 0 });
    }
    for (const t in parTaux) { parTaux[t].base_ht = r2(parTaux[t].base_ht); parTaux[t].tva = r2(parTaux[t].tva); parTaux[t].ttc = r2(parTaux[t].ttc); }
    const totalTva = r2(Object.values(parTaux).reduce((s2, v) => s2 + v.tva, 0));
    res.json({ debut, fin, par_taux: parTaux, total_tva_exigible: totalTva, non_ventile: nonVentile, reglements: detail });
  } catch (e) { console.error('[compta:tva-enc]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/compta/export-logiciel?debut=&fin=
// Fichier d'import du logiciel comptable : colonnes fixes 142 car., ISO-8859-1, CRLF.
router.get('/export-logiciel', requireRole('admin', 'comptabilite'), async (req, res) => {
  try {
    const p = periode(req);
    const { buffer, lignes, pieces } = await exportCompta(req.activeCampingId, p.debut, p.fin);
    await writeAudit(req, { action: 'export', entite: 'compta',
      apres: { debut: p.debut, fin: p.fin, lignes, pieces, format: 'colonnes_fixes' } });
    const mois = String(p.debut).slice(2, 7).replace('-', '');
    res.setHeader('Content-Type', 'text/plain; charset=ISO-8859-1');
    res.setHeader('Content-Disposition', `attachment; filename="Ximport_${mois}.txt"`);
    res.send(buffer);
  } catch (e) { console.error('[compta:export-logiciel]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/compta/ventilation?debut&fin
// Ce que recoit chaque nature facturee sur la periode : le compte, la regle
// qui a repondu, et le montant. « a_ventiler » liste ce qui ne correspond a
// AUCUNE regle — c'est la seule chose a regler, et elle etait invisible.
router.get('/ventilation', requireRole('admin', 'comptabilite'), async (req, res) => {
  try {
    const { debut, fin } = periode(req);
    const plan = await chargerPlan(req.activeCampingId);
    const { data: factures, error } = await supabase.from('factures')
      .select('id,numero,date_emission,statut,lignes')
      .eq('camping_id', req.activeCampingId)
      .gte('date_emission', debut).lte('date_emission', fin);
    if (error) throw error;

    const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
    // Regroupement par designation : le gestionnaire pense « le menage »,
    // pas « la ligne 3 de la facture 412 ».
    const parDesignation = new Map();
    for (const f of (factures || [])) {
      for (const l of (f.lignes || [])) {
        const nom = String(l.designation || '(sans désignation)').trim();
        const v = ventilerLigne(nom, plan);
        const cle = nom.toLowerCase();
        const e = parDesignation.get(cle) || {
          designation: nom, compte: v.compte, libelle: v.libelle,
          regle: v.mot, a_ventiler: v.attente, ht: 0, lignes: 0,
          taux: new Set(), exemples: [],
        };
        e.ht = r2(e.ht + ligneHt(l));
        e.lignes += 1;
        e.taux.add(Number(l.taux_tva || 0));
        if (e.exemples.length < 3 && f.numero) e.exemples.push(f.numero);
        parDesignation.set(cle, e);
      }
    }
    const lignes = [...parDesignation.values()]
      .map((e) => ({ ...e, taux: [...e.taux].sort((a, b) => a - b) }))
      .sort((a, b) => (b.a_ventiler - a.a_ventiler) || (Math.abs(b.ht) - Math.abs(a.ht)));

    const aVentiler = lignes.filter((l) => l.a_ventiler);
    res.json({
      debut, fin, plan, lignes,
      a_ventiler: { nombre: aVentiler.length, ht: r2(aVentiler.reduce((s, l) => s + l.ht, 0)) },
      defaut: VENT_DEFAUT,
    });
  } catch (e) {
    console.error('[compta:ventilation]', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/compta/ventilation  { regles[], compte_defaut, libelle_defaut,
//                                compte_attente, attente_active, comptes_tva }
// Enregistre dans campings.parametres.ventilation. Les deux exports le
// relisent au prochain telechargement : rien n'est fige dans le code.
router.put('/ventilation', requireRole('admin', 'comptabilite'), async (req, res) => {
  try {
    const b = req.body || {};
    const { data: camp } = await supabase.from('campings').select('parametres')
      .eq('id', req.activeCampingId).maybeSingle();
    const parametres = (camp && camp.parametres) || {};

    // On n'accepte que des regles utilisables : un mot vide attraperait
    // TOUTES les lignes (indexOf('') === 0), un compte vide casserait le fichier.
    const regles = Array.isArray(b.regles) ? b.regles
      .map((r) => ({
        contient: String((r && r.contient) || '').trim(),
        compte: String((r && r.compte) || '').trim(),
        libelle: String((r && r.libelle) || '').trim(),
      }))
      .filter((r) => r.contient && r.compte) : [];
    if (Array.isArray(b.regles) && !regles.length && b.regles.length) {
      return res.status(400).json({ error: 'Chaque règle demande un mot-clé et un compte.' });
    }

    const comptes_tva = {};
    for (const [k, v] of Object.entries(b.comptes_tva || {})) {
      const t = Number(k);
      if (!Number.isFinite(t)) continue;
      const c = String(v || '').trim();
      if (c) comptes_tva[t] = c;
    }

    const ventilation = {
      regles,
      compte_defaut: String(b.compte_defaut || '').trim() || VENT_DEFAUT.compte_defaut,
      libelle_defaut: String(b.libelle_defaut || '').trim() || VENT_DEFAUT.libelle_defaut,
      compte_attente: String(b.compte_attente || '').trim() || VENT_DEFAUT.compte_attente,
      libelle_attente: String(b.libelle_attente || '').trim() || VENT_DEFAUT.libelle_attente,
      attente_active: !!b.attente_active,
      ...(Object.keys(comptes_tva).length ? { comptes_tva } : {}),
    };

    const { error } = await supabase.from('campings')
      .update({ parametres: { ...parametres, ventilation } })
      .eq('id', req.activeCampingId);
    if (error) throw error;

    await writeAudit(req, { action: 'update', entite: 'compta_ventilation',
      avant: parametres.ventilation || null, apres: ventilation });
    res.json({ ok: true, plan: fusionner({ ...parametres, ventilation }) });
  } catch (e) {
    console.error('[compta:ventilation-put]', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

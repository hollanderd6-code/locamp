const express = require('express');
const multer = require('multer');
const { supabase } = require('../lib/supabase');
const { writeAudit } = require('../lib/audit');
const { auth, campingScope, requireRole } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
router.use(auth, campingScope);

const FIELDS = ['nom', 'type', 'clauses', 'reglement_interieur'];
function pick(b, f) { const o = {}; for (const k of f) if (b[k] !== undefined) o[k] = b[k]; return o; }

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase.from('contrat_modeles').select('*')
      .eq('camping_id', req.activeCampingId).order('nom');
    if (error) throw error;
    res.json({ modeles: data });
  } catch (e) { console.error('[modeles:list]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

router.post('/', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const body = pick(req.body || {}, FIELDS);
    if (!body.nom) return res.status(400).json({ error: 'nom requis' });
    body.camping_id = req.activeCampingId;
    const { data, error } = await supabase.from('contrat_modeles').insert(body).select().single();
    if (error) throw error;
    await writeAudit(req, { action: 'create', entite: 'contrat_modeles', entite_id: data.id, apres: data });
    res.status(201).json({ modele: data });
  } catch (e) { console.error('[modeles:create]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

router.put('/:id', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const { data, error } = await supabase.from('contrat_modeles').update(pick(req.body || {}, FIELDS))
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).select().single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Modèle introuvable' });
    await writeAudit(req, { action: 'update', entite: 'contrat_modeles', entite_id: data.id, apres: data });
    res.json({ modele: data });
  } catch (e) { console.error('[modeles:update]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/contrat-modeles/importer  (PDF -> texte -> modèle brouillon)
// Dépose un contrat existant : Locamp en extrait le texte et crée un modèle à
// ajuster (nettoyage + pose des variables {{nom}}, {{montant}}, {{date_fin}}...).
router.post('/importer', requireRole('admin', 'gestionnaire'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'PDF requis' });
    if (req.file.mimetype !== 'application/pdf') return res.status(400).json({ error: 'Le document doit être un PDF' });

    let pdfjs;
    try { pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'); }
    catch (_) { return res.status(503).json({ error: 'Extraction PDF indisponible — redéploie avec la dépendance pdfjs-dist (npm install).' }); }

    let brut = '';
    try {
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(req.file.buffer), useSystemFonts: true, disableFontFace: true }).promise;
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const tc = await page.getTextContent();
        brut += tc.items.map((it) => it.str + (it.hasEOL ? '\n' : '')).join('') + '\n\n';
      }
    } catch (err) { console.error('[modeles:import:pdfjs]', err.message); brut = ''; }
    // Nettoyage léger : espaces de fin, lignes vides multiples, césures "mot-\nsuite".
    const texte = brut
      .replace(/[ \t]+\n/g, '\n')
      .replace(/(\w)-\n(\w)/g, '$1$2')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (!texte || texte.length < 40) {
      return res.status(422).json({ error: 'Impossible d\u2019extraire le texte : PDF scanné (image) ? Il faudrait la version texte du contrat.' });
    }

    const nom = String(req.body.nom || req.file.originalname.replace(/\.pdf$/i, '') || 'Contrat importé').slice(0, 120);
    const { data, error } = await supabase.from('contrat_modeles').insert({
      camping_id: req.activeCampingId, nom, type: 'importe', clauses: texte.slice(0, 60000),
    }).select().single();
    if (error) throw error;

    await writeAudit(req, { action: 'import', entite: 'contrat_modeles', entite_id: data.id, apres: { nom, longueur: texte.length } });
    res.status(201).json({ modele: data, longueur: texte.length });
  } catch (e) { console.error('[modeles:import]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// DELETE /api/contrat-modeles/:id  (refusé si des contrats l'utilisent)
router.delete('/:id', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const { count } = await supabase.from('contrats')
      .select('id', { count: 'exact', head: true })
      .eq('camping_id', req.activeCampingId).eq('modele_id', req.params.id);
    if (count > 0) return res.status(409).json({ error: `${count} contrat(s) utilisent ce modèle — il ne peut pas être supprimé.` });
    const { error } = await supabase.from('contrat_modeles').delete()
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id);
    if (error) throw error;
    await writeAudit(req, { action: 'delete', entite: 'contrat_modeles', entite_id: req.params.id });
    res.json({ ok: true });
  } catch (e) { console.error('[modeles:delete]', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;

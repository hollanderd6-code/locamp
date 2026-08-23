#!/usr/bin/env node
/* ============================================================
   outils/lettrage-correctif.js
   Les paiements n'étaient jamais imputés aux factures
   ============================================================
   Cibles : backend/lib/paiement.js
            backend/lib/lettrage.js
            backend/routes/reglements.js

   ── LA CAUSE ─────────────────────────────────────────────────────
   recomputeFacture cherchait les reglements affectes a une facture
   ainsi :

       .contains('affectations', [{ facture_id: factureId }])

   Passe un TABLEAU JavaScript, postgrest-js le traite comme un tableau
   POSTGRES et le serialise avec join(',') :

       affectations=cs.{[object Object]}

   La requete ne remonte donc jamais rien. montant_regle restait a 0 et
   le statut a « emise », alors que les paiements existaient et
   s'affichaient sous la facture.

   Le containment JSONB lui-meme fonctionne : verifie en SQL direct.
   Seul l'appel etait faux — et il l'etait silencieusement, ce qui est
   le pire des cas : aucune erreur, un zero plausible.

   ── L'EFFET EN CHAINE ────────────────────────────────────────────
   autoAffectations calcule le reste du a partir de montant_regle. A
   zero, il voit des factures impayees la ou tout etait solde : chaque
   nouveau paiement refaisait les MEMES affectations. Sur le dossier
   Dupont, deux reglements de 500 € ont produit 400 € affectes sur une
   facture de 200 € et 600 € sur une facture de 300 €.

   Et l'ecran proposait « Encaisser » sur des factures deja payees.

   ── CE QUI EST CORRIGE ───────────────────────────────────────────

   1. LA REQUETE. .filter('affectations', 'cs', JSON.stringify([...]))
      passe la valeur telle quelle : affectations=cs.[{"facture_id":"…"}]
      — la syntaxe attendue par PostgREST pour un containment JSONB.

   2. UN GARDE-FOU. montant_regle est plafonne au total TTC. Un calcul
      juste n'en a pas besoin ; c'est precisement pour le jour ou il
      cessera de l'etre. Un trop-percu affiche devient une facture
      « soldee » qu'on ne relance plus.

   3. UNE ERREUR QUI SE VOIT. La requete verifie desormais son propre
      resultat et journalise en cas d'echec. Ce bug a vecu parce qu'il
      ne disait rien.

   4. UN RE-LETTRAGE. Nouvelle route POST /api/reglements/relettrer
      { resident_id } : vide les affectations du resident et les refait
      dans l'ordre chronologique. Les montants encaisses ne bougent pas
      — seule leur imputation change, et les affectations ne sont pas
      scellees par la chaine fiscale (lib/lettrage.js le documente).
      C'est ce qui repare les dossiers deja abimes.

   ── APRES DEPLOIEMENT ────────────────────────────────────────────
   Pour chaque resident dont les factures sont fausses :

     await fetch(API + '/api/reglements/relettrer', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json',
                  Authorization: 'Bearer ' + TOKEN },
       body: JSON.stringify({ resident_id: '…' })
     });

   Usage :
     node outils/lettrage-correctif.js --essai
     node outils/lettrage-correctif.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');
const PAIE  = path.join(process.cwd(), 'backend', 'lib', 'paiement.js');
const LETT  = path.join(process.cwd(), 'backend', 'lib', 'lettrage.js');
const ROUTE = path.join(process.cwd(), 'backend', 'routes', 'reglements.js');

for (const f of [PAIE, LETT, ROUTE]) {
  if (!fs.existsSync(f)) {
    console.error('\n  \u2717 ' + f + ' introuvable. Lancez depuis la racine du projet.\n');
    process.exit(1);
  }
}

let paie  = fs.readFileSync(PAIE, 'utf8');
let lett  = fs.readFileSync(LETT, 'utf8');
let route = fs.readFileSync(ROUTE, 'utf8');

if (paie.indexOf("'cs', JSON.stringify") !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

/* ── 1. La requete, le plafond, l'erreur visible ──────────────────── */
const A1 = `  const { data: regs } = await supabase.from('reglements')
    .select('affectations').eq('camping_id', campingId)
    .contains('affectations', [{ facture_id: factureId }]);

  let regle = 0;
  for (const r of (regs || [])) {
    for (const a of (r.affectations || [])) {
      if (a.facture_id === factureId) regle += Number(a.montant || 0);
    }
  }
  regle = Math.round(regle * 100) / 100;
  const ttc = Number(facture.total_ttc || 0);`;

const N1 = `  /* .contains() avec un TABLEAU JS serialise en tableau Postgres —
     join(',') sur des objets donne « cs.{[object Object]} », qui ne
     matche jamais. .filter(…, 'cs', …) passe la valeur telle quelle :
     affectations=cs.[{"facture_id":"…"}], la syntaxe du containment JSONB. */
  const { data: regs, error: errRegs } = await supabase.from('reglements')
    .select('affectations').eq('camping_id', campingId)
    .filter('affectations', 'cs', JSON.stringify([{ facture_id: factureId }]));

  /* Ce bug a vecu parce qu'il ne disait rien : la requete echouait, le
     resultat valait zero, et zero est un montant plausible. */
  if (errRegs) {
    console.error('[paiement:recompute] lecture des reglements impossible —',
      'facture', factureId, ':', errRegs.message);
    return;
  }

  let regle = 0;
  for (const r of (regs || [])) {
    for (const a of (r.affectations || [])) {
      if (a.facture_id === factureId) regle += Number(a.montant || 0);
    }
  }
  regle = Math.round(regle * 100) / 100;
  const ttc = Number(facture.total_ttc || 0);

  /* Plafond : on n'impute jamais plus que le du. Un calcul juste n'en a pas
     besoin — c'est pour le jour ou il cessera de l'etre. Sans lui, un
     trop-percu passe la facture en « soldee » et on cesse de la relancer. */
  if (ttc > 0 && regle > ttc) {
    console.warn('[paiement:recompute] affectations superieures au du —',
      'facture', factureId, ':', regle, '>', ttc);
    regle = Math.round(ttc * 100) / 100;
  }`;

/* ── 2. Le re-lettrage complet ────────────────────────────────────── */
const A2 = `module.exports = { appliquerCredit };`;

const N2 = `/* Remet a plat l'imputation d'un resident : vide les affectations de tous
   ses reglements, puis les refait dans l'ordre chronologique.

   Les MONTANTS encaisses ne bougent pas — seule leur imputation change. La
   chaine d'inalterabilite scelle mode, date, montant et reference, pas les
   affectations (voir l'en-tete de ce fichier). Rien de fiscal n'est touche.

   C'est ce qui repare les dossiers ou le meme paiement a ete impute
   plusieurs fois faute de montant_regle a jour. */
async function relettrerResident(campingId, residentId) {
  if (!campingId || !residentId) return { remis: 0, affecte: 0, factures: 0 };

  const { data: regs, error } = await supabase.from('reglements')
    .select('id,affectations').eq('camping_id', campingId).eq('resident_id', residentId);
  if (error) throw error;

  /* Les factures a recalculer : celles que les anciennes affectations
     touchaient, plus celles que les nouvelles toucheront. Sans la premiere
     moitie, une facture qui perd son imputation garderait son ancien solde. */
  const aRecalculer = new Set();
  for (const r of (regs || [])) {
    for (const a of (r.affectations || [])) if (a.facture_id) aRecalculer.add(a.facture_id);
    if ((r.affectations || []).length) {
      await supabase.from('reglements').update({ affectations: [] }).eq('id', r.id);
    }
  }
  for (const fid of aRecalculer) await recomputeFacture(campingId, fid);

  const r = await appliquerCredit(campingId, residentId);
  return { remis: (regs || []).length, affecte: r.affecte, factures: r.factures };
}

module.exports = { appliquerCredit, relettrerResident };`;

/* ── 3. La route ──────────────────────────────────────────────────── */
const A3 = `router.post('/', requirePerm('encaisser'), async (req, res) => {`;

const N3 = `// POST /api/reglements/relettrer  { resident_id }
// Remet a plat l'imputation des paiements d'un resident. Reserve a l'admin :
// l'operation reecrit toutes ses affectations.
router.post('/relettrer', requireRole('admin'), async (req, res) => {
  try {
    const residentId = req.body && req.body.resident_id;
    if (!residentId) return res.status(400).json({ error: 'resident_id requis' });

    const { relettrerResident } = require('../lib/lettrage');
    const r = await relettrerResident(req.activeCampingId, residentId);

    await writeAudit(req, { action: 'update', entite: 'residents', entite_id: residentId,
      apres: { relettrage: true, reglements: r.remis, affecte: r.affecte, factures: r.factures } });
    res.json(r);
  } catch (e) {
    console.error('[reglements:relettrer]', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.post('/', requirePerm('encaisser'), async (req, res) => {`;

const edits = [
  [PAIE,  'requete et plafond', A1, N1, () => paie,  (v) => { paie = v; }],
  [LETT,  're-lettrage',        A2, N2, () => lett,  (v) => { lett = v; }],
  [ROUTE, 'route de relettrage', A3, N3, () => route, (v) => { route = v; }]
];

for (const [, nom, ancien, , get] of edits) {
  const n = get().split(ancien).length - 1;
  if (n !== 1) {
    console.error('\n  \u2717 ' + nom + ' : ' + n + ' occurrence(s), 1 attendue.');
    console.error('    Le fichier a change. Rien n\'a ete ecrit.\n');
    process.exit(1);
  }
}
for (const [, , ancien, nouveau, get, set] of edits) set(get().split(ancien).join(nouveau));

for (const [f, nom, , , get] of edits) {
  try { new Function(get()); }
  catch (e) {
    console.error('\n  \u2717 ' + nom + ' : JavaScript invalide — ' + e.message);
    console.error('    Rien n\'a ete ecrit.\n');
    process.exit(1);
  }
}

if (!ESSAI) {
  fs.writeFileSync(PAIE, paie, 'utf8');
  fs.writeFileSync(LETT, lett, 'utf8');
  fs.writeFileSync(ROUTE, route, 'utf8');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log('  La requete de lettrage retrouve enfin les reglements.');
console.log('  montant_regle est plafonne au du, et l\'echec se journalise.');
console.log('  Nouvelle route POST /api/reglements/relettrer { resident_id }.\n');
console.log('  Les nouveaux paiements s\'imputeront correctement. Les dossiers');
console.log('  deja abimes demandent un appel a /relettrer — un par resident.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

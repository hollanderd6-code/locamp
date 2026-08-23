#!/usr/bin/env node
/* ============================================================
   outils/route-recap.js
   La route du récapitulatif, seule
   ============================================================
   Cible : backend/routes/signatures.js

   Le script precedent groupait cinq modifications et n'ecrivait qu'en
   cas de succes complet. L'une a echoue, rien n'a ete ecrit, et le
   commit qui suivait n'a emporte que le fichier d'outil : la route
   n'est jamais arrivee en production, sans que rien ne le signale.

   Celui-ci ne fait qu'une chose, et se termine en code 1 s'il echoue —
   ce qui arrete un enchainement « && git commit ».

   ── LA ROUTE ─────────────────────────────────────────────────────
   GET /api/signatures/:id/recap renvoie le dossier de preuve en PDF.
   buildRecapPdf() existait deja dans lib/pdf.js, complet ; le bouton
   appelait deja cette adresse. Seul le fil entre les deux manquait.

   La consultation est tracee : lire un dossier de preuve est un acte,
   au meme titre que telecharger un contrat.

   Usage :
     node outils/route-recap.js --essai
     node outils/route-recap.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'backend', 'routes', 'signatures.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);          // arrete un « && git commit » qui suivrait
}

if (!fs.existsSync(CIBLE)) echec('backend/routes/signatures.js introuvable. Lancez depuis la racine du projet.');

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('/:id/recap') !== -1) {
  console.log('\n  La route est deja presente — rien a faire.\n');
  process.exit(0);
}

const ROUTE = `
// GET /api/signatures/:id/recap  -> PDF du dossier de preuve
// buildRecapPdf existait deja dans lib/pdf.js et le bouton appelait deja cette
// adresse : seul le fil entre les deux manquait.
router.get('/:id/recap', async (req, res) => {
  try {
    const { data: doc } = await supabase.from('documents_signature').select('*')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).maybeSingle();
    if (!doc) return res.status(404).json({ error: 'Document introuvable' });
    if (doc.statut !== 'signe') {
      return res.status(400).json({ error: 'Le récapitulatif n\\u2019existe qu\\u2019une fois le document signé.' });
    }

    const [camping, resident, preuve] = await Promise.all([
      supabase.from('campings').select('nom,raison_sociale,adresse,email,siret')
        .eq('id', req.activeCampingId).maybeSingle(),
      doc.resident_id
        ? supabase.from('residents').select('civilite,nom,prenom,email,adresse')
            .eq('id', doc.resident_id).maybeSingle()
        : Promise.resolve({ data: {} }),
      supabase.from('signatures_preuves').select('*').eq('document_id', doc.id).maybeSingle(),
    ]);

    const { buildRecapPdf } = require('../lib/pdf');
    const pdf = await buildRecapPdf({
      camping: camping.data || {},
      resident: resident.data || {},
      document: doc,
      preuve: preuve.data || null,
    });

    /* Consulter un dossier de preuve est un acte : il laisse une trace, au
       meme titre que le telechargement d'un contrat. */
    await writeAudit(req, { action: 'access', entite: 'documents_signature',
      entite_id: doc.id, apres: { titre: doc.titre, piece: 'recapitulatif' } });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      'inline; filename="recapitulatif-' + String(doc.id).slice(0, 8) + '.pdf"');
    res.send(pdf);
  } catch (e) {
    console.error('[sign:recap]', e.message);
    res.status(500).json({ error: 'Récapitulatif impossible : ' + e.message });
  }
});

`;

/* On se pose juste avant l'export, quelle que soit sa forme exacte. */
const ANCRE = 'module.exports = router;';
const n = src.split(ANCRE).length - 1;
if (n !== 1) echec(n + ' occurrence(s) de « ' + ANCRE + ' », 1 attendue.');

src = src.replace(ANCRE, ROUTE + ANCRE);

/* Les dependances utilisees par la route doivent etre en tete du fichier. */
for (const dep of ['supabase', 'writeAudit']) {
  if (src.indexOf(dep) === -1) echec('« ' + dep + ' » n\'est pas importe dans ce fichier.');
}

try { new Function(src); }
catch (e) { echec('Le resultat n\'est pas du JavaScript valide : ' + e.message); }

if (!ESSAI) fs.writeFileSync(CIBLE, src, 'utf8');

/* Verification apres ecriture : ce qui est sur le disque, pas ce qu'on croit. */
if (!ESSAI) {
  const relu = fs.readFileSync(CIBLE, 'utf8');
  if (relu.indexOf("router.get('/:id/recap'") === -1) echec('La route n\'est pas dans le fichier apres ecriture.');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  GET /api/signatures/:id/recap ajoutee a signatures.js.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

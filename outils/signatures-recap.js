#!/usr/bin/env node
/* ============================================================
   outils/signatures-recap.js
   Le récapitulatif n'avait pas de route
   ============================================================
   Cibles : backend/routes/signatures.js
            backend/public/app.js

   ── 1. « ROUTE INTROUVABLE » ─────────────────────────────────────
   Le bouton « Recapitulatif » appelle GET /api/signatures/:id/recap.
   Cette route n'existe pas.

   Pourtant tout le reste est ecrit : buildRecapPdf() occupe 130 lignes
   dans lib/pdf.js — en-tete eIDAS, emetteur, signataire, detail
   chronologique horodate en Europe/Paris, empreintes SHA-256,
   consentement, mentions des articles 1366 et 1367 du Code civil. Un
   vrai dossier de preuve.

   Il manquait le fil entre le bouton et la fonction. La route est
   ecrite ici : elle charge le document, le resident, le camping et la
   preuve, appelle buildRecapPdf et renvoie le PDF.

   L'acces est trace (writeAudit) : consulter un dossier de preuve est
   un acte qui doit laisser une trace, comme le telechargement d'un
   contrat.

   ── 2. UN CHAMP DE SAISIE SUR CHAQUE LIGNE ───────────────────────
   La colonne « Terme » affiche un selecteur de date sur toutes les
   lignes, y compris les documents ANNULES. Sur votre liste, huit champs
   vides s'alignent, dont cinq sur des documents qui n'ont plus cours.

   Un terme ne veut dire quelque chose que sur un document en vigueur :
   c'est ce qui declenche les rappels d'echeance. Sur un document annule
   ou en brouillon, il ne declenche rien.

   Le champ ne s'affiche donc plus que sur les documents envoyes ou
   signes. Les autres portent un tiret — comme les colonnes voisines.

   ── 3. LE TUTOIEMENT ─────────────────────────────────────────────
   Trois messages du depot tutoient : « Tu placeras ensuite les zones »,
   « renseigne son terme », « Locamp te previendra ». Meme correction
   que sur la fiche resident.

   Usage :
     node outils/signatures-recap.js --essai
     node outils/signatures-recap.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');
const ROUTE = path.join(process.cwd(), 'backend', 'routes', 'signatures.js');
const APP   = path.join(process.cwd(), 'backend', 'public', 'app.js');

for (const f of [ROUTE, APP]) {
  if (!fs.existsSync(f)) {
    console.error('\n  \u2717 ' + f + ' introuvable. Lancez depuis la racine du projet.\n');
    process.exit(1);
  }
}

let route = fs.readFileSync(ROUTE, 'utf8');
let app   = fs.readFileSync(APP, 'utf8');

if (route.indexOf("'/:id/recap'") !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

/* ── 1. La route manquante ────────────────────────────────────────── */
const A1 = `module.exports = router;`;

const N1 = `// GET /api/signatures/:id/recap  -> PDF du dossier de preuve
// buildRecapPdf existait dans lib/pdf.js et le bouton appelait cette adresse
// depuis le debut : seule la route entre les deux manquait.
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
      \`inline; filename="recapitulatif-\${String(doc.id).slice(0, 8)}.pdf"\`);
    res.send(pdf);
  } catch (e) {
    console.error('[sign:recap]', e.message);
    res.status(500).json({ error: 'Récapitulatif impossible : ' + e.message });
  }
});

module.exports = router;`;

/* ── 2. Le champ de terme, seulement quand il agit ────────────────── */
const A2 = `            return \`\${badge}<input type="date" value="\${d.date_fin || ''}" data-act="majTermeDoc" data-evt="change" data-a1="\${d.id}" data-a2="@value" title="Terme du document — modifiable directement">\`;`;

const N2 = `            /* Le terme declenche les rappels d'echeance : il n'agit que sur un
               document en vigueur. Sur un brouillon ou un document annule, le
               champ n'aurait aucun effet — huit selecteurs de date vides
               alignes pour rien. */
            if (d.statut !== 'signe' && d.statut !== 'envoye') {
              return d.date_fin ? \`\${badge}\${dfr(d.date_fin)}\` : '<span class="muted">—</span>';
            }
            return \`\${badge}<input type="date" value="\${d.date_fin || ''}" data-act="majTermeDoc" data-evt="change" data-a1="\${d.id}" data-a2="@value" title="Terme du document — modifiable directement">\`;`;

/* ── 3. Le tutoiement ─────────────────────────────────────────────── */
const edits = [
  [ROUTE, 'route recap',  A1, N1, () => route, (v) => { route = v; }],
  [APP,   'champ terme',  A2, N2, () => app,   (v) => { app = v; }],
  [APP,   'depot : zones',
    `PDF uniquement. Tu placeras ensuite les zones de signature sur le document.`,
    `PDF uniquement. Vous placerez ensuite les zones de signature sur le document.`,
    () => app, (v) => { app = v; }],
  [APP,   'depot : terme',
    `Si c\\u2019est un contrat (ou tout document à durée limitée), renseigne son terme : Locamp te préviendra avant l\\u2019échéance`,
    `Si c\\u2019est un contrat (ou tout document à durée limitée), renseignez son terme : Locamp vous préviendra avant l\\u2019échéance`,
    () => app, (v) => { app = v; }],
  [APP,   'documents : assurance',
    `Pour une attestation d\\u2019assurance : pense aussi à renseigner la date sur la fiche`,
    `Pour une attestation d\\u2019assurance : pensez aussi à renseigner la date sur la fiche`,
    () => app, (v) => { app = v; }]
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

for (const [, nom, , , get] of edits) {
  try { new Function(get()); }
  catch (e) {
    console.error('\n  \u2717 ' + nom + ' : JavaScript invalide — ' + e.message);
    console.error('    Rien n\'a ete ecrit.\n');
    process.exit(1);
  }
}

if (!ESSAI) {
  fs.writeFileSync(ROUTE, route, 'utf8');
  fs.writeFileSync(APP, app, 'utf8');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log('  GET /api/signatures/:id/recap ecrite — le bouton fonctionne.');
console.log('  Le champ « terme » ne s\'affiche que sur les documents en vigueur.');
console.log('  Trois messages passes au vouvoiement.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

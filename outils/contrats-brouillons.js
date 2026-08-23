#!/usr/bin/env node
/* ============================================================
   outils/contrats-brouillons.js
   Quatre brouillons qu'on ne pouvait ni finir ni supprimer
   ============================================================
   Cibles : backend/routes/contrats.js
            backend/public/app.js

   ── LA VRAIE CAUSE ───────────────────────────────────────────────
   POST /api/contrats travaille en deux temps :

       1. insert du contrat            statut « brouillon »
       2. generation du PDF, puis      statut « emis »

   Si l'etape 2 echoue, l'erreur est attrapee au niveau de la route et
   renvoyee en 500 — mais le contrat de l'etape 1 reste en base. En
   brouillon, sans PDF.

   Or un contrat sans PDF ne peut RIEN : « Telecharger » repond « PDF non
   genere », « Envoyer en signature » exige un pdf_path, « Signe
   (papier) » refuse explicitement les brouillons. Aucune action, pas
   meme la suppression.

   L'utilisateur voit une erreur, recommence, et laisse un dechet a
   chaque tentative. Quatre brouillons sur le dossier Dupont, un cinquieme
   contrat qui a fini par passer.

   Ce n'est donc pas un manque de bouton : c'est une operation en deux
   temps sans reprise ni nettoyage.

   ── CE QUI EST FAIT ──────────────────────────────────────────────

   1. ON NE LAISSE PLUS DE DECHET. Si la generation du PDF echoue, le
      contrat insere est supprime avant de renvoyer l'erreur. Un contrat
      existe entierement ou pas du tout. Meme traitement au renouvellement.

   2. L'ERREUR DIT CE QUI S'EST PASSE. « Erreur serveur » ne permettait
      pas de savoir que le PDF etait en cause. Le message porte desormais
      la raison — c'est ce qui manquait pour comprendre les quatre
      brouillons.

   3. ON PEUT REESSAYER. POST /:id/regenerer-pdf reprend un contrat reste
      en brouillon et le fait passer en « emis ». Repare l'existant sans
      resaisie.

   4. ON PEUT SUPPRIMER — LES BROUILLONS SEULEMENT. Un contrat emis ou
      signe est une piece : il se resilie, il ne s'efface pas. La route
      refuse tout autre statut, et l'operation est tracee.

   Usage :
     node outils/contrats-brouillons.js --essai
     node outils/contrats-brouillons.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');
const ROUTE = path.join(process.cwd(), 'backend', 'routes', 'contrats.js');
const APP   = path.join(process.cwd(), 'backend', 'public', 'app.js');

for (const f of [ROUTE, APP]) {
  if (!fs.existsSync(f)) {
    console.error('\n  \u2717 ' + f + ' introuvable. Lancez depuis la racine du projet.\n');
    process.exit(1);
  }
}

let route = fs.readFileSync(ROUTE, 'utf8');
let app   = fs.readFileSync(APP, 'utf8');

if (route.indexOf('regenerer-pdf') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

/* ── 1. Creation : nettoyer derriere soi ──────────────────────────── */
const A1 = `    // génération PDF
    const full = await loadFullContrat(req.activeCampingId, contrat.id);
    const { path, hash } = await genererPdfNonSigne(full);
    const { data: updated } = await supabase.from('contrats')
      .update({ pdf_path: path, hash_document: hash, statut: 'emis' })
      .eq('id', contrat.id).select().single();`;

const N1 = `    /* Le contrat est insere, il reste a lui donner son PDF. Si cette seconde
       etape echoue, on retire le contrat : sans PDF il ne peut ni etre
       telecharge, ni envoye en signature, ni marque signe — un brouillon
       inerte que rien ne permet meme de supprimer. Un contrat existe
       entierement ou pas du tout. */
    let updated;
    try {
      const full = await loadFullContrat(req.activeCampingId, contrat.id);
      const g = await genererPdfNonSigne(full);
      const r = await supabase.from('contrats')
        .update({ pdf_path: g.path, hash_document: g.hash, statut: 'emis' })
        .eq('id', contrat.id).select().single();
      updated = r.data;
    } catch (ePdf) {
      await supabase.from('contrats').delete().eq('id', contrat.id);
      console.error('[contrats:create] PDF impossible, contrat retire —', ePdf.message);
      return res.status(500).json({ error: 'Génération du PDF impossible : ' + ePdf.message });
    }`;

/* ── 2. Renouvellement : meme traitement ──────────────────────────── */
const A2 = `    const full2 = await loadFullContrat(req.activeCampingId, neuf.id);
    const { path, hash } = await genererPdfNonSigne(full2);
    await supabase.from('contrats').update({ pdf_path: path, hash_document: hash, statut: 'emis' })
      .eq('id', neuf.id);`;

const N2 = `    let path;
    try {
      const full2 = await loadFullContrat(req.activeCampingId, neuf.id);
      const g = await genererPdfNonSigne(full2);
      path = g.path;
      await supabase.from('contrats').update({ pdf_path: g.path, hash_document: g.hash, statut: 'emis' })
        .eq('id', neuf.id);
    } catch (ePdf) {
      // Meme regle qu'a la creation : pas de contrat sans PDF.
      await supabase.from('contrats').delete().eq('id', neuf.id);
      console.error('[contrats:renouveler] PDF impossible, contrat retire —', ePdf.message);
      return res.status(500).json({ error: 'Génération du PDF impossible : ' + ePdf.message });
    }`;

/* ── 3. Reprise et suppression ────────────────────────────────────── */
const A3 = `module.exports = router;`;

const N3 = `// ---------- POST regenerer-pdf : reprendre un brouillon reste sans PDF ----------
// Repare les contrats crees avant que la creation ne nettoie derriere elle.
router.post('/:id/regenerer-pdf', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const full = await loadFullContrat(req.activeCampingId, req.params.id);
    if (!full) return res.status(404).json({ error: 'Contrat introuvable' });
    if (full.contrat.statut === 'signe') {
      return res.status(409).json({ error: 'Contrat signé : le PDF est scellé.' });
    }

    const { path: p, hash } = await genererPdfNonSigne(full);
    const patch = { pdf_path: p, hash_document: hash };
    // Un brouillon qui obtient enfin son PDF rejoint le circuit normal.
    if (full.contrat.statut === 'brouillon') patch.statut = 'emis';

    const { data, error } = await supabase.from('contrats').update(patch)
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).select().single();
    if (error) throw error;

    await writeAudit(req, { action: 'update', entite: 'contrats', entite_id: data.id,
      apres: { numero: data.numero, statut: data.statut, pdf: 'regenere' } });
    res.json({ contrat: data });
  } catch (e) {
    console.error('[contrats:regenerer-pdf]', e.message);
    res.status(500).json({ error: 'Génération du PDF impossible : ' + e.message });
  }
});

// ---------- DELETE : brouillons uniquement ----------
// Un contrat emis ou signe est une piece : il se resilie, il ne s'efface pas.
router.delete('/:id', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const { data: c } = await supabase.from('contrats').select('id,numero,statut,pdf_path')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).maybeSingle();
    if (!c) return res.status(404).json({ error: 'Contrat introuvable' });
    if (c.statut !== 'brouillon') {
      return res.status(409).json({
        error: 'Seul un brouillon peut être supprimé. Un contrat émis ou signé se résilie.'
      });
    }

    if (c.pdf_path) await removeDocument(c.pdf_path).catch(() => {});
    const { error } = await supabase.from('contrats').delete()
      .eq('camping_id', req.activeCampingId).eq('id', c.id);
    if (error) throw error;

    await writeAudit(req, { action: 'delete', entite: 'contrats', entite_id: c.id,
      avant: { numero: c.numero, statut: c.statut } });
    res.json({ ok: true });
  } catch (e) {
    console.error('[contrats:delete]', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;`;

/* ── 4. Les deux boutons, sur les brouillons seulement ────────────── */
const A4 = `            \${c.statut !== 'signe' && c.statut !== 'brouillon' ? \`
              <button class="btn btn-ghost btn-sm" data-act="contratVersSignature" data-a1="\${c.id}" title="Signature électronique par e-mail">Envoyer en signature</button>
              <button class="btn btn-ghost btn-sm" data-act="signerContratPapier" data-a1="\${c.id}" title="Le résident a signé sur papier : marquer signé (scan facultatif)">Signé (papier)</button>\` : ''}`;

const N4 = `            \${c.statut !== 'signe' && c.statut !== 'brouillon' ? \`
              <button class="btn btn-ghost btn-sm" data-act="contratVersSignature" data-a1="\${c.id}" title="Signature électronique par e-mail">Envoyer en signature</button>
              <button class="btn btn-ghost btn-sm" data-act="signerContratPapier" data-a1="\${c.id}" title="Le résident a signé sur papier : marquer signé (scan facultatif)">Signé (papier)</button>\` : ''}
            \${/* Un brouillon est un contrat dont le PDF n'a pas abouti : sans lui
                 aucune suite n'est possible. Deux issues, reprendre ou jeter. */
              c.statut === 'brouillon' ? \`
              <button class="btn btn-ghost btn-sm" data-act="regenererContrat" data-a1="\${c.id}" title="Le PDF n'a pas été généré : réessayer">Réessayer</button>
              <button class="btn btn-ghost btn-sm" data-act="supprimerContrat" data-a1="\${c.id}" data-a2="\${esc(c.numero || '')}" title="Supprimer ce brouillon">Supprimer</button>\` : ''}`;

/* ── 5. Les deux actions ──────────────────────────────────────────── */
const A5 = `window.telechargerContrat = async (id) => {`;

const N5 = `window.regenererContrat = async (id) => {
  try {
    await api(\`/api/contrats/\${id}/regenerer-pdf\`, { method: 'POST' });
    toast('Contrat émis — PDF généré');
    route();
  } catch (e) { toast(e.message || 'Erreur', true); }
};

window.supprimerContrat = async (id, numero) => {
  if (!await askConfirm(\`Supprimer le brouillon \${numero || ''} ?\\n\\nIl n'a pas de PDF et n'a jamais été envoyé.\`,
    { titre: 'Supprimer le brouillon', ok: 'Supprimer', danger: true })) return;
  try {
    await api(\`/api/contrats/\${id}\`, { method: 'DELETE' });
    toast('Brouillon supprimé');
    route();
  } catch (e) { toast(e.message || 'Erreur', true); }
};

window.telechargerContrat = async (id) => {`;

const edits = [
  [ROUTE, 'creation',      A1, N1, () => route, (v) => { route = v; }],
  [ROUTE, 'renouvellement', A2, N2, () => route, (v) => { route = v; }],
  [ROUTE, 'routes reprise/suppression', A3, N3, () => route, (v) => { route = v; }],
  [APP,   'boutons',       A4, N4, () => app,   (v) => { app = v; }],
  [APP,   'actions',       A5, N5, () => app,   (v) => { app = v; }]
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
  fs.writeFileSync(ROUTE, route, 'utf8');
  fs.writeFileSync(APP, app, 'utf8');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log('  Un PDF qui echoue ne laisse plus de contrat derriere lui.');
console.log('  L\'erreur dit la raison au lieu de « Erreur serveur ».');
console.log('  Les brouillons existants : « Reessayer » ou « Supprimer ».\n');
console.log('  Sur vos quatre brouillons, « Reessayer » dira pourquoi le PDF');
console.log('  echouait — c\'est l\'information qui manquait.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

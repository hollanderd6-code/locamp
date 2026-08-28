#!/usr/bin/env node
/* ============================================================
   outils/emplacement-supprimable.js
   Supprimer un emplacement
   ============================================================
   Cibles : backend/routes/emplacements.js  et  backend/public/app.js

   ── CE QUI MANQUAIT ─────────────────────────────────────────────
   On peut creer et modifier un emplacement, mais pas le supprimer :
   il n'existe AUCUNE route DELETE cote serveur. Un emplacement cree
   par erreur, ou un lot demoli, restait donc pour toujours — et
   faussait l'occupation (« 58 / 59 ») sans qu'on puisse rien y faire.

   ── CE QUE FAIT CE CORRECTIF ────────────────────────────────────
   Serveur : DELETE /api/emplacements/:id, meme role que la creation
   (admin, gestionnaire), tracee dans le journal d'activite comme les
   autres suppressions. Elle REFUSE si un resident est rattache — un
   emplacement habite ne se supprime pas, on demenage d'abord le
   resident. Le message le dit avec le nom du resident, pour qu'on
   sache ou aller.

   Front : un bouton « Supprimer » dans la fiche de l'emplacement,
   avec une confirmation qui annonce la consequence reelle. Elle
   compte : le schema declare
       releves_compteurs.emplacement_id ... ON DELETE CASCADE
   donc supprimer un emplacement supprime AUSSI tout son historique
   de relevés d'eau et d'electricite. C'est irreversible, et c'est
   ecrit dans la confirmation — pas decouvert apres.

   Les prestations et les residents, eux, sont declares ON DELETE SET
   NULL : ils survivent, simplement detaches. Rien n'est perdu de ce
   qui a ete facture.

   Usage :
     node outils/emplacement-supprimable.js --essai
     node outils/emplacement-supprimable.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const ROUTE = path.join(process.cwd(), 'backend', 'routes', 'emplacements.js');
const APP = path.join(process.cwd(), 'backend', 'public', 'app.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

/* ---------- 1. La route serveur ---------- */
const ROUTE_CODE = `
// DELETE /api/emplacements/:id  (admin, gestionnaire)
// Refuse si un resident est rattache : un emplacement habite ne se supprime
// pas, on demenage d'abord. Les releves de compteur de cet emplacement
// partent avec lui (ON DELETE CASCADE, cf. db/08_releves_compteurs.sql) ;
// residents et prestations sont seulement detaches (ON DELETE SET NULL).
router.delete('/:id', requireRole('admin', 'gestionnaire'), async (req, res) => {
  try {
    const { data: emp } = await supabase.from('emplacements').select('*')
      .eq('camping_id', req.activeCampingId).eq('id', req.params.id).maybeSingle();
    if (!emp) return res.status(404).json({ error: 'Emplacement introuvable' });

    const { data: occupants } = await supabase.from('residents')
      .select('id,nom,prenom')
      .eq('camping_id', req.activeCampingId).eq('emplacement_id', emp.id);

    if (occupants && occupants.length) {
      const qui = occupants.map((r) => \`\${r.prenom || ''} \${r.nom || ''}\`.trim()).filter(Boolean).join(', ');
      return res.status(409).json({
        error: \`Emplacement \${emp.numero} occupé par \${qui || 'un résident'} : \`
          + 'déplacez le résident vers un autre emplacement avant de le supprimer.',
      });
    }

    const { error } = await supabase.from('emplacements').delete()
      .eq('camping_id', req.activeCampingId).eq('id', emp.id);
    if (error) throw error;

    await writeAudit(req, { action: 'delete', entite: 'emplacements', entite_id: emp.id, avant: emp });
    res.json({ ok: true, numero: emp.numero });
  } catch (e) {
    console.error('[emplacements:delete]', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
`;

/* ---------- 2. Le bouton et l'action, cote front ---------- */
function FRONT_CODE() {
  /* La suppression d'un emplacement efface aussi son historique de
     releves (ON DELETE CASCADE cote base) : la confirmation doit le dire
     avant, pas la surprise apres. */
  window.supprimerEmplacement = async (id, numero) => {
    const ok = await askConfirm(
      `Supprimer l\u2019emplacement ${numero} ?\n\n`
      + 'Son historique de relevés d\u2019eau et d\u2019électricité sera supprimé avec lui, '
      + 'définitivement. Les factures et prestations déjà émises sont conservées.',
      { titre: 'Supprimer l\u2019emplacement', ok: 'Supprimer', danger: true }
    );
    if (!ok) return;
    try {
      await api('/api/emplacements/' + id, { method: 'DELETE' });
      EMP_SEL = null;
      toast(`Emplacement ${numero} supprimé`);
      /* Le plan garde les emplacements en memoire : on le fait relire. */
      if (typeof carteState !== 'undefined' && carteState) carteState = null;
      route();
    } catch (err) { toast(err.message, true); }
  };
}

for (const f of [ROUTE, APP]) if (!fs.existsSync(f)) echec(`${f} introuvable. Lancez depuis la racine du projet.`);
let route = fs.readFileSync(ROUTE, 'utf8');
let app = fs.readFileSync(APP, 'utf8');

if (route.indexOf("router.delete('/:id'") !== -1 || app.indexOf('window.supprimerEmplacement') !== -1) {
  console.log('\n  La suppression d\'emplacement existe deja — rien a faire.\n');
  process.exit(0);
}
if (app.indexOf('window.ouvrirEmplacement') === -1) {
  echec('outils/emplacements-liste-fiche.js n\'a pas ete applique : le bouton se pose dans la fiche.');
}

/* La route se pose juste avant l'export du routeur. */
const R_ANCRE = 'module.exports = router;';
if (route.split(R_ANCRE).length - 1 !== 1) echec('L\'export du routeur emplacements est introuvable ou duplique.');
route = route.replace(R_ANCRE, ROUTE_CODE.replace(/^\n/, '') + '\n' + R_ANCRE);

/* L'action, juste avant les filtres de l'ecran Emplacements — meme portee
   que EMP_SEL, qu'elle remet a zero. */
const A_ANCRE = 'window.filtrerEmplacements = (k) =>';
if (app.split(A_ANCRE).length - 1 !== 1) echec('L\'ancre des filtres Emplacements est introuvable ou dupliquee.');

const FRONT = FRONT_CODE.toString()
  .replace(/^function FRONT_CODE\(\)\s*\{\r?\n/, '')
  .replace(/\}\s*$/, '')
  .replace(/^ {2}/gm, '');

app = app.replace(A_ANCRE, FRONT.replace(/\s*$/, '\n') + '\n' + A_ANCRE);

/* Le bouton, dans la tete de la fiche — a gauche des deux autres, comme
   toute action destructrice. */
const B_ANCIEN = '      <div style="flex:none;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">\n'
  + '        <button class="btn btn-ghost btn-sm" data-act="allerA" data-a1="#/carte">Voir sur le plan</button>';
const B_NOUVEAU = '      <div style="flex:none;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">\n'
  + '        <button class="btn btn-ghost btn-sm" data-act="supprimerEmplacement" data-a1="${e.id}" data-a2="${esc(e.numero)}">Supprimer</button>\n'
  + '        <button class="btn btn-ghost btn-sm" data-act="allerA" data-a1="#/carte">Voir sur le plan</button>';
if (app.split(B_ANCIEN).length - 1 !== 1) echec('La tete de la fiche emplacement est introuvable ou modifiee.');
app = app.split(B_ANCIEN).join(B_NOUVEAU);

try { new Function(app); }
catch (e) { echec('app.js resultant n\'est pas du JavaScript valide — ' + e.message); }
try { new Function(route); }
catch (e) { echec('emplacements.js resultant n\'est pas du JavaScript valide — ' + e.message); }

for (const [quoi, aiguille, ou] of [
  ['la route DELETE', "router.delete('/:id'", route],
  ['le refus si occupe', 'déplacez le résident', route],
  ['la trace au journal', "action: 'delete', entite: 'emplacements'", route],
  ['l\'action front', 'window.supprimerEmplacement', app],
  ['le bouton', 'data-act="supprimerEmplacement"', app],
  ['l\'avertissement sur les releves', 'sera supprimé avec lui', app],
]) if (ou.indexOf(aiguille) === -1) echec(`Verification : ${quoi} est absent du resultat.`);

if (!ESSAI) {
  fs.writeFileSync(ROUTE, route, 'utf8');
  fs.writeFileSync(APP, app, 'utf8');
  if (fs.readFileSync(APP, 'utf8').indexOf('window.supprimerEmplacement') === -1
    || fs.readFileSync(ROUTE, 'utf8').indexOf("router.delete('/:id'") === -1) {
    echec('L\'ajout est absent apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Serveur : DELETE /api/emplacements/:id (admin, gestionnaire), tracee au journal.');
console.log('  Refus si un resident est rattache — le message nomme le resident.');
console.log('  Front : bouton « Supprimer » dans la fiche, confirmation qui annonce la perte des releves.');
console.log('  Redemarrez le serveur : une route ajoutee ne se recharge pas a chaud.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

#!/usr/bin/env node
/* ============================================================
   outils/carte-statut-reel.js
   La carte disait « tout libre » sur un camping plein
   ============================================================
   Cibles : backend/public/app.js
            backend/routes/emplacements.js

   ── LE DEFAUT ────────────────────────────────────────────────────
   La couleur d'une pastille vient de la colonne « statut » de la table
   emplacements. Cette colonne se remplit a la main, dans le formulaire
   d'emplacement. Rien, nulle part dans le backend, ne la passe a
   « occupe » quand un resident est affecte a l'emplacement.

   Un camping dont les 124 emplacements sont loues a l'annee affiche
   donc 124 pastilles vertes « Libre ».

   Trois consequences en chaine :

     — la legende annonce cinq etats, un seul apparait jamais ;
     — l'impaye ne peut PAS s'afficher : carteColor ne met du rouge que
       si un resident est rattache, mais l'emplacement etant declare
       libre, la mecanique existe sans jamais se declencher ;
     — la fiche resident filtre les emplacements disponibles sur
       statut === 'libre' : elle propose des emplacements deja occupes.

   ── LE PRINCIPE DE LA CORRECTION ─────────────────────────────────
   Un emplacement est occupe parce qu'un resident y habite. Ce n'est pas
   une information a saisir, c'est une consequence — et toute donnee
   saisie qui double une donnee deduite finit par diverger. On cesse
   donc de lire la colonne, et on deduit :

       resident rattache        -> occupe (rouge si en retard de paiement)
       statut saisi bloquant    -> indisponible / reserve  (respectes)
       sinon                    -> libre

   Les etats « indisponible » et « reserve » restent saisis a la main :
   ils ne se deduisent d'aucune autre donnee (travaux, reservation a
   venir). Ils l'emportent sur « libre », jamais sur un resident present.

   La colonne n'est ni supprimee ni reecrite : une migration de donnees
   sur un point qu'on peut deduire a chaque lecture serait un risque
   inutile. Elle continue de servir pour les deux etats manuels.

   ── CE QUI EST CORRIGE AILLEURS ──────────────────────────────────
   Le selecteur d'emplacement de la fiche resident utilise la meme
   deduction : il cesse de proposer des emplacements occupes, et cesse
   d'ecarter ceux qui sont libres mais mal etiquetes.

   Usage :
     node outils/carte-statut-reel.js --essai
     node outils/carte-statut-reel.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');
const APP   = path.join(process.cwd(), 'backend', 'public', 'app.js');
const ROUTE = path.join(process.cwd(), 'backend', 'routes', 'emplacements.js');

for (const f of [APP, ROUTE]) {
  if (!fs.existsSync(f)) {
    console.error('\n  \u2717 ' + f + ' introuvable. Lancez depuis la racine du projet.\n');
    process.exit(1);
  }
}

let app   = fs.readFileSync(APP, 'utf8');
let route = fs.readFileSync(ROUTE, 'utf8');

if (app.indexOf('statutReel') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

/* ── 1. La deduction, et la couleur qui en decoule ────────────────── */
const A1 = `function carteColor(e) {
  const imp = e.resident && carteState.enRetard.has(e.resident.id);
  return imp ? STATUT_COLOR.impaye : (STATUT_COLOR[e.statut] || '#999');
}`;

const N1 = `/* Le statut reel d'un emplacement.

   La colonne « statut » ne se met pas a jour toute seule : personne ne la
   passe a « occupe » quand un resident arrive. S'y fier affichait un camping
   complet comme entierement libre. Un emplacement est occupe parce qu'un
   resident y habite — c'est une consequence, pas une saisie.

   Les deux etats qui ne se deduisent de rien (travaux, reservation a venir)
   restent saisis a la main et sont respectes, mais jamais au point de nier
   un resident present. */
function statutReel(e) {
  if (e.resident) return 'occupe';
  if (e.statut === 'indisponible' || e.statut === 'reserve') return e.statut;
  return 'libre';
}

function carteColor(e) {
  if (e.resident && carteState.enRetard.has(e.resident.id)) return STATUT_COLOR.impaye;
  return STATUT_COLOR[statutReel(e)] || '#999';
}`;

/* ── 2. Le selecteur de la fiche resident ─────────────────────────── */
const A2 = `  // à la modification, on garde l'emplacement actuel dans la liste (il n'est plus « libre »)
  const dispo = emplacements.filter((e) => e.statut === 'libre' || (r && e.id === r.emplacement_id));`;

const N2 = `  /* Meme deduction que sur la carte : la colonne « statut » ne dit pas qui
     habite ou. S'y fier proposait des emplacements deja occupes, et ecartait
     des emplacements libres mal etiquetes. On garde l'emplacement actuel du
     resident a la modification — il n'est plus libre, mais c'est le sien. */
  const dispo = emplacements.filter((e) => statutReel(e) === 'libre' || (r && e.id === r.emplacement_id));`;

/* ── 3. La liste des emplacements affiche le statut deduit ────────── */
const A3 = `const STATUT_COLOR = { libre: '#1E5C4A', occupe: '#2C5282', reserve: '#C98B2D', indisponible: '#8A8A8A', impaye: '#B3492F' };`;
const N3 = `const STATUT_COLOR = { libre: '#1E5C4A', occupe: '#2C5282', reserve: '#C98B2D', indisponible: '#8A8A8A', impaye: '#B3492F' };
window.statutReel = (e) => statutReel(e);`;

const editsApp = [
  ['deduction du statut', A1, N1],
  ['selecteur fiche resident', A2, N2],
  ['exposition de statutReel', A3, N3]
];

for (const [nom, ancien] of editsApp) {
  const n = app.split(ancien).length - 1;
  if (n !== 1) {
    console.error('\n  \u2717 ' + nom + ' : ' + n + ' occurrence(s), 1 attendue.');
    console.error('    Le fichier a change. Rien n\'a ete ecrit.\n');
    process.exit(1);
  }
}
for (const [, ancien, nouveau] of editsApp) app = app.split(ancien).join(nouveau);

/* ── 4. Cote serveur : la liste simple porte aussi le resident ─────
   Sans cela, la fiche resident ne peut pas deduire — elle appelle
   /api/emplacements, qui ne renvoyait pas le resident rattache. */
const A4 = `    let q = supabase.from('emplacements').select('*').eq('camping_id', req.activeCampingId);
    if (req.query.statut) q = q.eq('statut', req.query.statut);
    if (req.query.secteur) q = q.eq('secteur', req.query.secteur);
    if (req.query.type) q = q.eq('type', req.query.type);
    const { data, error } = await q.order('numero');
    if (error) throw error;
    res.json({ emplacements: data });`;

const N4 = `    let q = supabase.from('emplacements').select('*').eq('camping_id', req.activeCampingId);
    if (req.query.statut) q = q.eq('statut', req.query.statut);
    if (req.query.secteur) q = q.eq('secteur', req.query.secteur);
    if (req.query.type) q = q.eq('type', req.query.type);
    const { data, error } = await q.order('numero');
    if (error) throw error;

    /* Le resident rattache voyage avec l'emplacement : c'est lui qui dit si
       l'emplacement est occupe. La colonne « statut » ne le sait pas — rien
       ne la met a jour quand quelqu'un s'installe. */
    const { data: ress } = await supabase.from('residents')
      .select('id,nom,prenom,emplacement_id')
      .eq('camping_id', req.activeCampingId).not('emplacement_id', 'is', null);

    const byEmp = {};
    (ress || []).forEach((r) => { byEmp[r.emplacement_id] = { id: r.id, nom: r.nom, prenom: r.prenom }; });

    res.json({ emplacements: (data || []).map((e) => ({ ...e, resident: byEmp[e.id] || null })) });`;

const n4 = route.split(A4).length - 1;
if (n4 !== 1) {
  console.error('\n  \u2717 route liste : ' + n4 + ' occurrence(s), 1 attendue.');
  console.error('    Le fichier a change. Rien n\'a ete ecrit.\n');
  process.exit(1);
}
route = route.split(A4).join(N4);

if (!ESSAI) {
  fs.writeFileSync(APP, app, 'utf8');
  fs.writeFileSync(ROUTE, route, 'utf8');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log('  Le statut se deduit du resident rattache.');
console.log('  L\'impaye peut enfin s\'afficher sur la carte.');
console.log('  La fiche resident ne propose plus d\'emplacements occupes.\n');
console.log('  « indisponible » et « reserve » restent saisis a la main.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

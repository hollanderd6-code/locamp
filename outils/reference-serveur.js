#!/usr/bin/env node
/* ============================================================
   La référence obligatoire, côté serveur
   ============================================================
   Cible : backend/routes/reglements.js

   Se termine en code 1 au moindre motif introuvable, relit le disque
   après écriture.

   ── POURQUOI ─────────────────────────────────────────────────────
   La règle « un chèque, un virement ou un titre ANCV doit porter sa
   référence » ne vivait que dans le formulaire. L'API l'ignorait.

   Aujourd'hui le formulaire est le seul chemin de saisie, donc la
   règle tient. Elle tombera au premier autre chemin : import de
   relevé bancaire, application mobile, webhook. Et elle tombera
   SILENCIEUSEMENT — des règlements sans référence apparaîtront, sans
   que personne ne relie la cause à l'effet.

   Une règle métier posée dans l'interface est une convention. Posée
   dans la route, c'est une garantie.

   ── LA MÊME TABLE DES DEUX CÔTÉS ─────────────────────────────────
   Le fichier suit déjà ce motif pour la remise en banque :

       const remisable = moyen ? !!moyen.remisable : mode === 'cheque';

   c'est-à-dire : la configuration du camping d'abord, un repli sur le
   code ensuite. La référence obligatoire adopte exactement la même
   forme, avec le TYPE du moyen — pas une liste de codes, pour qu'un
   moyen ajouté demain et typé « cheque » hérite de la règle.

   ── UN SECOND CONTRÔLE, TROUVÉ EN CHEMIN ─────────────────────────
       if (!mode || montant == null) ...

   `montant == null` laisse passer 0 et les montants négatifs. Un
   règlement à 0 € entre dans la chaîne fiscale et déclenche un
   lettrage sur rien ; un montant négatif retire de l'argent d'une
   facture sans qu'aucun avoir ne le justifie. Les deux sont refusés.

   ── CE QUI N'EST PAS TOUCHÉ ──────────────────────────────────────
   Le webhook Stripe n'écrit pas par cette route, et un paiement en
   ligne n'a de toute façon pas de référence à saisir : le type
   « stripe » reste facultatif, comme dans le formulaire.

   Usage :
     node outils/reference-serveur.js --essai
     node outils/reference-serveur.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'backend', 'routes', 'reglements.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

if (!fs.existsSync(CIBLE)) {
  console.error('\n  \u2717 backend/routes/reglements.js introuvable. Lancez depuis la racine du dépôt.\n');
  process.exit(1);
}

let src = fs.readFileSync(CIBLE, 'utf8');
const tailleAvant = src.length;

if (src.indexOf('REF_REQUISE') !== -1) {
  console.log('\n  Déjà appliqué — rien à faire.\n');
  process.exit(0);
}

const edits = [

  /* ── 1. La table des règles, en tête de fichier ────────────── */
  ['table des types exigeant une référence',
`const router = express.Router();
router.use(auth, campingScope);`,

`const router = express.Router();
router.use(auth, campingScope);

/* Types de moyens de paiement pour lesquels la référence est obligatoire :
   sans elle, la ligne du relevé bancaire ne peut plus être reliée à
   l'encaissement au moment du rapprochement.

   Indexé par TYPE et non par code, comme la règle de remise en banque juste
   en dessous : un moyen ajouté par le camping (« Chèque BNP », code maison)
   hérite de la règle du moment qu'il est typé « cheque ». Une liste de codes
   l'aurait oublié en silence.

   Absents volontairement : espece (rien à référencer), carte (le TPE porte
   sa trace), stripe (aucune saisie humaine), autre (on ne sait pas ce que
   c'est — exiger un champ sans savoir ce qu'il doit contenir bloquerait la
   saisie sans rien garantir). */
const REF_REQUISE = {
  cheque: 'le numéro du chèque',
  virement: 'le libellé du virement',
  ancv: 'le numéro du titre ANCV',
};`],

  /* ── 2. Charger le type du moyen ───────────────────────────── */
  ['charger le type du moyen',
`      .select('code,libelle,remisable,actif').eq('camping_id', req.activeCampingId).eq('code', mode).maybeSingle()`,
`      .select('code,libelle,type,remisable,actif').eq('camping_id', req.activeCampingId).eq('code', mode).maybeSingle()`],

  /* ── 3. Les deux contrôles ─────────────────────────────────── */
  ['contrôles : montant et référence',
`    if (!mode || montant == null) return res.status(400).json({ error: 'mode et montant requis' });`,

`    if (!mode) return res.status(400).json({ error: 'mode requis' });
    /* montant == null laissait passer 0 et les négatifs : un règlement à 0 €
       entre dans la chaîne fiscale et lettre sur rien ; un négatif retire de
       l'argent d'une facture sans avoir pour le justifier. */
    const m = Number(montant);
    if (!Number.isFinite(m) || m <= 0) {
      return res.status(400).json({ error: 'Le montant doit être un nombre supérieur à zéro.' });
    }`],

  ['référence exigée selon le type',
`    if (moyen && moyen.actif === false) return res.status(400).json({ error: \`Moyen de paiement « \${moyen.libelle} » désactivé\` });`,

`    if (moyen && moyen.actif === false) return res.status(400).json({ error: \`Moyen de paiement « \${moyen.libelle} » désactivé\` });

    /* Référence obligatoire selon le type du moyen. Même forme que la règle de
       remise ci-dessous : la configuration du camping d'abord, un repli sur le
       code ensuite (un camping sans moyens configurés utilise 'cheque' tel quel).

       Ce contrôle vivait uniquement dans le formulaire. Tout autre chemin
       d'écriture — import de relevé, application mobile — le contournait sans
       que rien ne le signale. */
    const typeMoyen = moyen ? moyen.type : mode;
    const refAttendue = REF_REQUISE[String(typeMoyen || '')];
    if (refAttendue && !String(reference || '').trim()) {
      return res.status(400).json({
        error: \`Référence obligatoire pour ce moyen de paiement : indiquez \${refAttendue}. \`
          + 'Sans elle, l\\'encaissement ne pourra pas être retrouvé au rapprochement bancaire.',
      });
    }`],

  /* ── 4. Utiliser le montant validé ─────────────────────────── */
  ['insertion : montant validé',
`      camping_id: req.activeCampingId, resident_id: resident_id || null, mode, montant,`,
`      camping_id: req.activeCampingId, resident_id: resident_id || null, mode, montant: m,`],

  ['lettrage : montant validé',
`    if (!affectations && resident_id) affectations = await autoAffectations(req.activeCampingId, resident_id, montant);`,
`    if (!affectations && resident_id) affectations = await autoAffectations(req.activeCampingId, resident_id, m);`],

  ['audit : montant validé',
`      apres: { mode, montant, affectations: affectations.length } });`,
`      apres: { mode, montant: m, affectations: affectations.length } });`],
];

let total = 0;
for (const [nom, avant, apres] of edits) {
  const n = src.split(avant).length - 1;
  if (n !== 1) {
    console.error('\n  \u2717 ' + nom);
    console.error('      ' + n + ' occurrence(s), 1 attendue.');
    console.error('      Motif : ' + avant.split('\n')[0].trim().slice(0, 78));
    console.error('\n    AUCUNE écriture. Le fichier est intact.\n');
    process.exit(1);
  }
  src = src.split(avant).join(apres);
  console.log('  ok  ' + nom);
  total += 1;
}

try {
  new Function(src);
} catch (e) {
  console.error('\n  \u2717 reglements.js serait invalide : ' + e.message + '\n    AUCUNE écriture.\n');
  process.exit(1);
}

/* Le `montant` brut ne doit plus servir à écrire : sinon la validation
   porterait sur une valeur et l'enregistrement sur une autre. */
const restes = [];
src.split('\n').forEach((l, i) => {
  if (/^\s*(\/\/|\*)/.test(l)) return;
  if (/\bmontant\b(?!\s*:)/.test(l) && /insert|autoAffectations|apres:/.test(l)) restes.push((i + 1) + ' : ' + l.trim().slice(0, 80));
});
if (restes.length) {
  console.error('\n  \u2717 Le montant non validé est encore utilisé :');
  restes.forEach((r) => console.error('      ' + r));
  console.error('    AUCUNE écriture.\n');
  process.exit(1);
}

if (ESSAI) {
  console.log('\n— ESSAI —  ' + total + ' remplacements, syntaxe vérifiée. Rien écrit.');
  console.log('  Relancez sans --essai pour appliquer.\n');
  process.exit(0);
}

fs.writeFileSync(CIBLE, src, 'utf8');
const relu = fs.readFileSync(CIBLE, 'utf8');
if (relu.indexOf('REF_REQUISE') === -1 || relu.length === tailleAvant) {
  console.error('\n  \u2717 L\'écriture n\'a pas pris. Vérifiez les droits sur le fichier.\n');
  process.exit(1);
}

console.log('\n— APPLIQUÉ —  ' + total + ' remplacements.');
console.log('  Écriture relue : ' + tailleAvant + ' → ' + relu.length + ' octets.');
console.log('\n  À VÉRIFIER APRÈS REDÉMARRAGE — la règle tient hors formulaire :');
console.log('\n    # un chèque sans référence doit être refusé (400)');
console.log('    curl -s -X POST "$URL/api/reglements" \\');
console.log('      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \\');
console.log('      -d \'{"resident_id":"...","mode":"cheque","montant":100}\'');
console.log('\n    # avec sa référence, il passe (201)');
console.log('    ... -d \'{"resident_id":"...","mode":"cheque","montant":100,"reference":"7845213"}\'');
console.log('\n    # un montant à zéro doit être refusé (400)');
console.log('    ... -d \'{"resident_id":"...","mode":"espece","montant":0}\'');
console.log('\n    # les espèces restent sans référence (201)');
console.log('    ... -d \'{"resident_id":"...","mode":"espece","montant":100}\'');
console.log('\n  ATTENTION — CE QUI PEUT CASSER');
console.log('    Si l\'application mobile ou un script enregistre des chèques,');
console.log('    des virements ou de l\'ANCV sans référence, il reçoit');
console.log('    maintenant un 400. C\'est le but — mais vérifiez que rien de');
console.log('    silencieux n\'écrivait par là. Le message d\'erreur nomme ce');
console.log('    qu\'il faut fournir.');
console.log('\n  UN POINT LAISSÉ OUVERT');
console.log('    Les règlements DÉJÀ enregistrés sans référence ne sont pas');
console.log('    touchés : ils resteraient introuvables au rapprochement, mais');
console.log('    corriger l\'historique demande de retrouver les numéros de');
console.log('    chèques. Pour savoir combien sont concernés :');
console.log('      select mode, count(*) from reglements');
console.log('       where (reference is null or reference = \'\')');
console.log('       group by mode;');
console.log('');

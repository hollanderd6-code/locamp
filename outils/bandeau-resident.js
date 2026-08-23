#!/usr/bin/env node
/* ============================================================
   outils/bandeau-resident.js
   Trois indicateurs sur six ne disaient jamais rien
   ============================================================
   Cible : backend/public/app.js

   ── LE DEFAUT ────────────────────────────────────────────────────
   Le bandeau de la fiche resident affiche six chiffres, dont deux
   empruntes a l'hotellerie de passage :

       0 (0 nuits)     SEJOURS
       —               DERNIER SEJOUR

   Sur un camping residentiel, ou les gens louent a l'annee, ces deux
   cases afficheront zero et un tiret pendant toute la vie du dossier.

   Un indicateur qui ne bouge jamais n'informe pas : il occupe la place
   et apprend au lecteur a ne plus regarder le bandeau. C'est le plus
   couteux — il devalue les quatre chiffres voisins, qui eux comptent.

   ── CE QUI EST FAIT ──────────────────────────────────────────────
   Les deux cases ne s'affichent que si le resident a au moins un
   sejour. Locamp gere aussi du passage : les retirer purement priverait
   ces campings-la d'une information utile. C'est la presence de la
   donnee qui decide, pas un reglage a poser.

   Pour un residentiel, le bandeau passe de six cases a quatre : a
   facturer, a regler, regle, cautions. Toutes porteuses.

   « Cautions » reste meme a zero : un zero y signifie « aucune caution
   retenue », ce qui est une reponse, pas une absence de reponse.

   Usage :
     node outils/bandeau-resident.js --essai
     node outils/bandeau-resident.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'backend', 'public', 'app.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

if (!fs.existsSync(CIBLE)) {
  console.error('\n  \u2717 backend/public/app.js introuvable. Lancez depuis la racine du projet.\n');
  process.exit(1);
}

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('/* passage seulement */') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

const ANCIEN = `      \${banItem(\`\${syn.nb_sejours} <small>(\${syn.nb_nuits} nuits)</small>\`, 'Séjours')}
      \${banItem(syn.dernier_sejour ? \`\${dfr(syn.dernier_sejour.du)} <small>→ \${dfr(syn.dernier_sejour.au)}</small>\` : '—', 'Dernier séjour')}`;

const NOUVEAU = `      \${/* passage seulement — vocabulaire d'hotellerie : sur un resident a
            l'annee ces deux cases afficheraient « 0 » et « — » pendant toute
            la vie du dossier, et devalueraient les chiffres voisins. C'est la
            donnee qui decide, pas un reglage. */
        (Number(syn.nb_sejours) > 0 || syn.dernier_sejour)
          ? banItem(\`\${syn.nb_sejours} <small>(\${syn.nb_nuits} nuits)</small>\`, 'Séjours')
            + banItem(syn.dernier_sejour ? \`\${dfr(syn.dernier_sejour.du)} <small>→ \${dfr(syn.dernier_sejour.au)}</small>\` : '—', 'Dernier séjour')
          : ''}`;

const n = src.split(ANCIEN).length - 1;
if (n !== 1) {
  console.error('\n  \u2717 ' + n + ' occurrence(s) du bandeau, 1 attendue.');
  console.error('    Le fichier a change. Rien n\'a ete ecrit.\n');
  process.exit(1);
}

src = src.split(ANCIEN).join(NOUVEAU);

try {
  new Function(src);
} catch (e) {
  console.error('\n  \u2717 Le resultat n\'est pas du JavaScript valide : ' + e.message);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!ESSAI) fs.writeFileSync(CIBLE, src, 'utf8');

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log('  « Sejours » et « Dernier sejour » n\'apparaissent qu\'en presence de sejours.');
console.log('  Le bandeau d\'un resident a l\'annee passe de six cases a quatre.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

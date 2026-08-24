#!/usr/bin/env node
/* ============================================================
   outils/suppression-compte.js
   Le chemin de suppression de compte, exigé par Google Play
   ============================================================
   Cibles : backend/server.js
            backend/public/index.html          (espace gestion)
            backend/public/portail/index.html  (espace locataire)
            backend/public/portail/portail.css
   Fourni a cote : suppression-compte.html → backend/public/

   ── CE QU'EXIGE GOOGLE ───────────────────────────────────────────
   Toute application permettant de creer un compte doit offrir un
   chemin de suppression, atteignable DEPUIS l'application et DEPUIS
   une adresse web publique. Google verifie que le lien fonctionne
   reellement — un lien mort fait rejeter la soumission.

   ── LA DECISION DE FOND : DEUX DEMANDEURS ────────────────────────
   Un gestionnaire et un resident ne s'adressent pas a la meme
   personne, et ce n'est pas une subtilite administrative :

     · le compte d'un gestionnaire nous appartient — nous en sommes
       responsables, la demande nous revient ;
     · les donnees d'un resident ont ete saisies par son camping, qui
       en decide l'usage. Nous ne sommes que sous-traitant : nous ne
       pouvons pas les effacer de notre propre initiative.

   La page traite donc les deux voies separement. C'est la meme
   distinction que dans la politique de confidentialite, et l'ignorer
   nous ferait promettre une suppression que nous n'avons pas le droit
   d'executer.

   ── CE QUE LA PAGE DIT AUSSI ─────────────────────────────────────
   Ce qui ne peut PAS etre supprime : factures, encaissements, contrats
   signes — dix ans d'obligation legale. Google demande explicitement de
   distinguer ce qui est efface de ce qui est conserve. Et une facture
   porte un nom : c'est ce qui la rend valable, elle ne peut donc pas
   etre anonymisee sans perdre sa valeur.

   ── OU LE LIEN EST POSE ──────────────────────────────────────────
   Cote locataire : dans le pied, a cote de « Confidentialite ».
   Cote gestion   : sous le pied de la barre laterale, en petit.

   Discret des deux cotes : c'est une sortie, elle doit exister sans
   s'inviter. Mais lisible — un lien de suppression cache est un lien
   de suppression absent.

   Usage :
     node outils/suppression-compte.js --essai
     node outils/suppression-compte.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');
const B = (...a) => path.join(process.cwd(), 'backend', ...a);
const SERVER = B('server.js');
const GESTION = B('public', 'index.html');
const PORTAIL = B('public', 'portail', 'index.html');
const PCSS = B('public', 'portail', 'portail.css');
const PAGE = B('public', 'suppression-compte.html');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

for (const f of [SERVER, GESTION, PORTAIL, PCSS]) {
  if (!fs.existsSync(f)) echec(f + ' introuvable. Lancez depuis la racine du depot.');
}

let server = fs.readFileSync(SERVER, 'utf8');
let gestion = fs.readFileSync(GESTION, 'utf8');
let portail = fs.readFileSync(PORTAIL, 'utf8');
let pcss = fs.readFileSync(PCSS, 'utf8');

const faits = [];

/* ── 1. La route, sans presumer de l'indentation ──────────────────── */
if (server.indexOf('suppression-compte') !== -1) {
  faits.push('route deja presente');
} else {
  const lignes = server.split('\n');
  const i = lignes.findIndex((l) => /^\s*app\.use\(\s*express\.static\(/.test(l));
  if (i === -1) echec('server.js : ligne « app.use(express.static(...)) » introuvable.');
  const ind = (lignes[i].match(/^\s*/) || [''])[0];

  lignes.splice(i, 0,
    ind + '/* Suppression de compte. Google Play exige ce chemin depuis l\'application',
    ind + '   ET depuis une adresse publique, et verifie qu\'il fonctionne. Pose avant',
    ind + '   le routage de l\'application, qui renverrait l\'ecran de connexion. */',
    ind + 'app.get([\'/suppression-compte\', \'/supprimer-mon-compte\'], (req, res) =>',
    ind + '  res.sendFile(require(\'path\').join(__dirname, \'public\', \'suppression-compte.html\')));',
    ''
  );
  server = lignes.join('\n');
  try { new Function(server); }
  catch (e) { echec('server.js : JavaScript invalide — ' + e.message); }
  faits.push('route posee dans server.js');
}

/* ── 2. Le pied du portail ───────────────────────────────────────── */
const A_P = `    <a href="/confidentialite" target="_blank" rel="noopener">Confidentialité</a>`;
const N_P = `    <a href="/confidentialite" target="_blank" rel="noopener">Confidentialité</a>
    <a href="/suppression-compte" target="_blank" rel="noopener">Supprimer mon compte</a>`;

if (portail.indexOf('suppression-compte') !== -1) {
  faits.push('lien du portail deja present');
} else if (portail.split(A_P).length - 1 === 1) {
  portail = portail.split(A_P).join(N_P);
  faits.push('lien pose dans le pied du portail');
} else {
  echec('portail/index.html : pied de page introuvable. Appliquez d\'abord portail-pied.js.');
}

/* ── 3. Le pied de la barre laterale de gestion ───────────────────── */
const A_G = `    </div>
  </aside>`;
const N_G = `    </div>

    <!-- Sortie de secours, exigee par Google Play : elle doit exister sans
         s'inviter, mais rester lisible — un lien cache est un lien absent. -->
    <div class="liens-legaux">
      <a href="/confidentialite" target="_blank" rel="noopener">Confidentialité</a>
      <a href="/suppression-compte" target="_blank" rel="noopener">Supprimer mon compte</a>
    </div>
  </aside>`;

if (gestion.indexOf('suppression-compte') !== -1) {
  faits.push('lien de gestion deja present');
} else if (gestion.split(A_G).length - 1 === 1) {
  gestion = gestion.split(A_G).join(N_G);
  faits.push('lien pose dans la barre laterale');
} else {
  const n = gestion.split(A_G).length - 1;
  echec('public/index.html : fin de la barre laterale — ' + n + ' occurrence(s), 1 attendue.');
}

/* ── 4. Le style, dans les deux feuilles ─────────────────────────── */
if (pcss.indexOf('LIENS LEGAUX') === -1) {
  pcss += `

/* ── Liens legaux du pied ──
   Deux sorties cote a cote : la politique, et la suppression de compte.
   Discretes — ce ne sont pas des actions du quotidien — mais lisibles :
   Google verifie que le second est atteignable. */
.footy{display:flex;align-items:center;justify-content:center;gap:14px;
  flex-wrap:wrap;text-align:center}
.footy a{font-size:12.5px;color:var(--brume);text-decoration:none;
  border-bottom:1px solid transparent}
.footy a:hover{color:var(--sapin);border-bottom-color:currentColor}
`;
  faits.push('style du pied du portail');
}

const GCSS = B('public', 'styles.css');
if (fs.existsSync(GCSS)) {
  let gcss = fs.readFileSync(GCSS, 'utf8');
  if (gcss.indexOf('liens-legaux') === -1) {
    gcss += `

/* ── Liens legaux de la barre laterale ──
   Sous le pied, en tres petit. La barre est deja dense : ces deux liens
   ne prennent qu'une ligne, et ne s'eclairent qu'au survol. */
.liens-legaux{display:flex;gap:10px;flex-wrap:wrap;
  padding:9px 4px 0;margin-top:8px;
  border-top:1px solid rgba(255,255,255,.06)}
.liens-legaux a{font-size:10.5px;color:#5E7268;text-decoration:none;line-height:1.4}
.liens-legaux a:hover{color:#93A69C}
@media (max-width:880px){
  .liens-legaux{padding-bottom:4px}
}
`;
    if (!ESSAI) fs.writeFileSync(GCSS, gcss, 'utf8');
    faits.push('style de la barre laterale');
  }
}

if (!ESSAI) {
  fs.writeFileSync(SERVER, server, 'utf8');
  fs.writeFileSync(GESTION, gestion, 'utf8');
  fs.writeFileSync(PORTAIL, portail, 'utf8');
  fs.writeFileSync(PCSS, pcss, 'utf8');

  const ok = fs.readFileSync(SERVER, 'utf8').indexOf('suppression-compte') !== -1
          && fs.readFileSync(GESTION, 'utf8').indexOf('suppression-compte') !== -1
          && fs.readFileSync(PORTAIL, 'utf8').indexOf('suppression-compte') !== -1;
  if (!ok) echec('Un fichier n\'a pas ete modifie.');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
faits.forEach((f) => console.log('  · ' + f));
console.log('');

if (!fs.existsSync(PAGE)) {
  console.log('  \u26a0  backend/public/suppression-compte.html est absent. Copiez-le :');
  console.log('     cp ~/Downloads/livraison-suppression/suppression-compte.html backend/public/\n');
}
console.log('  \u26a0  La page porte deux [ADRESSE E-MAIL] a renseigner. Google');
console.log('     verifie que ce chemin fonctionne : un lien mort fait rejeter.\n');
console.log('  Adresse a declarer dans la console Play :');
console.log('     https://locamp.onrender.com/suppression-compte\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

#!/usr/bin/env node
/* ============================================================
   outils/residents-liste.js
   Ecran Residents : largeur bornee, lignes denses, etats en mots
   ============================================================
   Cible : backend/public/app.js  (remplace vueResidents)

   ── POURQUOI PAS UNE LISTE + FICHE ICI ──────────────────────────
   La fiche d'un resident est deja une PAGE (#/residents/:id, avec ses
   onglets factures, reglements, prestations, documents, messages). La
   coller dans un panneau de droite reviendrait a la comprimer, ou a
   l'ecrire deux fois. Le clic sur une ligne continue donc d'ouvrir la
   fiche pleine page — ce qui change, c'est la liste :

   1. Largeur bornee a 1180 px. Le nom et sa colonne Solde se lisaient
      a un metre l'un de l'autre sur un ecran large.
   2. Lignes a 56 px au lieu d'une centaine. Neuf a dix residents
      visibles sans defiler, sans rien serrer.
   3. Les pastilles A / C disparaissent. Rouge et laiton cote a cote,
      sans libelle, avec une legende en pied de tableau : illisible pour
      un daltonien, et le laiton y portait un ETAT alors que votre
      regle dit qu'il n'est qu'un accent. Deux colonnes de mots les
      remplacent : Contrat et Assurance.
   4. Un bandeau de quatre chiffres (actifs, du total, contrats a
      renouveler, pieces manquantes) et quatre filtres comptes.
   5. Un solde nul s'ecrit « — ». Un solde positif est un du : il est
      le seul montant en rouge.
   6. Le surtitre « LOCATAIRES » au-dessus de « Residents » est retire :
      quatre series de capitales espacees se disputaient la hierarchie.

   Aucun changement backend, aucun changement CSS : GET /api/residents
   et GET /api/emplacements comme avant, meme navigation.

   Usage :
     node outils/residents-liste.js --essai
     node outils/residents-liste.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'backend', 'public', 'app.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

function NOUVEAU_CODE() {
  /* ---------- Residents : liste dense, etats en mots ----------
     L'etat de l'ecran (filtre, recherche) vit ici : on revient sur le
     meme filtre apres un aller-retour vers une fiche. */
  let RES_FILTRE = 'tous';
  let RES_Q = '';
  let RES_CACHE = { residents: [], empNum: {} };

  const RES_J = 86400000;
  const resJours = (d) => (d ? Math.floor((new Date(d) - new Date()) / RES_J) : null);

  /* L'ambre des avertissements : c'est la couleur de texte deja utilisee
     par l'avis « prix non configure » des compteurs. Le laiton de marque
     reste un accent, il ne dit jamais un etat. */
  const RES_AMBRE = '#7A5A22';

  function resAssurance(r) {
    if (!r.assurance_expire_le) return { txt: 'Manquante', col: 'var(--rouge)', ko: true };
    const j = resJours(r.assurance_expire_le);
    if (j < 0) return { txt: 'Expirée le ' + dfr(r.assurance_expire_le), col: 'var(--rouge)', ko: true };
    if (j <= 60) return { txt: `Expire dans ${j} j`, col: RES_AMBRE, ko: true };
    return { txt: 'À jour', col: 'var(--brume)', ko: false };
  }

  function resContrat(r) {
    const c = r.contrat;
    if (!c) return { txt: 'Aucun contrat', col: 'var(--rouge)', ko: true };
    if (!c.date_fin) {
      return c.signe
        ? { txt: 'Sans échéance', col: 'var(--brume)', ko: false }
        : { txt: 'Non signé', col: RES_AMBRE, ko: true };
    }
    const j = resJours(c.date_fin);
    if (j < 0) return { txt: 'Expiré le ' + dfr(c.date_fin), col: 'var(--rouge)', ko: true };
    if (!c.signe) return { txt: 'Non signé · fin ' + dfr(c.date_fin), col: RES_AMBRE, ko: true };
    if (j <= 30) return { txt: `Fin dans ${j} j`, col: RES_AMBRE, ko: true };
    return { txt: 'Jusqu\u2019au ' + dfr(c.date_fin), col: 'var(--brume)', ko: false };
  }

  const resDu = (r) => Number(r.solde || 0) > 0.005;

  const RES_FILTRES = [
    ['tous', 'Tous', () => true],
    ['renouveler', 'À renouveler', (r) => r.actif !== false && resContrat(r).ko],
    ['impayes', 'Impayés', (r) => resDu(r)],
    ['pieces', 'Pièces manquantes', (r) => r.actif !== false && resAssurance(r).ko],
    ['inactifs', 'Inactifs', (r) => r.actif === false],
  ];

  function resVisibles() {
    const f = (RES_FILTRES.find((x) => x[0] === RES_FILTRE) || RES_FILTRES[0])[2];
    const q = RES_Q.trim().toLowerCase();
    return RES_CACHE.residents.filter((r) => {
      if (!f(r)) return false;
      if (!q) return true;
      const emp = r.emplacement_id ? (RES_CACHE.empNum[r.emplacement_id] || '') : '';
      return `${r.nom || ''} ${r.prenom || ''} ${r.email || ''} ${r.telephone || ''} ${r.compte_comptable || ''} ${emp}`
        .toLowerCase().includes(q);
    });
  }

  function resLigne(r) {
    const ct = resContrat(r);
    const as = resAssurance(r);
    const emp = r.emplacement_id ? RES_CACHE.empNum[r.emplacement_id] : null;
    const du = resDu(r);
    return `
      <tr class="row-click" data-act="allerA" data-a1="#/residents/${r.id}">
        <td style="padding:9px 12px">
          <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:230px">
            ${esc(r.prenom || '')} ${esc(r.nom)}${r.actif === false ? ' <span class="badge indisponible">inactif</span>' : ''}</div>
          <div class="muted" style="font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:230px">
            ${esc(r.email || r.telephone || '—')}</div>
        </td>
        <td data-l="Empl." style="padding:9px 12px">${emp ? `<strong>${esc(emp)}</strong>` : '<span class="muted">—</span>'}</td>
        <td data-l="Contrat" style="padding:9px 12px;font-size:13px;color:${ct.col}">${ct.txt}</td>
        <td data-l="Assurance" style="padding:9px 12px;font-size:13px;color:${as.col}">${as.txt}</td>
        <td class="right" data-l="Solde" style="padding:9px 12px;font-variant-numeric:tabular-nums;
            ${du ? 'color:var(--rouge);font-weight:600' : ''}">${du || Number(r.solde || 0) < -0.005 ? eur(r.solde) : '—'}</td>
      </tr>`;
  }

  function majListeResidents() {
    const body = $('#res-body');
    if (!body) return;
    const v = resVisibles();
    body.innerHTML = v.length ? v.map(resLigne).join('')
      : `<tr><td colspan="5" class="muted" style="padding:18px">Aucun résident ne correspond${RES_FILTRE === 'tous' && !RES_Q ? '. Créer le premier avec « Nouveau résident ».' : '.'}</td></tr>`;
    const c = $('#res-compte');
    if (c) c.textContent = v.length + (v.length > 1 ? ' résidents affichés' : ' résident affiché');
  }

  window.filtrerResidents = (k) => {
    RES_FILTRE = k;
    const box = $('#res-puces');
    if (box) {
      box.querySelectorAll('[data-a1]').forEach((b) => {
        const on = b.getAttribute('data-a1') === k;
        b.style.background = on ? 'var(--nuit)' : 'transparent';
        b.style.color = on ? 'var(--ivoire)' : '#5D6E66';
        b.style.borderColor = on ? 'var(--nuit)' : 'var(--hairline)';
        b.style.fontWeight = on ? '600' : '400';
      });
    }
    majListeResidents();
  };
  window.chercherResidents = (v) => { RES_Q = v; majListeResidents(); };

  async function vueResidents() {
    const [{ residents }, { emplacements }] = await Promise.all([
      api('/api/residents'), api('/api/emplacements'),
    ]);
    const empNum = {};
    (emplacements || []).forEach((e) => { empNum[e.id] = e.numero + (e.secteur ? ' · ' + e.secteur : ''); });
    RES_CACHE = { residents: residents || [], empNum };

    const actifs = RES_CACHE.residents.filter((r) => r.actif !== false);
    const compte = (k) => RES_CACHE.residents.filter((RES_FILTRES.find((x) => x[0] === k) || RES_FILTRES[0])[2]).length;
    const duTotal = RES_CACHE.residents.reduce((s, r) => s + (resDu(r) ? Number(r.solde) : 0), 0);

    const chiffres = [
      { k: 'Résidents actifs', v: String(actifs.length), n: RES_CACHE.residents.length - actifs.length
        ? `${RES_CACHE.residents.length - actifs.length} inactif${RES_CACHE.residents.length - actifs.length > 1 ? 's' : ''}` : 'aucun inactif', col: '' },
      { k: 'Dû total', v: duTotal > 0.005 ? eur(duTotal) : '—',
        n: `${compte('impayes')} résident${compte('impayes') > 1 ? 's' : ''} débiteur${compte('impayes') > 1 ? 's' : ''}`,
        col: duTotal > 0.005 ? 'var(--rouge)' : '' },
      { k: 'À renouveler', v: String(compte('renouveler')), n: 'contrat échu, non signé ou sous 30 j', col: compte('renouveler') ? RES_AMBRE : '' },
      { k: 'Pièces manquantes', v: String(compte('pieces')), n: 'assurance absente ou expirée', col: compte('pieces') ? RES_AMBRE : '' },
    ];

    const puces = RES_FILTRES.map(([k, l]) => {
      const on = k === RES_FILTRE;
      return `<button data-act="filtrerResidents" data-a1="${k}"
        style="padding:5px 12px;border-radius:20px;font-size:13px;cursor:pointer;font-family:inherit;
               border:1px solid ${on ? 'var(--nuit)' : 'var(--hairline)'};
               background:${on ? 'var(--nuit)' : 'transparent'};color:${on ? 'var(--ivoire)' : '#5D6E66'};
               font-weight:${on ? '600' : '400'}">${l} ${compte(k)}</button>`;
    }).join('');

    /* Largeur bornee : au-dela, l'oeil ne relie plus un nom a son solde. */
    $('#main').innerHTML = `
      <div style="max-width:1180px">
        <div class="page-head"><div><h1>Résidents</h1>
          <div class="muted" style="font-size:13.5px;margin-top:4px">
            ${actifs.length} résident${actifs.length > 1 ? 's' : ''} actif${actifs.length > 1 ? 's' : ''}${compte('renouveler') ? ' · ' + compte('renouveler') + ' contrat' + (compte('renouveler') > 1 ? 's' : '') + ' à renouveler' : ''}${compte('impayes') ? ' · ' + compte('impayes') + ' impayé' + (compte('impayes') > 1 ? 's' : '') : ''}
          </div></div>
          <div class="toolbar">
            <input class="search" id="res-search" data-act="chercherResidents" data-evt="input" data-a1="@value"
                   placeholder="Rechercher un nom, un e-mail, un emplacement" value="${esc(RES_Q)}" style="min-width:280px">
            <button class="btn btn-primary" data-act="formResident">Nouveau résident</button>
          </div></div>

        <div class="card" style="display:flex;padding:0;margin-bottom:14px">
          ${chiffres.map((c, i) => `
            <div style="flex:1;padding:13px 18px;${i ? 'border-left:1px solid var(--hairline)' : ''}">
              <div style="font-size:11.5px;font-weight:600;letter-spacing:.09em;color:var(--brume);text-transform:uppercase">${c.k}</div>
              <div style="font-size:22px;margin-top:5px;font-variant-numeric:tabular-nums;${c.col ? 'color:' + c.col : ''}">${c.v}</div>
              <div class="muted" style="font-size:12px;margin-top:2px">${c.n}</div>
            </div>`).join('')}
        </div>

        <div id="res-puces" style="display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
          ${puces}
          <span id="res-compte" class="muted" style="margin-left:auto;font-size:12.5px"></span>
        </div>

        <div class="card" style="padding:0;overflow:hidden">
          <table>
            <thead><tr>
              <th style="padding:10px 12px">Résident</th>
              <th style="padding:10px 12px">Empl.</th>
              <th style="padding:10px 12px">Contrat</th>
              <th style="padding:10px 12px">Assurance</th>
              <th class="right" style="padding:10px 12px">Solde</th>
            </tr></thead>
            <tbody id="res-body"></tbody>
          </table>
        </div>
        <p class="muted" style="margin:10px 0 0;font-size:12.5px">Un solde positif est une somme due. Cliquez une ligne pour ouvrir la fiche.</p>
      </div>`;

    majListeResidents();
  }
}

if (!fs.existsSync(CIBLE)) echec('backend/public/app.js introuvable. Lancez depuis la racine du projet.');
let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('window.filtrerResidents') !== -1) {
  console.log('\n  L\'ecran Residents est deja repris — rien a faire.\n');
  process.exit(0);
}

const DEBUT = 'async function vueResidents() {';
const FIN = '/* ---------- Fiche client (pleine page) ---------- */';
const i = src.indexOf(DEBUT);
const j = src.indexOf(FIN);
if (i === -1) echec('vueResidents introuvable dans app.js.');
if (j === -1 || j < i) echec('La borne de fin (fiche client) est introuvable ou mal placee.');

const ancien = src.slice(i, j);
if (ancien.length > 6000) echec(`Le bloc a remplacer fait ${ancien.length} caracteres — trop gros, app.js a change.`);
if (ancien.indexOf('conf-legende') === -1) echec('Le bloc repere ne ressemble pas a l\'ancienne vue Residents.');
if (ancien.indexOf('async function vue') !== ancien.lastIndexOf('async function vue')) {
  echec('Le bloc repere contient plusieurs vues — bornes invalides.');
}
/* Les pastilles et leur legende ne vivent QUE dans cette vue : leur
   disparition est la preuve que le bon bloc a ete remplace. */
const PASTILLES_AVANT = src.split('conf-cle').length - 1;

const CODE = NOUVEAU_CODE.toString()
  .replace(/^function NOUVEAU_CODE\(\)\s*\{\r?\n/, '')
  .replace(/\}\s*$/, '')
  .replace(/^ {2}/gm, '');

src = src.slice(0, i) + CODE.replace(/\s*$/, '\n') + '\n' + src.slice(j);

try { new Function(src); }
catch (e) { echec('Le resultat n\'est pas du JavaScript valide — ' + e.message); }

for (const [quoi, aiguille] of [
  ['la vue Residents', 'async function vueResidents()'],
  ['les filtres', 'window.filtrerResidents'],
  ['la recherche', 'window.chercherResidents'],
  ['les etats en mots', 'function resContrat'],
  ['le clic vers la fiche', 'data-a1="#/residents/'],
]) if (src.indexOf(aiguille) === -1) echec(`Verification : ${quoi} est absent du resultat.`);

if (src.split('conf-cle').length - 1 !== PASTILLES_AVANT - 1) {
  echec('Les pastilles A / C subsistent (ou un autre bloc a ete touche).');
}
if (src.indexOf('>LOCATAIRES<') !== -1) echec('Le surtitre subsiste.');

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('window.filtrerResidents') === -1) echec('L\'ajout est absent apres ecriture.');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Residents : largeur bornee a 1180 px, lignes a ~56 px.');
console.log('  Contrat et Assurance en mots — les pastilles A / C sont retirees.');
console.log('  Bandeau de 4 chiffres + filtres comptes (tous, a renouveler, impayes, pieces, inactifs).');
console.log('  Solde nul en tiret ; un du est le seul montant en rouge.');
console.log('  La fiche resident reste une page entiere, inchangee.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

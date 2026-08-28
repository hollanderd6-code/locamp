#!/usr/bin/env node
/* ============================================================
   outils/compteurs-tournee.js
   Ecran Compteurs : la tournee de saisie, au clavier
   ============================================================
   Cible : backend/public/app.js

   ── POURQUOI PAS UNE LISTE + FICHE ICI ──────────────────────────
   Cet ecran n'est pas une liste qu'on consulte : c'est une SAISIE. On
   arrive avec 58 index notes sur une feuille et on les tape. Une fiche
   a droite n'aiderait pas ; ce qui aide, c'est de taper vite et de ne
   pas se tromper.

   ── CE QUI CHANGE ───────────────────────────────────────────────
   1. Le clavier. Chaque ligne est un formulaire : Entree enregistre et
      le curseur saute au prochain compteur a relever. Une tournee se
      tape sans toucher la souris. (Tab passe d'un champ a l'autre sans
      rien enregistrer, comme il se doit.)
   2. La consommation s'affiche PENDANT la frappe : « 1 240 - 1 198 =
      42 kWh · 16,44 € ». Un index tape de travers se voyait apres
      coup, une fois la charge creee sur la fiche du resident. Un index
      inferieur au precedent est signale en rouge avant d'enregistrer.
   3. Des filtres comptes : a relever (jamais + en retard), jamais
      releves, en retard, a jour. Le resume qui traînait a cote des
      onglets devient un bandeau de chiffres, avec l'avancement de la
      tournee.
   4. La derniere consommation connue est affichee a cote de l'index :
      c'est l'ordre de grandeur qui permet de voir qu'on s'est trompe.
   5. Lignes a 52 px : on voit une quinzaine de compteurs au lieu de
      six, ce qui compte quand on en tape 58.

   Le prix manquant, la feuille de tournee papier et les deux fluides
   (electricite / eau) sont conserves tels quels.

   Aucun changement backend : GET /api/compteurs?type=,
   POST /api/compteurs/releve.

   Usage :
     node outils/compteurs-tournee.js --essai
     node outils/compteurs-tournee.js
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
  /* ---------- Compteurs : la tournee de saisie ----------
     Un ecran de frappe, pas de lecture : l'etat qui compte est
     « lesquels restent a relever » et « ou est le curseur ». */
  let CPT_FILTRE = 'restants';
  let CPT_Q = '';
  let CPT_FOCUS = null;      // emplacement a re-focaliser apres un releve
  let CPT_CACHE = { emps: [], unite: '', prix: 0, tva: 0, prixOk: false };

  const CPT_AMBRE = '#7A5A22';
  const CPT_MOIS = 31 * 86400000;

  function cptEtat(e) {
    if (!e.dernier_releve) return { cle: 'jamais', txt: 'Jamais relevé', col: CPT_AMBRE };
    const vieux = new Date(e.dernier_releve.date_releve) < new Date(Date.now() - CPT_MOIS);
    if (vieux) return { cle: 'retard', txt: 'Relevé le ' + dfr(e.dernier_releve.date_releve), col: 'var(--rouge)' };
    return { cle: 'ok', txt: 'Relevé le ' + dfr(e.dernier_releve.date_releve), col: 'var(--brume)' };
  }

  const CPT_FILTRES = [
    ['restants', 'À relever', (e) => cptEtat(e).cle !== 'ok'],
    ['tous', 'Tous', () => true],
    ['jamais', 'Jamais relevés', (e) => cptEtat(e).cle === 'jamais'],
    ['ok', 'À jour', (e) => cptEtat(e).cle === 'ok'],
  ];

  function cptVisibles() {
    const f = (CPT_FILTRES.find((x) => x[0] === CPT_FILTRE) || CPT_FILTRES[0])[2];
    const q = CPT_Q.trim().toLowerCase();
    return CPT_CACHE.emps.filter((e) => {
      if (!f(e)) return false;
      if (!q) return true;
      const r = e.resident ? `${e.resident.prenom || ''} ${e.resident.nom || ''}` : '';
      return `${e.numero || ''} ${e.secteur || ''} ${r}`.toLowerCase().includes(q);
    });
  }

  /* Le nombre saisi, tolerant a la virgule francaise. */
  function cptVal(v) {
    const n = Number(String(v == null ? '' : v).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }

  /* Apercu pendant la frappe : la conso et son montant, ou l'alerte si
     l'index recule. C'est le seul moment ou une faute de frappe se
     rattrape sans effacer une charge. */
  window.apercuConso = (empId) => {
    const input = $('#idx-' + empId);
    const cible = $('#cs-' + empId);
    if (!input || !cible) return;
    const e = CPT_CACHE.emps.find((x) => x.id === empId);
    const U = CPT_CACHE.unite;
    const v = cptVal(input.value);
    if (v == null || input.value === '') { cible.innerHTML = ''; return; }
    const ancien = e && e.dernier_releve ? Number(e.dernier_releve.index_kwh) : null;
    if (ancien == null) {
      cible.innerHTML = `<span class="muted">index initial — aucune charge créée</span>`;
      return;
    }
    if (v < ancien) {
      cible.innerHTML = `<span style="color:var(--rouge);font-weight:600">inférieur à ${ancien} — vérifiez</span>`;
      return;
    }
    const conso = Math.round((v - ancien) * 100) / 100;
    const montant = CPT_CACHE.prixOk ? conso * Number(CPT_CACHE.prix) : null;
    cible.innerHTML = `<span style="color:#3C4E47">${conso} ${U}</span>`
      + (montant != null ? ` <span class="muted">· ${eur(montant)}</span>` : '');
  };

  window.filtrerCompteurs = (k) => { CPT_FILTRE = k; vueCompteurs(); };
  window.chercherCompteurs = (v) => { CPT_Q = v; vueCompteurs(); };

  /* Apres un releve, le curseur va au compteur suivant qui en attend un :
     une tournee se tape sans quitter le clavier. */
  window.apresReleve = (empId) => {
    const v = cptVisibles();
    const i = v.findIndex((x) => x.id === empId);
    const suivant = v.slice(i + 1).find((x) => cptEtat(x).cle !== 'ok') || v[i + 1];
    CPT_FOCUS = suivant ? suivant.id : null;
    route();
  };

  function cptLigne(e) {
    const et = cptEtat(e);
    const U = CPT_CACHE.unite;
    const ancien = e.dernier_releve ? Number(e.dernier_releve.index_kwh) : null;
    const derConso = e.dernier_releve && e.dernier_releve.conso_kwh != null
      ? Number(e.dernier_releve.conso_kwh) : null;
    return `
      <tr>
        <td style="padding:7px 12px;white-space:nowrap">
          <strong>${esc(e.numero)}</strong>${e.secteur ? ` <span class="muted">· ${esc(e.secteur)}</span>` : ''}
        </td>
        <td style="padding:7px 12px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${e.resident ? esc(`${e.resident.prenom || ''} ${e.resident.nom || ''}`.trim()) : '<span class="muted">libre</span>'}
        </td>
        <td style="padding:7px 12px;font-size:12.5px;color:${et.col};white-space:nowrap">${et.txt}</td>
        <td class="right" style="padding:7px 12px;font-variant-numeric:tabular-nums;white-space:nowrap">
          ${ancien != null ? ancien : '<span class="muted">—</span>'}
          ${derConso != null ? `<div class="muted" style="font-size:11.5px">dernière : ${derConso} ${U}</div>` : ''}
        </td>
        <td style="padding:7px 12px">
          <form data-act="releverCompteur" data-evt="submit" data-a1="${e.id}"
                style="display:flex;align-items:center;gap:8px;justify-content:flex-end">
            <input type="number" step="0.01" min="0" id="idx-${e.id}"
                   data-act="apercuConso" data-evt="input" data-a1="${e.id}"
                   placeholder="${ancien != null ? ancien : 'index initial'}"
                   style="width:124px;text-align:right">
            <button class="btn btn-primary btn-sm" type="submit">Relever</button>
          </form>
          <div id="cs-${e.id}" style="text-align:right;font-size:12px;margin-top:3px;min-height:15px"></div>
        </td>
      </tr>`;
  }

  async function vueCompteurs() {
    const t = COMPTEUR_TYPE;
    const d = await api('/api/compteurs?type=' + t);
    d.emplacements.sort((a, b) => String(a.numero || '')
      .localeCompare(String(b.numero || ''), 'fr', { numeric: true, sensitivity: 'base' }));
    window._tourneeData = d.emplacements;
    window._tourneeUnite = d.unite;
    window._tourneeType = t;

    const prixOk = d.prix != null && d.prix > 0;
    const U = d.unite;
    CPT_CACHE = { emps: d.emplacements, unite: U, prix: d.prix || 0, tva: d.taux_tva, prixOk };

    const compte = (k) => d.emplacements.filter((CPT_FILTRES.find((x) => x[0] === k) || CPT_FILTRES[0])[2]).length;
    const total = d.emplacements.length;
    const faits = compte('ok');
    const pc = total ? Math.round((faits / total) * 100) : 0;

    /* Un prix se saisit a quatre decimales : eur() arrondirait a deux et
       afficherait 0,39 € pour 0,3912 €. */
    const prixTexte = Number(d.prix || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

    const puces = CPT_FILTRES.map(([k, l]) => {
      const on = k === CPT_FILTRE;
      return `<button data-act="filtrerCompteurs" data-a1="${k}"
        style="padding:4px 11px;border-radius:20px;font-size:12.5px;cursor:pointer;font-family:inherit;
               border:1px solid ${on ? 'var(--nuit)' : 'var(--hairline)'};
               background:${on ? 'var(--nuit)' : 'transparent'};color:${on ? 'var(--ivoire)' : '#5D6E66'};
               font-weight:${on ? '600' : '400'}">${l} ${compte(k)}</button>`;
    }).join('');

    const visibles = cptVisibles();

    $('#main').innerHTML = `
      <div class="page-head"><div><h1>Compteurs</h1>
        <div class="muted" style="font-size:13.5px;margin-top:4px">
          ${prixOk ? `Prix du ${U} : <strong>${prixTexte} € TTC</strong> · TVA ${d.taux_tva} %`
    : `<span style="color:${CPT_AMBRE}">prix du ${U} non configuré</span>`}
        </div></div>
        <div class="toolbar">
          <button class="btn btn-ghost" data-act="imprimerTournee" title="Feuille papier pour relever sur le terrain">Feuille de tournée</button>
        </div></div>

      <div class="fiche-tabs" style="margin-bottom:14px">
        <button class="fiche-tab ${t === 'elec' ? 'active' : ''}" data-act="switchCompteurType" data-a1="elec">Électricité (kWh)</button>
        <button class="fiche-tab ${t === 'eau' ? 'active' : ''}" data-act="switchCompteurType" data-a1="eau">Eau (m³)</button>
      </div>

      ${prixOk ? '' : `<p style="margin:0 0 14px;padding:11px 14px;border-radius:var(--r-s);
          background:var(--laiton-pale);border:1px solid rgba(185,138,60,.28);color:${CPT_AMBRE};font-size:13.5px;line-height:1.5">
          — Prix du ${U} non configuré. Les relevés sont bien enregistrés, mais aucune charge n\u2019est créée sur les fiches résidents.
          <a href="#/parametres" style="color:inherit;font-weight:600">Renseigner le prix dans Paramètres → Énergie &amp; eau</a>.</p>`}

      <div class="card" style="display:flex;padding:0;margin-bottom:14px">
        <div style="flex:1;padding:13px 18px">
          <div style="font-size:11.5px;font-weight:600;letter-spacing:.09em;color:var(--brume);text-transform:uppercase">Tournée</div>
          <div style="font-size:22px;margin-top:5px;font-variant-numeric:tabular-nums">${faits} / ${total}</div>
          <div style="height:5px;border-radius:4px;background:var(--hairline);margin-top:9px;overflow:hidden;display:flex">
            <div style="width:${pc}%;background:var(--sapin)"></div>
          </div>
        </div>
        <div style="flex:1;padding:13px 18px;border-left:1px solid var(--hairline)">
          <div style="font-size:11.5px;font-weight:600;letter-spacing:.09em;color:var(--brume);text-transform:uppercase">Jamais relevés</div>
          <div style="font-size:22px;margin-top:5px;font-variant-numeric:tabular-nums;${compte('jamais') ? 'color:' + CPT_AMBRE : ''}">${compte('jamais') || '—'}</div>
          <div class="muted" style="font-size:12px;margin-top:2px">compteurs à initialiser</div>
        </div>
        <div style="flex:1;padding:13px 18px;border-left:1px solid var(--hairline)">
          <div style="font-size:11.5px;font-weight:600;letter-spacing:.09em;color:var(--brume);text-transform:uppercase">En retard</div>
          <div style="font-size:22px;margin-top:5px;font-variant-numeric:tabular-nums;${compte('restants') - compte('jamais') ? 'color:var(--rouge);font-weight:600' : ''}">${(compte('restants') - compte('jamais')) || '—'}</div>
          <div class="muted" style="font-size:12px;margin-top:2px">dernier relevé de plus d'un mois</div>
        </div>
        <div style="flex:1;padding:13px 18px;border-left:1px solid var(--hairline)">
          <div style="font-size:11.5px;font-weight:600;letter-spacing:.09em;color:var(--brume);text-transform:uppercase">Prix du ${U}</div>
          <div style="font-size:22px;margin-top:5px;font-variant-numeric:tabular-nums">${prixOk ? prixTexte + ' €' : '—'}</div>
          <div class="muted" style="font-size:12px;margin-top:2px">${prixOk ? 'TVA ' + d.taux_tva + ' %' : 'à renseigner'}</div>
        </div>
      </div>

      <div style="display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
        ${puces}
        <input id="cpt-q" data-act="chercherCompteurs" data-evt="change" data-a1="@value"
               placeholder="Emplacement, secteur, résident" value="${esc(CPT_Q)}"
               style="margin-left:auto;min-width:240px">
      </div>

      <div class="card" style="padding:0;overflow:hidden">
        <table>
          <thead><tr>
            <th style="padding:10px 12px">Empl.</th>
            <th style="padding:10px 12px">Résident</th>
            <th style="padding:10px 12px">État</th>
            <th class="right" style="padding:10px 12px">Index actuel</th>
            <th class="right" style="padding:10px 12px">Nouvel index</th>
          </tr></thead>
          <tbody>${visibles.map(cptLigne).join('')
    || `<tr><td colspan="5" class="muted" style="padding:18px">${total ? 'Aucun compteur dans ce filtre.' : 'Aucun emplacement.'}</td></tr>`}</tbody>
        </table>
      </div>
      <p class="muted" style="margin-top:12px;font-size:12.5px">Entrée enregistre et passe au compteur suivant. Un relevé crée une charge « en cours » sur la fiche du résident (conso × prix du ${U}) — à facturer depuis sa fiche. Chaque fluide a sa propre série d\u2019index.</p>`;

    /* Le curseur reprend la ou la tournee s'est arretee. */
    const cible = CPT_FOCUS ? $('#idx-' + CPT_FOCUS) : null;
    CPT_FOCUS = null;
    if (cible) cible.focus();
  }
}

if (!fs.existsSync(CIBLE)) echec('backend/public/app.js introuvable. Lancez depuis la racine du projet.');
let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('window.apercuConso') !== -1) {
  console.log('\n  L\'ecran Compteurs est deja repris — rien a faire.\n');
  process.exit(0);
}

const DEBUT = 'async function vueCompteurs() {';
const FIN = 'window.switchCompteurType = (t) =>';
const i = src.indexOf(DEBUT);
const j = src.indexOf(FIN);
if (i === -1) echec('vueCompteurs introuvable dans app.js.');
if (j === -1 || j < i) echec('La borne de fin (switchCompteurType) est introuvable ou mal placee.');

const ancien = src.slice(i, j);
if (ancien.length > 6000) echec(`Le bloc a remplacer fait ${ancien.length} caracteres — trop gros, app.js a change.`);
if (ancien.indexOf('Feuille de tournée') === -1) echec('Le bloc repere ne ressemble pas a l\'ancienne vue Compteurs.');
if (ancien.indexOf('async function vue') !== ancien.lastIndexOf('async function vue')) {
  echec('Le bloc repere contient plusieurs vues — bornes invalides.');
}
const ENTETE = '<th>Empl.</th><th>Résident</th><th>Dernier relevé</th>';
const ENTETE_AVANT = src.split(ENTETE).length - 1;
if (!ENTETE_AVANT) echec('L\'en-tete de l\'ancien tableau est introuvable.');

const CODE = NOUVEAU_CODE.toString()
  .replace(/^function NOUVEAU_CODE\(\)\s*\{\r?\n/, '')
  .replace(/\}\s*$/, '')
  .replace(/^ {2}/gm, '');

src = src.slice(0, i) + CODE.replace(/\s*$/, '\n') + '\n' + src.slice(j);

/* Le releve enchaine sur le compteur suivant au lieu de recharger la page
   en perdant le curseur. Seul ce route() est remplace. */
const R_ANCIEN = '    else toast(r.info || \'Relevé enregistré\');\n    route();';
const R_NOUVEAU = '    else toast(r.info || \'Relevé enregistré\');\n'
  + '    /* apresReleve place le curseur sur le compteur suivant a relever. */\n'
  + '    apresReleve(empId);';
if (src.split(R_ANCIEN).length - 1 !== 1) echec('La fin de releverCompteur est introuvable ou modifiee.');
src = src.split(R_ANCIEN).join(R_NOUVEAU);

try { new Function(src); }
catch (e) { echec('Le resultat n\'est pas du JavaScript valide — ' + e.message); }

for (const [quoi, aiguille] of [
  ['la vue Compteurs', 'async function vueCompteurs()'],
  ['l\'apercu de consommation', 'window.apercuConso'],
  ['les filtres', 'window.filtrerCompteurs'],
  ['l\'enchainement au clavier', 'window.apresReleve'],
  ['l\'appel a apresReleve', 'apresReleve(empId);'],
  ['la feuille de tournee', 'data-act="imprimerTournee"'],
  ['les deux fluides', 'data-act="switchCompteurType"'],
]) if (src.indexOf(aiguille) === -1) echec(`Verification : ${quoi} est absent du resultat.`);

if (src.split(ENTETE).length - 1 !== ENTETE_AVANT - 1) {
  echec('L\'ancien tableau des compteurs subsiste (ou un autre tableau a ete touche).');
}

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('window.apercuConso') === -1) echec('L\'ajout est absent apres ecriture.');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Compteurs : Entree enregistre et saute au compteur suivant a relever.');
console.log('  Consommation et montant calcules pendant la frappe ; index qui recule signale.');
console.log('  Filtres comptes : a relever, tous, jamais releves, a jour — avec avancement de la tournee.');
console.log('  Feuille de tournee papier et les deux fluides : inchanges.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

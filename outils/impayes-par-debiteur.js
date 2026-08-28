#!/usr/bin/env node
/* ============================================================
   outils/impayes-par-debiteur.js
   Ecran Impayes : un debiteur par ligne, ses factures a droite
   ============================================================
   Cible : backend/public/app.js  (remplace vueImpayes)

   ── CE QUI CHANGE ───────────────────────────────────────────────
   Avant : une ligne par FACTURE, sans aucune action. Pour recouvrer,
   il fallait relever un nom, aller dans Factures, le retrouver,
   encaisser — et recommencer. Un resident qui doit quatre factures
   apparaissait quatre fois, sans qu'on voie jamais ce qu'il doit en
   tout.

   Apres : une ligne par DEBITEUR, ce qui est l'unite reelle du
   recouvrement (on telephone a une personne, pas a une facture). La
   liste est triee par retard le plus ancien. A droite, le debiteur
   choisi : son total du, ce qui est vraiment en retard, ses factures
   une par une avec « Encaisser » a cote de chacune, et le nombre de
   relances deja parties.

   Deux points de verite conserves du code actuel :
   · La creance totale et le retard restent distingues — un total qui
     melange les deux fait croire a un retard qu'on n'a pas.
   · window._impayesEnRetard continue d'alimenter le bouton de relance,
     qui n'agit que sur les factures echues.

   Ce que ce correctif ne fait PAS : relancer un debiteur en
   particulier. Le serveur n'expose qu'un envoi global
   (POST /api/relances/run) ; inventer un bouton par debiteur qui
   relancerait tout le monde serait un mensonge. Le bouton reste en
   haut, et la fiche dit combien de relances sont deja parties.

   Aucun changement backend : GET /api/relances/impayes,
   /api/residents, /api/factures, /api/relances.

   Usage :
     node outils/impayes-par-debiteur.js --essai
     node outils/impayes-par-debiteur.js
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
  /* ---------- Impayes : un debiteur par ligne ----------
     L'unite du recouvrement est la personne, pas la facture. */
  let IMP_SEL = null;
  let IMP_FILTRE = 'retard';
  let IMP_Q = '';
  let IMP_CACHE = { debiteurs: [], delai: 30 };

  const IMP_AMBRE = '#7A5A22';

  const IMP_FILTRES = [
    ['retard', 'En retard', (d) => d.montantRetard > 0.005],
    ['tous', 'Tous', () => true],
    ['grave', 'Retard 60 j et +', (d) => d.pireRetard > 60],
    ['echoir', 'À échoir seulement', (d) => d.montantRetard <= 0.005],
  ];

  function impVisibles() {
    const f = (IMP_FILTRES.find((x) => x[0] === IMP_FILTRE) || IMP_FILTRES[0])[2];
    const q = IMP_Q.trim().toLowerCase();
    return IMP_CACHE.debiteurs.filter((d) => {
      if (!f(d)) return false;
      if (!q) return true;
      return (d.nom + ' ' + d.factures.map((x) => x.numero || '').join(' ')).toLowerCase().includes(q);
    });
  }

  function impRetardTexte(j) {
    if (j <= 0) return { txt: 'À échoir', col: 'var(--sapin)' };
    if (j <= 30) return { txt: j + ' j de retard', col: IMP_AMBRE };
    return { txt: j + ' j de retard', col: 'var(--rouge)' };
  }

  function impLigneListe(d) {
    const sel = d.id === IMP_SEL;
    const r = impRetardTexte(d.pireRetard);
    return `
      <div data-act="ouvrirDebiteur" data-a1="${d.id}"
           style="display:flex;align-items:center;gap:12px;padding:0 18px;height:62px;cursor:pointer;
                  border-bottom:1px solid var(--hairline);
                  background:${sel ? 'var(--sapin-pale)' : 'transparent'};
                  box-shadow:${sel ? 'inset 3px 0 0 var(--sapin)' : 'none'}">
        <div style="min-width:0;flex:1">
          <div style="font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${esc(d.nom)}</div>
          <div class="muted" style="font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${d.factures.length} facture${d.factures.length > 1 ? 's' : ''}${d.relances ? ' · ' + d.relances + ' relance' + (d.relances > 1 ? 's' : '') : ''}</div>
        </div>
        <div style="text-align:right;flex:none">
          <div style="font-size:14px;font-variant-numeric:tabular-nums;font-weight:600">${eur(d.total)}</div>
          <div style="font-size:11.5px;font-weight:600;margin-top:2px;color:${r.col}">${r.txt}</div>
        </div>
      </div>`;
  }

  function majListeImpayes() {
    const box = $('#imp-liste');
    if (!box) return;
    const v = impVisibles();
    box.innerHTML = v.length ? v.map(impLigneListe).join('')
      : '<p class="muted" style="padding:18px">Aucun débiteur ne correspond.</p>';
    const n = $('#imp-compte');
    if (n) {
      const somme = v.reduce((s, d) => s + d.total, 0);
      n.textContent = v.length
        ? `${v.length} débiteur${v.length > 1 ? 's' : ''} · ${eur(somme)}`
        : '';
    }
  }

  window.ouvrirDebiteur = (id) => { IMP_SEL = id; majFicheDebiteur(); majListeImpayes(); };
  window.filtrerImpayes = (k) => { IMP_FILTRE = k; IMP_SEL = null; vueImpayes(); };
  window.chercherImpayes = (v) => { IMP_Q = v; majListeImpayes(); };

  function impFiche(d) {
    const r = impRetardTexte(d.pireRetard);
    const lignes = d.factures.slice()
      .sort((a, b) => b.jours_retard - a.jours_retard)
      .map((f) => {
        const fr = impRetardTexte(f.jours_retard);
        return `
        <div style="display:grid;grid-template-columns:1fr 130px 100px 104px;gap:12px;align-items:center;
                    padding:0 18px;height:52px;border-bottom:1px solid var(--hairline)">
          <div style="font-size:13.5px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(f.numero || '—')}</div>
          <div style="font-size:12.5px;color:${fr.col};font-weight:600">${fr.txt}</div>
          <div style="text-align:right;font-size:14px;font-variant-numeric:tabular-nums">${eur(f.reste)}</div>
          <div style="text-align:right">
            <button class="btn btn-ghost btn-sm" data-act="encaisserFacture"
                    data-a1="${f.id}" data-a2="${d.id}" data-a3="${f.reste}" data-num="3">Encaisser</button>
          </div>
        </div>`;
      }).join('');

    return `
      <div style="background:var(--carte);border-bottom:1px solid var(--hairline);padding:22px 26px 18px;
                  display:flex;align-items:flex-start;gap:18px;flex-wrap:wrap">
        <div style="flex:1;min-width:220px">
          <h1 style="margin:0;font-size:24px;line-height:1.15">${esc(d.nom)}</h1>
          <div class="muted" style="font-size:13.5px;margin-top:4px">
            ${d.factures.length} facture${d.factures.length > 1 ? 's' : ''} impayée${d.factures.length > 1 ? 's' : ''}
            ${d.email ? ' · ' + esc(d.email) : ''}${d.telephone ? ' · ' + esc(d.telephone) : ''}
          </div>
          <div style="display:flex;gap:7px;margin-top:11px;flex-wrap:wrap">
            <span style="font-size:12.5px;font-weight:600;padding:3px 9px;border-radius:var(--r-s);
                         background:${d.pireRetard > 30 ? 'var(--rouge-pale)' : d.pireRetard > 0 ? 'var(--laiton-pale)' : 'var(--sapin-pale)'};
                         color:${r.col}">${r.txt}</span>
            ${d.relances ? `<span style="font-size:12.5px;padding:3px 9px;border-radius:var(--r-s);background:var(--ivoire);border:1px solid var(--hairline);color:#5D6E66">${d.relances} relance${d.relances > 1 ? 's' : ''} envoyée${d.relances > 1 ? 's' : ''}</span>` : ''}
          </div>
        </div>
        <div style="flex:none;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
          ${d.email ? `<a class="btn btn-ghost btn-sm" href="mailto:${esc(d.email)}">Écrire</a>` : ''}
          <button class="btn btn-primary btn-sm" data-act="allerA" data-a1="#/residents/${d.id}">Ouvrir la fiche</button>
        </div>
      </div>

      <div style="padding:20px 26px;display:flex;flex-direction:column;gap:16px">
        <div class="card" style="display:flex;padding:0">
          <div style="flex:1;padding:13px 18px">
            <div style="font-size:11.5px;font-weight:600;letter-spacing:.09em;color:var(--brume);text-transform:uppercase">Total dû</div>
            <div style="font-size:22px;margin-top:5px;font-variant-numeric:tabular-nums">${eur(d.total)}</div>
          </div>
          <div style="flex:1;padding:13px 18px;border-left:1px solid var(--hairline)">
            <div style="font-size:11.5px;font-weight:600;letter-spacing:.09em;color:var(--brume);text-transform:uppercase">Dont en retard</div>
            <div style="font-size:22px;margin-top:5px;font-variant-numeric:tabular-nums;${d.montantRetard > 0.005 ? 'color:var(--rouge);font-weight:600' : ''}">${d.montantRetard > 0.005 ? eur(d.montantRetard) : '—'}</div>
          </div>
          <div style="flex:1;padding:13px 18px;border-left:1px solid var(--hairline)">
            <div style="font-size:11.5px;font-weight:600;letter-spacing:.09em;color:var(--brume);text-transform:uppercase">Plus ancienne</div>
            <div style="font-size:22px;margin-top:5px;font-variant-numeric:tabular-nums">${d.pireRetard > 0 ? d.pireRetard + ' j' : '—'}</div>
          </div>
        </div>

        <div class="card" style="padding:0;overflow:hidden">
          <div style="padding:13px 18px;border-bottom:1px solid var(--hairline);display:flex;
                      align-items:center;justify-content:space-between;gap:12px">
            <div style="font-size:14px;font-weight:600">Factures impayées</div>
            <div class="muted" style="font-size:12.5px">délai de paiement : ${IMP_CACHE.delai} j</div>
          </div>
          ${lignes}
        </div>
      </div>`;
  }

  function majFicheDebiteur() {
    const box = $('#imp-fiche');
    if (!box) return;
    const d = IMP_CACHE.debiteurs.find((x) => x.id === IMP_SEL);
    box.innerHTML = d ? impFiche(d)
      : `<p class="muted" style="padding:26px">${IMP_CACHE.debiteurs.length
        ? 'Aucun débiteur dans ce filtre.'
        : 'Aucun impayé : toutes les factures de l\'exercice sont réglées.'}</p>`;
  }

  async function vueImpayes() {
    const [imp, resD, relD] = await Promise.all([
      api('/api/relances/impayes' + exQS()),
      api('/api/residents').catch(() => ({ residents: [] })),
      api('/api/relances').catch(() => ({ relances: [] })),
    ]);
    const info = {};
    (resD.residents || []).forEach((r) => {
      info[r.id] = {
        nom: `${r.prenom || ''} ${r.nom || ''}`.trim() || '—',
        email: r.email || null, telephone: r.telephone || null,
      };
    });
    const nbRelances = {};
    for (const x of (relD.relances || [])) {
      if (x.resident_id) nbRelances[x.resident_id] = (nbRelances[x.resident_id] || 0) + 1;
    }

    /* Regroupement par debiteur : c'est la personne qu'on appelle. */
    const par = new Map();
    for (const f of (imp.impayes || [])) {
      let d = par.get(f.resident_id);
      if (!d) {
        const i = info[f.resident_id] || { nom: 'Résident supprimé', email: null, telephone: null };
        d = { id: f.resident_id, nom: i.nom, email: i.email, telephone: i.telephone,
          factures: [], total: 0, montantRetard: 0, pireRetard: 0, relances: nbRelances[f.resident_id] || 0 };
        par.set(f.resident_id, d);
      }
      d.factures.push(f);
      d.total += Number(f.reste || 0);
      if (f.en_retard) d.montantRetard += Number(f.reste || 0);
      if (f.jours_retard > d.pireRetard) d.pireRetard = f.jours_retard;
    }
    /* Le retard le plus ancien d'abord : c'est l'ordre des appels. */
    const debiteurs = [...par.values()].sort((a, b) => (b.pireRetard - a.pireRetard) || (b.total - a.total));
    IMP_CACHE = { debiteurs, delai: imp.delai };

    const enRetard = (imp.impayes || []).filter((f) => f.en_retard);
    const montantRetard = enRetard.reduce((s, f) => s + Number(f.reste || 0), 0);
    /* Le bouton de relance n'agit que sur les factures echues : le nombre
       annonce avant l'envoi doit etre celui-la. */
    window._impayesEnRetard = enRetard.length;

    const visibles = impVisibles();
    if (IMP_SEL && !debiteurs.some((d) => d.id === IMP_SEL)) IMP_SEL = null;
    if (!IMP_SEL && visibles.length) IMP_SEL = visibles[0].id;

    const compte = (k) => debiteurs.filter((IMP_FILTRES.find((x) => x[0] === k) || IMP_FILTRES[0])[2]).length;
    const puces = IMP_FILTRES.map(([k, l]) => {
      const on = k === IMP_FILTRE;
      return `<button data-act="filtrerImpayes" data-a1="${k}"
        style="padding:4px 11px;border-radius:20px;font-size:12.5px;cursor:pointer;font-family:inherit;
               border:1px solid ${on ? 'var(--nuit)' : 'var(--hairline)'};
               background:${on ? 'var(--nuit)' : 'transparent'};color:${on ? 'var(--ivoire)' : '#5D6E66'};
               font-weight:${on ? '600' : '400'}">${l} ${compte(k)}</button>`;
    }).join('');

    const a = imp.aging;
    const chiffres = [
      { k: 'Créance totale', v: eur(imp.total_du), n: `${(imp.impayes || []).length} facture${(imp.impayes || []).length > 1 ? 's' : ''}`, col: '' },
      { k: 'En retard', v: montantRetard > 0.005 ? eur(montantRetard) : '—', n: `${enRetard.length} facture${enRetard.length > 1 ? 's' : ''} échue${enRetard.length > 1 ? 's' : ''}`, col: montantRetard > 0.005 ? 'var(--rouge)' : '' },
      { k: 'Pas encore échu', v: a.a_echoir > 0.005 ? eur(a.a_echoir) : '—', n: `délai ${imp.delai} j`, col: '' },
      { k: 'Retard 61 j et +', v: (a.j61_90 + a.j90_plus) > 0.005 ? eur(a.j61_90 + a.j90_plus) : '—', n: 'le plus difficile à récupérer', col: (a.j61_90 + a.j90_plus) > 0.005 ? 'var(--rouge)' : '' },
    ];

    $('#main').innerHTML = `
      <div class="page-head"><div><h1>Impayés</h1>
        <div class="muted" style="font-size:13.5px;margin-top:4px">
          ${debiteurs.length} débiteur${debiteurs.length > 1 ? 's' : ''}${enRetard.length ? ' · ' + enRetard.length + ' facture' + (enRetard.length > 1 ? 's' : '') + ' en retard' : ' · rien en retard'}
        </div></div>
        <button class="btn btn-primary" data-act="runRelancesBtn">Envoyer les relances</button></div>

      <div class="card" style="display:flex;padding:0;margin-bottom:14px">
        ${chiffres.map((c, i) => `
          <div style="flex:1;padding:13px 18px;${i ? 'border-left:1px solid var(--hairline)' : ''}">
            <div style="font-size:11.5px;font-weight:600;letter-spacing:.09em;color:var(--brume);text-transform:uppercase">${c.k}</div>
            <div style="font-size:22px;margin-top:5px;font-variant-numeric:tabular-nums;${c.col ? 'color:' + c.col + ';font-weight:600' : ''}">${c.v}</div>
            <div class="muted" style="font-size:12px;margin-top:2px">${c.n}</div>
          </div>`).join('')}
      </div>

      <div class="card" style="padding:0;overflow:hidden;display:flex;align-items:stretch;min-height:520px">
        <div style="width:380px;flex:none;border-right:1px solid var(--hairline);display:flex;flex-direction:column;min-width:0">
          <div style="padding:16px 18px 13px;border-bottom:1px solid var(--hairline);display:flex;flex-direction:column;gap:11px">
            <input id="imp-q" data-act="chercherImpayes" data-evt="input" data-a1="@value"
                   placeholder="Résident, numéro de facture" value="${esc(IMP_Q)}" style="width:100%">
            <div style="display:flex;gap:6px;flex-wrap:wrap">${puces}</div>
            <div id="imp-compte" class="muted" style="font-size:12px"></div>
          </div>
          <div id="imp-liste" style="flex:1;overflow:auto"></div>
        </div>
        <div id="imp-fiche" style="flex:1;min-width:0;background:var(--ivoire)"></div>
      </div>
      <p class="muted" style="margin:10px 0 0;font-size:12.5px">« Envoyer les relances » agit sur toutes les factures échues du camping — il n'existe pas d'envoi par débiteur.</p>`;

    majListeImpayes();
    majFicheDebiteur();
  }
}

if (!fs.existsSync(CIBLE)) echec('backend/public/app.js introuvable. Lancez depuis la racine du projet.');
let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('window.ouvrirDebiteur') !== -1) {
  console.log('\n  L\'ecran Impayes est deja regroupe par debiteur — rien a faire.\n');
  process.exit(0);
}
if (src.indexOf('window.encaisserFacture') === -1) {
  echec('window.encaisserFacture est introuvable — la fiche debiteur en depend.');
}

const DEBUT = 'async function vueImpayes() {';
const FIN = 'window.runRelancesBtn = async () => {';
const i = src.indexOf(DEBUT);
const j = src.indexOf(FIN);
if (i === -1) echec('vueImpayes introuvable dans app.js.');
if (j === -1 || j < i) echec('La borne de fin (runRelancesBtn) est introuvable ou mal placee.');

const ancien = src.slice(i, j);
if (ancien.length > 4000) echec(`Le bloc a remplacer fait ${ancien.length} caracteres — trop gros, app.js a change.`);
if (ancien.indexOf('Créance totale') === -1) echec('Le bloc repere ne ressemble pas a l\'ancienne vue Impayes.');
if (ancien.indexOf('async function vue') !== ancien.lastIndexOf('async function vue')) {
  echec('Le bloc repere contient plusieurs vues — bornes invalides.');
}
const ENTETE = '<th>Facture</th><th>Résident</th>';
const ENTETE_AVANT = src.split(ENTETE).length - 1;
if (!ENTETE_AVANT) echec('L\'en-tete de l\'ancien tableau est introuvable.');

const CODE = NOUVEAU_CODE.toString()
  .replace(/^function NOUVEAU_CODE\(\)\s*\{\r?\n/, '')
  .replace(/\}\s*$/, '')
  .replace(/^ {2}/gm, '');

src = src.slice(0, i) + CODE.replace(/\s*$/, '\n') + '\n' + src.slice(j);

try { new Function(src); }
catch (e) { echec('Le resultat n\'est pas du JavaScript valide — ' + e.message); }

for (const [quoi, aiguille] of [
  ['la vue Impayes', 'async function vueImpayes()'],
  ['la selection d\'un debiteur', 'window.ouvrirDebiteur'],
  ['les filtres', 'window.filtrerImpayes'],
  ['la recherche', 'window.chercherImpayes'],
  ['le bouton Encaisser', 'data-act="encaisserFacture"'],
  ['le compteur du bouton de relance', 'window._impayesEnRetard ='],
]) if (src.indexOf(aiguille) === -1) echec(`Verification : ${quoi} est absent du resultat.`);

if (src.split(ENTETE).length - 1 !== ENTETE_AVANT - 1) {
  echec('L\'ancien tableau des impayes subsiste (ou un autre tableau a ete touche).');
}

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('window.ouvrirDebiteur') === -1) echec('L\'ajout est absent apres ecriture.');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Impayes : une ligne par debiteur, triee par retard le plus ancien.');
console.log('  Fiche : total du, dont en retard, plus ancien retard, factures avec « Encaisser ».');
console.log('  Filtres comptes : en retard, tous, retard 60 j et +, a echoir seulement.');
console.log('  Le bouton de relance reste global — le serveur n\'expose pas d\'envoi par debiteur.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

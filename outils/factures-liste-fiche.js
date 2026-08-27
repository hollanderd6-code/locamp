#!/usr/bin/env node
/* ============================================================
   outils/factures-liste-fiche.js
   Ecran Factures : liste a gauche, facture ouverte a droite
   ============================================================
   Cible : backend/public/app.js  (remplace vueFactures)

   ── CE QUI CHANGE ───────────────────────────────────────────────
   Avant : un tableau large de 7 colonnes, une ligne par facture, et
   quatre a cinq boutons empiles dans la derniere colonne — a un metre
   du nom auquel ils se rapportent. Pour savoir ce que contient une
   facture il fallait ouvrir le PDF.

   Apres : la liste tient dans une colonne de 380 px (resident, numero,
   montant, etat), la facture selectionnee s'ouvre a droite avec ses
   postes, ses totaux, son reste du et l'historique de ses reglements.
   Les actions sont en tete de fiche, a cote du numero.

   Aucun changement backend : tout vient de routes qui existent deja —
   GET /api/factures, GET /api/factures/:id, GET /api/residents,
   GET /api/reglements?resident_id=. Les actions reutilisent les
   fonctions globales du fichier (pdfFacture, emailFacture,
   encaisserFacture, emettreFacture, editerLignesFacture, faireAvoir,
   dupliquerFacture, supprimerBrouillon) : rien n'est reecrit.

   Deux choix a signaler :
   · « Encaisser » redevient un bouton d'un mot. Le lettrage automatique
     s'explique en dessous, pas dans le libelle du bouton.
   · Un montant nul s'ecrit « — ». Seuls les vrais montants attirent
     l'oeil.

   Usage :
     node outils/factures-liste-fiche.js --essai
     node outils/factures-liste-fiche.js
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

/* Le nouveau code est ecrit ici comme une vraie fonction, puis
   transforme en texte : on evite d'echapper a la main chaque accent
   grave et chaque ${} du HTML genere. */
function NOUVEAU_CODE() {
  /* ---------- Factures : liste + fiche ----------
     L'etat de l'ecran (facture ouverte, filtre, recherche) vit ici et
     non dans l'URL : on revient sur la meme facture apres un
     encaissement, qui passe par route(). */
  let FAC_SEL = null;
  let FAC_FILTRE = 'toutes';
  let FAC_Q = '';
  let FAC_CACHE = { factures: [], noms: {} };

  const FAC_FILTRES = [
    ['toutes', 'Toutes', () => true],
    ['impayees', 'Impayées', (f) => ['emise', 'partielle', 'en_retard'].includes(f.statut) && facReste(f) > 0.005],
    ['brouillons', 'Brouillons', (f) => f.statut === 'brouillon'],
    ['reglees', 'Réglées', (f) => f.statut === 'reglee'],
  ];

  const facReste = (f) => Math.round((Number(f.total_ttc || 0) - Number(f.montant_regle || 0)) * 100) / 100;
  /* Un montant nul s'ecrit « — » : le mur de zeros comptables donne
     l'impression que rien n'est calcule. */
  const facEur = (n) => (Math.abs(Number(n || 0)) < 0.005 ? '—' : eur(n));

  function facEtat(f) {
    if (f.statut === 'brouillon') return { txt: 'Brouillon', col: 'var(--brume)' };
    if (f.statut === 'avoir') return { txt: 'Avoir', col: 'var(--brume)' };
    if (f.statut === 'annulee') return { txt: 'Annulée', col: 'var(--brume)' };
    if (facReste(f) > 0.005) {
      const j = f.date_emission
        ? Math.floor((Date.now() - new Date(f.date_emission).getTime()) / 86400000) : null;
      return { txt: 'Impayée' + (j != null && j > 0 ? ' · ' + j + ' j' : ''), col: 'var(--rouge)' };
    }
    return { txt: 'Réglée', col: 'var(--sapin)' };
  }

  function facVisibles() {
    const f = (FAC_FILTRES.find((x) => x[0] === FAC_FILTRE) || FAC_FILTRES[0])[2];
    const q = FAC_Q.trim().toLowerCase();
    return FAC_CACHE.factures.filter((x) => {
      if (!f(x)) return false;
      if (!q) return true;
      return (String(x.numero || '') + ' ' + (FAC_CACHE.noms[x.resident_id] || '') + ' '
        + String(x.periode || '')).toLowerCase().includes(q);
    });
  }

  function facLigneListe(f) {
    const e = facEtat(f);
    const sel = f.id === FAC_SEL;
    return `
      <div data-act="ouvrirFacture" data-a1="${f.id}"
           style="display:flex;align-items:center;gap:12px;padding:0 18px;height:62px;cursor:pointer;
                  border-bottom:1px solid var(--hairline);
                  background:${sel ? 'var(--sapin-pale)' : 'transparent'};
                  box-shadow:${sel ? 'inset 3px 0 0 var(--sapin)' : 'none'}">
        <div style="min-width:0;flex:1">
          <div style="font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${esc(FAC_CACHE.noms[f.resident_id] || 'Résident supprimé')}</div>
          <div style="font-size:12.5px;color:var(--brume);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${esc(f.numero || 'brouillon')}${f.periode ? ' · ' + esc(f.periode) : ''}</div>
        </div>
        <div style="text-align:right;flex:none">
          <div style="font-variant-numeric:tabular-nums;font-size:14px">${eur(f.total_ttc)}</div>
          <div style="font-size:11.5px;font-weight:600;margin-top:2px;color:${e.col}">${e.txt}</div>
        </div>
      </div>`;
  }

  function majListeFactures() {
    const box = $('#fac-liste');
    if (!box) return;
    const v = facVisibles();
    box.innerHTML = v.length
      ? v.map(facLigneListe).join('')
      : `<p class="muted" style="padding:18px">Aucune facture ne correspond.</p>`;
    const c = $('#fac-compte');
    if (c) c.textContent = v.length + (v.length > 1 ? ' factures' : ' facture');
  }

  window.ouvrirFacture = (id) => { FAC_SEL = id; vueFactures(); };
  window.filtrerFactures = (k) => { FAC_FILTRE = k; FAC_SEL = null; vueFactures(); };
  window.chercherFactures = (v) => { FAC_Q = v; majListeFactures(); };

  async function facFiche(id) {
    const { facture: f } = await api('/api/factures/' + id);
    const { reglements } = await api('/api/reglements?resident_id=' + f.resident_id + exQSand())
      .catch(() => ({ reglements: [] }));

    const reste = facReste(f);
    const e = facEtat(f);
    const nom = FAC_CACHE.noms[f.resident_id] || 'Résident supprimé';
    const brouillon = f.statut === 'brouillon';
    const fige = ['avoir', 'annulee'].includes(f.statut);

    /* Le montant d'une ligne : le TTC stocke est la source de verite ;
       a defaut on le rededuit, comme le fait le PDF. */
    const ligneTtc = (l) => {
      const q = Number(l.quantite || 1);
      if (l.montant_ttc != null) return Number(l.montant_ttc);
      if (l.total_ttc != null) return Number(l.total_ttc);
      if (l.pu_ttc != null) return Number(l.pu_ttc) * q;
      return Number(l.pu_ht || 0) * q * (1 + Number(l.taux_tva || 0) / 100);
    };
    const pu = (l) => {
      const q = Number(l.quantite || 1) || 1;
      return l.pu_ttc != null ? Number(l.pu_ttc) : ligneTtc(l) / q;
    };

    const postes = (f.lignes || []).map((l) => `
      <div style="display:grid;grid-template-columns:1fr 68px 96px 108px;gap:12px;align-items:center;
                  padding:0 18px;height:52px;border-bottom:1px solid var(--hairline)">
        <div style="font-size:13.5px;min-width:0">${esc(l.designation || '—')}</div>
        <div style="text-align:right;font-size:13px;color:var(--brume);font-variant-numeric:tabular-nums">${Number(l.quantite || 1)}</div>
        <div style="text-align:right;font-size:13px;color:var(--brume);font-variant-numeric:tabular-nums">${eur(pu(l))}</div>
        <div style="text-align:right;font-size:14px;font-variant-numeric:tabular-nums">${eur(ligneTtc(l))}</div>
      </div>`).join('') || '<p class="muted" style="padding:16px 18px;margin:0">Aucune ligne.</p>';

    /* Suivi : ce qui est arrive a cette facture, du plus recent au plus
       ancien. Les reglements sont lus dans leurs affectations : un
       encaissement peut couvrir plusieurs factures. */
    const suivi = [];
    for (const g of (reglements || [])) {
      for (const a of (g.affectations || [])) {
        if (!a || a.facture_id !== f.id) continue;
        suivi.push({ d: g.date_reglement, txt: `Règlement ${lib(g.mode) || esc(g.mode)} — ${eur(a.montant)}${g.reference ? ' · réf. ' + esc(g.reference) : ''}` });
      }
    }
    if (f.date_emission) suivi.push({ d: f.date_emission, txt: brouillon ? 'Brouillon créé' : 'Facture émise' });
    suivi.sort((a, b) => String(b.d).localeCompare(String(a.d)));

    const boutons = [];
    if (brouillon) {
      boutons.push(`<button class="btn btn-ghost btn-sm" data-act="editerLignesFacture" data-a1="${f.id}">Modifier les lignes</button>`);
      boutons.push(`<button class="btn btn-ghost btn-sm" data-act="supprimerBrouillon" data-a1="${f.id}">Supprimer</button>`);
      boutons.push(`<button class="btn btn-primary btn-sm" data-act="emettreFacture" data-a1="${f.id}">Émettre</button>`);
    } else {
      boutons.push(`<button class="btn btn-ghost btn-sm" data-act="pdfFacture" data-a1="${f.id}">PDF</button>`);
      if (!fige) boutons.push(`<button class="btn btn-ghost btn-sm" data-act="emailFacture" data-a1="${f.id}">E-mail</button>`);
      if (!fige) boutons.push(`<button class="btn btn-ghost btn-sm" data-act="faireAvoir" data-a1="${f.id}">Avoir</button>`);
      if (!fige && reste > 0.005) {
        boutons.push(`<button class="btn btn-primary btn-sm" data-act="encaisserFacture" data-a1="${f.id}" data-a2="${f.resident_id}" data-a3="${reste}" data-num="3">Encaisser</button>`);
      }
    }

    return `
      <div style="background:var(--carte);border-bottom:1px solid var(--hairline);padding:22px 26px 18px;
                  display:flex;align-items:flex-start;gap:18px;flex-wrap:wrap">
        <div style="flex:1;min-width:240px">
          <h1 style="margin:0;font-size:24px;line-height:1.15">${esc(f.numero || 'Brouillon')}</h1>
          <div class="muted" style="font-size:13.5px;margin-top:4px">
            ${esc(nom)}${f.periode ? ' · période ' + esc(f.periode) : ''} · ${brouillon ? 'créé' : 'émise'} le ${dfr(f.date_emission)}
          </div>
          <div style="display:flex;gap:7px;margin-top:11px;flex-wrap:wrap">
            <span class="badge ${esc(f.statut)}">${lib(f.statut)}</span>
            ${reste > 0.005 ? `<span style="font-size:12.5px;font-weight:600;padding:3px 9px;border-radius:var(--r-s);background:var(--rouge-pale);color:var(--rouge)">${e.txt}</span>` : ''}
          </div>
        </div>
        <div style="flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:5px">
          <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">${boutons.join('')}</div>
          ${!brouillon && reste > 0.005
    ? '<div class="muted" style="font-size:12px">Le lettrage se fait tout seul.</div>'
    : brouillon ? '<div class="muted" style="font-size:12px">L\'émission attribue le numéro définitif.</div>' : ''}
        </div>
      </div>

      <div style="padding:20px 26px;display:flex;flex-direction:column;gap:16px">
        <div class="card" style="padding:0;overflow:hidden">
          <div style="display:grid;grid-template-columns:1fr 68px 96px 108px;gap:12px;padding:10px 18px;
                      border-bottom:1px solid var(--hairline);font-size:11px;font-weight:600;
                      letter-spacing:.08em;text-transform:uppercase;color:var(--brume)">
            <div>Poste</div><div style="text-align:right">Qté</div>
            <div style="text-align:right">PU</div><div style="text-align:right">Total</div>
          </div>
          ${postes}
          <div style="padding:14px 18px;display:flex;flex-direction:column;gap:6px;align-items:flex-end">
            <div style="display:flex;gap:26px;font-size:13px;color:var(--brume)"><span>Total HT</span><span style="font-variant-numeric:tabular-nums;min-width:92px;text-align:right">${eur(f.total_ht)}</span></div>
            <div style="display:flex;gap:26px;font-size:13px;color:var(--brume)"><span>TVA</span><span style="font-variant-numeric:tabular-nums;min-width:92px;text-align:right">${eur(f.total_tva)}</span></div>
            <div style="display:flex;gap:26px;font-size:15px;font-weight:600;align-items:baseline"><span>Total TTC</span><span style="font-variant-numeric:tabular-nums;min-width:92px;text-align:right;font-size:19px">${eur(f.total_ttc)}</span></div>
            <div style="display:flex;gap:26px;font-size:13px;color:var(--brume)"><span>Déjà réglé</span><span style="font-variant-numeric:tabular-nums;min-width:92px;text-align:right">${facEur(f.montant_regle)}</span></div>
            <div style="display:flex;gap:26px;font-size:13px;font-weight:600;color:${reste > 0.005 ? 'var(--rouge)' : 'var(--sapin)'}"><span>Reste dû</span><span style="font-variant-numeric:tabular-nums;min-width:92px;text-align:right">${facEur(reste)}</span></div>
          </div>
        </div>

        <div class="card" style="padding:0;overflow:hidden">
          <div style="padding:13px 18px;border-bottom:1px solid var(--hairline);font-size:14px;font-weight:600">Suivi</div>
          ${suivi.length ? suivi.map((s) => `
            <div style="display:grid;grid-template-columns:92px 1fr;gap:14px;align-items:center;
                        padding:0 18px;height:46px;border-bottom:1px solid var(--hairline)">
              <div style="font-size:12.5px;color:var(--brume);font-variant-numeric:tabular-nums">${dfr(s.d)}</div>
              <div style="font-size:13.5px">${s.txt}</div>
            </div>`).join('')
    : '<p class="muted" style="padding:16px 18px;margin:0">Rien à signaler pour l\'instant.</p>'}
        </div>
      </div>`;
  }

  async function vueFactures() {
    const mois = new Date().toISOString().slice(0, 7);
    const [{ factures }, resD] = await Promise.all([
      api('/api/factures' + exQS()),
      api('/api/residents').catch(() => ({ residents: [] })),
    ]);
    const noms = {};
    for (const r of (resD.residents || [])) {
      noms[r.id] = `${r.prenom ? r.prenom + ' ' : ''}${r.nom || ''}`.trim() || '—';
    }
    FAC_CACHE = { factures: factures || [], noms };

    const visibles = facVisibles();
    if (FAC_SEL && !FAC_CACHE.factures.some((f) => f.id === FAC_SEL)) FAC_SEL = null;
    if (!FAC_SEL && visibles.length) FAC_SEL = visibles[0].id;

    const compte = (k) => FAC_CACHE.factures.filter((FAC_FILTRES.find((x) => x[0] === k) || FAC_FILTRES[0])[2]).length;
    const puces = FAC_FILTRES.map(([k, l]) => {
      const n = compte(k);
      const on = k === FAC_FILTRE;
      return `<button data-act="filtrerFactures" data-a1="${k}"
        style="padding:4px 11px;border-radius:20px;font-size:12.5px;cursor:pointer;font-family:inherit;
               ${on ? 'background:var(--nuit);color:var(--ivoire);border:1px solid var(--nuit);font-weight:600'
    : 'background:transparent;color:#5D6E66;border:1px solid var(--hairline)'}">${l} ${n}</button>`;
    }).join('');

    $('#main').innerHTML = `
      <div class="page-head"><div><h1>Factures</h1></div>
        <div class="toolbar">
          <input id="fac-periode" type="month" value="${mois}">
          <button class="btn btn-ghost" data-act="formFacture">Nouvelle facture</button>
          <button class="btn btn-primary" data-act="runFacturation">Générer la facturation du mois</button>
        </div></div>

      <div class="card" style="padding:0;overflow:hidden;display:flex;align-items:stretch;min-height:560px">
        <div style="width:380px;flex:none;border-right:1px solid var(--hairline);display:flex;flex-direction:column;min-width:0">
          <div style="padding:16px 18px 13px;border-bottom:1px solid var(--hairline);display:flex;flex-direction:column;gap:11px">
            <input id="fac-q" data-act="chercherFactures" data-evt="input" data-a1="@value"
                   placeholder="Numéro, résident, période" value="${esc(FAC_Q)}" style="width:100%">
            <div style="display:flex;gap:6px;flex-wrap:wrap">${puces}</div>
            <div id="fac-compte" class="muted" style="font-size:12px">${visibles.length} facture${visibles.length > 1 ? 's' : ''}</div>
          </div>
          <div id="fac-liste" style="flex:1;overflow:auto"></div>
        </div>
        <div id="fac-fiche" style="flex:1;min-width:0;background:var(--ivoire)"></div>
      </div>`;

    majListeFactures();
    const fiche = $('#fac-fiche');
    if (!FAC_SEL) {
      fiche.innerHTML = `<p class="muted" style="padding:26px">${FAC_CACHE.factures.length
        ? 'Aucune facture dans ce filtre.'
        : 'Aucune facture. « Générer la facturation du mois » crée les brouillons du mois pour tous les résidents.'}</p>`;
      return;
    }
    fiche.innerHTML = '<p class="muted" style="padding:26px">Chargement…</p>';
    try { fiche.innerHTML = await facFiche(FAC_SEL); }
    catch (err) { fiche.innerHTML = `<p class="form-error" style="margin:26px">${esc(err.message)}</p>`; }
  }
}

if (!fs.existsSync(CIBLE)) echec('backend/public/app.js introuvable. Lancez depuis la racine du projet.');
let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('window.ouvrirFacture') !== -1) {
  console.log('\n  L\'ecran Factures est deja en liste + fiche — rien a faire.\n');
  process.exit(0);
}

/* On repere l'ancienne vue par ses deux bornes plutot que de reproduire
   son texte : moins de chances de casser sur un espace pres. */
const DEBUT = 'async function vueFactures() {';
const FIN = '/* ---------- Messagerie (boîte de réception) ---------- */';
const i = src.indexOf(DEBUT);
const j = src.indexOf(FIN);
if (i === -1) echec('vueFactures introuvable dans app.js.');
if (j === -1 || j < i) echec('La borne de fin (bloc Messagerie) est introuvable ou mal placee.');

const ancien = src.slice(i, j);
/* Compte de reference : « Réglé » apparait aussi dans d'autres tableaux.
   La verification porte sur la disparition d'UNE occurrence, pas de toutes. */
const REGLE_AVANT = src.split('<th class="right">Réglé</th>').length - 1;
if (ancien.length > 4000) echec(`Le bloc a remplacer fait ${ancien.length} caracteres — trop gros, app.js a change.`);
if (ancien.indexOf('Générer la facturation du mois') === -1) echec('Le bloc repere ne ressemble pas a l\'ancienne vue Factures.');
if (ancien.indexOf('async function vue') !== ancien.lastIndexOf('async function vue')) {
  echec('Le bloc repere contient plusieurs vues — bornes invalides.');
}

const CODE = NOUVEAU_CODE.toString()
  .replace(/^function NOUVEAU_CODE\(\)\s*\{\r?\n/, '')
  .replace(/\}\s*$/, '')
  .replace(/^ {2}/gm, '');

src = src.slice(0, i) + CODE.replace(/\s*$/, '\n') + '\n' + src.slice(j);

try { new Function(src); }
catch (e) { echec('Le resultat n\'est pas du JavaScript valide — ' + e.message); }

for (const [quoi, aiguille] of [
  ['la vue Factures', 'async function vueFactures()'],
  ['la selection d\'une facture', 'window.ouvrirFacture'],
  ['les filtres', 'window.filtrerFactures'],
  ['la recherche', 'window.chercherFactures'],
  ['la fiche', 'async function facFiche'],
  ['le bouton Encaisser', 'data-act="encaisserFacture"'],
]) if (src.indexOf(aiguille) === -1) echec(`Verification : ${quoi} est absent du resultat.`);

if (src.split('<th class="right">Réglé</th>').length - 1 !== REGLE_AVANT - 1) {
  echec('L\'ancien tableau de factures subsiste (ou un autre tableau a ete touche).');
}

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('window.ouvrirFacture') === -1) echec('L\'ajout est absent apres ecriture.');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Factures : liste 380 px a gauche, facture ouverte a droite.');
console.log('  Recherche + filtres Toutes / Impayees / Brouillons / Reglees, avec compteurs.');
console.log('  Fiche : postes, totaux, reste du, suivi des reglements.');
console.log('  Actions en tete de fiche — PDF, e-mail, avoir, encaisser ; emettre pour un brouillon.');
console.log('  Aucun changement backend.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

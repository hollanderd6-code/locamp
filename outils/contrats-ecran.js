#!/usr/bin/env node
/* ============================================================
   outils/contrats-ecran.js
   Nouvel ecran Contrats : liste a gauche, contrat ouvert a droite
   ============================================================
   Cibles : backend/public/app.js  et  backend/public/index.html

   ── POURQUOI UN NOUVEL ECRAN ────────────────────────────────────
   Les contrats existent cote serveur depuis le debut (creation, PDF,
   signature en ligne, signature papier, renouvellement, suppression
   d'un brouillon) mais ils n'ont jamais eu d'ecran a eux : ils vivent
   dans un tableau au fond de la fiche d'un resident. Pour savoir
   lesquels arrivent a echeance il faut donc ouvrir les 58 fiches, ou
   se fier a la liste du tableau de bord.

   Cet ecran repond a la seule question qu'on se pose sur les contrats :
   lesquels reclament une action, maintenant.

   ── CE QU'IL FAIT ───────────────────────────────────────────────
   · Une entree « Contrats » dans la barre laterale, sous Residents.
   · Liste de 380 px : resident, numero, periode, montant, etat. Triee
     par urgence — echus d'abord, puis les fins proches, puis le reste.
   · Filtres comptes : tous, a renouveler (echu ou fin sous 60 j),
     en attente de signature, signes, brouillons.
   · Fiche a droite : periode, montant mensuel, resident, emplacement,
     et l'etat de la signature. Les actions sont en tete de fiche et
     dependent de l'etat — un contrat signe ne propose que son PDF.
   · Un brouillon (PDF non genere) propose Reessayer et Supprimer,
     comme dans la fiche resident.

   Aucun changement backend : GET /api/contrats, /api/residents,
   /api/emplacements. Les actions reutilisent les fonctions globales
   existantes (telechargerContrat, contratVersSignature,
   signerContratPapier, regenererContrat, supprimerContrat,
   nouveauContrat, renouvelerContrat) : rien n'est reecrit.

   Usage :
     node outils/contrats-ecran.js --essai
     node outils/contrats-ecran.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const APP = path.join(process.cwd(), 'backend', 'public', 'app.js');
const HTML = path.join(process.cwd(), 'backend', 'public', 'index.html');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

function NOUVEAU_CODE() {
  /* ---------- Contrats (ecran dedie) ----------
     Les contrats vivaient au fond de la fiche resident. Ici, la seule
     question qui compte : lesquels reclament une action. */
  let CTR_SEL = null;
  let CTR_FILTRE = 'tous';
  let CTR_Q = '';
  let CTR_CACHE = { contrats: [], res: {}, emp: {} };

  const CTR_AMBRE = '#7A5A22';
  const CTR_J = 86400000;
  const ctrJours = (d) => (d ? Math.floor((new Date(d) - new Date()) / CTR_J) : null);

  /* Un contrat « en attente » est emis mais pas signe : c'est le seul
     etat ou l'action attend quelqu'un d'autre que nous. */
  const ctrEnAttente = (c) => !['signe', 'brouillon', 'annule'].includes(c.statut);

  function ctrEtat(c) {
    if (c.statut === 'brouillon') return { txt: 'Brouillon', col: CTR_AMBRE, rang: 3 };
    if (c.statut === 'annule') return { txt: 'Annulé', col: 'var(--brume)', rang: 5 };
    const j = ctrJours(c.date_fin);
    if (c.date_fin && j < 0) return { txt: 'Échu le ' + dfr(c.date_fin), col: 'var(--rouge)', rang: 0 };
    if (ctrEnAttente(c)) return { txt: 'En attente de signature', col: CTR_AMBRE, rang: 1 };
    if (c.date_fin && j <= 60) return { txt: `Fin dans ${j} j`, col: CTR_AMBRE, rang: 2 };
    return { txt: 'Signé', col: 'var(--sapin)', rang: 4 };
  }

  const ctrEur = (n) => (Math.abs(Number(n || 0)) < 0.005 ? '—' : eur(n));
  const ctrNom = (c) => CTR_CACHE.res[c.resident_id] || 'Résident supprimé';

  const CTR_FILTRES = [
    ['tous', 'Tous', (c) => c.statut !== 'annule'],
    ['renouveler', 'À renouveler', (c) => {
      if (['brouillon', 'annule'].includes(c.statut) || !c.date_fin) return false;
      return ctrJours(c.date_fin) <= 60;
    }],
    ['attente', 'En attente', (c) => ctrEnAttente(c)],
    ['signes', 'Signés', (c) => c.statut === 'signe'],
    ['brouillons', 'Brouillons', (c) => c.statut === 'brouillon'],
  ];

  function ctrVisibles() {
    const f = (CTR_FILTRES.find((x) => x[0] === CTR_FILTRE) || CTR_FILTRES[0])[2];
    const q = CTR_Q.trim().toLowerCase();
    return CTR_CACHE.contrats.filter((c) => {
      if (!f(c)) return false;
      if (!q) return true;
      return `${c.numero || ''} ${ctrNom(c)}`.toLowerCase().includes(q);
    });
  }

  function ctrLigneListe(c) {
    const e = ctrEtat(c);
    const sel = c.id === CTR_SEL;
    return `
      <div data-act="ouvrirContrat" data-a1="${c.id}"
           style="display:flex;align-items:center;gap:12px;padding:0 18px;height:62px;cursor:pointer;
                  border-bottom:1px solid var(--hairline);
                  background:${sel ? 'var(--sapin-pale)' : 'transparent'};
                  box-shadow:${sel ? 'inset 3px 0 0 var(--sapin)' : 'none'}">
        <div style="min-width:0;flex:1">
          <div style="font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${esc(ctrNom(c))}</div>
          <div class="muted" style="font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${esc(c.numero || 'sans numéro')}${c.date_fin ? ' · fin ' + dfr(c.date_fin) : ''}</div>
        </div>
        <div style="text-align:right;flex:none">
          <div style="font-size:13.5px;font-variant-numeric:tabular-nums">${ctrEur(c.montant_mensuel)}</div>
          <div style="font-size:11.5px;font-weight:600;margin-top:2px;color:${e.col}">${e.txt}</div>
        </div>
      </div>`;
  }

  function majListeContrats() {
    const box = $('#ctr-liste');
    if (!box) return;
    const v = ctrVisibles();
    box.innerHTML = v.length ? v.map(ctrLigneListe).join('')
      : '<p class="muted" style="padding:18px">Aucun contrat ne correspond.</p>';
    const n = $('#ctr-compte');
    if (n) n.textContent = v.length + (v.length > 1 ? ' contrats' : ' contrat');
  }

  window.ouvrirContrat = (id) => { CTR_SEL = id; vueContrats(); };
  window.filtrerContrats = (k) => { CTR_FILTRE = k; CTR_SEL = null; vueContrats(); };
  window.chercherContrats = (v) => { CTR_Q = v; majListeContrats(); };

  function ctrFiche(c) {
    const e = ctrEtat(c);
    const nom = ctrNom(c);
    const emp = CTR_CACHE.emp[c.resident_id];
    const brouillon = c.statut === 'brouillon';
    const signe = c.statut === 'signe';

    const boutons = [];
    if (brouillon) {
      boutons.push(`<button class="btn btn-ghost btn-sm" data-act="supprimerContrat" data-a1="${c.id}" data-a2="${esc(c.numero || '')}">Supprimer</button>`);
      boutons.push(`<button class="btn btn-primary btn-sm" data-act="regenererContrat" data-a1="${c.id}">Réessayer le PDF</button>`);
    } else {
      boutons.push(`<button class="btn btn-ghost btn-sm" data-act="telechargerContrat" data-a1="${c.id}">PDF</button>`);
      if (!signe) {
        boutons.push(`<button class="btn btn-ghost btn-sm" data-act="signerContratPapier" data-a1="${c.id}">Signé (papier)</button>`);
        boutons.push(`<button class="btn btn-primary btn-sm" data-act="contratVersSignature" data-a1="${c.id}">Envoyer en signature</button>`);
      } else if (c.date_fin && ctrJours(c.date_fin) <= 60) {
        boutons.push(`<button class="btn btn-primary btn-sm" data-act="renouvelerContrat" data-a1="${c.id}">Renouveler</button>`);
      }
    }

    const infos = [
      ['Période', `${c.date_debut ? dfr(c.date_debut) : '—'} → ${c.date_fin ? dfr(c.date_fin) : 'illimité'}`],
      ['Loyer mensuel', ctrEur(c.montant_mensuel)],
      ['Emplacement', emp ? esc(emp) : '<span class="muted">non rattaché</span>'],
      ['Statut', `<span class="badge ${signe ? 'reglee' : brouillon ? 'brouillon' : 'emise'}">${lib(c.statut)}</span>`],
      ['Signature', signe
        ? 'signé' + (c.date_signature ? ' le ' + dfr(c.date_signature) : '')
        : brouillon
          ? '<span style="color:' + CTR_AMBRE + '">PDF non généré</span>'
          : '<span style="color:' + CTR_AMBRE + '">en attente du résident</span>'],
    ];

    return `
      <div style="background:var(--carte);border-bottom:1px solid var(--hairline);padding:22px 26px 18px;
                  display:flex;align-items:flex-start;gap:18px;flex-wrap:wrap">
        <div style="flex:1;min-width:220px">
          <h1 style="margin:0;font-size:24px;line-height:1.15">${esc(c.numero || 'Brouillon')}</h1>
          <div class="muted" style="font-size:13.5px;margin-top:4px">
            ${esc(nom)}${emp ? ' · emplacement ' + esc(emp) : ''}
          </div>
          <div style="display:flex;gap:7px;margin-top:11px;flex-wrap:wrap">
            <span style="font-size:12.5px;font-weight:600;padding:3px 9px;border-radius:var(--r-s);
                         background:${e.col === 'var(--rouge)' ? 'var(--rouge-pale)' : e.col === 'var(--sapin)' ? 'var(--sapin-pale)' : 'var(--laiton-pale)'};
                         color:${e.col}">${e.txt}</span>
          </div>
        </div>
        <div style="flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:5px">
          <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">${boutons.join('')}</div>
          ${brouillon
    ? '<div class="muted" style="font-size:12px">Un brouillon est un contrat dont le PDF n\'a pas abouti.</div>'
    : signe ? '' : '<div class="muted" style="font-size:12px">La signature papier accepte un scan, facultatif.</div>'}
        </div>
      </div>

      <div style="padding:20px 26px;display:flex;flex-direction:column;gap:16px">
        <div class="card" style="padding:0;overflow:hidden">
          ${infos.map(([k, v]) => `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;
                        padding:0 18px;height:46px;border-bottom:1px solid var(--hairline)">
              <span class="muted" style="font-size:13px">${k}</span>
              <span style="font-size:13.5px;text-align:right">${v}</span>
            </div>`).join('')}
        </div>
        <div class="card" style="padding:0;overflow:hidden">
          <div style="padding:13px 18px;border-bottom:1px solid var(--hairline);display:flex;
                      align-items:center;justify-content:space-between;gap:12px">
            <div style="font-size:14px;font-weight:600">Résident</div>
            ${c.resident_id ? `<button class="btn btn-ghost btn-sm" data-act="allerA" data-a1="#/residents/${c.resident_id}">Ouvrir la fiche</button>` : ''}
          </div>
          <div style="padding:16px 18px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">
            <div style="font-size:15px;font-weight:600">${esc(nom)}</div>
            ${c.resident_id ? `<button class="btn btn-ghost btn-sm" data-act="nouveauContrat" data-a1="${c.resident_id}">Nouveau contrat</button>` : ''}
          </div>
        </div>
      </div>`;
  }

  async function vueContrats() {
    const [ctrD, resD, empD] = await Promise.all([
      api('/api/contrats'),
      api('/api/residents').catch(() => ({ residents: [] })),
      api('/api/emplacements').catch(() => ({ emplacements: [] })),
    ]);
    const res = {}; const emp = {};
    const numEmp = {};
    (empD.emplacements || []).forEach((x) => { numEmp[x.id] = x.numero; });
    (resD.residents || []).forEach((r) => {
      res[r.id] = `${r.prenom ? r.prenom + ' ' : ''}${r.nom || ''}`.trim() || '—';
      if (r.emplacement_id && numEmp[r.emplacement_id]) emp[r.id] = numEmp[r.emplacement_id];
    });

    /* Tri par urgence : ce qui reclame une action remonte. A rang egal,
       la fin la plus proche d'abord. */
    const liste = (ctrD.contrats || []).slice().sort((a, b) => {
      const ra = ctrEtat(a).rang; const rb = ctrEtat(b).rang;
      if (ra !== rb) return ra - rb;
      const ja = a.date_fin ? new Date(a.date_fin).getTime() : Infinity;
      const jb = b.date_fin ? new Date(b.date_fin).getTime() : Infinity;
      return ja - jb;
    });
    CTR_CACHE = { contrats: liste, res, emp };

    const visibles = ctrVisibles();
    if (CTR_SEL && !liste.some((c) => c.id === CTR_SEL)) CTR_SEL = null;
    if (!CTR_SEL && visibles.length) CTR_SEL = visibles[0].id;

    const compte = (k) => liste.filter((CTR_FILTRES.find((x) => x[0] === k) || CTR_FILTRES[0])[2]).length;
    const puces = CTR_FILTRES.map(([k, l]) => {
      const on = k === CTR_FILTRE;
      return `<button data-act="filtrerContrats" data-a1="${k}"
        style="padding:4px 11px;border-radius:20px;font-size:12.5px;cursor:pointer;font-family:inherit;
               border:1px solid ${on ? 'var(--nuit)' : 'var(--hairline)'};
               background:${on ? 'var(--nuit)' : 'transparent'};color:${on ? 'var(--ivoire)' : '#5D6E66'};
               font-weight:${on ? '600' : '400'}">${l} ${compte(k)}</button>`;
    }).join('');

    const urgents = compte('renouveler');
    $('#main').innerHTML = `
      <div class="page-head"><div><h1>Contrats</h1>
        <div class="muted" style="font-size:13.5px;margin-top:4px">
          ${compte('tous')} contrat${compte('tous') > 1 ? 's' : ''} en cours${urgents ? ' · ' + urgents + ' à renouveler' : ''}${compte('attente') ? ' · ' + compte('attente') + ' en attente de signature' : ''}
        </div></div>
        <button class="btn btn-ghost" data-act="allerA" data-a1="#/residents"
                title="Un contrat se crée depuis la fiche du résident">Créer depuis un résident</button></div>

      <div class="card" style="padding:0;overflow:hidden;display:flex;align-items:stretch;min-height:560px">
        <div style="width:380px;flex:none;border-right:1px solid var(--hairline);display:flex;flex-direction:column;min-width:0">
          <div style="padding:16px 18px 13px;border-bottom:1px solid var(--hairline);display:flex;flex-direction:column;gap:11px">
            <input id="ctr-q" data-act="chercherContrats" data-evt="input" data-a1="@value"
                   placeholder="Numéro, résident" value="${esc(CTR_Q)}" style="width:100%">
            <div style="display:flex;gap:6px;flex-wrap:wrap">${puces}</div>
            <div id="ctr-compte" class="muted" style="font-size:12px"></div>
          </div>
          <div id="ctr-liste" style="flex:1;overflow:auto"></div>
        </div>
        <div id="ctr-fiche" style="flex:1;min-width:0;background:var(--ivoire)"></div>
      </div>`;

    majListeContrats();
    const fiche = $('#ctr-fiche');
    const c = liste.find((x) => x.id === CTR_SEL);
    fiche.innerHTML = c ? ctrFiche(c)
      : `<p class="muted" style="padding:26px">${liste.length
        ? 'Aucun contrat dans ce filtre.'
        : 'Aucun contrat. Ouvrez la fiche d\'un résident et utilisez « Nouveau contrat ».'}</p>`;
  }
}

for (const f of [APP, HTML]) if (!fs.existsSync(f)) echec(`${f} introuvable. Lancez depuis la racine du projet.`);
let app = fs.readFileSync(APP, 'utf8');
let html = fs.readFileSync(HTML, 'utf8');

if (app.indexOf('async function vueContrats') !== -1) {
  console.log('\n  L\'ecran Contrats existe deja — rien a faire.\n');
  process.exit(0);
}
/* Les actions de la fiche sont empruntees a la fiche resident : sans
   elles, les boutons ne feraient rien. */
for (const fn of ['telechargerContrat', 'contratVersSignature', 'signerContratPapier',
  'regenererContrat', 'supprimerContrat', 'nouveauContrat', 'renouvelerContrat']) {
  if (app.indexOf('window.' + fn) === -1) echec(`window.${fn} est introuvable dans app.js — l'ecran en depend.`);
}

/* 1. Le code de la vue, pose juste avant le bloc Factures. */
const ANCRE = '/* ---------- Factures ---------- */';
if (app.split(ANCRE).length - 1 !== 1) echec('L\'ancre du bloc Factures n\'est pas unique.');

const CODE = NOUVEAU_CODE.toString()
  .replace(/^function NOUVEAU_CODE\(\)\s*\{\r?\n/, '')
  .replace(/\}\s*$/, '')
  .replace(/^ {2}/gm, '');

app = app.replace(ANCRE, CODE.replace(/\s*$/, '\n') + '\n' + ANCRE);

/* 2. La route. */
const ROUTE_ANCIEN = 'residents: vueResidents, emplacements: vueEmplacements,';
const ROUTE_NOUVEAU = 'residents: vueResidents, emplacements: vueEmplacements, contrats: vueContrats,';
if (app.split(ROUTE_ANCIEN).length - 1 !== 1) echec('La table des routes est introuvable ou modifiee.');
app = app.split(ROUTE_ANCIEN).join(ROUTE_NOUVEAU);

try { new Function(app); }
catch (e) { echec('app.js resultant n\'est pas du JavaScript valide — ' + e.message); }

/* 3. L'entree de menu, sous Residents. */
const NAV_FIN = '<span>Résidents</span></a>';
if (html.split(NAV_FIN).length - 1 !== 1) echec('L\'entree Residents de la barre laterale est introuvable.');
const NAV_CONTRATS = NAV_FIN + '\n'
  + '      <a href="#/contrats" data-nav="contrats"><svg class="nav-ic" viewBox="0 0 24 24" fill="none" '
  + 'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<path d="M6 2.5h12v19H6z"/><path d="M9.5 7h5"/><path d="M9.5 11h5"/>'
  + '<path d="M9.5 16.5c1.6-1.6 2.4.8 4 -.8"/></svg><span>Contrats</span></a>';
html = html.split(NAV_FIN).join(NAV_CONTRATS);

for (const [quoi, aiguille, ou] of [
  ['la vue Contrats', 'async function vueContrats()', app],
  ['la route', 'contrats: vueContrats', app],
  ['la selection', 'window.ouvrirContrat', app],
  ['les filtres', 'window.filtrerContrats', app],
  ['l\'entree de menu', 'data-nav="contrats"', html],
]) if (ou.indexOf(aiguille) === -1) echec(`Verification : ${quoi} est absent du resultat.`);

if (!ESSAI) {
  fs.writeFileSync(APP, app, 'utf8');
  fs.writeFileSync(HTML, html, 'utf8');
  if (fs.readFileSync(APP, 'utf8').indexOf('async function vueContrats') === -1
    || fs.readFileSync(HTML, 'utf8').indexOf('data-nav="contrats"') === -1) {
    echec('L\'ajout est absent apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Nouvel ecran Contrats : #/contrats, entree de menu sous Residents.');
console.log('  Liste triee par urgence : echus, en attente de signature, fins proches, puis le reste.');
console.log('  Filtres comptes : tous, a renouveler, en attente, signes, brouillons.');
console.log('  Fiche : periode, montant, emplacement, etat de signature ; actions selon l\'etat.');
console.log('  Aucun changement backend — actions empruntees a la fiche resident.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

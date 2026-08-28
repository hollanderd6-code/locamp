#!/usr/bin/env node
/* ============================================================
   outils/emplacements-liste-fiche.js
   Ecran Emplacements : liste a gauche, emplacement ouvert a droite
   ============================================================
   Cible : backend/public/app.js  (remplace vueEmplacements)

   ── CE QUI CHANGE ───────────────────────────────────────────────
   Avant : un tableau de six colonnes, et la fiche s'ouvrait dans le
   tiroir lateral qui recouvre la page — donc impossible de comparer
   deux emplacements, et la colonne « Carte » se contentait d'un ✓.

   Apres, comme pour les factures : liste de 380 px a gauche (numero,
   type, secteur, etat, resident), emplacement selectionne a droite
   avec son resident, son loyer, ses factures en attente et sa position
   sur le plan. « Modifier » est en tete de fiche.

   Le tiroir reste pour les formulaires — creer, modifier — et
   window.ficheEmplacement n'est pas touche : le clic sur le plan
   continue d'ouvrir le tiroir, ou l'on est deja dans une autre page.

   Trois points fideles au reste du produit :
   · L'etat affiche est statutReel() : un emplacement ou habite un
     resident est occupe, quel que soit le statut saisi.
   · Un emplacement dont le resident doit de l'argent est signale en
     rouge, comme sur le plan.
   · Un loyer nul s'ecrit « — », pas 0,00 €.

   Aucun changement backend : GET /api/emplacements,
   GET /api/emplacements/:id, GET /api/factures?resident_id=.

   Usage :
     node outils/emplacements-liste-fiche.js --essai
     node outils/emplacements-liste-fiche.js
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
  /* ---------- Emplacements : liste + fiche ----------
     L'etat de l'ecran (selection, filtre, recherche) vit ici : on
     revient sur le meme emplacement apres une modification, qui passe
     par route(). */
  let EMP_SEL = null;
  let EMP_FILTRE = 'tous';
  let EMP_Q = '';
  let EMP_CACHE = { emplacements: [], retard: new Set() };

  const EMP_AMBRE = '#7A5A22';

  const empTriNaturel = (a, b) => String(a.numero || '')
    .localeCompare(String(b.numero || ''), 'fr', { numeric: true, sensitivity: 'base' });

  const EMP_FILTRES = [
    ['tous', 'Tous', () => true],
    ['occupes', 'Occupés', (e) => statutReel(e) === 'occupe'],
    ['libres', 'Libres', (e) => statutReel(e) === 'libre'],
    ['impayes', 'Impayés', (e) => e.resident && EMP_CACHE.retard.has(e.resident.id)],
    ['horsplan', 'Hors plan', (e) => e.coord_x == null || e.coord_y == null],
  ];

  function empEtat(e) {
    const s = statutReel(e);
    if (e.resident && EMP_CACHE.retard.has(e.resident.id)) return { txt: 'Impayé', col: 'var(--rouge)' };
    if (s === 'occupe') return { txt: 'Occupé', col: 'var(--brume)' };
    if (s === 'libre') return { txt: 'Libre', col: 'var(--sapin)' };
    return { txt: lib(s), col: EMP_AMBRE };
  }

  const empEur = (n) => (Math.abs(Number(n || 0)) < 0.005 ? '—' : eur(n));

  function empVisibles() {
    const f = (EMP_FILTRES.find((x) => x[0] === EMP_FILTRE) || EMP_FILTRES[0])[2];
    const q = EMP_Q.trim().toLowerCase();
    return EMP_CACHE.emplacements.filter((e) => {
      if (!f(e)) return false;
      if (!q) return true;
      const r = e.resident ? `${e.resident.prenom || ''} ${e.resident.nom || ''}` : '';
      return `${e.numero || ''} ${e.secteur || ''} ${e.type || ''} ${r}`.toLowerCase().includes(q);
    });
  }

  function empLigneListe(e) {
    const et = empEtat(e);
    const sel = e.id === EMP_SEL;
    const r = e.resident;
    return `
      <div data-act="ouvrirEmplacement" data-a1="${e.id}"
           style="display:flex;align-items:center;gap:12px;padding:0 18px;height:62px;cursor:pointer;
                  border-bottom:1px solid var(--hairline);
                  background:${sel ? 'var(--sapin-pale)' : 'transparent'};
                  box-shadow:${sel ? 'inset 3px 0 0 var(--sapin)' : 'none'}">
        <div style="width:38px;height:38px;flex:none;border-radius:var(--r-s);display:flex;align-items:center;
                    justify-content:center;font-size:13.5px;font-weight:600;
                    background:${sel ? 'var(--sapin)' : 'var(--ivoire)'};
                    color:${sel ? 'var(--ivoire)' : '#5D6E66'}">${esc(e.numero)}</div>
        <div style="min-width:0;flex:1">
          <div style="font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${r ? esc(`${r.prenom || ''} ${r.nom || ''}`.trim()) : '<span style="font-weight:400;color:#5D6E66">Libre</span>'}</div>
          <div class="muted" style="font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${esc(e.type || 'type non renseigné')}${e.secteur ? ' · ' + esc(e.secteur) : ''}</div>
        </div>
        <div style="text-align:right;flex:none">
          <div style="font-size:13.5px;font-variant-numeric:tabular-nums">${empEur(e.loyer_base)}</div>
          <div style="font-size:11.5px;font-weight:600;margin-top:2px;color:${et.col}">${et.txt}</div>
        </div>
      </div>`;
  }

  function majListeEmplacements() {
    const box = $('#emp-liste');
    if (!box) return;
    const v = empVisibles();
    box.innerHTML = v.length ? v.map(empLigneListe).join('')
      : '<p class="muted" style="padding:18px">Aucun emplacement ne correspond.</p>';
    const c = $('#emp-compte');
    if (c) c.textContent = v.length + (v.length > 1 ? ' emplacements' : ' emplacement');
  }

  window.ouvrirEmplacement = (id) => { EMP_SEL = id; vueEmplacements(); };
  window.filtrerEmplacements = (k) => { EMP_FILTRE = k; EMP_SEL = null; vueEmplacements(); };
  window.chercherEmplacements = (v) => { EMP_Q = v; majListeEmplacements(); };

  async function empFiche(id) {
    const { emplacement: e, residents } = await api('/api/emplacements/' + id);
    const r = (residents || [])[0];
    const et = empEtat({ ...e, resident: r });

    let factures = [];
    if (r) {
      const d = await api('/api/factures?resident_id=' + r.id + exQSand()).catch(() => ({ factures: [] }));
      factures = (d.factures || []).filter((f) => ['emise', 'partielle', 'en_retard'].includes(f.statut));
    }
    const du = factures.reduce((s, f) => s + (Number(f.total_ttc || 0) - Number(f.montant_regle || 0)), 0);

    const infos = [
      ['Type', e.type ? esc(e.type) : '<span class="muted">non renseigné</span>'],
      ['Secteur', e.secteur ? esc(e.secteur) : '<span class="muted">—</span>'],
      ['Loyer de base', empEur(e.loyer_base)],
      ['Statut saisi', `<span class="badge ${esc(e.statut)}">${lib(e.statut)}</span>`],
      ['Sur le plan', e.coord_x != null && e.coord_y != null
        ? `oui · x ${Math.round(e.coord_x)} · y ${Math.round(e.coord_y)}`
        : '<span style="color:' + EMP_AMBRE + '">non placé</span>'],
    ];

    return `
      <div style="background:var(--carte);border-bottom:1px solid var(--hairline);padding:22px 26px 18px;
                  display:flex;align-items:flex-start;gap:18px;flex-wrap:wrap">
        <div style="width:52px;height:52px;flex:none;border-radius:var(--r-s);background:var(--sapin-pale);
                    color:var(--sapin);display:flex;align-items:center;justify-content:center;
                    font-size:19px;font-weight:600">${esc(e.numero)}</div>
        <div style="flex:1;min-width:200px">
          <h1 style="margin:0;font-size:24px;line-height:1.15">Emplacement ${esc(e.numero)}</h1>
          <div class="muted" style="font-size:13.5px;margin-top:4px">
            ${esc(e.type || 'type non renseigné')}${e.secteur ? ' · ' + esc(e.secteur) : ''} ·
            <span style="color:${et.col};font-weight:600">${et.txt}</span>
          </div>
        </div>
        <div style="flex:none;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
          <button class="btn btn-ghost btn-sm" data-act="allerA" data-a1="#/carte">Voir sur le plan</button>
          <button class="btn btn-primary btn-sm" data-act="modifierEmplacement" data-a1="${e.id}">Modifier</button>
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
            ${r ? `<button class="btn btn-ghost btn-sm" data-act="allerA" data-a1="#/residents/${r.id}">Ouvrir la fiche</button>` : ''}
          </div>
          ${r ? `
            <div style="padding:16px 18px;display:flex;flex-direction:column;gap:4px">
              <div style="font-size:15px;font-weight:600">${esc(`${r.prenom || ''} ${r.nom || ''}`.trim())}</div>
              <div class="muted" style="font-size:13px">${esc(r.email || '—')}${r.telephone ? ' · ' + esc(r.telephone) : ''}</div>
            </div>
            <div style="display:flex;border-top:1px solid var(--hairline)">
              <div style="flex:1;padding:13px 18px">
                <div class="muted" style="font-size:11.5px;font-weight:600;letter-spacing:.09em;text-transform:uppercase">Reste dû</div>
                <div style="font-size:20px;margin-top:4px;font-variant-numeric:tabular-nums;${du > 0.005 ? 'color:var(--rouge);font-weight:600' : ''}">${empEur(du)}</div>
              </div>
              <div style="flex:1;padding:13px 18px;border-left:1px solid var(--hairline)">
                <div class="muted" style="font-size:11.5px;font-weight:600;letter-spacing:.09em;text-transform:uppercase">Factures en attente</div>
                <div style="font-size:20px;margin-top:4px;font-variant-numeric:tabular-nums">${factures.length || '—'}</div>
              </div>
            </div>
            ${factures.length ? factures.map((f) => `
              <div data-act="ouvrirFacture" data-a1="${f.id}" style="display:grid;grid-template-columns:1fr 110px 96px;
                          gap:12px;align-items:center;padding:0 18px;height:46px;cursor:pointer;
                          border-top:1px solid var(--hairline)">
                <div style="font-size:13.5px">${esc(f.numero || 'brouillon')}</div>
                <div><span class="badge ${esc(f.statut)}">${lib(f.statut)}</span></div>
                <div style="text-align:right;font-size:13.5px;font-variant-numeric:tabular-nums;color:var(--rouge)">${eur(f.total_ttc - f.montant_regle)}</div>
              </div>`).join('') : ''}`
    : `<div style="padding:16px 18px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">
                 <span class="muted" style="font-size:13.5px">Aucun résident rattaché — cet emplacement est libre.</span>
                 <button class="btn btn-ghost btn-sm" data-act="formResident">Installer un résident</button>
               </div>`}
        </div>
      </div>`;
  }

  async function vueEmplacements() {
    const [{ emplacements }, facD] = await Promise.all([
      api('/api/emplacements'),
      api('/api/factures' + exQS()).catch(() => ({ factures: [] })),
    ]);
    /* Meme regle que le plan : « en retard » se lit dans les factures
       echues, pas dans un champ du resident. */
    const retard = new Set();
    for (const f of (facD.factures || [])) {
      if (!['emise', 'partielle', 'en_retard'].includes(f.statut)) continue;
      if (Number(f.total_ttc || 0) - Number(f.montant_regle || 0) < 0.005) continue;
      if (f.date_echeance && new Date(f.date_echeance) >= new Date()) continue;
      if (f.resident_id) retard.add(f.resident_id);
    }
    const liste = (emplacements || []).slice().sort(empTriNaturel);
    EMP_CACHE = { emplacements: liste, retard };

    const visibles = empVisibles();
    if (EMP_SEL && !liste.some((e) => e.id === EMP_SEL)) EMP_SEL = null;
    if (!EMP_SEL && visibles.length) EMP_SEL = visibles[0].id;

    const compte = (k) => liste.filter((EMP_FILTRES.find((x) => x[0] === k) || EMP_FILTRES[0])[2]).length;
    const puces = EMP_FILTRES.map(([k, l]) => {
      const on = k === EMP_FILTRE;
      return `<button data-act="filtrerEmplacements" data-a1="${k}"
        style="padding:4px 11px;border-radius:20px;font-size:12.5px;cursor:pointer;font-family:inherit;
               border:1px solid ${on ? 'var(--nuit)' : 'var(--hairline)'};
               background:${on ? 'var(--nuit)' : 'transparent'};color:${on ? 'var(--ivoire)' : '#5D6E66'};
               font-weight:${on ? '600' : '400'}">${l} ${compte(k)}</button>`;
    }).join('');

    $('#main').innerHTML = `
      <div class="page-head"><div><h1>Emplacements</h1>
        <div class="muted" style="font-size:13.5px;margin-top:4px">
          ${liste.length} emplacement${liste.length > 1 ? 's' : ''} · ${compte('occupes')} occupé${compte('occupes') > 1 ? 's' : ''} · ${compte('libres')} libre${compte('libres') > 1 ? 's' : ''}
        </div></div>
        <button class="btn btn-primary" data-act="formEmplacement">Nouvel emplacement</button></div>

      <div class="card" style="padding:0;overflow:hidden;display:flex;align-items:stretch;min-height:560px">
        <div style="width:380px;flex:none;border-right:1px solid var(--hairline);display:flex;flex-direction:column;min-width:0">
          <div style="padding:16px 18px 13px;border-bottom:1px solid var(--hairline);display:flex;flex-direction:column;gap:11px">
            <input id="emp-q" data-act="chercherEmplacements" data-evt="input" data-a1="@value"
                   placeholder="Numéro, type, secteur, résident" value="${esc(EMP_Q)}" style="width:100%">
            <div style="display:flex;gap:6px;flex-wrap:wrap">${puces}</div>
            <div id="emp-compte" class="muted" style="font-size:12px"></div>
          </div>
          <div id="emp-liste" style="flex:1;overflow:auto"></div>
        </div>
        <div id="emp-fiche" style="flex:1;min-width:0;background:var(--ivoire)"></div>
      </div>`;

    majListeEmplacements();
    const fiche = $('#emp-fiche');
    if (!EMP_SEL) {
      fiche.innerHTML = `<p class="muted" style="padding:26px">${liste.length
        ? 'Aucun emplacement dans ce filtre.'
        : 'Aucun emplacement. « Nouvel emplacement » crée le premier.'}</p>`;
      return;
    }
    fiche.innerHTML = '<p class="muted" style="padding:26px">Chargement…</p>';
    try { fiche.innerHTML = await empFiche(EMP_SEL); }
    catch (err) { fiche.innerHTML = `<p class="form-error" style="margin:26px">${esc(err.message)}</p>`; }
  }
}

if (!fs.existsSync(CIBLE)) echec('backend/public/app.js introuvable. Lancez depuis la racine du projet.');
let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('window.ouvrirEmplacement') !== -1) {
  console.log('\n  L\'ecran Emplacements est deja en liste + fiche — rien a faire.\n');
  process.exit(0);
}
if (src.indexOf('window.modifierEmplacement') === -1) {
  echec('outils/emplacement-modifiable.js n\'a pas ete applique : la fiche a besoin du formulaire de modification.');
}

const DEBUT = 'async function vueEmplacements() {';
const FIN = 'window.formEmplacement = async () => {';
const i = src.indexOf(DEBUT);
const j = src.indexOf(FIN);
if (i === -1) echec('vueEmplacements introuvable dans app.js.');
if (j === -1 || j < i) echec('La borne de fin (formEmplacement) est introuvable ou mal placee.');

const ancien = src.slice(i, j);
if (ancien.length > 3000) echec(`Le bloc a remplacer fait ${ancien.length} caracteres — trop gros, app.js a change.`);
if (ancien.indexOf('Nouvel emplacement') === -1) echec('Le bloc repere ne ressemble pas a l\'ancienne vue Emplacements.');
if (ancien.indexOf('async function vue') !== ancien.lastIndexOf('async function vue')) {
  echec('Le bloc repere contient plusieurs vues — bornes invalides.');
}
/* L'ancien en-tete de tableau ne vit que dans cette vue : sa disparition
   prouve que le bon bloc a ete remplace. */
const ENTETE = '<th>N°</th><th>Secteur</th><th>Type</th>';
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
  ['la vue Emplacements', 'async function vueEmplacements()'],
  ['la selection', 'window.ouvrirEmplacement'],
  ['les filtres', 'window.filtrerEmplacements'],
  ['la recherche', 'window.chercherEmplacements'],
  ['la fiche', 'async function empFiche'],
  ['le bouton Modifier', 'data-act="modifierEmplacement"'],
]) if (src.indexOf(aiguille) === -1) echec(`Verification : ${quoi} est absent du resultat.`);

if (src.split(ENTETE).length - 1 !== ENTETE_AVANT - 1) {
  echec('L\'ancien tableau des emplacements subsiste (ou un autre tableau a ete touche).');
}
if (src.indexOf('window.ficheEmplacement') === -1) echec('Le tiroir du plan a disparu — il doit rester.');

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('window.ouvrirEmplacement') === -1) echec('L\'ajout est absent apres ecriture.');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Emplacements : liste 380 px a gauche, emplacement ouvert a droite.');
console.log('  Filtres comptes : tous, occupes, libres, impayes, hors plan.');
console.log('  Fiche : type, secteur, loyer, position sur le plan, resident, reste du, factures en attente.');
console.log('  « Modifier » en tete de fiche ; le tiroir reste pour les formulaires et pour le plan.');
console.log('  Aucun changement backend.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

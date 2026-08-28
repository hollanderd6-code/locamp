#!/usr/bin/env node
/* ============================================================
   outils/reglements-liste-fiche.js
   Ecran Reglements : saisie au tiroir, journal en liste + fiche
   ============================================================
   Cible : backend/public/app.js  (remplace vueReglements)

   ── CE QUI CHANGE ───────────────────────────────────────────────
   Avant : la moitie haute de l'ecran etait occupee en permanence par
   le formulaire de saisie — visible meme quand on venait seulement
   consulter — et la moitie basse par un journal plat de tous les
   encaissements, sans recherche ni filtre. Surtout, on ne voyait
   JAMAIS ce qu'un reglement avait paye : le lettrage se fait tout
   seul, ses affectations n'etaient affichees nulle part. Un versement
   encaisse mais non affecte (une avance) etait donc invisible.

   Apres :
   1. « Encaisser un paiement » ouvre le formulaire dans le tiroir —
      avec les memes garde-fous, aucun n'est perdu : reference
      obligatoire selon le TYPE du moyen, alerte de doublon le meme
      jour, refus du montant nul, resident a choisir explicitement.
   2. Le journal devient une liste + fiche. A gauche, les
      encaissements avec recherche et filtres comptes ; a droite, le
      reglement choisi et surtout SES AFFECTATIONS : quelle facture il
      a payee, et pour combien.
   3. Ce qui reste non affecte est nomme : « avance de 120,00 € — non
      affectee ». C'est un credit qui eteint les impayes suivants, et
      qui n'apparaissait dans aucun ecran.
   4. Un filtre « avances » isole ces credits.

   Les remises en banque (bordereaux par moyen) sont conservees telles
   quelles, sous la liste.

   Aucun changement backend : GET /api/reglements, /api/residents,
   /api/moyens-paiement, /api/factures, POST /api/reglements.

   Usage :
     node outils/reglements-liste-fiche.js --essai
     node outils/reglements-liste-fiche.js
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
  /* ---------- Reglements : liste + fiche ----------
     Le formulaire vit dans le tiroir ; l'ecran sert a retrouver un
     encaissement et a voir ce qu'il a paye. */
  let REG_SEL = null;
  let REG_FILTRE = 'tous';
  let REG_Q = '';
  let REG_CACHE = { reglements: [], rmap: {}, mlib: {}, typeParCode: {}, facNum: {} };

  const REG_AMBRE = '#7A5A22';
  const regAffecte = (g) => (g.affectations || [])
    .reduce((s, a) => s + Number((a && a.montant) || 0), 0);
  const regReste = (g) => Math.round((Number(g.montant || 0) - regAffecte(g)) * 100) / 100;

  const REG_FILTRES = [
    ['tous', 'Tous', () => true],
    ['avances', 'Avances', (g) => regReste(g) > 0.005],
    ['mois', 'Ce mois', (g) => String(g.date_reglement || '').slice(0, 7) === new Date().toISOString().slice(0, 7)],
  ];

  function regVisibles() {
    const f = (REG_FILTRES.find((x) => x[0] === REG_FILTRE) || REG_FILTRES[0])[2];
    const q = REG_Q.trim().toLowerCase();
    return REG_CACHE.reglements.filter((g) => {
      if (!f(g)) return false;
      if (!q) return true;
      return `${REG_CACHE.rmap[g.resident_id] || ''} ${g.reference || ''} ${REG_CACHE.mlib[g.mode] || g.mode || ''}`
        .toLowerCase().includes(q);
    });
  }

  function regLigneListe(g) {
    const sel = g.id === REG_SEL;
    const reste = regReste(g);
    return `
      <div data-act="ouvrirReglement" data-a1="${g.id}"
           style="display:flex;align-items:center;gap:12px;padding:0 18px;height:62px;cursor:pointer;
                  border-bottom:1px solid var(--hairline);
                  background:${sel ? 'var(--sapin-pale)' : 'transparent'};
                  box-shadow:${sel ? 'inset 3px 0 0 var(--sapin)' : 'none'}">
        <div style="min-width:0;flex:1">
          <div style="font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${esc(REG_CACHE.rmap[g.resident_id] || 'Résident supprimé')}</div>
          <div class="muted" style="font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${dfr(g.date_reglement)} · ${esc(REG_CACHE.mlib[g.mode] || g.mode || '—')}${g.reference ? ' · ' + esc(g.reference) : ''}</div>
        </div>
        <div style="text-align:right;flex:none">
          <div style="font-size:14px;font-weight:600;font-variant-numeric:tabular-nums">${eur(g.montant)}</div>
          ${reste > 0.005
    ? `<div style="font-size:11.5px;font-weight:600;margin-top:2px;color:${REG_AMBRE}">avance de ${eur(reste)}</div>`
    : '<div class="muted" style="font-size:11.5px;margin-top:2px">lettré</div>'}
        </div>
      </div>`;
  }

  function majListeReglements() {
    const box = $('#reg-liste');
    if (!box) return;
    const v = regVisibles();
    box.innerHTML = v.length ? v.map(regLigneListe).join('')
      : '<p class="muted" style="padding:18px">Aucun règlement ne correspond.</p>';
    const n = $('#reg-compte');
    if (n) {
      const somme = v.reduce((s, g) => s + Number(g.montant || 0), 0);
      n.textContent = v.length ? `${v.length} règlement${v.length > 1 ? 's' : ''} · ${eur(somme)}` : '';
    }
  }

  window.ouvrirReglement = (id) => { REG_SEL = id; majListeReglements(); majFicheReglement(); };
  window.filtrerReglements = (k) => { REG_FILTRE = k; REG_SEL = null; vueReglements(); };
  window.chercherReglements = (v) => { REG_Q = v; majListeReglements(); };

  function regFiche(g) {
    const reste = regReste(g);
    const aff = (g.affectations || []).filter((a) => a && a.facture_id);
    const infos = [
      ['Date du règlement', dfr(g.date_reglement)],
      ['Moyen', esc(REG_CACHE.mlib[g.mode] || g.mode || '—')],
      ['Référence', g.reference ? esc(g.reference) : '<span class="muted">aucune</span>'],
      ['Saisi le', g.created_at
        ? new Date(g.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '<span class="muted">—</span>'],
    ];

    return `
      <div style="background:var(--carte);border-bottom:1px solid var(--hairline);padding:22px 26px 18px;
                  display:flex;align-items:flex-start;gap:18px;flex-wrap:wrap">
        <div style="flex:1;min-width:220px">
          <h1 style="margin:0;font-size:24px;line-height:1.15">${eur(g.montant)}</h1>
          <div class="muted" style="font-size:13.5px;margin-top:4px">
            ${esc(REG_CACHE.rmap[g.resident_id] || 'Résident supprimé')} · ${dfr(g.date_reglement)}
          </div>
          <div style="display:flex;gap:7px;margin-top:11px;flex-wrap:wrap">
            ${reste > 0.005
    ? `<span style="font-size:12.5px;font-weight:600;padding:3px 9px;border-radius:var(--r-s);
                     background:var(--laiton-pale);color:${REG_AMBRE}">Avance de ${eur(reste)} — non affectée</span>`
    : '<span style="font-size:12.5px;font-weight:600;padding:3px 9px;border-radius:var(--r-s);background:var(--sapin-pale);color:var(--sapin)">Entièrement lettré</span>'}
          </div>
        </div>
        ${g.resident_id ? `<div style="flex:none">
          <button class="btn btn-ghost btn-sm" data-act="allerA" data-a1="#/residents/${g.resident_id}">Ouvrir la fiche</button>
        </div>` : ''}
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
            <div style="font-size:14px;font-weight:600">Factures payées par ce règlement</div>
            <div class="muted" style="font-size:12.5px">lettrage automatique</div>
          </div>
          ${aff.length ? aff.map((a) => `
            <div data-act="ouvrirFacture" data-a1="${a.facture_id}"
                 style="display:grid;grid-template-columns:1fr 110px;gap:12px;align-items:center;
                        padding:0 18px;height:46px;cursor:pointer;border-bottom:1px solid var(--hairline)">
              <div style="font-size:13.5px">${esc(REG_CACHE.facNum[a.facture_id] || 'facture')}</div>
              <div style="text-align:right;font-size:13.5px;font-variant-numeric:tabular-nums">${eur(a.montant)}</div>
            </div>`).join('')
    : '<p class="muted" style="padding:16px 18px;margin:0">Aucune affectation : ce versement est une avance, il éteindra les prochaines factures du résident.</p>'}
          ${aff.length ? `
            <div style="padding:12px 18px;display:flex;flex-direction:column;gap:6px;align-items:flex-end">
              <div style="display:flex;gap:26px;font-size:13px;color:var(--brume)"><span>Affecté</span><span style="font-variant-numeric:tabular-nums;min-width:92px;text-align:right">${eur(regAffecte(g))}</span></div>
              ${reste > 0.005 ? `<div style="display:flex;gap:26px;font-size:13px;font-weight:600;color:${REG_AMBRE}"><span>Reste en avance</span><span style="font-variant-numeric:tabular-nums;min-width:92px;text-align:right">${eur(reste)}</span></div>` : ''}
            </div>` : ''}
        </div>
      </div>`;
  }

  function majFicheReglement() {
    const box = $('#reg-fiche');
    if (!box) return;
    const g = REG_CACHE.reglements.find((x) => x.id === REG_SEL);
    box.innerHTML = g ? regFiche(g)
      : `<p class="muted" style="padding:26px">${REG_CACHE.reglements.length
        ? 'Choisissez un règlement.'
        : 'Aucun règlement enregistré. « Encaisser un paiement » enregistre le premier.'}</p>`;
  }

  /* ---- Saisie : au tiroir, avec les memes garde-fous qu'avant ---- */
  window.formReglement = () => {
    const { rmap, mlib, typeParCode, reglements } = REG_CACHE;
    const residents = Object.entries(rmap)
      .sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'fr'));
    const codes = Object.keys(typeParCode);

    openDrawer(`
      <h2>Encaisser un paiement</h2>
      <p class="muted" style="margin-top:4px">Le règlement est lettré automatiquement sur les factures dues du résident, de la plus ancienne à la plus récente.</p>
      <form id="f-reg" class="form-grid" style="margin-top:12px">
        ${/* Sans option vide, un <select required> est considere rempli par le
             navigateur : valider sans y toucher enregistrait le paiement au nom
             du PREMIER resident de la liste, avec lettrage automatique. */''}
        <label class="full">Résident *<select name="resident_id" required>
          <option value="">— choisir —</option>
          ${residents.map(([id, nom]) => `<option value="${id}">${esc(nom)}</option>`).join('')}</select></label>
        <label>Moyen de paiement *<select name="mode" required>
          ${codes.length
    ? codes.map((c) => `<option value="${esc(c)}">${esc(mlib[c] || c)}</option>`).join('')
    : '<option value="espece">Espèces</option><option value="cheque">Chèque</option>'}
        </select></label>
        <label>Montant (€) *<input name="montant" type="number" step="0.01" required autofocus></label>
        <label class="full"><span id="reg-ref-label">Référence</span><input name="reference" id="reg-ref"></label>
        <div class="full"><button class="btn btn-primary btn-block">Encaisser</button></div>
      </form>
      ${codes.length ? '' : '<p class="muted" style="font-size:12px">Moyens de paiement par défaut — configurez-les dans Administration.</p>'}`);

    /* Le libelle de la reference suit le TYPE du moyen choisi. */
    const majChampRef = () => {
      const champ = $('#reg-ref');
      const lab = $('#reg-ref-label');
      const form = $('#f-reg');
      if (!champ || !lab || !form) return;
      const r = regleRef(typeParCode[form.mode?.value]);
      lab.innerHTML = esc(r.aide) + (r.requis ? ' *' : '');
      champ.placeholder = r.exemple;
      champ.required = r.requis;
    };
    $('#f-reg').mode?.addEventListener('change', majChampRef);
    majChampRef();

    $('#f-reg').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target).entries());
      body.montant = Number(body.montant);
      if (!body.resident_id) { toast('Choisissez le résident.', true); return; }
      if (!(body.montant > 0)) { toast('Le montant doit être supérieur à zéro.', true); return; }

      /* Refait ici et pas seulement par l'attribut required : changer le
         moyen apres avoir saisi la reference ne doit pas passer entre les
         mailles. Sans reference, un cheque ou un virement est introuvable
         au rapprochement bancaire. */
      const regle = regleRef(typeParCode[body.mode]);
      if (regle.requis && !String(body.reference || '').trim()) {
        const nom = (mlib[body.mode] || body.mode || 'ce moyen').toLowerCase();
        toast(regle.aide + ' obligatoire pour un paiement par ' + nom
          + ' : sans elle, l\u2019encaissement ne pourra pas être retrouvé au rapprochement bancaire.', true);
        $('#reg-ref')?.focus();
        return;
      }

      /* Meme montant, meme jour, meme resident, meme moyen : peut-etre deux
         versements reels, peut-etre une double saisie. On ne bloque pas — on
         force le regard, parce qu'apres lettrage la correction demande
         d'annuler un reglement deja impute sur des factures. */
      const aujourdhui = new Date().toISOString().slice(0, 10);
      const doublonProbable = (reglements || []).some((g) => g.resident_id === body.resident_id
        && String(g.date_reglement).slice(0, 10) === aujourdhui
        && Math.abs(Number(g.montant) - body.montant) < 0.005
        && String(g.mode) === String(body.mode));
      if (doublonProbable) {
        const ok = await askConfirm(
          'Un paiement de ' + eur(body.montant) + ' a déjà été enregistré aujourd\u2019hui pour '
          + (rmap[body.resident_id] || 'ce résident') + ', avec le même moyen.\n\n'
          + 'S\u2019agit-il bien d\u2019un second versement ?'
        );
        if (!ok) return;
      }

      try {
        const { reglement } = await api('/api/reglements', { method: 'POST', body });
        closeDrawer();
        toast('Paiement enregistré et lettré');
        if (reglement && reglement.id) REG_SEL = reglement.id;
        route();
      } catch (err) { toast(err.message, true); }
    });
  };

  async function vueReglements() {
    const [{ reglements }, { residents }, moyRes, facRes] = await Promise.all([
      api('/api/reglements' + exQS()), api('/api/residents'),
      api('/api/moyens-paiement').catch(() => ({ moyens: [] })),
      api('/api/factures' + exQS()).catch(() => ({ factures: [] })),
    ]);
    const rmap = {}; residents.forEach((r) => { rmap[r.id] = `${r.prenom || ''} ${r.nom}`.trim(); });
    const moyens = moyRes.moyens || [];
    const mlib = {}; moyens.forEach((m) => { mlib[m.code] = m.libelle; });
    const typeParCode = {};
    moyens.forEach((m) => { typeParCode[m.code] = m.type; });
    /* Sans configuration, les deux options de repli portent leur type dans
       leur valeur. */
    if (!moyens.length) { typeParCode.espece = 'espece'; typeParCode.cheque = 'cheque'; }
    const facNum = {}; (facRes.factures || []).forEach((f) => { facNum[f.id] = f.numero; });

    const liste = (reglements || []).slice()
      .sort((a, b) => String(b.date_reglement).localeCompare(String(a.date_reglement)));
    REG_CACHE = { reglements: liste, rmap, mlib, typeParCode, facNum };

    const visibles = regVisibles();
    if (REG_SEL && !liste.some((g) => g.id === REG_SEL)) REG_SEL = null;
    if (!REG_SEL && visibles.length) REG_SEL = visibles[0].id;

    const compte = (k) => liste.filter((REG_FILTRES.find((x) => x[0] === k) || REG_FILTRES[0])[2]).length;
    const puces = REG_FILTRES.map(([k, l]) => {
      const on = k === REG_FILTRE;
      return `<button data-act="filtrerReglements" data-a1="${k}"
        style="padding:4px 11px;border-radius:20px;font-size:12.5px;cursor:pointer;font-family:inherit;
               border:1px solid ${on ? 'var(--nuit)' : 'var(--hairline)'};
               background:${on ? 'var(--nuit)' : 'transparent'};color:${on ? 'var(--ivoire)' : '#5D6E66'};
               font-weight:${on ? '600' : '400'}">${l} ${compte(k)}</button>`;
    }).join('');

    const total = liste.reduce((s, g) => s + Number(g.montant || 0), 0);
    const avances = liste.reduce((s, g) => s + Math.max(0, regReste(g)), 0);

    $('#main').innerHTML = `
      <div class="page-head"><div><h1>Règlements</h1>
        <div class="muted" style="font-size:13.5px;margin-top:4px">
          ${liste.length} encaissement${liste.length > 1 ? 's' : ''} · ${eur(total)}${avances > 0.005 ? ' · dont ' + eur(avances) + ' en avance non affectée' : ''}
        </div></div>
        <button class="btn btn-primary" data-act="formReglement">Encaisser un paiement</button></div>

      <div class="card" style="padding:0;overflow:hidden;display:flex;align-items:stretch;min-height:520px">
        <div style="width:380px;flex:none;border-right:1px solid var(--hairline);display:flex;flex-direction:column;min-width:0">
          <div style="padding:16px 18px 13px;border-bottom:1px solid var(--hairline);display:flex;flex-direction:column;gap:11px">
            <input id="reg-q" data-act="chercherReglements" data-evt="input" data-a1="@value"
                   placeholder="Résident, référence, moyen" value="${esc(REG_Q)}" style="width:100%">
            <div style="display:flex;gap:6px;flex-wrap:wrap">${puces}</div>
            <div id="reg-compte" class="muted" style="font-size:12px"></div>
          </div>
          <div id="reg-liste" style="flex:1;overflow:auto"></div>
        </div>
        <div id="reg-fiche" style="flex:1;min-width:0;background:var(--ivoire)"></div>
      </div>
      <div id="remises-zone"></div>`;

    majListeReglements();
    majFicheReglement();
    chargerRemises();
  }
}

if (!fs.existsSync(CIBLE)) echec('backend/public/app.js introuvable. Lancez depuis la racine du projet.');
let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('window.ouvrirReglement') !== -1) {
  console.log('\n  L\'ecran Reglements est deja en liste + fiche — rien a faire.\n');
  process.exit(0);
}
if (src.indexOf('function regleRef') === -1) echec('regleRef est introuvable — les regles de reference en dependent.');
if (src.indexOf('async function chargerRemises') === -1) echec('chargerRemises est introuvable — les remises en dependent.');
if (src.indexOf('window.ouvrirFacture') === -1) {
  echec('outils/factures-liste-fiche.js n\'a pas ete applique : la fiche renvoie vers une facture.');
}

const DEBUT = 'async function vueReglements() {';
const FIN = '// Remises en banque : un bordereau par moyen de paiement';
const i = src.indexOf(DEBUT);
const j = src.indexOf(FIN);
if (i === -1) echec('vueReglements introuvable dans app.js.');
if (j === -1 || j < i) echec('La borne de fin (chargerRemises) est introuvable ou mal placee.');

const ancien = src.slice(i, j);
if (ancien.length > 9000) echec(`Le bloc a remplacer fait ${ancien.length} caracteres — trop gros, app.js a change.`);
if (ancien.indexOf('lettrage automatique') === -1) echec('Le bloc repere ne ressemble pas a l\'ancienne vue Reglements.');
if (ancien.indexOf('async function vue') !== ancien.lastIndexOf('async function vue')) {
  echec('Le bloc repere contient plusieurs vues — bornes invalides.');
}
/* Le bouton au libelle-mode-d'emploi ne vit que la : sa disparition prouve
   que le bon bloc a ete remplace. */
const BTN = '<div class="full"><button class="btn btn-primary">Encaisser (lettrage automatique)</button></div>';
if (src.split(BTN).length - 1 !== 1) echec('L\'ancien bouton d\'encaissement est introuvable ou duplique.');

const CODE = NOUVEAU_CODE.toString()
  .replace(/^function NOUVEAU_CODE\(\)\s*\{\r?\n/, '')
  .replace(/\}\s*$/, '')
  .replace(/^ {2}/gm, '');

src = src.slice(0, i) + CODE.replace(/\s*$/, '\n') + '\n' + src.slice(j);

/* Meme correction dans le tiroir d'encaissement d'une fiche client : un
   bouton dit ce qu'il fait, l'explication vit sous lui. */
const BTN2 = '<div class="full"><button class="btn btn-primary btn-block">Encaisser (lettrage automatique)</button></div>';
const BTN2_NEUF = '<div class="full"><button class="btn btn-primary btn-block">Encaisser</button>'
  + '\n        <p class="muted" style="margin:8px 0 0;font-size:12px">Le lettrage se fait tout seul, de la facture la plus ancienne a la plus recente.</p></div>';
if (src.split(BTN2).length - 1 !== 1) echec('Le bouton du tiroir d\'encaissement est introuvable ou duplique.');
src = src.split(BTN2).join(BTN2_NEUF);

try { new Function(src); }
catch (e) { echec('Le resultat n\'est pas du JavaScript valide — ' + e.message); }

for (const [quoi, aiguille] of [
  ['la vue Reglements', 'async function vueReglements()'],
  ['la selection', 'window.ouvrirReglement'],
  ['les filtres', 'window.filtrerReglements'],
  ['la recherche', 'window.chercherReglements'],
  ['le formulaire au tiroir', 'window.formReglement'],
  ['la garde de reference obligatoire', 'regle.requis && !String(body.reference'],
  ['l\'alerte de doublon', 'doublonProbable'],
  ['les remises', 'chargerRemises();'],
]) if (src.indexOf(aiguille) === -1) echec(`Verification : ${quoi} est absent du resultat.`);

if (src.indexOf(BTN) !== -1) echec('L\'ancien formulaire de saisie subsiste.');

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('window.ouvrirReglement') === -1) echec('L\'ajout est absent apres ecriture.');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Reglements : saisie dans le tiroir, journal en liste + fiche.');
console.log('  La fiche montre les factures payees par le reglement, et ce qui reste en avance.');
console.log('  Filtres comptes : tous, avances, ce mois ; recherche resident / reference / moyen.');
console.log('  Garde-fous conserves : reference selon le type de moyen, alerte de doublon, resident explicite.');
console.log('  Remises en banque : inchangees.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

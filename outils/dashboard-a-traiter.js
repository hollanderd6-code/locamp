#!/usr/bin/env node
/* ============================================================
   outils/dashboard-a-traiter.js
   Tableau de bord : ce qui demande une decision aujourd'hui
   ============================================================
   Cible : backend/public/app.js  (remplace vueDashboard)

   ── CE QUI CHANGE ───────────────────────────────────────────────
   Avant : deux longs tableaux — huit factures en retard, dix
   echeances — plus une bande d'alertes, plus des compteurs de fin de
   mois. Sur un camping complet, cela donnait des dizaines de lignes
   quasi identiques (meme date, meme « dans 5 j », meme bouton) : une
   liste, pas un tableau de bord. Et le mur de « 0,00 € » des mois
   calmes laissait croire que rien n'etait calcule.

   Apres, une seule question : qu'est-ce qui demande une decision
   aujourd'hui ?

   1. « A traiter » rassemble en UNE liste ce qui reclame une action,
      classe par urgence : impayes en retard, attestations manquantes ou
      expirees, contrats a renouveler, messages non lus, prestations a
      facturer. Chaque ligne porte son action — celle qui existait deja
      dans les anciens tableaux, jamais une inventee.
   2. Les impayes se resument en UNE ligne (n factures, montant, plus
      ancien retard) au lieu de huit : le detail a son ecran, qui est
      desormais fait pour ca.
   3. Un bandeau de quatre chiffres, l'encaissement du mois avec son
      reste a encaisser, et l'occupation par secteur.
   4. Un montant nul s'ecrit « — ». Un etat vide se dit avec une phrase,
      pas avec un zero comptable.
   5. Le surtitre « VUE D'ENSEMBLE » disparait : quatre series de
      capitales espacees se disputaient la hierarchie.

   Aucun changement backend : /api/dashboard, /api/relances/impayes,
   /api/prestations, /api/messages/non-lus, /api/residents,
   /api/echeances, /api/emplacements.

   Usage :
     node outils/dashboard-a-traiter.js --essai
     node outils/dashboard-a-traiter.js
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
  /* ---------- Tableau de bord : ce qui demande une decision ---------- */
  const DSH_AMBRE = '#7A5A22';
  const dshEur = (n) => (Math.abs(Number(n || 0)) < 0.005 ? '—' : eur(n));

  async function vueDashboard() {
    const [d, imp, presRes, msgRes, { residents }, echRes, empRes] = await Promise.all([
      api('/api/dashboard' + exQS()),
      api('/api/relances/impayes' + exQS()).catch(() => null),
      api('/api/prestations?statut=en_cours').catch(() => ({ prestations: [] })),
      api('/api/messages/non-lus').catch(() => ({ total: 0 })),
      api('/api/residents').catch(() => ({ residents: [] })),
      api('/api/echeances?horizon=60').catch(() => ({ echeances: [] })),
      api('/api/emplacements').catch(() => ({ emplacements: [] })),
    ]);
    const echeances = echRes.echeances || [];
    const rmap = {}; residents.forEach((r) => { rmap[r.id] = `${r.prenom || ''} ${r.nom}`.trim(); });
    const aFacturer = (presRes.prestations || []).filter((p) => p.type !== 'caution')
      .reduce((s, p) => s + Number(p.montant_ttc), 0);
    const nbAFacturer = (presRes.prestations || []).filter((p) => p.type !== 'caution').length;
    const enRetard = imp ? imp.impayes.filter((f) => f.en_retard) : [];
    const montantRetard = enRetard.reduce((s, f) => s + Number(f.reste || 0), 0);
    const pireRetard = enRetard.reduce((m, f) => Math.max(m, f.jours_retard || 0), 0);
    const debiteurs = new Set(enRetard.map((f) => f.resident_id)).size;

    /* Encaisse ce mois : la somme des encaissements par mode. Le compare
       au facture donne le reste a encaisser — ce qu'un « CA facture »
       seul ne disait pas. */
    const encaisse = Object.values(d.encaissements_mois || {})
      .reduce((s, v) => s + Number(v || 0), 0);
    const facture = Number(d.ca_mois || 0);
    const pc = facture > 0.005 ? Math.min(100, Math.round((encaisse / facture) * 100)) : 0;

    /* ---- A traiter : une seule liste, classee par urgence ----
       Chaque entree porte l'action qui existait deja dans les anciens
       tableaux. Rien d'invente : ce qui n'a pas d'action ouvre l'ecran
       qui en a une. */
    const aTraiter = [];

    if (enRetard.length) {
      aTraiter.push({
        pt: 'var(--rouge)',
        titre: `${enRetard.length} facture${enRetard.length > 1 ? 's' : ''} en retard · ${eur(montantRetard)}`,
        sous: `${debiteurs} débiteur${debiteurs > 1 ? 's' : ''}${pireRetard ? ' · la plus ancienne de ' + pireRetard + ' j' : ''}`,
        act: `<button class="btn btn-primary btn-sm" data-act="relancerImpayes">Relancer</button>
              <button class="btn btn-ghost btn-sm" data-act="allerA" data-a1="#/impayes">Détail</button>`,
      });
    }

    const urgence = (x) => (x.statut === 'manquante' ? 0 : x.statut === 'expiree' ? 1
      : (x.jours_restants != null && x.jours_restants <= 7) ? 2 : 3);
    const ech = echeances.slice().sort((a, b) => urgence(a) - urgence(b)
      || Number(a.jours_restants || 0) - Number(b.jours_restants || 0));

    for (const x of ech.slice(0, 6)) {
      const quoi = x.type === 'assurance' ? 'Attestation d\u2019assurance'
        : x.type === 'document' ? `Document « ${esc((x.titre || '').slice(0, 34))} »`
          : `Contrat ${esc(x.contrat_numero || '')}`;
      const etat = x.statut === 'manquante' ? 'aucune attestation'
        : x.statut === 'expiree' ? 'expirée le ' + dfr(x.echeance)
          : `échéance dans ${x.jours_restants} j${x.echeance ? ' · ' + dfr(x.echeance) : ''}`;
      const act = x.type === 'contrat'
        ? `<button class="btn btn-ghost btn-sm" data-act="renouvelerContrat" data-a1="${x.contrat_id}" title="Duplique le contrat pour la période suivante puis l\u2019envoie en signature">Renouveler</button>`
        : x.type === 'document'
          ? '<button class="btn btn-ghost btn-sm" data-act="allerA" data-a1="#/signatures" title="Déposer la nouvelle version à signer">Voir / refaire</button>'
          : (x.resident_id ? `<button class="btn btn-ghost btn-sm" data-act="ouvrirConversation" data-a1="${x.resident_id}">Écrire</button>` : '');
      aTraiter.push({
        pt: urgence(x) <= 1 ? 'var(--rouge)' : DSH_AMBRE,
        titre: `${quoi} — ${esc(x.resident_nom || rmap[x.resident_id] || 'résident')}`,
        sous: etat,
        act,
      });
    }

    if (msgRes.total) {
      aTraiter.push({
        pt: DSH_AMBRE,
        titre: `${msgRes.total} message${msgRes.total > 1 ? 's' : ''} non lu${msgRes.total > 1 ? 's' : ''}`,
        sous: 'des résidents attendent une réponse',
        act: '<button class="btn btn-ghost btn-sm" data-act="allerA" data-a1="#/messagerie">Lire</button>',
      });
    }

    if (aFacturer > 0.005) {
      aTraiter.push({
        pt: 'var(--sapin)',
        titre: `${eur(aFacturer)} de prestations à facturer`,
        sous: `${nbAFacturer} ligne${nbAFacturer > 1 ? 's' : ''} en cours — relevés, ventes, charges`,
        act: '<button class="btn btn-ghost btn-sm" data-act="allerA" data-a1="#/factures">Facturer</button>',
      });
    }

    if (d.alertes.documents_expirant) {
      aTraiter.push({
        pt: DSH_AMBRE,
        titre: `${d.alertes.documents_expirant} document${d.alertes.documents_expirant > 1 ? 's' : ''} à renouveler sous 30 jours`,
        sous: 'attestations et pièces des résidents',
        act: '<button class="btn btn-ghost btn-sm" data-act="echRappels" title="Notifie le staff et écrit aux résidents concernés (paliers 60/30/7/0 j, jamais deux fois le même rappel)">Envoyer les rappels</button>',
      });
    }

    /* ---- Occupation par secteur : lue sur les emplacements reels ---- */
    const secteurs = new Map();
    for (const e of (empRes.emplacements || [])) {
      const k = e.secteur || 'Sans secteur';
      const s = secteurs.get(k) || { nom: k, total: 0, occ: 0 };
      s.total += 1;
      if (typeof statutReel === 'function' ? statutReel(e) === 'occupe' : !!e.resident) s.occ += 1;
      secteurs.set(k, s);
    }
    const parSecteur = [...secteurs.values()].sort((a, b) => b.total - a.total).slice(0, 6);

    const chiffres = [
      { k: 'Occupation', v: `${d.occupation.occupes} / ${d.occupation.total}`,
        n: `${d.occupation.taux} %${d.occupation.total - d.occupation.occupes ? ' · ' + (d.occupation.total - d.occupation.occupes) + ' libre' + (d.occupation.total - d.occupation.occupes > 1 ? 's' : '') : ' · complet'}`, col: '' },
      { k: 'Facturé ce mois', v: dshEur(facture), n: `${d.factures_mois.total} facture${d.factures_mois.total > 1 ? 's' : ''} émise${d.factures_mois.total > 1 ? 's' : ''}`, col: '' },
      { k: 'Impayés', v: dshEur(d.impayes.total_du),
        n: d.impayes.nombre ? `${d.impayes.nombre} facture${d.impayes.nombre > 1 ? 's' : ''}${montantRetard > 0.005 ? ' · dont ' + eur(montantRetard) + ' en retard' : ''}` : 'rien à recouvrer',
        col: Number(d.impayes.total_du || 0) > 0.005 ? 'var(--rouge)' : '' },
      { k: 'À facturer', v: dshEur(aFacturer),
        n: nbAFacturer ? `${nbAFacturer} prestation${nbAFacturer > 1 ? 's' : ''} en cours` : 'rien en attente',
        col: aFacturer > 0.005 ? DSH_AMBRE : '' },
    ];

    const dateStr = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

    $('#main').innerHTML = `
      <div class="page-head">
        <div><h1>${dateStr.charAt(0).toUpperCase() + dateStr.slice(1)}</h1>
          <div class="muted" style="font-size:13.5px;margin-top:4px">
            ${aTraiter.length ? `${aTraiter.length} point${aTraiter.length > 1 ? 's' : ''} à traiter` : 'rien à traiter aujourd\u2019hui'}
          </div></div>
        <div class="toolbar">
          <button class="btn btn-ghost btn-sm" data-act="messageGroupe">Message à tous</button>
          <button class="btn btn-ghost btn-sm" data-act="messageRapide">Message à un résident</button>
        </div>
      </div>

      <div class="card" style="display:flex;padding:0;margin-bottom:16px">
        ${chiffres.map((c, i) => `
          <div style="flex:1;padding:14px 18px;${i ? 'border-left:1px solid var(--hairline)' : ''}">
            <div style="font-size:11.5px;font-weight:600;letter-spacing:.09em;color:var(--brume);text-transform:uppercase">${c.k}</div>
            <div style="font-size:24px;margin-top:5px;font-variant-numeric:tabular-nums;${c.col ? 'color:' + c.col + ';font-weight:600' : ''}">${c.v}</div>
            <div class="muted" style="font-size:12px;margin-top:2px">${c.n}</div>
          </div>`).join('')}
      </div>

      <div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">
        <div class="card" style="flex:1.35;min-width:420px;padding:0;overflow:hidden">
          <div style="padding:14px 18px;border-bottom:1px solid var(--hairline);display:flex;
                      align-items:center;justify-content:space-between;gap:12px">
            <h2 style="margin:0;font-size:16px">À traiter</h2>
            ${echeances.length > 6 ? `<span class="muted" style="font-size:12.5px">${echeances.length - 6} autre${echeances.length - 6 > 1 ? 's' : ''} échéance${echeances.length - 6 > 1 ? 's' : ''} sous 60 j</span>` : ''}
          </div>
          ${aTraiter.length ? aTraiter.map((t) => `
            <div style="display:flex;align-items:center;gap:12px;padding:0 18px;height:66px;
                        border-bottom:1px solid var(--hairline)">
              <span style="width:7px;height:7px;border-radius:50%;flex:none;background:${t.pt}"></span>
              <div style="flex:1;min-width:0">
                <div style="font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.titre}</div>
                <div class="muted" style="font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.sous}</div>
              </div>
              <div style="flex:none;display:flex;gap:6px">${t.act}</div>
            </div>`).join('')
    : `<p class="muted" style="padding:22px 18px;margin:0">Rien à traiter : les loyers sont encaissés, les contrats à jour, les messages lus.</p>`}
        </div>

        <div style="flex:1;min-width:300px;display:flex;flex-direction:column;gap:16px">
          <div class="card">
            <h2 style="margin:0;font-size:16px">Encaissements du mois</h2>
            <div style="display:flex;align-items:baseline;gap:9px;margin-top:9px">
              <div style="font-size:26px;font-variant-numeric:tabular-nums">${dshEur(encaisse)}</div>
              <div class="muted" style="font-size:12.5px">${facture > 0.005 ? 'sur ' + eur(facture) + ' facturés' : 'rien facturé ce mois'}</div>
            </div>
            ${facture > 0.005 ? `
              <div style="height:7px;border-radius:5px;background:var(--hairline);margin-top:11px;overflow:hidden;display:flex">
                <div style="width:${pc}%;background:var(--sapin)"></div>
              </div>
              <div style="display:flex;justify-content:space-between;font-size:12px;margin-top:7px">
                <span class="muted">${pc} % encaissé</span>
                ${facture - encaisse > 0.005 ? `<span style="color:var(--rouge);font-weight:600">${eur(facture - encaisse)} restant</span>` : '<span style="color:var(--sapin);font-weight:600">tout est encaissé</span>'}
              </div>` : ''}
            ${Object.keys(d.encaissements_mois || {}).length ? `
              <div style="margin-top:14px;display:flex;flex-direction:column;gap:7px">
                ${Object.entries(d.encaissements_mois).map(([k, v]) => `
                  <div style="display:flex;justify-content:space-between;font-size:13px">
                    <span class="muted">${esc(lib(k))}</span>
                    <span style="font-variant-numeric:tabular-nums">${eur(v)}</span>
                  </div>`).join('')}
              </div>` : ''}
          </div>

          ${parSecteur.length ? `
          <div class="card" style="padding:0;overflow:hidden">
            <div style="padding:14px 18px;border-bottom:1px solid var(--hairline)">
              <h2 style="margin:0;font-size:16px">Occupation par secteur</h2>
            </div>
            <div style="padding:14px 18px;display:flex;flex-direction:column;gap:13px">
              ${parSecteur.map((s) => {
    const p = s.total ? Math.round((s.occ / s.total) * 100) : 0;
    return `
                <div>
                  <div style="display:flex;justify-content:space-between;font-size:13px">
                    <span>${esc(s.nom)}</span>
                    <span class="muted" style="font-variant-numeric:tabular-nums">${s.occ} / ${s.total}</span>
                  </div>
                  <div style="height:6px;border-radius:4px;background:var(--hairline);margin-top:6px;overflow:hidden;display:flex">
                    <div style="width:${p}%;background:${p === 100 ? 'var(--sapin)' : DSH_AMBRE}"></div>
                  </div>
                </div>`;
  }).join('')}
            </div>
          </div>` : ''}
        </div>
      </div>`;
  }
}

if (!fs.existsSync(CIBLE)) echec('backend/public/app.js introuvable. Lancez depuis la racine du projet.');
let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('/* ---------- Tableau de bord : ce qui demande une decision ---------- */') !== -1) {
  console.log('\n  Le tableau de bord est deja repris — rien a faire.\n');
  process.exit(0);
}
for (const fn of ['relancerImpayes', 'echRappels', 'renouvelerContrat', 'ouvrirConversation',
  'messageGroupe', 'messageRapide']) {
  if (src.indexOf('window.' + fn) === -1) echec(`window.${fn} est introuvable — le tableau de bord en depend.`);
}
if (src.indexOf('function statutReel') === -1) echec('statutReel est introuvable — l\'occupation par secteur en depend.');

const DEBUT = 'async function vueDashboard() {';
const FIN = 'window.echRappels = async () => {';
const i = src.indexOf(DEBUT);
const j = src.indexOf(FIN);
if (i === -1) echec('vueDashboard introuvable dans app.js.');
if (j === -1 || j < i) echec('La borne de fin (echRappels) est introuvable ou mal placee.');

const ancien = src.slice(i, j);
if (ancien.length > 9000) echec(`Le bloc a remplacer fait ${ancien.length} caracteres — trop gros, app.js a change.`);
if (ancien.indexOf('Vue d\'ensemble') === -1) echec('Le bloc repere ne ressemble pas a l\'ancien tableau de bord.');
if (ancien.indexOf('async function vue') !== ancien.lastIndexOf('async function vue')) {
  echec('Le bloc repere contient plusieurs vues — bornes invalides.');
}
/* Les deux tableaux de l'ancien ecran ne vivent que la : leur disparition
   prouve que le bon bloc a ete remplace. */
const T1 = '<h2>Factures en retard</h2>';
const T2 = '<h2>Échéances — assurances &amp; contrats</h2>';
for (const [t, n] of [[T1, 'Factures en retard'], [T2, 'Echeances']]) {
  if (src.split(t).length - 1 !== 1) echec(`Le tableau « ${n} » est introuvable ou duplique.`);
}

const CODE = NOUVEAU_CODE.toString()
  .replace(/^function NOUVEAU_CODE\(\)\s*\{\r?\n/, '')
  .replace(/\}\s*$/, '')
  .replace(/^ {2}/gm, '');

src = src.slice(0, i) + CODE.replace(/\s*$/, '\n') + '\n' + src.slice(j);

try { new Function(src); }
catch (e) { echec('Le resultat n\'est pas du JavaScript valide — ' + e.message); }

for (const [quoi, aiguille] of [
  ['la vue Tableau de bord', 'async function vueDashboard()'],
  ['la liste A traiter', '>À traiter</h2>'],
  ['la relance des impayes', 'data-act="relancerImpayes"'],
  ['le renouvellement de contrat', 'data-act="renouvelerContrat"'],
  ['les rappels d\'echeance', 'data-act="echRappels"'],
  ['l\'occupation par secteur', 'Occupation par secteur'],
]) if (src.indexOf(aiguille) === -1) echec(`Verification : ${quoi} est absent du resultat.`);

for (const [t, n] of [[T1, 'Factures en retard'], [T2, 'Echeances']]) {
  if (src.indexOf(t) !== -1) echec(`L'ancien tableau « ${n} » subsiste.`);
}
if (src.indexOf('>Vue d\'ensemble<') !== -1) echec('Le surtitre subsiste.');

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('>À traiter</h2>') === -1) echec('L\'ajout est absent apres ecriture.');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Tableau de bord : une liste « A traiter », classee par urgence, chaque ligne avec son action.');
console.log('  Les 8 factures en retard deviennent une ligne ; le detail vit dans Impayes.');
console.log('  Bandeau de 4 chiffres, encaissements du mois avec reste a encaisser, occupation par secteur.');
console.log('  Montants nuls en tiret ; surtitre retire.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

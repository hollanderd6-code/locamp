process.env.SUPABASE_URL ||= 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test';
process.env.JWT_SECRET ||= 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeTotals } = require('../lib/facturation');
const { ligne, ventiler, PLAN_DEFAUT } = require('../lib/export-compta');

/* ============================================================
   Le piège des AVOIRS.

   Un avoir est créé avec des lignes à prix unitaire NÉGATIF
   (cf. routes/factures.js). Ses total_ht / total_tva / total_ttc
   sont donc DÉJÀ négatifs.

   => Tout code qui applique en plus un `signe = avoir ? -1 : 1`
      INVERSE le montant : l'avoir gonfle le CA au lieu de le réduire.
      Ces tests verrouillent cette règle.
   ============================================================ */

const r2 = (n) => Math.round(n * 100) / 100;

test('AVOIR — les montants sont déjà négatifs (fondement de tous les autres tests)', () => {
  const t = computeTotals([{ designation: 'Avoir — Loyer', quantite: 1, pu_ht: -300, taux_tva: 10 }]);
  assert.equal(t.total_ht, -300);
  assert.equal(t.total_tva, -30);
  assert.equal(t.total_ttc, -330);
});

test('AVOIR — appliquer un signe -1 inverserait le montant (le bug à ne jamais réintroduire)', () => {
  const avoir = { total_ttc: -330 };
  const correct = avoir.total_ttc;              // on prend tel quel
  const bugue = -1 * avoir.total_ttc;           // double négation
  assert.equal(correct, -330, 'un avoir doit RÉDUIRE le total');
  assert.equal(bugue, 330);
  assert.notEqual(correct, bugue, 'le signe supplémentaire inverse bien le montant');
});

// ---- Clôture fiscale : facture + avoir doivent s'annuler ----
function totauxCloture(factures) {
  // reproduit lib/fiscal.js cloturer() : aucun signe supplémentaire
  return factures.reduce((acc, f) => ({
    ht: r2(acc.ht + Number(f.total_ht || 0)),
    tva: r2(acc.tva + Number(f.total_tva || 0)),
    ttc: r2(acc.ttc + Number(f.total_ttc || 0)),
  }), { ht: 0, tva: 0, ttc: 0 });
}

test('CLÔTURE — une facture annulée par son avoir donne un CA nul', () => {
  const factures = [
    { statut: 'annulee', total_ht: 300, total_tva: 30, total_ttc: 330 },  // facture d'origine
    { statut: 'avoir', total_ht: -300, total_tva: -30, total_ttc: -330 }, // son avoir
  ];
  const t = totauxCloture(factures);
  assert.equal(t.ttc, 0, 'facture + avoir = 0 (le cumul perpétuel serait faux sinon)');
  assert.equal(t.ht, 0);
  assert.equal(t.tva, 0);
});

test('CLÔTURE — exclure la facture annulée fausserait le total', () => {
  const toutes = [
    { statut: 'annulee', total_ttc: 330 },
    { statut: 'avoir', total_ttc: -330 },
    { statut: 'emise', total_ttc: 500 },
  ];
  const correct = totauxCloture(toutes).ttc;
  const bugue = totauxCloture(toutes.filter((f) => f.statut !== 'annulee')).ttc;
  assert.equal(correct, 500, 'CA réel = seule la facture émise');
  assert.equal(bugue, 170, 'en excluant l\u2019annulée, l\u2019avoir ampute à tort le CA');
  assert.notEqual(correct, bugue);
});

// ---- Relevé de compte : solde progressif ----
function soldeProgressif(mouvements) {
  let solde = 0;
  return mouvements.map((m) => {
    solde = r2(solde + (m.debit || 0) - (m.credit || 0));
    return { ...m, solde };
  });
}

test('RELEVÉ — solde progressif : facture, paiement partiel, avoir', () => {
  const l = soldeProgressif([
    { debit: 500, credit: 0 },   // facture
    { debit: 0, credit: 300 },   // paiement partiel
    { debit: -200, credit: 0 },  // avoir (déjà négatif)
    { debit: 0, credit: 100 },   // solde du reste
  ]);
  assert.deepEqual(l.map((x) => x.solde), [500, 200, 0, -100]);
  assert.equal(l[3].solde, -100, 'le client est en crédit de 100 €');
});

test('RELEVÉ — report d\'année : le solde de clôture devient le report suivant', () => {
  const mvts2025 = [{ debit: 500, credit: 0 }, { debit: 0, credit: 300 }];
  const fin2025 = soldeProgressif(mvts2025).pop().solde;
  assert.equal(fin2025, 200);

  let solde = fin2025;   // report à nouveau
  [{ debit: 400, credit: 0 }, { debit: 0, credit: 400 }].forEach((m) => {
    solde = r2(solde + m.debit - m.credit);
  });
  assert.equal(solde, 200, 'le report est bien conservé d\u2019une année sur l\u2019autre');
});

// ---- Export comptable : format à colonnes fixes ----
test('EXPORT — ligne de 142 caractères, format exact du logiciel comptable', () => {
  const l = ligne({ piece: 1, journal: 'VT', date: '20260601', numero: '686',
    compte: '41106002', libelle: 'Facture 686 FOUQUET Jean-Pierre',
    montant: 477.39, sens: 'D', nom: 'FOUQUET Jean-Pierre' });
  assert.equal(l.length, 142);
  assert.equal(l.slice(0, 5), '00001');       // pièce sur 5, zéros à gauche
  assert.equal(l.slice(5, 7), 'VT');          // journal
  assert.equal(l.slice(7, 15), '20260601');   // date AAAAMMJJ
  assert.equal(l.slice(71, 84), '0000000477,39'); // montant, virgule décimale
  assert.equal(l.slice(84, 85), 'D');         // sens
});

test('EXPORT — un montant négatif bascule au débit (contrepassation)', () => {
  const mt = -330;
  const sens = mt >= 0 ? 'C' : 'D';
  assert.equal(sens, 'D', 'un produit négatif (avoir) se débite');
  const l = ligne({ piece: 2, journal: 'VT', date: '20260601', compte: '706000',
    libelle: 'Ventes du 01/06/2026', montant: mt, sens, nom: 'Résident' });
  assert.equal(l.slice(71, 84), '0000000330,00', 'le montant est écrit en valeur absolue');
  assert.equal(l.slice(84, 85), 'D');
});

test('EXPORT — ventilation par mot-clé', () => {
  assert.equal(ventiler('Taxe de séjour (2 pers. × 31 nuits)', PLAN_DEFAUT).compte, '708021');
  assert.equal(ventiler('Bouteille de gaz', PLAN_DEFAUT).compte, '707001');
  assert.equal(ventiler('Loyer emplacement — juillet 2026', PLAN_DEFAUT).compte, '706000');
  assert.equal(ventiler('Article inconnu', PLAN_DEFAUT).compte, PLAN_DEFAUT.compte_produit_defaut);
});

// ---- Taxe de séjour ----
test('TAXE — un avoir sort en négatif au relevé (justificatif collectivité)', () => {
  const montant = -20.15;                 // ligne d'avoir, déjà négative
  const negatif = montant < 0;
  const nuitees = negatif ? -Math.abs(31) : 31;
  const personnes = negatif ? -Math.abs(1) : 1;
  assert.equal(montant, -20.15);
  assert.equal(nuitees, -31);
  assert.equal(personnes, -1);
  assert.equal(r2(nuitees * 0.65), montant, 'nuitées × tarif = montant, signes cohérents');
});

test('TAXE — nuitées = personnes × nuits, montant = nuitées × tarif (chiffres réels Inaxel)', () => {
  const cas = [
    { pers: 2, nuits: 30, nuitees: 60, montant: 39.00 },
    { pers: 1, nuits: 31, nuitees: 31, montant: 20.15 },
    { pers: 3, nuits: 30, nuitees: 90, montant: 58.50 },
  ];
  for (const c of cas) {
    assert.equal(c.pers * c.nuits, c.nuitees);
    assert.equal(r2(c.nuitees * 0.65), c.montant);
  }
});

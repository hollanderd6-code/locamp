process.env.SUPABASE_URL ||= 'https://test.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test'; process.env.JWT_SECRET ||= 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeTotals, buildLignes, htDepuisTtc } = require('../lib/facturation');

const r2 = (n) => Math.round(n * 100) / 100;

test('htDepuisTtc — dérive le HT depuis un TTC', () => {
  assert.equal(htDepuisTtc(120, 20), 100);      // 120 TTC @20% -> 100 HT
  assert.equal(htDepuisTtc(100, 0), 100);       // 0% -> inchangé
  assert.equal(htDepuisTtc(110, 10), 100);      // @10%
});

test('computeTotals — ligne HT simple, TVA 0%', () => {
  const t = computeTotals([{ designation: 'Loyer', quantite: 1, pu_ht: 300, taux_tva: 0 }]);
  assert.equal(t.total_ht, 300);
  assert.equal(t.total_tva, 0);
  assert.equal(t.total_ttc, 300);
});

test('computeTotals — TVA 20% et quantité', () => {
  const t = computeTotals([{ designation: 'Gaz', quantite: 2, pu_ht: 19.17, taux_tva: 20 }]);
  assert.equal(t.total_ht, 38.34);
  assert.equal(t.total_tva, 7.67);              // 38.34 * 0.20 = 7.668 -> 7.67
  assert.equal(t.total_ttc, 46.01);
});

test('computeTotals — saisie TTC prioritaire, HT dérivé', () => {
  const t = computeTotals([{ designation: 'Forfait', quantite: 1, pu_ttc: 120, taux_tva: 20 }]);
  assert.equal(t.total_ht, 100);                // 120 TTC -> 100 HT
  assert.equal(t.total_tva, 20);
  assert.equal(t.total_ttc, 120);
});

test('computeTotals — multi-taux, TTC = HT + TVA', () => {
  const t = computeTotals([
    { designation: 'Loyer', quantite: 1, pu_ht: 558.35, taux_tva: 0 },
    { designation: 'Charges', quantite: 1, pu_ht: 52.13, taux_tva: 10 },
    { designation: 'Gaz', quantite: 2, pu_ht: 19.17, taux_tva: 20 },
  ]);
  // HT = 558.35 + 52.13 + 38.34 = 648.82
  assert.equal(t.total_ht, 648.82);
  // TVA = 0 + 5.213->5.21 + 7.668->7.67 = 12.88
  assert.equal(t.total_tva, 12.88);
  assert.equal(t.total_ttc, r2(t.total_ht + t.total_tva));
  // invariant fondamental : TTC == HT + TVA
  assert.equal(t.total_ttc, 661.7);
});

test('computeTotals — liste vide', () => {
  const t = computeTotals([]);
  assert.deepEqual([t.total_ht, t.total_tva, t.total_ttc], [0, 0, 0]);
});

test('computeTotals — déduit les nuits depuis les dates', () => {
  const t = computeTotals([{ designation: 'Séjour', quantite: 1, pu_ht: 100, taux_tva: 0, date_debut: '2026-07-01', date_fin: '2026-07-31' }]);
  assert.equal(t.lignes[0].nuits, 30);
});

// ---- buildLignes : prorata ----
const paramsLoyer = { facturation: { tva_taux_loyer: 0 } };

test('buildLignes — mois plein : loyer entier', () => {
  const l = buildLignes({ montant_mensuel: 420, date_debut: '2026-01-01', date_fin: null }, {}, '2026-07', paramsLoyer);
  const t = computeTotals(l);
  assert.equal(t.total_ttc, 420);
  assert.equal(l[0].nuits, 31);
});

test('buildLignes — prorata entrée le 16/07 (16 jours sur 31)', () => {
  const l = buildLignes({ montant_mensuel: 420, date_debut: '2026-07-16', date_fin: null }, {}, '2026-07', paramsLoyer);
  // 420 * 16/31 = 216.774 -> 216.77
  assert.equal(r2(l[0].pu_ttc), 216.77);
  assert.match(l[0].designation, /prorata 16\/31/);
});

test('buildLignes — taxe de séjour ajoutée si active', () => {
  const params = { facturation: { tva_taux_loyer: 0 }, taxe_sejour: { actif: true, tarif_nuit_personne: 0.66 } };
  const l = buildLignes({ montant_mensuel: 300, date_debut: '2026-01-01', date_fin: null }, { foyer: { occupants: 2 } }, '2026-07', params);
  // 2 pers * 31 nuits * 0.66 = 40.92
  const taxe = l.find((x) => /Taxe de séjour/.test(x.designation));
  assert.ok(taxe, 'ligne taxe présente');
  assert.equal(r2(taxe.pu_ht), 40.92);
});

test('buildLignes — pas de loyer si montant nul', () => {
  const l = buildLignes({ montant_mensuel: 0 }, {}, '2026-07', paramsLoyer);
  assert.equal(l.length, 0);
});
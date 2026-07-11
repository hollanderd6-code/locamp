process.env.SUPABASE_URL ||= 'https://test.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test'; process.env.JWT_SECRET ||= 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeSupabaseMock } = require('./helpers-mock');
const { fmtNum, fmtDate, toFEC, FEC_COLS } = require('../lib/comptabilite');

test('fmtNum — virgule décimale, 2 décimales (norme FEC)', () => {
  assert.equal(fmtNum(300), '300,00');
  assert.equal(fmtNum(40.92), '40,92');    // 2 décimales
  assert.equal(fmtNum(7.668), '7,67');     // arrondi au centime supérieur
  assert.equal(fmtNum(0), '0,00');
  assert.equal(fmtNum(1234.5), '1234,50'); // pas de séparateur de milliers
});

test('fmtDate — format AAAAMMJJ', () => {
  assert.equal(fmtDate('2026-07-01'), '20260701');
  assert.equal(fmtDate(''), '');
});

test('FEC — 18 colonnes normalisées', () => {
  assert.equal(FEC_COLS.length, 18);
  assert.equal(FEC_COLS[0], 'JournalCode');
});

test('toFEC — entête tabulé + une ligne', () => {
  const lignes = [{ JournalCode: 'VE', JournalLib: 'Ventes', EcritureNum: 1, EcritureDate: '20260701',
    CompteNum: '411000', CompteLib: 'Clients', CompAuxNum: '41100001', CompAuxLib: 'Dupont',
    PieceRef: 'F-1', PieceDate: '20260701', EcritureLib: 'Facture F-1', Debit: '300,00', Credit: '0,00',
    EcritureLet: '', DateLet: '', ValidDate: '20260701', Montantdevise: '', Idevise: '' }];
  const out = toFEC(lignes).split('\r\n');
  assert.equal(out[0].split('\t').length, 18);
  assert.equal(out[1].split('\t').length, 18);
});

// ---- Équilibre comptable : LE test critique ----
function loadComptaWithStore(store) {
  const mock = makeSupabaseMock(store);
  const supPath = require.resolve('../lib/supabase');
  require.cache[supPath] = { id: supPath, filename: supPath, loaded: true, exports: { supabase: mock } };
  const cpPath = require.resolve('../lib/comptabilite');
  delete require.cache[cpPath];
  return require('../lib/comptabilite');
}
const somme = (lignes, col) => lignes.reduce((s, l) => s + Number(String(l[col]).replace(',', '.')), 0);

test('buildEcritures — écritures équilibrées (débit = crédit) sur facture + règlement', async () => {
  const store = {
    campings: [{ id: 'c1', parametres: {} }],
    residents: [{ id: 'r1', nom: 'Dupont', prenom: 'Marie', compte_comptable: '41100001' }],
    factures: [{ id: 'f1', camping_id: 'c1', resident_id: 'r1', numero: 'F-2026-00001',
      date_emission: '2026-07-05', statut: 'reglee', total_ht: 300, total_tva: 0, total_ttc: 300,
      lignes: [{ designation: 'Loyer', montant_ht: 300, taux_tva: 0 }] }],
    reglements: [{ id: 'g1', camping_id: 'c1', resident_id: 'r1', mode: 'virement', montant: 300,
      date_reglement: '2026-07-10', affectations: [{ facture_id: 'f1', montant: 300 }] }],
  };
  const { buildEcritures } = loadComptaWithStore(store);
  const lignes = await buildEcritures('c1', '2026-01-01', '2026-12-31');
  const debit = Math.round(somme(lignes, 'Debit') * 100) / 100;
  const credit = Math.round(somme(lignes, 'Credit') * 100) / 100;
  assert.ok(lignes.length > 0, 'des écritures sont générées');
  assert.equal(debit, credit, `débit (${debit}) doit égaler crédit (${credit})`);
});

test('buildEcritures — équilibre avec TVA multi-taux', async () => {
  const store = {
    campings: [{ id: 'c1', parametres: {} }],
    residents: [{ id: 'r1', nom: 'M', prenom: 'X', compte_comptable: '41100001' }],
    factures: [{ id: 'f1', camping_id: 'c1', resident_id: 'r1', numero: 'F-2', date_emission: '2026-07-05',
      statut: 'emise', total_ht: 100, total_tva: 20, total_ttc: 120,
      lignes: [{ designation: 'Vente', montant_ht: 100, taux_tva: 20 }] }],
    reglements: [],
  };
  const { buildEcritures } = loadComptaWithStore(store);
  const lignes = await buildEcritures('c1', '2026-01-01', '2026-12-31');
  assert.equal(Math.round(somme(lignes, 'Debit') * 100) / 100, Math.round(somme(lignes, 'Credit') * 100) / 100);
});
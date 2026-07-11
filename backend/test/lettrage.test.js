process.env.SUPABASE_URL ||= 'https://test.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test'; process.env.JWT_SECRET ||= 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const { makeSupabaseMock } = require('./helpers-mock');

// Injecte le mock à la place de ../lib/supabase AVANT de charger paiement.js
function loadPaiementWithStore(store) {
  const mock = makeSupabaseMock(store);
  const supPath = require.resolve('../lib/supabase');
  require.cache[supPath] = { id: supPath, filename: supPath, loaded: true, exports: { supabase: mock } };
  const payPath = require.resolve('../lib/paiement');
  delete require.cache[payPath];
  return require('../lib/paiement');
}

test('autoAffectations — impute sur la plus ancienne facture d\'abord (FIFO)', async () => {
  const store = { factures: [
    { id: 'f1', camping_id: 'c1', resident_id: 'r1', total_ttc: 100, montant_regle: 0, statut: 'emise', date_emission: '2026-05-01' },
    { id: 'f2', camping_id: 'c1', resident_id: 'r1', total_ttc: 100, montant_regle: 0, statut: 'emise', date_emission: '2026-06-01' },
  ] };
  const { autoAffectations } = loadPaiementWithStore(store);
  const aff = await autoAffectations('c1', 'r1', 150);
  // 100 sur f1 (la plus ancienne) + 50 sur f2
  assert.deepEqual(aff, [{ facture_id: 'f1', montant: 100 }, { facture_id: 'f2', montant: 50 }]);
});

test('autoAffectations — ne dépasse pas le reste dû', async () => {
  const store = { factures: [
    { id: 'f1', camping_id: 'c1', resident_id: 'r1', total_ttc: 100, montant_regle: 80, statut: 'partielle', date_emission: '2026-05-01' },
  ] };
  const { autoAffectations } = loadPaiementWithStore(store);
  const aff = await autoAffectations('c1', 'r1', 50);
  // reste dû = 20 ; on ne lettre que 20
  assert.deepEqual(aff, [{ facture_id: 'f1', montant: 20 }]);
});

test('autoAffectations — aucun impayé -> aucune affectation', async () => {
  const store = { factures: [] };
  const { autoAffectations } = loadPaiementWithStore(store);
  const aff = await autoAffectations('c1', 'r1', 100);
  assert.deepEqual(aff, []);
});

test('recomputeFacture — passe à reglee quand soldée', async () => {
  const store = {
    factures: [{ id: 'f1', camping_id: 'c1', total_ttc: 100, statut: 'emise', montant_regle: 0 }],
    reglements: [{ id: 'g1', camping_id: 'c1', affectations: [{ facture_id: 'f1', montant: 100 }] }],
  };
  const { recomputeFacture } = loadPaiementWithStore(store);
  const res = await recomputeFacture('c1', 'f1');
  assert.equal(res.regle, 100);
  assert.equal(res.statut, 'reglee');
});

test('recomputeFacture — paiement partiel -> partielle', async () => {
  const store = {
    factures: [{ id: 'f1', camping_id: 'c1', total_ttc: 100, statut: 'emise', montant_regle: 0 }],
    reglements: [{ id: 'g1', camping_id: 'c1', affectations: [{ facture_id: 'f1', montant: 40 }] }],
  };
  const { recomputeFacture } = loadPaiementWithStore(store);
  const res = await recomputeFacture('c1', 'f1');
  assert.equal(res.regle, 40);
  assert.equal(res.statut, 'partielle');
});

test('recomputeFacture — cumule plusieurs règlements', async () => {
  const store = {
    factures: [{ id: 'f1', camping_id: 'c1', total_ttc: 100, statut: 'emise', montant_regle: 0 }],
    reglements: [
      { id: 'g1', camping_id: 'c1', affectations: [{ facture_id: 'f1', montant: 60 }] },
      { id: 'g2', camping_id: 'c1', affectations: [{ facture_id: 'f1', montant: 40 }] },
    ],
  };
  const { recomputeFacture } = loadPaiementWithStore(store);
  const res = await recomputeFacture('c1', 'f1');
  assert.equal(res.regle, 100);
  assert.equal(res.statut, 'reglee');
});
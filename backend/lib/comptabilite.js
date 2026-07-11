const { supabase } = require('./supabase');

// Plan comptable par défaut (surchargé par camping.parametres.comptabilite).
const DEFAULTS = {
  journal_ventes: 'VE', journal_ventes_lib: 'Journal des ventes',
  journal_banque: 'BQ', journal_banque_lib: 'Journal de banque',
  journal_caisse: 'CA', journal_caisse_lib: 'Journal de caisse',
  compte_client: '411000', compte_client_lib: 'Clients',
  compte_loyer: '706000', compte_loyer_lib: 'Locations emplacements',
  compte_taxe_sejour: '447100', compte_taxe_sejour_lib: 'Taxe de séjour collectée',
  compte_tva: '445710', compte_tva_lib: 'TVA collectée',
  comptes_reglement: { espece: '530000', cheque: '511500', virement: '512000', tpe: '512000', stripe: '512000' },
  comptes_reglement_lib: { 530000: 'Caisse', 511500: 'Chèques à encaisser', 512000: 'Banque' },
};

const FEC_COLS = ['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib',
  'CompAuxNum', 'CompAuxLib', 'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit',
  'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise'];

function fmtDate(d) { return d ? String(d).slice(0, 10).replace(/-/g, '') : ''; }
function fmtNum(n) { return (Math.round(Number(n || 0) * 100) / 100).toFixed(2).replace('.', ','); }
function auxNum(residentId, rmapComptes) {
  if (!residentId) return '';
  // compte auxiliaire réel (411…) si attribué, sinon code technique de secours
  return (rmapComptes && rmapComptes[residentId]) || ('C' + residentId.replace(/-/g, '').slice(0, 10).toUpperCase());
}

// Construit les lignes d'écritures (partie double) sur une période [debut, fin].
async function buildEcritures(campingId, debut, fin) {
  const { data: camp } = await supabase.from('campings').select('parametres').eq('id', campingId).maybeSingle();
  const P = { ...DEFAULTS, ...((camp?.parametres || {}).comptabilite || {}) };
  P.comptes_reglement = { ...DEFAULTS.comptes_reglement, ...(P.comptes_reglement || {}) };
  P.comptes_reglement_lib = { ...DEFAULTS.comptes_reglement_lib, ...(P.comptes_reglement_lib || {}) };

  const [{ data: factures }, { data: reglements }, { data: residents }] = await Promise.all([
    supabase.from('factures').select('*').eq('camping_id', campingId)
      .gte('date_emission', debut).lte('date_emission', fin).order('date_emission'),
    supabase.from('reglements').select('*').eq('camping_id', campingId)
      .gte('date_reglement', debut).lte('date_reglement', fin).order('date_reglement'),
    supabase.from('residents').select('id,nom,prenom,compte_comptable').eq('camping_id', campingId),
  ]);
  const rmap = {};
  const rmapComptes = {};
  (residents || []).forEach((r) => {
    rmap[r.id] = `${r.prenom || ''} ${r.nom || ''}`.trim();
    if (r.compte_comptable) rmapComptes[r.id] = r.compte_comptable;
  });

  // --- Lettrage simple : facture soldée par des règlements mono-affectation ---
  const lettreOf = {}; // factureId -> lettre
  const dateLetOf = {}; // factureId -> date de solde
  let letterSeq = 0;
  for (const f of (factures || [])) {
    if (f.statut === 'reglee') {
      letterSeq += 1;
      lettreOf[f.id] = 'L' + String(letterSeq).padStart(4, '0');
    }
  }
  for (const r of (reglements || [])) {
    for (const a of (r.affectations || [])) {
      if (lettreOf[a.facture_id]) {
        dateLetOf[a.facture_id] = r.date_reglement > (dateLetOf[a.facture_id] || '') ? r.date_reglement : (dateLetOf[a.facture_id] || r.date_reglement);
      }
    }
  }

  const lines = [];
  let num = 0;
  const push = (o) => lines.push({
    JournalCode: o.jc, JournalLib: o.jl, EcritureNum: o.num, EcritureDate: fmtDate(o.date),
    CompteNum: o.compte, CompteLib: o.compteLib, CompAuxNum: o.auxNum || '', CompAuxLib: o.auxLib || '',
    PieceRef: o.piece || '', PieceDate: fmtDate(o.pieceDate || o.date), EcritureLib: o.lib || '',
    Debit: fmtNum(o.debit || 0), Credit: fmtNum(o.credit || 0),
    EcritureLet: o.let || '', DateLet: o.dateLet ? fmtDate(o.dateLet) : '',
    ValidDate: fmtDate(fin), Montantdevise: '', Idevise: '',
  });
  // signe -> debit/credit
  const leg = (base, compte, compteLib, montantSigne, extra = {}) => push({
    ...base, compte, compteLib,
    debit: montantSigne > 0 ? montantSigne : 0,
    credit: montantSigne < 0 ? -montantSigne : 0,
    ...extra,
  });

  // --- Écritures de vente (factures + avoirs) ---
  for (const f of (factures || [])) {
    num += 1;
    const isAvoir = f.statut === 'avoir';
    const base = { jc: P.journal_ventes, jl: P.journal_ventes_lib, num, date: f.date_emission,
      piece: f.numero, pieceDate: f.date_emission, lib: `${isAvoir ? 'Avoir' : 'Facture'} ${f.numero}` };
    const auxL = rmap[f.resident_id] || '';
    const aN = auxNum(f.resident_id, rmapComptes);

    let htTaxe = 0, htAutre = 0;
    for (const l of (f.lignes || [])) {
      const mHt = Number(l.montant_ht != null ? l.montant_ht : (l.quantite || 1) * (l.pu_ht || 0));
      if (String(l.designation || '').toLowerCase().startsWith('taxe de séjour')) htTaxe += mHt; else htAutre += mHt;
    }
    const tva = Number(f.total_tva || 0);
    const ttc = Number(f.total_ttc || 0);
    const lt = lettreOf[f.id], dl = dateLetOf[f.id];

    // Client au débit (TTC), produits + TVA au crédit
    leg(base, P.compte_client, P.compte_client_lib, ttc, { auxNum: aN, auxLib: auxL, let: lt, dateLet: dl });
    if (Math.abs(htAutre) > 0.0001) leg(base, P.compte_loyer, P.compte_loyer_lib, -htAutre);
    if (Math.abs(htTaxe) > 0.0001) leg(base, P.compte_taxe_sejour, P.compte_taxe_sejour_lib, -htTaxe);
    if (Math.abs(tva) > 0.0001) leg(base, P.compte_tva, P.compte_tva_lib, -tva);
  }

  // --- Écritures d'encaissement (règlements) ---
  for (const r of (reglements || [])) {
    num += 1;
    const isCaisse = r.mode === 'espece';
    const compteBank = P.comptes_reglement[r.mode] || '512000';
    const bankLib = P.comptes_reglement_lib[compteBank] || 'Banque';
    const base = { jc: isCaisse ? P.journal_caisse : P.journal_banque, jl: isCaisse ? P.journal_caisse_lib : P.journal_banque_lib,
      num, date: r.date_reglement, piece: r.reference || r.id.slice(0, 8), pieceDate: r.date_reglement, lib: `Règlement ${r.mode} ${r.reference || ''}`.trim() };
    const auxL = rmap[r.resident_id] || '';
    const aN = auxNum(r.resident_id, rmapComptes);
    const montant = Number(r.montant || 0);

    // lettrage : si le règlement n'affecte qu'une facture soldée
    let lt = '', dl = null;
    if ((r.affectations || []).length === 1 && lettreOf[r.affectations[0].facture_id]) {
      lt = lettreOf[r.affectations[0].facture_id]; dl = dateLetOf[r.affectations[0].facture_id];
    }

    leg(base, compteBank, bankLib, montant);
    leg(base, P.compte_client, P.compte_client_lib, -montant, { auxNum: aN, auxLib: auxL, let: lt, dateLet: dl });
  }

  return lines;
}

function toFEC(lines) {
  const rows = [FEC_COLS.join('\t')];
  for (const l of lines) rows.push(FEC_COLS.map((c) => (l[c] != null ? String(l[c]) : '')).join('\t'));
  return rows.join('\r\n');
}
function toCSV(lines) {
  const rows = [FEC_COLS.join(';')];
  for (const l of lines) rows.push(FEC_COLS.map((c) => (l[c] != null ? String(l[c]) : '')).join(';'));
  return rows.join('\r\n');
}

module.exports = { buildEcritures, toFEC, toCSV, fmtNum, fmtDate, FEC_COLS };

const { supabase } = require('./supabase');

/* ============================================================
   Export comptable — format à colonnes fixes (142 car.), ISO-8859-1, CRLF.
   Reproduit à l'octet près le fichier d'import du logiciel comptable.

   Position  Larg.  Contenu
   [  0:  5]   5    n° de pièce (rempli à gauche par des zéros)
   [  5:  7]   2    journal (VT = ventes, BQ = banque)
   [  7: 15]   8    date AAAAMMJJ
   [ 15: 26]  11    n° de facture (cadré à droite ; vide en ventilation/banque)
   [ 26: 35]   9    espaces
   [ 35: 43]   8    compte (cadré à gauche)
   [ 43: 46]   3    espaces
   [ 46: 71]  25    libellé (tronqué / complété)
   [ 71: 84]  13    montant, zéros à gauche, virgule décimale
   [ 84: 85]   1    sens : D (débit) ou C (crédit)
   [ 85:103]  18    espaces
   [103:142]  39    libellé long (nom du client / nature)
   ============================================================ */

const LARG = { piece: 5, journal: 2, date: 8, numero: 11, compte: 8, libelle: 25, montant: 13, nom: 39 };

// Plan comptable par défaut (surchargeable : parametres.compta)
const PLAN_DEFAUT = {
  journal_ventes: 'VT',
  journal_banque: 'BQ',
  compte_banque: '512001',
  compte_client_defaut: '411000',
  comptes_tva: { 10: '445716', 20: '445717', 5.5: '445715' },
  // Règles de ventilation : première règle dont un mot-clé est contenu dans la désignation.
  regles: [
    { contient: 'taxe de séjour', compte: '708021', libelle: 'Taxes de séjour' },
    { contient: 'électricité',    compte: '708011', libelle: 'Electricité Maison' },
    { contient: 'electricite',    compte: '708011', libelle: 'Electricité Maison' },
    { contient: 'energie',        compte: '708004', libelle: 'Energies' },
    { contient: 'énergie',        compte: '708004', libelle: 'Energies' },
    { contient: 'gaz',            compte: '707001', libelle: 'Vente gaz' },
    { contient: 'lave',           compte: '708002', libelle: 'Lave Linge' },
    { contient: 'internet',       compte: '706007', libelle: 'Internet' },
    { contient: 'loyer',          compte: '706000', libelle: 'Résident' },
    { contient: 'séjour',         compte: '706000', libelle: 'Résident' },
  ],
  compte_produit_defaut: '706000',
  libelle_produit_defaut: 'Camping',
};

// Retire les accents pour la comparaison des règles (mais PAS pour l'écriture du fichier).
const sansAccents = (s) => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// Montant : 13 caractères, zéros à gauche, virgule décimale, toujours positif.
function fmtMontant(n) {
  const v = Math.abs(Math.round(Number(n || 0) * 100) / 100);
  const s = v.toFixed(2).replace('.', ',');
  return s.padStart(LARG.montant, '0');
}

const cadreG = (s, n) => String(s || '').slice(0, n).padEnd(n);
const cadreD = (s, n) => String(s || '').slice(0, n).padStart(n);

function ligne({ piece, journal, date, numero = '', compte, libelle, montant, sens, nom = '' }) {
  return String(piece).padStart(LARG.piece, '0')
    + cadreG(journal, LARG.journal)
    + date                                   // AAAAMMJJ, déjà 8 car.
    + cadreD(numero, LARG.numero)
    + ' '.repeat(9)
    + cadreG(compte, LARG.compte)
    + ' '.repeat(3)
    + cadreG(libelle, LARG.libelle)
    + fmtMontant(montant)
    + sens
    + ' '.repeat(18)
    + cadreG(nom, LARG.nom);
}

const ymd = (d) => String(d).slice(0, 10).replace(/-/g, '');
const jjmmaaaa = (d) => {
  const [a, m, j] = String(d).slice(0, 10).split('-');
  return `${j}/${m}/${a}`;
};
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;

// Ventilation d'une ligne de facture -> { compte, libelle }
function ventiler(designation, plan) {
  const d = sansAccents(designation);
  for (const r of (plan.regles || [])) {
    if (d.includes(sansAccents(r.contient))) return { compte: r.compte, libelle: r.libelle };
  }
  return { compte: plan.compte_produit_defaut, libelle: plan.libelle_produit_defaut };
}

/**
 * Génère le fichier d'import comptable pour une période.
 * @returns {Buffer} contenu ISO-8859-1, lignes CRLF
 */
async function exportCompta(campingId, debut, fin) {
  const [{ data: camping }, { data: factures }, { data: reglements }, { data: residents }, { data: moyens }] =
    await Promise.all([
      supabase.from('campings').select('parametres').eq('id', campingId).maybeSingle(),
      // Les factures annulées par un avoir RESTENT dans l'export : elles ont bien été
      // émises, et c'est l'avoir (déjà négatif) qui les contrepasse. Les exclure ferait
      // disparaître leur produit tout en gardant l'avoir → CA faussé.
      supabase.from('factures').select('*').eq('camping_id', campingId)
        .gte('date_emission', debut).lte('date_emission', fin)
        .order('date_emission').order('numero'),
      supabase.from('reglements').select('*').eq('camping_id', campingId)
        .gte('date_reglement', debut).lte('date_reglement', fin).order('date_reglement'),
      supabase.from('residents').select('id,nom,prenom,compte_comptable').eq('camping_id', campingId),
      supabase.from('moyens_paiement').select('code,libelle,compte_comptable').eq('camping_id', campingId)
        .then((r) => r, () => ({ data: [] })),
    ]);

  const plan = { ...PLAN_DEFAUT, ...((camping?.parametres || {}).compta || {}) };
  plan.comptes_tva = { ...PLAN_DEFAUT.comptes_tva, ...((camping?.parametres?.compta || {}).comptes_tva || {}) };
  if (!plan.regles?.length) plan.regles = PLAN_DEFAUT.regles;

  const rmap = {};
  (residents || []).forEach((r) => {
    rmap[r.id] = {
      nom: `${r.nom || ''}${r.prenom ? ' ' + r.prenom : ''}`.trim(),
      compte: r.compte_comptable || plan.compte_client_defaut,
    };
  });
  const mmap = {};
  (moyens || []).forEach((m) => { mmap[m.code] = m; });

  const out = [];
  let piece = 0;

  /* ---------- Journal des VENTES : une pièce par jour ---------- */
  const parJour = {};
  for (const f of (factures || [])) {
    const j = String(f.date_emission).slice(0, 10);
    (parJour[j] ||= []).push(f);
  }

  for (const jour of Object.keys(parJour).sort()) {
    piece += 1;
    const date = ymd(jour);
    const lot = parJour[jour];
    const produits = {};   // "compte|libelle" -> HT cumulé
    const tva = {};        // taux -> TVA cumulée

    for (const f of lot) {
      const cli = rmap[f.resident_id] || { nom: '—', compte: plan.compte_client_defaut };
      const avoir = f.statut === 'avoir';
      const num = String(f.numero || '').replace(/^\D+/, '').replace(/^0+/, '') || String(f.numero || '');

      // Écriture client : facture au débit, avoir au crédit.
      out.push(ligne({
        piece, journal: plan.journal_ventes, date, numero: num,
        compte: cli.compte,
        libelle: `${avoir ? 'Avoir' : 'Facture'} ${num} ${cli.nom}`,
        montant: f.total_ttc, sens: avoir ? 'C' : 'D',
        nom: cli.nom,
      }));

      // Les montants d'un avoir sont DÉJÀ négatifs (lignes à PU négatif) :
      // n'applique aucun signe supplémentaire, sous peine d'inverser l'écriture.
      for (const l of (f.lignes || [])) {
        const v = ventiler(l.designation, plan);
        const ht = Number(l.montant_ht != null ? l.montant_ht : (l.quantite || 1) * (l.pu_ht || 0));
        const k = `${v.compte}|${v.libelle}`;
        produits[k] = r2((produits[k] || 0) + ht);
        const taux = Number(l.taux_tva || 0);
        if (taux > 0) tva[taux] = r2((tva[taux] || 0) + r2(ht * taux / 100));
      }
    }

    const libVentes = `Ventes du ${jjmmaaaa(jour)}`;
    // Produits (crédit) puis TVA (crédit) — un montant négatif bascule au débit.
    for (const k of Object.keys(produits)) {
      const mt = produits[k];
      if (Math.abs(mt) < 0.005) continue;
      const [compte, libelle] = k.split('|');
      out.push(ligne({ piece, journal: plan.journal_ventes, date, compte,
        libelle: libVentes, montant: mt, sens: mt >= 0 ? 'C' : 'D', nom: libelle }));
    }
    for (const taux of Object.keys(tva).sort((a, b) => a - b)) {
      const mt = tva[taux];
      if (Math.abs(mt) < 0.005) continue;
      const compte = plan.comptes_tva[taux] || plan.comptes_tva[Number(taux)] || '445710';
      out.push(ligne({ piece, journal: plan.journal_ventes, date, compte,
        libelle: libVentes, montant: mt, sens: mt >= 0 ? 'C' : 'D',
        nom: `TVA à ${taux}` }));
    }
  }

  /* ---------- Journal de BANQUE : une pièce par moyen de paiement ---------- */
  const parMoyen = {};
  for (const r of (reglements || [])) (parMoyen[r.mode] ||= []).push(r);

  for (const code of Object.keys(parMoyen).sort()) {
    piece += 1;
    const regs = parMoyen[code].sort((a, b) => String(a.date_reglement).localeCompare(String(b.date_reglement)));
    const moyen = mmap[code] || { libelle: code, compte_comptable: null };
    const libMoyen = moyen.libelle || code;
    let total = 0;

    for (const r of regs) {
      const cli = rmap[r.resident_id] || { nom: '—', compte: plan.compte_client_defaut };
      total = r2(total + Number(r.montant));
      // Pour un chèque, le libellé porte le n° du chèque (comme dans le fichier d'origine).
      const lib = (r.reference && /cheque|ancv/i.test(code)) ? String(r.reference) : libMoyen;
      out.push(ligne({
        piece, journal: plan.journal_banque, date: ymd(r.date_reglement),
        compte: cli.compte, libelle: lib,
        montant: r.montant, sens: 'C', nom: cli.nom,
      }));
    }

    // Contrepartie : total encaissé au débit de la banque.
    const dernier = regs[regs.length - 1];
    out.push(ligne({
      piece, journal: plan.journal_banque, date: ymd(dernier.date_reglement),
      compte: moyen.compte_comptable || plan.compte_banque,
      libelle: `Paiements  ${jjmmaaaa(regs[0].date_reglement)} - `,
      montant: total, sens: 'D', nom: libMoyen,
    }));
  }

  const texte = out.map((l) => l).join('\r\n') + (out.length ? '\r\n' : '');
  return { buffer: Buffer.from(texte, 'latin1'), lignes: out.length, pieces: piece };
}

module.exports = { exportCompta, ligne, fmtMontant, ventiler, PLAN_DEFAUT };

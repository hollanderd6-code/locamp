const PDFDocument = require('pdfkit');

const GREEN = '#0E6E63';
const INK = '#14302E';
const SAPIN = '#175243';
const LAITON = '#B98A3C';
const IVOIRE = '#F6F3EC';
const GRIS = '#6B7A74';
const HAIR = '#E4DFD3';

// échéance = date_emission + délai (jours). Renvoie une date FR ou ''.
function echeanceStr(dateEmission, delai) {
  if (!dateEmission) return '';
  const d = new Date(dateEmission);
  d.setDate(d.getDate() + Number(delai || 0));
  return d.toLocaleDateString('fr-FR');
}

function fmtDate(d) {
  if (!d) return '—';
  const s = String(d).slice(0, 10);
  const [y, m, j] = s.split('-');
  return (y && m && j) ? `${j}/${m}/${y}` : s;
}
function fmtDateShort(d) {
  if (!d) return '';
  const s = String(d).slice(0, 10);
  const [y, m, j] = s.split('-');
  return (y && m && j) ? `${j}/${m}/${y.slice(2)}` : s;
}
function fmtEur(n) {
  return `${Number(n || 0).toFixed(2).replace('.', ',')} €`;
}
// Remplace {{variable}} par la valeur du contexte.
function mergeClauses(tpl, ctx) {
  if (!tpl) return '';
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (ctx[k] != null ? String(ctx[k]) : ''));
}

// Construit le PDF du contrat. Si `signature` est fourni, ajoute le pavé
// de signature électronique et l'empreinte. Renvoie un Buffer.
function buildContratPdf({ camping = {}, resident = {}, emplacement = {}, contrat = {}, signature = null }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 56 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // --- En-tête ---
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(13)
        .text(camping.raison_sociale || camping.nom || 'Camping', { continued: false });
      doc.font('Helvetica').fontSize(9).fillColor('#555');
      if (camping.adresse) doc.text(camping.adresse);
      const legal = [camping.siret ? `SIRET ${camping.siret}` : null, camping.tva ? `TVA ${camping.tva}` : null]
        .filter(Boolean).join('  ·  ');
      if (legal) doc.text(legal);
      doc.moveUp(camping.adresse || legal ? 2.4 : 1);
      doc.font('Helvetica-Bold').fontSize(10).fillColor(GREEN)
        .text(`Contrat n° ${contrat.numero || '—'}`, { align: 'right' });

      doc.moveDown(1.5);
      doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(16)
        .text("CONTRAT DE LOCATION D'EMPLACEMENT", { align: 'center' });
      doc.fillColor('#666').font('Helvetica').fontSize(9)
        .text('Camping résidentiel — location longue durée', { align: 'center' });
      doc.moveDown(1.2);

      const section = (t) => {
        doc.moveDown(0.6);
        doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(11).text(t);
        doc.fillColor('#222').font('Helvetica').fontSize(10);
      };
      const line = (t) => doc.fillColor('#222').font('Helvetica').fontSize(10).text(t, { align: 'justify' });

      // --- Parties ---
      section('Entre les soussignés');
      line(`Le bailleur : ${camping.raison_sociale || camping.nom || '—'}${camping.adresse ? ', ' + camping.adresse : ''}${camping.siret ? ', SIRET ' + camping.siret : ''}.`);
      doc.moveDown(0.3);
      const loc = `${resident.civilite || ''} ${resident.prenom || ''} ${resident.nom || ''}`.trim();
      const nele = resident.date_naissance ? ` né(e) le ${fmtDate(resident.date_naissance)}` : '';
      line(`Le locataire : ${loc || '—'}${nele}${resident.adresse ? ', demeurant ' + resident.adresse : ''}${resident.email ? ', ' + resident.email : ''}${resident.telephone ? ', ' + resident.telephone : ''}.`);

      // --- Article 1 : objet ---
      section('Article 1 — Objet');
      line(`Le bailleur donne en location l'emplacement n° ${emplacement.numero || '—'}${emplacement.secteur ? ' (' + emplacement.secteur + ')' : ''}${emplacement.type ? ', de type ' + emplacement.type : ''}, au sein du camping résidentiel.`);

      // --- Article 2 : durée ---
      section('Article 2 — Durée');
      if (contrat.date_fin) {
        line(`Le présent contrat est conclu du ${fmtDate(contrat.date_debut)} au ${fmtDate(contrat.date_fin)}.`);
      } else {
        line(`Le présent contrat prend effet le ${fmtDate(contrat.date_debut)} pour une durée indéterminée, chaque partie pouvant y mettre fin dans les conditions prévues.`);
      }

      // --- Article 3 : loyer ---
      section('Article 3 — Loyer et charges');
      line(`Le loyer mensuel est fixé à ${fmtEur(contrat.montant_mensuel)}, payable mensuellement. Les charges et consommations sont refacturées selon les modalités en vigueur.`);

      // --- Article 4 : règlement intérieur ---
      section('Article 4 — Règlement intérieur');
      line(`Le locataire déclare avoir pris connaissance et accepter le règlement intérieur du camping${contrat.reglement_interieur_ver ? ' (version ' + contrat.reglement_interieur_ver + ')' : ''}, qui fait partie intégrante du présent contrat.`);

      // --- Clauses particulières ---
      if (contrat.clauses && contrat.clauses.trim()) {
        section('Article 5 — Clauses particulières');
        line(contrat.clauses.trim());
      }

      // --- Signature ---
      doc.moveDown(1.2);
      if (signature) {
        const boxY = doc.y;
        doc.roundedRect(56, boxY, doc.page.width - 112, 96, 6).fillOpacity(0.06).fill(GREEN).fillOpacity(1);
        doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(11).text('Signature électronique', 66, boxY + 10);
        doc.fillColor('#222').font('Helvetica').fontSize(9);
        doc.text(`Signé par : ${signature.signataire_nom || loc}`, 66, boxY + 28);
        doc.text(`Date et heure : ${signature.horodatage}`, 66);
        doc.text(`Consentement explicite recueilli : oui${signature.ip ? '   ·   IP : ' + signature.ip : ''}`, 66);
        doc.fillColor('#666').fontSize(7.5)
          .text(`Empreinte du document (SHA-256) : ${signature.hash_document || '—'}`, 66, boxY + 72, { width: doc.page.width - 132 });
      } else {
        doc.fillColor('#222').font('Helvetica').fontSize(10)
          .text(`Fait le ${fmtDate(new Date().toISOString())}.`);
        doc.moveDown(2);
        doc.text('Le bailleur', 66, doc.y, { continued: true });
        doc.text('Le locataire', { align: 'right' });
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// Construit le PDF d'une facture (ou avoir si statut='avoir'). Mentions légales FR.
function buildFacturePdf({ camping = {}, resident = {}, facture = {} }) {
  return new Promise((resolve, reject) => {
    try {
      const params = (camping.parametres && camping.parametres.facturation) || {};
      const isAvoir = facture.statut === 'avoir';
      const isProforma = !!facture.proforma || facture.nature === 'proforma';
      const accent = isProforma ? GRIS : SAPIN;
      const doc = new PDFDocument({ size: 'A4', margin: 0 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const L = 56, R = 539, W = R - L;     // largeur utile 483

      // ===== Bandeau de tête (filet laiton) =====
      doc.rect(0, 0, doc.page.width, 4).fill(accent);
      doc.rect(0, 4, doc.page.width, 2).fill(LAITON);

      const headerY = 54;
      // Logo dans une pastille verte, ou monogramme
      let sellerX = L;
      const logoBox = 56;
      if (camping.logo && Buffer.isBuffer(camping.logo)) {
        try {
          doc.roundedRect(L, headerY, logoBox, logoBox, 12).fill(accent);
          doc.image(camping.logo, L + 6, headerY + 6, { fit: [logoBox - 12, logoBox - 12] });
          sellerX = L + logoBox + 16;
        } catch (_) { sellerX = L; }
      } else if (camping.nom || camping.raison_sociale) {
        doc.roundedRect(L, headerY, logoBox, logoBox, 12).fill(accent);
        doc.fillColor('#F2EBDD').font('Helvetica-Bold').fontSize(28)
          .text(((camping.raison_sociale || camping.nom || 'C')[0] || 'C').toUpperCase(),
            L, headerY + 15, { width: logoBox, align: 'center' });
        sellerX = L + logoBox + 16;
      }

      // Émetteur
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(14)
        .text(camping.raison_sociale || camping.nom || 'Camping', sellerX, headerY + 2, { width: 250 });
      doc.font('Helvetica').fontSize(8.5).fillColor(GRIS);
      const eLines = [camping.adresse,
        [camping.telephone, camping.email].filter(Boolean).join('   ·   '),
        [camping.siret ? 'SIRET ' + camping.siret : null, camping.tva ? 'TVA ' + camping.tva : null].filter(Boolean).join('   ·   ')]
        .filter(Boolean);
      let ey = headerY + 22;
      eLines.forEach((t) => { doc.text(t, sellerX, ey, { width: 250 }); ey += 12; });

      // Titre à droite
      doc.fillColor(accent).font('Helvetica-Bold').fontSize(26)
        .text(isProforma ? 'PROFORMA' : (isAvoir ? 'AVOIR' : 'FACTURE'), 340, headerY - 2, { width: 199, align: 'right' });
      doc.font('Helvetica').fontSize(9.5).fillColor('#333');
      let my = headerY + 34;
      const meta = (label, val) => {
        doc.fillColor(GRIS).font('Helvetica').text(label, 340, my, { width: 100, align: 'right' });
        doc.fillColor(INK).font('Helvetica-Bold').text(val, 444, my, { width: 95, align: 'right' });
        my += 15;
      };
      if (!isProforma) meta('N°', facture.numero || '—'); else meta('Réf.', 'Non comptable');
      meta('Date', fmtDate(facture.date_emission));
      if (facture.periode) meta('Période', facture.periode);
      const ech = echeanceStr(facture.date_emission, params.delai_paiement);
      if (ech && !isProforma && !isAvoir) meta('Échéance', ech);

      // ===== Bloc client encadré =====
      const clientY = 150;
      doc.roundedRect(L, clientY, 250, 86, 8).fill(IVOIRE);
      doc.roundedRect(L, clientY, 250, 86, 8).lineWidth(1).stroke(HAIR);
      doc.rect(L, clientY + 10, 3, 66).fill(LAITON);
      doc.fillColor(LAITON).font('Helvetica-Bold').fontSize(8).text('FACTURÉ À', L + 16, clientY + 12, { characterSpacing: 1 });
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(12)
        .text(`${resident.civilite || ''} ${resident.prenom || ''} ${resident.nom || ''}`.trim() || '—', L + 16, clientY + 26, { width: 224 });
      doc.font('Helvetica').fontSize(9).fillColor('#444');
      let cy = clientY + 44;
      if (resident.adresse) { doc.text(resident.adresse, L + 16, cy, { width: 224 }); cy += 12; }
      if (resident.email) { doc.text(resident.email, L + 16, cy, { width: 224 }); cy += 12; }
      if (resident.compte_comptable) doc.fillColor(GRIS).fontSize(8).text('Compte ' + resident.compte_comptable, L + 16, cy, { width: 224 });

      // ===== Tableau =====
      let y = clientY + 108;
      const C = { des: L, du: 214, au: 258, nu: 302, qte: 330, puht: 360, totht: 410, tva: 458, ttc: 488 };
      const hasDates = (facture.lignes || []).some((l) => l.date_debut || l.date_fin || l.nuits != null);

      const drawHeader = () => {
        doc.roundedRect(L, y, W, 22, 4).fill(accent);
        doc.fillColor('#EAF3F0').font('Helvetica-Bold').fontSize(7.5);
        doc.text('DÉSIGNATION', C.des + 8, y + 7, { width: 150 });
        if (hasDates) {
          doc.text('DU', C.du, y + 7, { width: 42 });
          doc.text('AU', C.au, y + 7, { width: 42 });
          doc.text('NUITS', C.nu, y + 7, { width: 26, align: 'right' });
        }
        doc.text('QTÉ', C.qte, y + 7, { width: 26, align: 'right' });
        doc.text('PU HT', C.puht, y + 7, { width: 46, align: 'right' });
        doc.text('TOTAL HT', C.totht, y + 7, { width: 44, align: 'right' });
        doc.text('TVA', C.tva, y + 7, { width: 26, align: 'right' });
        doc.text('TTC', C.ttc, y + 7, { width: 43, align: 'right' });
        y += 26;
      };
      drawHeader();

      const recap = {};
      (facture.lignes || []).forEach((l, i) => {
        const q = Number(l.quantite || 1);
        const pu = Number(l.pu_ht || 0);
        const taux = Number(l.taux_tva || 0);
        const ht = l.montant_ht != null ? Number(l.montant_ht) : Math.round(q * pu * 100) / 100;
        const tvaM = Math.round(ht * taux) / 100;
        const ttc = Math.round((ht + tvaM) * 100) / 100;
        recap[taux] = recap[taux] || { base: 0, tva: 0 };
        recap[taux].base += ht; recap[taux].tva += tvaM;

        const hDes = doc.heightOfString(String(l.designation || ''), { width: 150, fontSize: 9 });
        const rowH = Math.max(hDes, 12) + 9;
        if (y + rowH > 700) { doc.addPage(); doc.rect(0, 0, doc.page.width, 4).fill(accent); y = 56; drawHeader(); }
        if (i % 2 === 1) { doc.rect(L, y - 4, W, rowH).fill('#FBF9F4'); }
        doc.fillColor(INK).font('Helvetica-Bold').fontSize(9);
        doc.text(String(l.designation || ''), C.des + 8, y, { width: 150 });
        doc.font('Helvetica').fontSize(9).fillColor('#444');
        if (hasDates) {
          doc.text(fmtDateShort(l.date_debut), C.du, y, { width: 42 });
          doc.text(fmtDateShort(l.date_fin), C.au, y, { width: 42 });
          doc.text(l.nuits != null ? String(l.nuits) : '', C.nu, y, { width: 26, align: 'right' });
        }
        doc.text(String(q), C.qte, y, { width: 26, align: 'right' });
        doc.text(fmtEur(pu), C.puht, y, { width: 46, align: 'right' });
        doc.fillColor(INK).text(fmtEur(ht), C.totht, y, { width: 44, align: 'right' });
        doc.fillColor('#444').text(`${taux} %`, C.tva, y, { width: 26, align: 'right' });
        doc.font('Helvetica-Bold').fillColor(INK).text(fmtEur(ttc), C.ttc, y, { width: 43, align: 'right' });
        y += rowH;
        doc.moveTo(L, y - 3).lineTo(R, y - 3).lineWidth(0.5).strokeColor('#EFEBE0').stroke();
      });

      y += 16;
      const blockY = y;

      // Récap TVA (gauche)
      const tauxList = Object.keys(recap).map(Number).sort((a, b) => a - b);
      if (tauxList.length) {
        const boxH = 22 + tauxList.length * 13;
        doc.roundedRect(L, blockY, 230, boxH, 8).fill(IVOIRE);
        doc.fillColor(GRIS).font('Helvetica-Bold').fontSize(7.5);
        doc.text('TAUX', L + 12, blockY + 10, { width: 44 });
        doc.text('BASE HT', L + 60, blockY + 10, { width: 74, align: 'right' });
        doc.text('MONTANT TVA', L + 138, blockY + 10, { width: 80, align: 'right' });
        let ry = blockY + 24;
        doc.font('Helvetica').fontSize(8.5).fillColor(INK);
        tauxList.forEach((t) => {
          doc.text(`${t} %`, L + 12, ry, { width: 44 });
          doc.text(fmtEur(recap[t].base), L + 60, ry, { width: 74, align: 'right' });
          doc.text(fmtEur(recap[t].tva), L + 138, ry, { width: 80, align: 'right' });
          ry += 13;
        });
      }

      // Totaux (droite)
      let ty = blockY + 2;
      const totRow = (label, val) => {
        doc.font('Helvetica').fontSize(9.5).fillColor(GRIS).text(label, 330, ty, { width: 110, align: 'right' });
        doc.font('Helvetica-Bold').fillColor(INK).text(fmtEur(val), 444, ty, { width: 95, align: 'right' });
        ty += 16;
      };
      totRow('Total HT', facture.total_ht);
      totRow('TVA', facture.total_tva);
      ty += 4;
      doc.roundedRect(330, ty, 209, 34, 8).fill(accent);
      doc.fillColor('#EAF3F0').font('Helvetica-Bold').fontSize(9)
        .text(isAvoir ? 'TOTAL AVOIR TTC' : 'TOTAL TTC', 344, ty + 12, { width: 90 });
      doc.fillColor('#fff').font('Helvetica-Bold').fontSize(15)
        .text(fmtEur(facture.total_ttc), 424, ty + 9, { width: 103, align: 'right' });

      y = Math.max(ty + 34, blockY + (tauxList.length ? 30 + tauxList.length * 13 : 0)) + 28;

      // ===== Mentions =====
      doc.fillColor(GRIS).font('Helvetica').fontSize(8);
      if (isProforma) { doc.text('Proforma établie à titre indicatif — ne vaut pas facture et n\u2019ouvre aucun droit à déduction de TVA.', L, y, { width: W }); y = doc.y + 2; }
      if (Number(facture.total_tva || 0) === 0 && params.mention_tva) { doc.text(params.mention_tva, L, y, { width: W }); y = doc.y + 2; }
      doc.text(`Conditions de règlement : ${params.conditions_reglement || 'À réception de facture.'}${ech && !isProforma && !isAvoir ? '  ·  Échéance : ' + ech : ''}`, L, y, { width: W });
      doc.text(params.penalites || 'En cas de retard de paiement, des pénalités au taux légal en vigueur seront appliquées, ainsi qu\u2019une indemnité forfaitaire pour frais de recouvrement de 40 €.', L, doc.y + 2, { width: W });
      if (isAvoir && facture.avoir_de) doc.text('Avoir émis en correction d\u2019une facture antérieure.', L, doc.y + 2, { width: W });

      // ===== Pied de page =====
      const footY = 792;
      doc.moveTo(L, footY).lineTo(R, footY).lineWidth(0.5).strokeColor(HAIR).stroke();
      const foot = [camping.raison_sociale || camping.nom, camping.adresse,
        camping.siret ? 'SIRET ' + camping.siret : null].filter(Boolean).join('  —  ');
      if (foot) doc.fillColor('#A69C86').font('Helvetica').fontSize(7).text(foot, L, footY + 6, { width: W, align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// Bordereau de remise de chèques en banque. Renvoie un Buffer.
function buildRemisePdf({ camping = {}, remise = {}, cheques = [] }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 56 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(camping.raison_sociale || camping.nom || 'Camping');
      doc.font('Helvetica').fontSize(8.5).fillColor('#555');
      if (camping.adresse) doc.text(camping.adresse);
      if (camping.siret) doc.text(`SIRET ${camping.siret}`);

      doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(18)
        .text('REMISE DE CHÈQUES', 300, 56, { width: 242, align: 'right' });
      doc.fillColor('#222').font('Helvetica').fontSize(9);
      doc.text(`Bordereau n° ${remise.numero || '—'}`, 300, undefined, { width: 242, align: 'right' });
      doc.text(`Date de remise : ${fmtDate(remise.date_remise)}`, 300, undefined, { width: 242, align: 'right' });
      if (remise.banque) doc.text(`Banque : ${remise.banque}`, 300, undefined, { width: 242, align: 'right' });

      let y = 170;
      const X = { n: 56, tireur: 96, ref: 300, date: 400, mont: 480 };
      doc.rect(56, y, 486, 20).fill(GREEN);
      doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9);
      doc.text('#', X.n + 4, y + 6);
      doc.text('Tireur', X.tireur, y + 6);
      doc.text('N° chèque', X.ref, y + 6);
      doc.text('Date', X.date, y + 6);
      doc.text('Montant', X.mont, y + 6, { width: 58, align: 'right' });
      y += 26;

      let total = 0;
      doc.font('Helvetica').fontSize(9).fillColor('#222');
      cheques.forEach((c, i) => {
        if (i % 2 === 1) { doc.rect(56, y - 4, 486, 18).fillOpacity(0.05).fill(GREEN).fillOpacity(1); }
        doc.fillColor('#222');
        doc.text(String(i + 1), X.n + 4, y);
        doc.text(String(c.tireur || '—').slice(0, 34), X.tireur, y);
        doc.text(String(c.reference || '—').slice(0, 16), X.ref, y);
        doc.text(fmtDate(c.date_reglement), X.date, y);
        doc.text(fmtEur(c.montant), X.mont, y, { width: 58, align: 'right' });
        total += Number(c.montant || 0);
        y += 18;
      });

      y += 8;
      doc.font('Helvetica-Bold').fontSize(11).fillColor(GREEN);
      doc.text(`Total (${cheques.length} chèque${cheques.length > 1 ? 's' : ''})`, 300, y, { width: 160, align: 'right' });
      doc.text(fmtEur(total), 462, y, { width: 80, align: 'right' });

      doc.moveDown(3);
      doc.font('Helvetica').fontSize(8.5).fillColor('#666')
        .text('Bordereau à joindre à la remise. Conserver une copie.', 56, y + 40);

      doc.end();
    } catch (err) { reject(err); }
  });
}

module.exports = { buildContratPdf, buildFacturePdf, buildRemisePdf, mergeClauses, fmtDate, fmtEur, canEmbedImage };

// Vérifie qu'une image est décodable par le moteur PDF (PNG/JPEG standard, non-CMYK).
function canEmbedImage(buffer) {
  try {
    const d = new PDFDocument();
    d.image(buffer, 0, 0, { width: 10 });
    return true;
  } catch (_) {
    return false;
  }
}

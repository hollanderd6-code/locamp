const PDFDocument = require('pdfkit');

const GREEN = '#0E6E63';
const INK = '#14302E';

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
      const isProforma = !!facture.proforma;
      const doc = new PDFDocument({ size: 'A4', margin: 56 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const L = 56, R = 539;          // largeur utile : 483 pt
      const headerY = 48;

      // --- Logo (optionnel) ---
      let sellerX = L;
      if (camping.logo && Buffer.isBuffer(camping.logo)) {
        try { doc.image(camping.logo, L, headerY, { fit: [112, 58] }); sellerX = L + 124; }
        catch (_) { /* logo illisible : ignoré */ }
      }

      // --- Émetteur ---
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(13)
        .text(camping.raison_sociale || camping.nom || 'Camping', sellerX, headerY, { width: 300 });
      doc.font('Helvetica').fontSize(8.5).fillColor('#555');
      if (camping.adresse) doc.text(camping.adresse, sellerX, undefined, { width: 300 });
      const contact = [camping.telephone, camping.email].filter(Boolean).join('   ·   ');
      if (contact) doc.text(contact, sellerX, undefined, { width: 300 });
      const legal = [camping.siret ? `SIRET ${camping.siret}` : null, camping.tva ? `TVA ${camping.tva}` : null]
        .filter(Boolean).join('   ·   ');
      if (legal) doc.text(legal, sellerX, undefined, { width: 300 });

      // --- Titre + méta (droite) ---
      doc.fillColor(isProforma ? '#8A8A8A' : GREEN).font('Helvetica-Bold').fontSize(20)
        .text(isProforma ? 'PROFORMA' : (isAvoir ? 'AVOIR' : 'FACTURE'), 360, headerY, { width: 179, align: 'right' });
      doc.fillColor('#222').font('Helvetica').fontSize(9);
      if (!isProforma) doc.text(`N° ${facture.numero || '—'}`, 360, undefined, { width: 179, align: 'right' });
      else doc.text('Document non comptable', 360, undefined, { width: 179, align: 'right' });
      doc.text(`Date : ${fmtDate(facture.date_emission)}`, 360, undefined, { width: 179, align: 'right' });
      if (facture.periode) doc.text(`Période : ${facture.periode}`, 360, undefined, { width: 179, align: 'right' });

      // --- Client (encadré) ---
      const clientY = 150;
      doc.roundedRect(340, clientY, 199, 68, 5).lineWidth(1).stroke('#DADED9');
      doc.fillColor('#666').font('Helvetica-Bold').fontSize(8).text('FACTURÉ À', 350, clientY + 8);
      doc.fillColor('#222').font('Helvetica-Bold').fontSize(10)
        .text(`${resident.civilite || ''} ${resident.prenom || ''} ${resident.nom || ''}`.trim() || '—', 350, clientY + 20, { width: 179 });
      doc.font('Helvetica').fontSize(9).fillColor('#444');
      if (resident.adresse) doc.text(resident.adresse, 350, undefined, { width: 179 });
      if (resident.email) doc.text(resident.email, 350, undefined, { width: 179 });

      // --- Tableau des lignes ---
      let y = clientY + 88;
      const C = { des: 56, du: 196, au: 244, nu: 292, qte: 322, puht: 352, totht: 402, tva: 452, ttc: 486 };
      const drawHeader = () => {
        doc.rect(L, y, 483, 18).fill(GREEN);
        doc.fillColor('#fff').font('Helvetica-Bold').fontSize(7.5);
        doc.text('Désignation', C.des + 3, y + 5, { width: 136 });
        doc.text('Du', C.du, y + 5, { width: 46 });
        doc.text('Au', C.au, y + 5, { width: 46 });
        doc.text('Nuits', C.nu, y + 5, { width: 26, align: 'right' });
        doc.text('Qté', C.qte, y + 5, { width: 26, align: 'right' });
        doc.text('PU HT', C.puht, y + 5, { width: 46, align: 'right' });
        doc.text('Total HT', C.totht, y + 5, { width: 46, align: 'right' });
        doc.text('TVA', C.tva, y + 5, { width: 30, align: 'right' });
        doc.text('TTC', C.ttc, y + 5, { width: 51, align: 'right' });
        y += 22;
      };
      drawHeader();

      const recap = {};   // taux -> { base, tva }
      (facture.lignes || []).forEach((l, i) => {
        const q = Number(l.quantite || 1);
        const pu = Number(l.pu_ht || 0);
        const taux = Number(l.taux_tva || 0);
        const ht = l.montant_ht != null ? Number(l.montant_ht) : Math.round(q * pu * 100) / 100;
        const tvaM = Math.round(ht * taux) / 100;
        const ttc = Math.round((ht + tvaM) * 100) / 100;
        recap[taux] = recap[taux] || { base: 0, tva: 0 };
        recap[taux].base += ht; recap[taux].tva += tvaM;

        const hDes = doc.heightOfString(String(l.designation || ''), { width: 136, fontSize: 7.5 });
        const rowH = Math.max(hDes, 10) + 6;
        if (y + rowH > 720) { doc.addPage(); y = 56; drawHeader(); }
        if (i % 2 === 1) { doc.rect(L, y - 3, 483, rowH).fillOpacity(0.05).fill(GREEN).fillOpacity(1); }
        doc.fillColor('#222').font('Helvetica').fontSize(7.5);
        doc.text(String(l.designation || ''), C.des + 3, y, { width: 136 });
        doc.text(fmtDateShort(l.date_debut), C.du, y, { width: 46 });
        doc.text(fmtDateShort(l.date_fin), C.au, y, { width: 46 });
        doc.text(l.nuits != null ? String(l.nuits) : '', C.nu, y, { width: 26, align: 'right' });
        doc.text(String(q), C.qte, y, { width: 26, align: 'right' });
        doc.text(fmtEur(pu), C.puht, y, { width: 46, align: 'right' });
        doc.text(fmtEur(ht), C.totht, y, { width: 46, align: 'right' });
        doc.text(`${taux} %`, C.tva, y, { width: 30, align: 'right' });
        doc.text(fmtEur(ttc), C.ttc, y, { width: 51, align: 'right' });
        y += rowH;
      });

      doc.moveTo(L, y + 2).lineTo(R, y + 2).lineWidth(0.5).stroke('#DADED9');
      y += 14;

      // --- Récap TVA (gauche) + Totaux (droite) ---
      const blockY = y;
      const tauxList = Object.keys(recap).map(Number).sort((a, b) => a - b);
      if (tauxList.length) {
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#666');
        doc.text('Taux', 56, y, { width: 44 });
        doc.text('Base HT', 100, y, { width: 66, align: 'right' });
        doc.text('Montant TVA', 170, y, { width: 74, align: 'right' });
        y += 12;
        doc.font('Helvetica').fontSize(7.5).fillColor('#222');
        tauxList.forEach((t) => {
          doc.text(`${t} %`, 56, y, { width: 44 });
          doc.text(fmtEur(recap[t].base), 100, y, { width: 66, align: 'right' });
          doc.text(fmtEur(recap[t].tva), 170, y, { width: 74, align: 'right' });
          y += 11;
        });
      }

      let ty = blockY;
      const totRow = (label, val, bold) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9).fillColor(bold ? GREEN : '#222');
        doc.text(label, 360, ty, { width: 100, align: 'right' });
        doc.text(fmtEur(val), 462, ty, { width: 77, align: 'right' });
        ty += bold ? 18 : 14;
      };
      totRow('Total HT', facture.total_ht);
      totRow('TVA', facture.total_tva);
      totRow(isAvoir ? 'Total avoir TTC' : 'Total TTC', facture.total_ttc, true);

      y = Math.max(y, ty) + 24;

      // --- Mentions légales ---
      doc.fillColor('#666').font('Helvetica').fontSize(7.5);
      if (isProforma) doc.text('Proforma établie à titre indicatif — ne vaut pas facture.', 56, y, { width: 483 });
      if (Number(facture.total_tva || 0) === 0 && params.mention_tva) doc.text(params.mention_tva, 56, isProforma ? undefined : y, { width: 483 });
      doc.text(`Conditions de règlement : ${params.conditions_reglement || 'À réception de facture.'}`, 56, undefined, { width: 483 });
      doc.text(params.penalites || 'En cas de retard de paiement, des pénalités au taux légal en vigueur seront appliquées, ainsi qu\u2019une indemnité forfaitaire pour frais de recouvrement de 40 €.', 56, undefined, { width: 483 });
      if (isAvoir && facture.avoir_de) doc.text('Avoir émis en correction d\u2019une facture antérieure.', 56, undefined, { width: 483 });

      // --- Pied de page légal ---
      doc.moveDown(0.8);
      const foot = [camping.raison_sociale || camping.nom, camping.adresse,
        camping.siret ? 'SIRET ' + camping.siret : null, camping.tva ? 'TVA ' + camping.tva : null]
        .filter(Boolean).join(' — ');
      if (foot) doc.fillColor('#999').fontSize(6.5).text(foot, 56, undefined, { width: 483, align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { buildContratPdf, buildFacturePdf, mergeClauses, fmtDate, fmtEur, canEmbedImage };

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

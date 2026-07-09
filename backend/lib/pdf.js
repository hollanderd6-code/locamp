const PDFDocument = require('pdfkit');

const GREEN = '#0E6E63';
const INK = '#14302E';

function fmtDate(d) {
  if (!d) return '—';
  const s = String(d).slice(0, 10);
  const [y, m, j] = s.split('-');
  return (y && m && j) ? `${j}/${m}/${y}` : s;
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
      const doc = new PDFDocument({ size: 'A4', margin: 56 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Émetteur
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(camping.raison_sociale || camping.nom || 'Camping');
      doc.font('Helvetica').fontSize(8.5).fillColor('#555');
      if (camping.adresse) doc.text(camping.adresse);
      const legal = [camping.siret ? `SIRET ${camping.siret}` : null, camping.tva ? `TVA ${camping.tva}` : null]
        .filter(Boolean).join('  ·  ');
      if (legal) doc.text(legal);

      // Titre + méta (à droite)
      doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(18)
        .text(isAvoir ? 'AVOIR' : 'FACTURE', 360, 56, { width: 182, align: 'right' });
      doc.fillColor('#222').font('Helvetica').fontSize(9);
      doc.text(`N° ${facture.numero || '—'}`, 360, undefined, { width: 182, align: 'right' });
      doc.text(`Date : ${fmtDate(facture.date_emission)}`, 360, undefined, { width: 182, align: 'right' });
      if (facture.periode) doc.text(`Période : ${facture.periode}`, 360, undefined, { width: 182, align: 'right' });

      // Client
      const clientY = 150;
      doc.fillColor('#666').font('Helvetica-Bold').fontSize(8).text('FACTURÉ À', 56, clientY);
      doc.fillColor('#222').font('Helvetica').fontSize(10);
      doc.text(`${resident.civilite || ''} ${resident.prenom || ''} ${resident.nom || ''}`.trim() || '—', 56, undefined);
      if (resident.adresse) doc.text(resident.adresse, 56, undefined);
      if (resident.email) doc.text(resident.email, 56, undefined);

      // Tableau
      let y = clientY + 54;
      const X = { des: 56, qte: 320, pu: 372, tva: 452, tot: 508 };
      doc.rect(56, y, 486, 20).fill(GREEN);
      doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9);
      doc.text('Désignation', X.des + 4, y + 6);
      doc.text('Qté', X.qte, y + 6);
      doc.text('PU HT', X.pu, y + 6);
      doc.text('TVA', X.tva, y + 6);
      doc.text('Total HT', X.tot, y + 6);
      y += 24;

      doc.font('Helvetica').fontSize(9);
      (facture.lignes || []).forEach((l, i) => {
        const q = Number(l.quantite || 1);
        const pu = Number(l.pu_ht || 0);
        const ht = l.montant_ht != null ? Number(l.montant_ht) : q * pu;
        const hDes = doc.heightOfString(String(l.designation || ''), { width: 258 });
        const rowH = Math.max(hDes, 12) + 6;
        if (i % 2 === 1) { doc.rect(56, y - 3, 486, rowH).fillOpacity(0.05).fill(GREEN).fillOpacity(1); }
        doc.fillColor('#222').font('Helvetica').fontSize(9);
        doc.text(String(l.designation || ''), X.des + 4, y, { width: 258 });
        doc.text(String(q), X.qte, y);
        doc.text(fmtEur(pu), X.pu, y);
        doc.text(`${Number(l.taux_tva || 0)} %`, X.tva, y);
        doc.text(fmtEur(ht), X.tot, y);
        y += rowH;
      });

      // Totaux
      y += 12;
      const totRow = (label, val, bold) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9).fillColor(bold ? GREEN : '#222');
        doc.text(label, 360, y, { width: 100, align: 'right' });
        doc.text(fmtEur(val), 462, y, { width: 80, align: 'right' });
        y += bold ? 18 : 15;
      };
      totRow('Total HT', facture.total_ht);
      totRow('TVA', facture.total_tva);
      totRow('Total TTC', facture.total_ttc, true);

      // Mentions légales
      y += 22;
      doc.fillColor('#666').font('Helvetica').fontSize(7.5);
      if (Number(facture.total_tva || 0) === 0 && params.mention_tva) doc.text(params.mention_tva, 56, y, { width: 486 });
      doc.text(`Conditions de règlement : ${params.conditions_reglement || 'À réception de facture.'}`, 56, undefined, { width: 486 });
      doc.text(params.penalites || 'En cas de retard de paiement, des pénalités au taux légal en vigueur seront appliquées, ainsi qu\u2019une indemnité forfaitaire pour frais de recouvrement.', 56, undefined, { width: 486 });
      if (isAvoir && facture.avoir_de) doc.text('Avoir émis en correction d\u2019une facture antérieure.', 56, undefined, { width: 486 });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { buildContratPdf, buildFacturePdf, mergeClauses, fmtDate, fmtEur };

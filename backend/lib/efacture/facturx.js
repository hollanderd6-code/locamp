/* ============================================================================
   Factur-X — facture hybride : le PDF lisible + un XML structuré embarqué.

   Le XML suit la norme EN 16931 au format CII (UN/CEFACT Cross Industry
   Invoice), profil « EN 16931 » (dit « comfort »). C'est ce que lira la
   Plateforme Agréée, puis l'administration.

   ⚠️ Périmètre : ce module produit le XML et l'attache au PDF (avec les
   métadonnées XMP Factur-X). La conformité PDF/A-3 STRICTE exigerait en plus
   un profil ICC et des polices intégrées — ce que la chaîne pdfkit/Helvetica
   ne permet pas en l'état. Le fichier est exploitable par une PA (c'est le XML
   qui fait foi), mais ne passerait pas un validateur PDF/A-3 pointilleux.
   ========================================================================== */

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const dec = (n) => r2(n).toFixed(2);

/* ---------- Helpers XML ---------- */
// Échappe les caractères interdits dans un contenu XML.
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
const bal = (nom, val) => `<${nom}>${esc(val)}</${nom}>`;

// SIREN = 9 premiers chiffres du SIRET (BT-47 : identifiant légal du vendeur/acheteur).
function siren(siret) {
  const n = String(siret || '').replace(/\D/g, '');
  return n.length >= 9 ? n.slice(0, 9) : null;
}
// Date au format 102 de la norme : AAAAMMJJ.
function date102(d) {
  const s = String(d || '').slice(0, 10).replace(/-/g, '');
  return /^\d{8}$/.test(s) ? s : new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

/* ---------- Partie (vendeur / acheteur) ---------- */
function partieXml(balise, p) {
  const id = siren(p.siret);
  return `      <ram:${balise}>
        ${bal('ram:Name', p.nom || '—')}
${id ? `        <ram:SpecifiedLegalOrganization>
          <ram:ID schemeID="0002">${esc(id)}</ram:ID>
        </ram:SpecifiedLegalOrganization>` : ''}
        <ram:PostalTradeAddress>
${p.cp ? `          ${bal('ram:PostcodeCode', p.cp)}` : ''}
${p.rue ? `          ${bal('ram:LineOne', p.rue)}` : ''}
${p.ville ? `          ${bal('ram:CityName', p.ville)}` : ''}
          ${bal('ram:CountryID', p.pays || 'FR')}
        </ram:PostalTradeAddress>
${p.tva ? `        <ram:SpecifiedTaxRegistration>
          <ram:ID schemeID="VA">${esc(p.tva)}</ram:ID>
        </ram:SpecifiedTaxRegistration>` : ''}
      </ram:${balise}>`;
}

/* ---------- Ligne de facture ---------- */
function ligneXml(l, i) {
  const q = Number(l.quantite || 1);
  const pu = Number(l.pu_ht || 0);
  const taux = Number(l.taux_tva || 0);
  const mHt = l.montant_ht != null ? Number(l.montant_ht) : r2(q * pu);
  return `      <ram:IncludedSupplyChainTradeLineItem>
        <ram:AssociatedDocumentLineDocument>
          ${bal('ram:LineID', String(i + 1))}
        </ram:AssociatedDocumentLineDocument>
        <ram:SpecifiedTradeProduct>
          ${bal('ram:Name', l.designation || 'Prestation')}
        </ram:SpecifiedTradeProduct>
        <ram:SpecifiedLineTradeAgreement>
          <ram:NetPriceProductTradePrice>
            <ram:ChargeAmount>${dec(pu)}</ram:ChargeAmount>
          </ram:NetPriceProductTradePrice>
        </ram:SpecifiedLineTradeAgreement>
        <ram:SpecifiedLineTradeDelivery>
          <ram:BilledQuantity unitCode="C62">${q}</ram:BilledQuantity>
        </ram:SpecifiedLineTradeDelivery>
        <ram:SpecifiedLineTradeSettlement>
          <ram:ApplicableTradeTax>
            <ram:TypeCode>VAT</ram:TypeCode>
            <ram:CategoryCode>${taux > 0 ? 'S' : 'Z'}</ram:CategoryCode>
            <ram:RateApplicablePercent>${dec(taux)}</ram:RateApplicablePercent>
          </ram:ApplicableTradeTax>
          <ram:SpecifiedTradeSettlementLineMonetarySummation>
            <ram:LineTotalAmount>${dec(mHt)}</ram:LineTotalAmount>
          </ram:SpecifiedTradeSettlementLineMonetarySummation>
        </ram:SpecifiedLineTradeSettlement>
      </ram:IncludedSupplyChainTradeLineItem>`;
}

/* ---------- Ventilation de TVA par taux ---------- */
function taxesXml(lignes) {
  const parTaux = {};
  for (const l of (lignes || [])) {
    const taux = Number(l.taux_tva || 0);
    const mHt = l.montant_ht != null ? Number(l.montant_ht) : r2(Number(l.quantite || 1) * Number(l.pu_ht || 0));
    parTaux[taux] = r2((parTaux[taux] || 0) + mHt);
  }
  return Object.entries(parTaux).map(([taux, base]) => {
    const t = Number(taux);
    const montant = r2(base * t / 100);
    return `        <ram:ApplicableTradeTax>
          <ram:CalculatedAmount>${dec(montant)}</ram:CalculatedAmount>
          <ram:TypeCode>VAT</ram:TypeCode>
          <ram:BasisAmount>${dec(base)}</ram:BasisAmount>
          <ram:CategoryCode>${t > 0 ? 'S' : 'Z'}</ram:CategoryCode>
${t === 0 ? '          <ram:ExemptionReason>Non soumis à TVA</ram:ExemptionReason>' : ''}
          <ram:RateApplicablePercent>${dec(t)}</ram:RateApplicablePercent>
        </ram:ApplicableTradeTax>`;
  }).join('\n');
}

/* ---------- XML complet ---------- */
// facture : { numero, date_emission, lignes[], total_ht, total_tva, total_ttc, montant_regle }
// vendeur / acheteur : { nom, siret, tva, rue, cp, ville, pays }
function construireFacturxXML({ facture, vendeur, acheteur }) {
  const lignes = facture.lignes || [];
  const ht = facture.total_ht != null ? Number(facture.total_ht) : 0;
  const tva = facture.total_tva != null ? Number(facture.total_tva) : 0;
  const ttc = facture.total_ttc != null ? Number(facture.total_ttc) : r2(ht + tva);
  const regle = Number(facture.montant_regle || 0);
  // 380 = facture ; 381 = avoir (note de crédit)
  const typeCode = facture.statut === 'avoir' ? '381' : '380';

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice
  xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
  xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
  xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID>urn:cen.eu:en16931:2017</ram:ID>
    </ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    ${bal('ram:ID', facture.numero)}
    <ram:TypeCode>${typeCode}</ram:TypeCode>
    <ram:IssueDateTime>
      <udt:DateTimeString format="102">${date102(facture.date_emission)}</udt:DateTimeString>
    </ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
${lignes.map(ligneXml).join('\n')}
    <ram:ApplicableHeaderTradeAgreement>
${partieXml('SellerTradeParty', vendeur)}
${partieXml('BuyerTradeParty', acheteur)}
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery/>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
${taxesXml(lignes)}
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${dec(ht)}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>${dec(ht)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">${dec(tva)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${dec(ttc)}</ram:GrandTotalAmount>
        <ram:TotalPrepaidAmount>${dec(regle)}</ram:TotalPrepaidAmount>
        <ram:DuePayableAmount>${dec(r2(ttc - regle))}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;
}

/* ---------- Métadonnées XMP (déclarent le PDF comme Factur-X) ---------- */
function xmpFacturx(numero) {
  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
      <pdfaid:part>3</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">Facture ${esc(numero)}</rdf:li></rdf:Alt></dc:title>
    </rdf:Description>
    <rdf:Description rdf:about=""
      xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">
      <fx:DocumentType>INVOICE</fx:DocumentType>
      <fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>
      <fx:Version>1.0</fx:Version>
      <fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/* ---------- Embarquement du XML dans le PDF ---------- */
async function attacherXmlAuPdf(pdfBuffer, xml, numero) {
  const { PDFDocument, AFRelationship } = require('pdf-lib');
  const pdf = await PDFDocument.load(pdfBuffer);

  // Le nom de fichier « factur-x.xml » est imposé par la spécification.
  await pdf.attach(Buffer.from(xml, 'utf8'), 'factur-x.xml', {
    mimeType: 'application/xml',
    description: 'Factur-X invoice (EN 16931)',
    creationDate: new Date(),
    modificationDate: new Date(),
    afRelationship: AFRelationship.Data,   // la pièce EST la donnée de la facture
  });

  pdf.setTitle(`Facture ${numero}`);
  pdf.setProducer('Locamp');
  pdf.setCreator('Locamp');

  // XMP : c'est ce qui permet à un lecteur d'identifier le PDF comme Factur-X.
  try {
    const { PDFHexString, PDFName, PDFRawStream } = require('pdf-lib');
    const xmp = xmpFacturx(numero);
    const stream = pdf.context.stream(xmp, {
      Type: PDFName.of('Metadata'),
      Subtype: PDFName.of('XML'),
      Length: xmp.length,
    });
    pdf.catalog.set(PDFName.of('Metadata'), pdf.context.register(stream));
  } catch (e) { console.error('[facturx] XMP :', e.message); }

  return Buffer.from(await pdf.save());
}

/* ---------- Orchestrateur ---------- */
// Charge la facture, le camping et le résident, fabrique le PDF lisible puis
// y embarque le XML. Renvoie { buffer, xml, numero } ou { error }.
async function genererFacturx(campingId, factureId) {
  const { supabase } = require('../supabase');
  const { buildFacturePdf } = require('../pdf');
  const { downloadDocument } = require('../storage');

  const { data: facture } = await supabase.from('factures').select('*')
    .eq('camping_id', campingId).eq('id', factureId).maybeSingle();
  if (!facture) return { error: 'Facture introuvable', code: 404 };
  if (facture.statut === 'brouillon') {
    return { error: 'Un brouillon ne peut pas être transmis : émettez la facture d\'abord.', code: 409 };
  }

  const [{ data: camping }, { data: resident }] = await Promise.all([
    supabase.from('campings').select('*').eq('id', campingId).maybeSingle(),
    facture.resident_id
      ? supabase.from('residents').select('*').eq('id', facture.resident_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!resident) return { error: 'Facture sans client : Factur-X impossible', code: 400 };

  // Garde-fou : Factur-X est un flux B2B. Sans SIREN acheteur, c'est un
  // particulier -> pas de Factur-X, mais e-reporting (autre brique).
  if (!siren(resident.siret)) {
    return {
      error: 'Ce client est un particulier (aucun SIRET). Factur-X ne concerne que les clients '
        + 'entreprise ; les ventes aux particuliers relèvent de l\'e-reporting.',
      code: 400, b2c: true,
    };
  }
  if (!siren(camping.siret)) {
    return { error: 'Le SIRET de votre camping est manquant (Paramètres). Il est requis sur toute facture.', code: 400 };
  }

  // PDF lisible (identique à celui envoyé au client)
  const camp = { ...camping };
  if (camp.logo_path) {
    try { camp.logo = await downloadDocument(camp.logo_path); } catch { /* logo optionnel */ }
  }
  const pdfBase = await buildFacturePdf({ camping: camp, resident, facture });

  const xml = construireFacturxXML({
    facture,
    vendeur: {
      nom: camping.raison_sociale || camping.nom,
      siret: camping.siret, tva: camping.tva,
      rue: camping.adresse, cp: camping.adresse_cp, ville: camping.adresse_ville, pays: 'FR',
    },
    acheteur: {
      nom: resident.raison_sociale || `${resident.prenom || ''} ${resident.nom || ''}`.trim(),
      siret: resident.siret, tva: resident.tva_intra,
      rue: resident.adresse, cp: resident.adresse_cp, ville: resident.adresse_ville,
      pays: resident.adresse_pays || 'FR',
    },
  });

  const buffer = await attacherXmlAuPdf(pdfBase, xml, facture.numero);
  return { buffer, xml, numero: facture.numero };
}

module.exports = { construireFacturxXML, attacherXmlAuPdf, genererFacturx, siren };

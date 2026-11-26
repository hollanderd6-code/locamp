import SwiftUI

/// Accueil : la situation du locataire d'un coup d'oeil (reste a regler,
/// documents a signer), et les raccourcis vers ce qu'il vient faire.
struct AccueilView: View {
    @Environment(Session.self) private var session
    @Environment(Espace.self) private var espace
    @State private var depot = false
    @State private var apercu = Apercu()

    var body: some View {
        VueChargement(etat: espace.etat, reessayer: espace.charger) { _ in
            ScrollView {
                VStack(spacing: 20) {
                    CarteSolde(depot: $depot)

                    if !espace.aSigner.isEmpty {
                        VStack(spacing: 10) {
                            ForEach(espace.aSigner) { d in
                                NavigationLink(value: d) { BandeauSignature(document: d) }
                                    .buttonStyle(.plain)
                            }
                        }
                    }

                    Raccourcis(depot: $depot)

                    if !espace.prestations.isEmpty {
                        VStack(spacing: 10) {
                            TitreSection(texte: "En préparation")
                            VStack(spacing: 0) {
                                ForEach(Array(espace.prestations.enumerated()), id: \.element.id) { i, p in
                                    if i > 0 { Divider().padding(.leading, 16) }
                                    LignePrestation(prestation: p)
                                }
                            }
                            .background(.background.secondary, in: .rect(cornerRadius: 22))
                        }
                    }

                    if !espace.factures.isEmpty {
                        VStack(spacing: 10) {
                            HStack {
                                TitreSection(texte: "Dernières factures")
                                Button("Tout voir") { session.onglet = .factures }
                                    .font(.subheadline.weight(.medium))
                            }
                            VStack(spacing: 0) {
                                ForEach(Array(espace.factures.prefix(3).enumerated()), id: \.element.id) { i, f in
                                    if i > 0 { Divider().padding(.leading, 16) }
                                    Button {
                                        apercu.ouvrir(nom: "Facture \(f.numero ?? f.titre).pdf") {
                                            try await API.requete("/api/portail/factures/\(f.id)/pdf", as: LienSigne.self).url
                                        }
                                    } label: { LigneFacture(facture: f).padding(.horizontal, 16).padding(.vertical, 12) }
                                    .buttonStyle(.plain)
                                }
                            }
                            .background(.background.secondary, in: .rect(cornerRadius: 22))
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
            }
            .refreshable { await espace.charger() }
        }
        .background(Color("Fond").ignoresSafeArea())
        .navigationTitle(espace.moi.map { "Bonjour \($0.resident.appel)" } ?? "Accueil")
        .navigationSubtitle(sousTitre)
        .toolbarTitleDisplayMode(.large)
        .barreEspace()
        .navigationDestination(for: DocumentSignature.self) { SignatureView(document: $0) }
        .sheet(isPresented: $depot) { DepotDocumentView() }
        .apercu(apercu)
    }

    private var sousTitre: String {
        guard let m = espace.moi else { return "" }
        var bouts = [m.camping.nom]
        if let n = m.emplacement?.numero?.valeur, !n.isEmpty { bouts.append("Emplacement \(n)") }
        return bouts.joined(separator: " · ")
    }
}

// MARK: - Carte du solde

private struct CarteSolde: View {
    @Environment(Session.self) private var session
    @Environment(Espace.self) private var espace
    @Binding var depot: Bool
    @State private var paiement = false

    var body: some View {
        let du = espace.totalDu > 0.004
        let teinte: Color = !du ? .green : (espace.retardMax > 0 ? .red : .orange)

        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Label(du ? "Reste à régler" : "Votre situation",
                      systemImage: du ? "eurosign.circle.fill" : "checkmark.seal.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(teinte)
                Spacer()
            }
            Text(du ? Format.euros(espace.totalDu) : "À jour")
                .font(.system(size: 44, weight: .bold, design: .rounded))
                .contentTransition(.numericText())
                .minimumScaleFactor(0.6)
                .lineLimit(1)
            Text(detail)
                .font(.subheadline)
                .foregroundStyle(.secondary)

            if du {
                HStack(spacing: 10) {
                    if espace.paiementPossible, let f = espace.dues.sorted(by: { ($0.date_emission ?? "") < ($1.date_emission ?? "") }).first {
                        Button {
                            Task { await payer(f) }
                        } label: {
                            Label("Payer en ligne", systemImage: "creditcard")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.glassProminent)
                        .disabled(paiement)
                    }
                    Button {
                        session.onglet = .factures
                    } label: {
                        Label("Mes factures", systemImage: "doc.text")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.glass)
                }
                .controlSize(.large)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(.regular.tint(teinte.opacity(0.12)), in: .rect(cornerRadius: 28))
        .padding(.top, 4)
    }

    private var detail: String {
        if espace.totalDu <= 0.004 { return "Aucun paiement en attente. Merci !" }
        if espace.retardMax > 0 { return "En retard de \(espace.retardMax) jour\(espace.retardMax > 1 ? "s" : "")" }
        let n = espace.dues.count
        return "\(n) facture\(n > 1 ? "s" : "") à régler"
    }

    @Environment(\.openURL) private var ouvrir
    private func payer(_ f: Facture) async {
        paiement = true
        defer { paiement = false }
        do {
            let r = try await API.requete("/api/portail/factures/\(f.id)/payer", methode: "POST", as: LienSigne.self)
            if let u = URL(string: r.url) { ouvrir(u) }
        } catch {
            session.afficher(error.localizedDescription, erreur: true)
        }
    }
}

// MARK: - Document a signer

struct BandeauSignature: View {
    let document: DocumentSignature

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: "signature")
                .font(.title2)
                .foregroundStyle(.white)
                .frame(width: 46, height: 46)
                .background(Color.accentColor.gradient, in: .rect(cornerRadius: 14))
            VStack(alignment: .leading, spacing: 3) {
                Text("Signature demandée").font(.caption.weight(.semibold)).foregroundStyle(Color.accentColor)
                Text(document.titre).font(.body.weight(.semibold)).lineLimit(2)
                Text("\(document.nb_pages ?? 1) page\((document.nb_pages ?? 1) > 1 ? "s" : "") · à lire et signer")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(.regular.tint(Color.accentColor.opacity(0.10)).interactive(), in: .rect(cornerRadius: 22))
        .contentShape(.rect(cornerRadius: 22))
    }
}

// MARK: - Raccourcis

private struct Raccourcis: View {
    @Environment(Session.self) private var session
    @Binding var depot: Bool

    var body: some View {
        GlassEffectContainer(spacing: 12) {
            HStack(spacing: 12) {
                raccourci("Écrire au camping", "bubble.left.and.text.bubble.right") { session.onglet = .messages }
                raccourci("Envoyer un document", "arrow.up.doc") { depot = true }
                raccourci("Mes documents", "folder") { session.onglet = .documents }
            }
        }
    }

    private func raccourci(_ titre: String, _ symbole: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 8) {
                Image(systemName: symbole)
                    .font(.title2)
                    .foregroundStyle(Color.accentColor)
                    .frame(height: 28)
                Text(titre)
                    .font(.footnote.weight(.medium))
                    .multilineTextAlignment(.center)
                    .lineLimit(2, reservesSpace: true)
                    .foregroundStyle(.primary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .padding(.horizontal, 6)
            .contentShape(.rect(cornerRadius: 22))
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 22))
    }
}

// MARK: - Lignes

struct LignePrestation: View {
    let prestation: Prestation

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 3) {
                Text(prestation.designation ?? prestation.libelleType).font(.body.weight(.medium))
                Text(details).font(.footnote).foregroundStyle(.secondary)
            }
            Spacer()
            if let m = prestation.montant_ttc { Text(Format.euros(m.valeur)).font(.body.monospacedDigit()) }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
    }

    private var details: String {
        var s = prestation.libelleType
        if prestation.date_debut != nil {
            s += " · du \(Format.jour(prestation.date_debut))"
            if prestation.date_fin != nil { s += " au \(Format.jour(prestation.date_fin))" }
        }
        return s
    }
}

struct LigneFacture: View {
    let facture: Facture

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: facture.statut == "avoir" ? "arrow.uturn.backward.circle" : "doc.text")
                .font(.title3)
                .foregroundStyle(Color.accentColor)
                .frame(width: 38, height: 38)
                .background(Color.accentColor.opacity(0.12), in: .rect(cornerRadius: 11))
            VStack(alignment: .leading, spacing: 4) {
                Text(facture.titre).font(.body.weight(.semibold))
                PastilleEtat(facture: facture)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 4) {
                Text(Format.euros(facture.total_ttc.valeur)).font(.body.weight(.semibold).monospacedDigit())
                if let n = facture.numero { Text(n).font(.caption).foregroundStyle(.secondary) }
            }
        }
        .contentShape(.rect)
    }
}

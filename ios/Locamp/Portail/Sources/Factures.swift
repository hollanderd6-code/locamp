import SwiftUI

/// Factures : celles a regler en tete, puis l'historique par annee.
/// Toucher une facture ouvre son PDF dans l'apercu natif.
struct FacturesView: View {
    @Environment(Session.self) private var session
    @Environment(Espace.self) private var espace
    @State private var apercu = Apercu()
    @State private var filtre = Filtre.toutes
    @State private var paiement: String?
    @Environment(\.openURL) private var ouvrir

    enum Filtre: String, CaseIterable, Identifiable {
        case toutes = "Toutes", aRegler = "À régler", payees = "Payées"
        var id: String { rawValue }
    }

    private var liste: [Facture] {
        switch filtre {
        case .toutes: espace.factures
        case .aRegler: espace.dues
        case .payees: espace.factures.filter { $0.etat == .payee }
        }
    }

    /// Les factures regroupees par annee d'emission, la plus recente d'abord.
    private var parAnnee: [(annee: String, factures: [Facture])] {
        let g = Dictionary(grouping: liste) { String(($0.date_emission ?? $0.periode ?? "—").prefix(4)) }
        return g.keys.sorted(by: >).map { ($0, g[$0]!) }
    }

    var body: some View {
        VueChargement(etat: espace.etat, reessayer: espace.charger) { _ in
            List {
                if espace.totalDu > 0.004 && filtre != .payees {
                    Section {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Reste à régler").font(.subheadline).foregroundStyle(.secondary)
                                Text(Format.euros(espace.totalDu)).font(.title2.weight(.bold).monospacedDigit())
                            }
                            Spacer()
                            Image(systemName: espace.retardMax > 0 ? "exclamationmark.triangle.fill" : "clock")
                                .font(.title2)
                                .foregroundStyle(espace.retardMax > 0 ? .red : .orange)
                        }
                        .padding(.vertical, 4)
                    }
                }

                ForEach(parAnnee, id: \.annee) { groupe in
                    Section(groupe.annee) {
                        ForEach(groupe.factures) { f in
                            Button { ouvrirPdf(f) } label: { LigneFacture(facture: f) }
                                .buttonStyle(.plain)
                                .swipeActions(edge: .trailing) {
                                    if espace.paiementPossible && f.aRegler {
                                        Button("Payer", systemImage: "creditcard") { Task { await payer(f) } }
                                            .tint(Color.accentColor)
                                    }
                                }
                                .contextMenu {
                                    Button("Voir le PDF", systemImage: "doc.richtext") { ouvrirPdf(f) }
                                    if espace.paiementPossible && f.aRegler {
                                        Button("Payer \(Format.euros(f.reste.valeur))", systemImage: "creditcard") {
                                            Task { await payer(f) }
                                        }
                                    }
                                }
                        }
                    }
                }
            }
            .overlay {
                if liste.isEmpty {
                    ContentUnavailableView(filtre == .toutes ? "Aucune facture" : "Rien ici",
                                           systemImage: "doc.text",
                                           description: Text(filtre == .aRegler ? "Vous êtes à jour. Merci !"
                                                             : "Vos factures apparaîtront ici dès leur émission."))
                }
            }
            .refreshable { await espace.charger() }
            .safeAreaInset(edge: .top, spacing: 0) {
                Picker("Filtre", selection: $filtre) {
                    ForEach(Filtre.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
            }
        }
        .navigationTitle("Factures")
        .toolbarTitleDisplayMode(.large)
        .barreEspace()
        .apercu(apercu)
        .sensoryFeedback(.selection, trigger: filtre)
    }

    private func ouvrirPdf(_ f: Facture) {
        apercu.ouvrir(nom: "Facture \(f.numero ?? f.titre).pdf") {
            try await API.requete("/api/portail/factures/\(f.id)/pdf", as: LienSigne.self).url
        }
    }

    private func payer(_ f: Facture) async {
        guard paiement == nil else { return }
        paiement = f.id
        defer { paiement = nil }
        do {
            let r = try await API.requete("/api/portail/factures/\(f.id)/payer", methode: "POST", as: LienSigne.self)
            if let u = URL(string: r.url) { ouvrir(u) }
        } catch {
            session.afficher(error.localizedDescription, erreur: true)
        }
    }
}

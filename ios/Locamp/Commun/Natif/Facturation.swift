import SwiftUI

/// Section a ouvrir quand on arrive sur l'onglet (tuiles de l'accueil).
@MainActor enum SectionFacturation { static var demandee: String? }

/// Facturation : Factures, Reglements, Impayes.
struct FacturationView: View {
    enum Section_: String, CaseIterable, Identifiable {
        case factures = "Factures", reglements = "Règlements", impayes = "Impayés"
        var id: String { rawValue }
    }

    @State private var section = Section_.factures
    @State private var encaisser = false
    @State private var revision = 0
    @State private var generer = false

    private func genererMois() async {
        struct R: Decodable { let crees: Int?; let ignores: Int?; let erreurs: Int? }
        do {
            let r = try await ClientAPI.partage.requete("/api/factures/run-mensuel", methode: "POST", corps: [:], as: R.self)
            Pont.partage.afficherToast("\(r.crees ?? 0) facture\((r.crees ?? 0) > 1 ? "s" : "") créée\((r.crees ?? 0) > 1 ? "s" : "")"
                                       + ((r.erreurs ?? 0) > 0 ? " · \(r.erreurs!) erreur\(r.erreurs! > 1 ? "s" : "")" : ""),
                                       erreur: (r.erreurs ?? 0) > 0)
            section = .factures
            ClientAPI.partage.revision += 1
        } catch {
            Pont.partage.afficherToast(error.localizedDescription, erreur: true)
        }
    }

    var body: some View {
        Group {
            switch section {
            case .factures: ListeFactures()
            case .reglements: ListeReglements(revision: revision)
            case .impayes: ListeImpayes()
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            Picker("Section", selection: $section) {
                ForEach(Section_.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16).padding(.bottom, 8)
        }
        .navigationTitle(section.rawValue)
        .toolbarTitleDisplayMode(.large)
        .barreGestion()
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu("Plus d'actions", systemImage: "ellipsis") {
                    Button("Générer la facturation du mois", systemImage: "doc.badge.plus") { generer = true }
                }
            }
            ToolbarSpacer(.fixed, placement: .topBarTrailing)
            ToolbarItem(placement: .topBarTrailing) {
                Button("Encaisser un paiement", systemImage: "eurosign") { encaisser = true }
                    .buttonStyle(.glassProminent)
            }
        }
        .alert("Générer la facturation de \(Date.now.formatted(.dateTime.month(.wide).year().locale(Fmt.fr))) ?", isPresented: $generer) {
            Button("Annuler", role: .cancel) {}
            Button("Générer") { Task { await genererMois() } }
        } message: {
            Text("Crée les brouillons du mois pour tous les résidents (loyer, charges et prestations en cours). Vous les vérifiez puis les émettez.")
        }
        .sheet(isPresented: $encaisser, onDismiss: { revision += 1 }) { EncaisserView() }
        .sensoryFeedback(.selection, trigger: section)
        .onAppear {
            if let d = SectionFacturation.demandee, let s = Section_.allCases.first(where: { String(describing: $0) == d }) {
                section = s
            }
            SectionFacturation.demandee = nil
        }
        .navigationDestination(for: ResidentCible.self) { FicheResidentView(residentId: $0.id) }
    }
}

/// Noms des residents, pour afficher « a qui » sur chaque ligne.
@MainActor
enum AnnuaireResidents {
    static var noms: [String: String] = [:]
    static func charger() async {
        if let r = try? await ClientAPI.partage.requete("/api/residents", as: ReponseResidents2.self) {
            noms = Dictionary(r.residents.map { ($0.id, $0.nomComplet) }, uniquingKeysWith: { a, _ in a })
        }
    }
}

// MARK: - Factures

private struct ListeFactures: View {
    @State private var source = Source<[FactureG]> {
        let ex = ClientAPI.partage.exercice
        async let f = ClientAPI.partage.requete("/api/factures" + (ex.isEmpty ? "" : "?" + ex), as: ReponseFacturesG.self)
        await AnnuaireResidents.charger()
        return try await f.factures
    }
    @State private var filtre = "toutes"
    @State private var recherche = ""
    @State private var apercu = ApercuFichier()

    /// Emettre un brouillon : numero definitif, entree dans la chaine fiscale.
    private func emettre(_ f: FactureG) async {
        do {
            _ = try await ClientAPI.partage.requete("/api/factures/\(f.id)/emettre", methode: "POST", corps: [:], as: ClientAPI.Vide.self)
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            Pont.partage.afficherToast("Facture émise")
            await source.rafraichir()
        } catch {
            Pont.partage.afficherToast(error.localizedDescription, erreur: true)
        }
    }

    var body: some View {
        Chargeur(etat: source.etat, reessayer: source.rafraichir) { factures in
            let liste = factures.filter { f in
                switch filtre {
                case "impayees": guard f.reste > 0.004 && !["brouillon", "avoir", "annulee"].contains(f.statut) else { return false }
                case "brouillons": guard f.statut == "brouillon" else { return false }
                case "reglees": guard f.statut == "reglee" else { return false }
                default: break
                }
                let q = recherche.trimmingCharacters(in: .whitespaces)
                guard !q.isEmpty else { return true }
                let nom = f.resident_id.flatMap { AnnuaireResidents.noms[$0] } ?? ""
                return [f.numero ?? "", nom, f.titre].contains { $0.localizedStandardContains(q) }
            }
            List {
                Section {
                    Picker("Filtre", selection: $filtre) {
                        Text("Toutes").tag("toutes")
                        Text("Impayées").tag("impayees")
                        Text("Brouillons").tag("brouillons")
                        Text("Réglées").tag("reglees")
                    }
                    .pickerStyle(.menu)
                }
                Section("\(liste.count) facture\(liste.count > 1 ? "s" : "")") {
                    ForEach(liste) { f in
                        Button {
                            apercu.ouvrirLien(nom: "Facture \(f.numero ?? f.titre).pdf", chemin: "/api/factures/\(f.id)/pdf")
                        } label: {
                            LigneFactureG(facture: f, nom: f.resident_id.flatMap { AnnuaireResidents.noms[$0] })
                        }
                        .buttonStyle(.plain)
                        .swipeActions(edge: .trailing) {
                            if f.statut == "brouillon" {
                                Button("Émettre", systemImage: "paperplane") { Task { await emettre(f) } }
                                    .tint(Color.accentColor)
                            }
                        }
                        .contextMenu {
                            if f.statut == "brouillon" {
                                Button("Émettre la facture", systemImage: "paperplane") { Task { await emettre(f) } }
                            }
                            if let r = f.resident_id {
                                NavigationLink(value: ResidentCible(id: r)) { Label("Voir le résident", systemImage: "person.crop.circle") }
                            }
                        }
                    }
                }
            }
            .overlay {
                if liste.isEmpty {
                    ContentUnavailableView("Aucune facture", systemImage: "doc.text",
                                           description: Text("« Générer la facturation du mois » se fait depuis le site pour l'instant."))
                }
            }
            .searchable(text: $recherche, prompt: "Numéro, résident, période")
        }
        .charger(source)
        .apercu(apercu)
    }
}

struct LigneFactureG: View {
    let facture: FactureG
    var nom: String? = nil

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(nom ?? facture.titre).font(.body.weight(.semibold)).lineLimit(1)
                Text([facture.numero, nom == nil ? nil : facture.titre].compactMap { $0 }.joined(separator: " · "))
                    .font(.footnote).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 4) {
                Text(facture.total_ttc.euros).font(.body.weight(.semibold).monospacedDigit())
                Pastille(texte: facture.libelleStatut, couleur: couleurStatut(facture.statut))
            }
        }
        .contentShape(.rect)
    }
}

// MARK: - Reglements

private struct ListeReglements: View {
    let revision: Int
    @State private var source = Source<[Reglement]> {
        let ex = ClientAPI.partage.exercice
        async let g = ClientAPI.partage.requete("/api/reglements" + (ex.isEmpty ? "" : "?" + ex), as: ReponseReglements.self)
        await AnnuaireResidents.charger()
        return try await g.reglements
    }

    var body: some View {
        Chargeur(etat: source.etat, reessayer: source.rafraichir) { liste in
            let total = liste.filter { $0.annule != true }.reduce(0) { $0 + $1.montant.valeur }
            List {
                Section {
                    LabeledContent("Total encaissé") { Text(Fmt.euros(total)).fontWeight(.semibold) }
                    LabeledContent("Encaissements", value: "\(liste.count)")
                }
                Section {
                    ForEach(liste) { g in
                        LigneReglement(reglement: g, nom: g.resident_id.flatMap { AnnuaireResidents.noms[$0] })
                    }
                }
            }
            .overlay {
                if liste.isEmpty {
                    ContentUnavailableView("Aucun règlement", systemImage: "eurosign.circle",
                                           description: Text("« Encaisser un paiement » enregistre le premier."))
                }
            }
        }
        .charger(source)
        .onChange(of: revision) { _, _ in Task { await source.rafraichir() } }
    }
}

struct LigneReglement: View {
    let reglement: Reglement
    let nom: String?

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: symbole)
                .foregroundStyle(Color.accentColor)
                .frame(width: 34, height: 34)
                .background(Color.accentColor.opacity(0.12), in: .rect(cornerRadius: 10))
            VStack(alignment: .leading, spacing: 2) {
                Text(nom ?? Fmt.modeLibelle(reglement.mode)).font(.body.weight(.medium)).lineLimit(1)
                Text([nom == nil ? nil : Fmt.modeLibelle(reglement.mode), Fmt.jour(reglement.date_reglement), reglement.reference]
                        .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.footnote).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 8)
            Text(reglement.montant.euros)
                .font(.body.weight(.semibold).monospacedDigit())
                .strikethrough(reglement.annule == true)
                .foregroundStyle(reglement.annule == true ? Color.secondary : Color.green)
        }
    }

    private var symbole: String {
        switch reglement.mode {
        case "cheque": "checkmark.rectangle"
        case "virement": "arrow.left.arrow.right"
        case "carte", "stripe": "creditcard"
        case "espece": "banknote"
        default: "eurosign"
        }
    }
}

// MARK: - Impayes

private struct ListeImpayes: View {
    @State private var source = Source<Impayes> {
        let ex = ClientAPI.partage.exercice
        async let i = ClientAPI.partage.requete("/api/relances/impayes" + (ex.isEmpty ? "" : "?" + ex), as: Impayes.self)
        await AnnuaireResidents.charger()
        return try await i
    }
    @State private var relance = false
    @State private var envoi = false

    var body: some View {
        Chargeur(etat: source.etat, reessayer: source.rafraichir) { d in
            List {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Créance totale").font(.subheadline).foregroundStyle(.secondary)
                        Text(d.total_du.euros).font(.largeTitle.weight(.bold).monospacedDigit())
                            .foregroundStyle(d.total_du.valeur > 0 ? Color.red : Color.primary)
                        Text("\(d.impayes.count) facture\(d.impayes.count > 1 ? "s" : "") · \(d.impayes.filter(\.en_retard).count) en retard")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                    BalanceAgee(aging: d.aging)
                }
                if !d.impayes.isEmpty {
                    Section("Débiteurs") {
                        ForEach(d.impayes.sorted { $0.jours_retard > $1.jours_retard }) { l in
                            NavigationLink(value: ResidentCible(id: l.resident_id ?? "")) {
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(l.resident_id.flatMap { AnnuaireResidents.noms[$0] } ?? "—").font(.body.weight(.semibold))
                                        Text("\(l.numero ?? "") · \(l.en_retard ? "retard \(l.jours_retard) j" : "à échoir")")
                                            .font(.footnote).foregroundStyle(l.en_retard ? Color.red : Color.secondary)
                                    }
                                    Spacer()
                                    Text(l.reste.euros).font(.body.weight(.semibold).monospacedDigit())
                                }
                            }
                            .disabled(l.resident_id == nil)
                        }
                    }
                    Section {
                        Button { relance = true } label: { Label("Envoyer les relances", systemImage: "paperplane") }
                            .disabled(envoi)
                    } footer: {
                        Text("Un e-mail de relance part pour chaque facture échue du camping.")
                    }
                }
            }
            .overlay {
                if d.impayes.isEmpty {
                    ContentUnavailableView("Aucun impayé", systemImage: "checkmark.seal",
                                           description: Text("Toutes les factures de l'exercice sont réglées."))
                }
            }
            .alert("Envoyer les relances ?", isPresented: $relance) {
                Button("Annuler", role: .cancel) {}
                Button("Envoyer") { Task { await relancer() } }
            } message: {
                Text("Un e-mail part pour chaque facture échue.")
            }
        }
        .charger(source)
    }

    private func relancer() async {
        envoi = true
        defer { envoi = false }
        struct R: Decodable { let envoyees: Int?; let ignorees: Int? }
        do {
            let r = try await ClientAPI.partage.requete("/api/relances/run", methode: "POST", corps: [:], as: R.self)
            Pont.partage.afficherToast("\(r.envoyees ?? 0) relance\((r.envoyees ?? 0) > 1 ? "s" : "") envoyée\((r.envoyees ?? 0) > 1 ? "s" : "")")
            await source.rafraichir()
        } catch {
            Pont.partage.afficherToast(error.localizedDescription, erreur: true)
        }
    }
}

private struct BalanceAgee: View {
    let aging: Impayes.Aging

    var body: some View {
        let tranches: [(String, Double, Color)] = [
            ("À échoir", aging.a_echoir.valeur, .secondary), ("0-30 j", aging.j0_30.valeur, .yellow),
            ("31-60 j", aging.j31_60.valeur, .orange), ("61-90 j", aging.j61_90.valeur, .red), ("90 j +", aging.j90_plus.valeur, .purple),
        ]
        let max = Swift.max(tranches.map(\.1).max() ?? 0, 1)
        VStack(spacing: 8) {
            ForEach(tranches, id: \.0) { t in
                HStack(spacing: 10) {
                    Text(t.0).font(.footnote).foregroundStyle(.secondary).frame(width: 64, alignment: .leading)
                    GeometryReader { g in
                        Capsule().fill(t.2.opacity(0.75)).frame(width: Swift.max(4, g.size.width * t.1 / max))
                    }
                    .frame(height: 10)
                    Text(Fmt.eurosCourts(t.1)).font(.footnote.monospacedDigit()).frame(width: 74, alignment: .trailing)
                }
            }
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }
}

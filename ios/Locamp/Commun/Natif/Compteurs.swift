import SwiftUI

struct ListeCompteurs: Decodable {
    struct Releve: Decodable, Hashable { let date_releve: String?; let index_kwh: Montant?; let conso_kwh: Montant? }
    struct Occupant: Decodable, Hashable { let id: String; let nom: String?; let prenom: String? }
    struct Ligne: Decodable, Identifiable, Hashable {
        let id: String
        let numero: TexteSouple?
        let secteur: String?
        let resident: Occupant?
        let dernier_releve: Releve?
        var nom: String { [resident?.prenom, resident?.nom].compactMap { $0 }.joined(separator: " ") }
        /// Releve ce mois-ci ?
        var releveCeMois: Bool {
            guard let d = dernier_releve?.date_releve else { return false }
            return d.prefix(7) == Date.now.formatted(.iso8601.year().month()).prefix(7)
        }
    }
    let type: String
    let unite: String
    let prix: Double?
    let emplacements: [Ligne]
}

/// Releves de compteurs (electricite, eau). Pense pour la tournee : on
/// saisit un index, l'app passe a l'emplacement suivant.
struct CompteursView: View {
    enum Fluide: String, CaseIterable, Identifiable { case elec, eau; var id: String { rawValue }
        var titre: String { self == .elec ? "Électricité" : "Eau" } }
    enum Filtre: String, CaseIterable, Identifiable { case aRelever = "À relever", tous = "Tous", releves = "Relevés"; var id: String { rawValue } }

    @State private var fluide = Fluide.elec
    @State private var filtre = Filtre.aRelever
    @State private var recherche = ""
    @State private var donnees: EtatChargement<ListeCompteurs> = .enCours
    @State private var saisie: ListeCompteurs.Ligne?

    var body: some View {
        Chargeur(etat: donnees, reessayer: charger) { d in
            let liste = filtrer(d)
            let releves = d.emplacements.filter(\.releveCeMois).count
            List {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text("Tournée du mois").font(.subheadline.weight(.semibold))
                            Spacer()
                            Text("\(releves) / \(d.emplacements.count)").font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
                        }
                        ProgressView(value: Double(releves), total: Double(max(d.emplacements.count, 1))).tint(Color.accentColor)
                        if let p = d.prix {
                            Text("Prix : \(p.formatted(.currency(code: "EUR").precision(.fractionLength(2...4)).locale(Fmt.fr))) TTC / \(d.unite)")
                                .font(.caption).foregroundStyle(.secondary)
                        } else {
                            Text("Aucun tarif configuré : les relevés sont enregistrés sans charge.").font(.caption).foregroundStyle(.orange)
                        }
                    }
                    .padding(.vertical, 4)
                }
                Section {
                    ForEach(liste) { l in
                        Button { saisie = l } label: { LigneCompteur(ligne: l, unite: d.unite) }
                            .buttonStyle(.plain)
                    }
                }
            }
            .overlay {
                if liste.isEmpty {
                    ContentUnavailableView(filtre == .aRelever ? "Tournée terminée" : "Aucun emplacement",
                                           systemImage: filtre == .aRelever ? "checkmark.seal" : "gauge.with.dots.needle.33percent",
                                           description: Text(filtre == .aRelever ? "Tous les compteurs sont relevés ce mois-ci." : ""))
                }
            }
            .sheet(item: $saisie) { l in
                SaisieReleve(ligne: l, fluide: fluide, unite: d.unite, prix: d.prix) { suivant in
                    Task {
                        await charger()
                        // Tournee : on enchaine sur le prochain emplacement a relever.
                        if suivant, let liste = donnees.valeur.map(filtrer),
                           let i = liste.firstIndex(where: { $0.id == l.id }) ?? liste.firstIndex(where: { !$0.releveCeMois }) {
                            let prochain = liste.dropFirst(i).first { $0.id != l.id && !$0.releveCeMois }
                            saisie = nil
                            if let prochain { try? await Task.sleep(for: .milliseconds(450)); saisie = prochain }
                        } else { saisie = nil }
                    }
                }
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            VStack(spacing: 8) {
                Picker("Fluide", selection: $fluide) { ForEach(Fluide.allCases) { Text($0.titre).tag($0) } }
                Picker("Filtre", selection: $filtre) { ForEach(Filtre.allCases) { Text($0.rawValue).tag($0) } }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16).padding(.bottom, 8)
        }
        .navigationTitle("Compteurs")
        .toolbarTitleDisplayMode(.large)
        .searchable(text: $recherche, prompt: "Emplacement ou résident")
        .barreGestion()
        .task(id: "\(ClientAPI.partage.revision)-\(fluide.rawValue)") { await charger() }
        .refreshable { await charger() }
    }

    private func charger() async {
        do {
            let d = try await ClientAPI.partage.requete("/api/compteurs?type=\(fluide.rawValue)", as: ListeCompteurs.self)
            withAnimation(.smooth) { donnees = .pret(d) }
        } catch ClientAPI.Erreur.horsSession {
        } catch is CancellationError {
        } catch {
            if donnees.valeur == nil { donnees = .echec(error.localizedDescription) }
        }
    }

    private func filtrer(_ d: ListeCompteurs) -> [ListeCompteurs.Ligne] {
        let q = recherche.trimmingCharacters(in: .whitespaces)
        return d.emplacements.filter { l in
            switch filtre {
            case .aRelever: guard !l.releveCeMois else { return false }
            case .releves: guard l.releveCeMois else { return false }
            case .tous: break
            }
            return q.isEmpty || (l.numero?.valeur ?? "").localizedStandardContains(q) || l.nom.localizedStandardContains(q)
        }
    }
}

private struct LigneCompteur: View {
    let ligne: ListeCompteurs.Ligne
    let unite: String

    var body: some View {
        HStack(spacing: 12) {
            Text(ligne.numero?.valeur ?? "—")
                .font(.headline.monospacedDigit())
                .frame(width: 52, height: 40)
                .background((ligne.releveCeMois ? Color.green : Color.accentColor).opacity(0.13), in: .rect(cornerRadius: 10))
                .foregroundStyle(ligne.releveCeMois ? Color.green : Color.accentColor)
            VStack(alignment: .leading, spacing: 2) {
                Text(ligne.nom.isEmpty ? "Libre" : ligne.nom).font(.body.weight(.medium)).lineLimit(1)
                if let r = ligne.dernier_releve {
                    Text("Dernier : \(Self.index(r.index_kwh?.valeur)) \(unite) · \(Fmt.jour(r.date_releve))")
                        .font(.footnote).foregroundStyle(.secondary)
                } else {
                    Text("Jamais relevé").font(.footnote).foregroundStyle(.orange)
                }
            }
            Spacer()
            Image(systemName: ligne.releveCeMois ? "checkmark.circle.fill" : "plus.circle")
                .font(.title3)
                .foregroundStyle(ligne.releveCeMois ? Color.green : Color.accentColor)
        }
        .contentShape(.rect)
    }

    static func index(_ v: Double?) -> String {
        guard let v else { return "—" }
        return v.formatted(.number.precision(.fractionLength(0...2)).locale(Fmt.fr))
    }
}

/// Saisie d'un index, conso et cout calcules en direct.
private struct SaisieReleve: View {
    let ligne: ListeCompteurs.Ligne
    let fluide: CompteursView.Fluide
    let unite: String
    let prix: Double?
    let termine: (_ suivant: Bool) -> Void

    @Environment(\.dismiss) private var fermer
    @State private var index: Double?
    @State private var date = Date.now
    @State private var envoi = false
    @State private var erreur: String?
    @State private var alerte: String?
    @FocusState private var focus: Bool

    private var precedent: Double? { ligne.dernier_releve?.index_kwh?.valeur }
    private var conso: Double? {
        guard let index, let precedent else { return nil }
        return index - precedent
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Nouvel index", value: $index, format: .number.locale(Fmt.fr))
                        .keyboardType(.decimalPad)
                        .font(.system(size: 34, weight: .semibold, design: .rounded).monospacedDigit())
                        .focused($focus)
                    DatePicker("Date du relevé", selection: $date, in: ...Date.now, displayedComponents: .date)
                        .environment(\.locale, Fmt.fr)
                } header: {
                    Text(ligne.nom.isEmpty ? "Emplacement libre" : ligne.nom)
                } footer: {
                    if let p = precedent {
                        Text("Précédent : \(LigneCompteur.index(p)) \(unite) le \(Fmt.jour(ligne.dernier_releve?.date_releve))")
                    } else {
                        Text("Premier relevé de ce compteur : il sert de point de départ, sans charge.")
                    }
                }

                if let c = conso {
                    Section("Consommation") {
                        LabeledContent("Conso", value: "\(LigneCompteur.index(c)) \(unite)")
                            .foregroundStyle(c < 0 ? Color.red : Color.primary)
                        if let prix, c > 0, ligne.resident != nil {
                            LabeledContent("Charge estimée", value: Fmt.euros(c * prix))
                        }
                        if c < 0 {
                            Label("Index inférieur au précédent.", systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red)
                        }
                    }
                }
                if let alerte {
                    Section { Label(alerte, systemImage: "exclamationmark.triangle").foregroundStyle(.orange) }
                }
                if let erreur {
                    Section { Label(erreur, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red) }
                }
            }
            .navigationTitle("Emplacement \(ligne.numero?.valeur ?? "")")
            .toolbarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Fermer", systemImage: "xmark") { termine(false) } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Enregistrer", systemImage: "checkmark") { Task { await enregistrer() } }
                        .buttonStyle(.glassProminent)
                        .disabled(index == nil || (conso ?? 0) < 0 || envoi)
                }
            }
            .onAppear { focus = true }
        }
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled(envoi)
    }

    private func enregistrer() async {
        guard let index else { return }
        envoi = true; erreur = nil
        defer { envoi = false }
        struct R: Decodable { let alerte: String?; let info: String? }
        do {
            let r = try await ClientAPI.partage.requete("/api/compteurs/releve", methode: "POST", corps: [
                "emplacement_id": ligne.id, "index_kwh": index, "type": fluide.rawValue,
                "date_releve": date.formatted(.iso8601.year().month().day()),
            ], as: R.self)
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            if let a = r.alerte {
                // Surconsommation : on montre l'avertissement avant de passer au suivant.
                alerte = a
                try? await Task.sleep(for: .seconds(3))
            }
            Pont.partage.afficherToast("Relevé enregistré · emplacement \(ligne.numero?.valeur ?? "")")
            termine(true)
        } catch {
            erreur = error.localizedDescription
        }
    }
}

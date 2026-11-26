import SwiftUI

/// Encaisser un paiement : resident, montant, moyen, reference, date.
/// Le serveur lettre automatiquement sur les factures les plus anciennes
/// et inscrit l'encaissement dans la chaine fiscale (routes/reglements.js).
struct EncaisserView: View {
    var residentInitial: ResidentCible? = nil
    var nomInitial: String? = nil

    @Environment(\.dismiss) private var fermer
    @State private var residents: [Resident] = []
    @State private var moyens: [MoyenPaiement] = []
    @State private var resident: ResidentCible?
    @State private var nom = ""
    @State private var montant: Double?
    @State private var mode = ""
    @State private var reference = ""
    @State private var date = Date.now
    @State private var choix = false
    @State private var envoi = false
    @State private var erreur: String?
    @FocusState private var champMontant: Bool

    private var moyen: MoyenPaiement? { moyens.first { $0.code == mode } }
    private var valide: Bool {
        (montant ?? 0) > 0 && !mode.isEmpty
            && (moyen?.referenceRequise == nil || !reference.trimmingCharacters(in: .whitespaces).isEmpty)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Résident") {
                    Button { choix = true } label: {
                        HStack {
                            if resident != nil { Avatar(nom: nom, taille: 32) }
                            Text(resident == nil ? "Choisir un résident" : nom)
                                .foregroundStyle(resident == nil ? Color.accentColor : Color.primary)
                            Spacer()
                            Image(systemName: "chevron.right").font(.footnote).foregroundStyle(.tertiary)
                        }
                    }
                }
                Section("Paiement") {
                    TextField("Montant", value: $montant, format: .currency(code: "EUR").locale(Fmt.fr))
                        .keyboardType(.decimalPad)
                        .focused($champMontant)
                        .font(.title2.weight(.semibold))
                    Picker("Moyen", selection: $mode) {
                        ForEach(moyens) { m in Text(m.libelle).tag(m.code) }
                    }
                    if let r = moyen?.referenceRequise {
                        TextField(r + " (obligatoire)", text: $reference)
                    } else {
                        TextField("Référence (facultatif)", text: $reference)
                    }
                    DatePicker("Date", selection: $date, in: ...Date.now, displayedComponents: .date)
                        .environment(\.locale, Fmt.fr)
                }
                Section {
                } footer: {
                    Text("Le paiement est affecté automatiquement aux factures les plus anciennes du résident.")
                }
                if let erreur {
                    Section { Label(erreur, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red) }
                }
            }
            .navigationTitle("Encaisser")
            .toolbarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Annuler", systemImage: "xmark") { fermer() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Encaisser", systemImage: "checkmark") { Task { await envoyer() } }
                        .buttonStyle(.glassProminent)
                        .disabled(!valide || envoi)
                }
            }
            .overlay { if envoi { ProgressView().controlSize(.large).padding(24).glassEffect(.regular, in: .rect(cornerRadius: 20)) } }
            .sheet(isPresented: $choix) {
                ChoixResidentG(residents: residents) { r in
                    resident = ResidentCible(id: r.id); nom = r.nomComplet; choix = false
                    if montant == nil, let s = r.solde?.valeur, s > 0 { montant = s }
                    champMontant = true
                }
            }
            .task {
                resident = residentInitial
                nom = nomInitial ?? ""
                async let m = try? ClientAPI.partage.requete("/api/moyens-paiement", as: ReponseMoyens.self)
                async let r = try? ClientAPI.partage.requete("/api/residents", as: ReponseResidents2.self)
                let (mm, rr) = await (m, r)
                moyens = mm?.moyens ?? []
                residents = (rr?.residents ?? []).filter(\.estActif)
                if mode.isEmpty { mode = moyens.first?.code ?? "" }
                if montant == nil, let id = residentInitial?.id, let s = residents.first(where: { $0.id == id })?.solde?.valeur, s > 0 {
                    montant = s
                }
            }
        }
        .interactiveDismissDisabled(envoi)
    }

    private func envoyer() async {
        envoi = true; erreur = nil
        defer { envoi = false }
        var corps: [String: Any] = ["mode": mode, "montant": montant ?? 0,
                                    "date_reglement": date.formatted(.iso8601.year().month().day())]
        if let r = resident?.id { corps["resident_id"] = r }
        let ref = reference.trimmingCharacters(in: .whitespaces)
        if !ref.isEmpty { corps["reference"] = ref }
        do {
            _ = try await ClientAPI.partage.requete("/api/reglements", methode: "POST", corps: corps, as: ClientAPI.Vide.self)
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            Pont.partage.afficherToast("Paiement de \(Fmt.euros(montant ?? 0)) encaissé")
            Pont.partage.rafraichirBadges()
            fermer()
        } catch {
            erreur = error.localizedDescription
        }
    }
}

private struct ChoixResidentG: View {
    let residents: [Resident]
    let choisir: (Resident) -> Void
    @Environment(\.dismiss) private var fermer
    @State private var recherche = ""

    var body: some View {
        NavigationStack {
            List(residents.filter { recherche.isEmpty || $0.nomComplet.localizedStandardContains(recherche) }) { r in
                Button { choisir(r) } label: {
                    HStack(spacing: 12) {
                        Avatar(nom: r.nomComplet, taille: 34)
                        Text(r.nomComplet).foregroundStyle(.primary)
                        Spacer()
                        if r.soldeDu, let s = r.solde { Text(s.euros).font(.subheadline.monospacedDigit()).foregroundStyle(.red) }
                    }
                }
            }
            .searchable(text: $recherche, placement: .navigationBarDrawer(displayMode: .always), prompt: "Résident")
            .navigationTitle("Résident")
            .toolbarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Annuler", systemImage: "xmark") { fermer() } } }
        }
        .presentationDetents([.medium, .large])
    }
}

import SwiftUI

/// Liste des residents : recherche, filtres, solde ; toucher ouvre la fiche.
struct ResidentsView: View {
    struct Donnees { let residents: [Resident]; let emplacements: [String: String] }

    @State private var source = Source<Donnees> {
        let api = ClientAPI.partage
        async let r = api.requete("/api/residents", as: ReponseResidents2.self)
        async let e = try? api.requete("/api/emplacements", as: ReponseEmplacements.self)
        let (rr, ee) = try await (r, e)
        var m: [String: String] = [:]
        for x in ee?.emplacements ?? [] { m[x.id] = x.numero?.valeur }
        return Donnees(residents: rr.residents, emplacements: m)
    }
    @State private var recherche = ""
    @State private var filtre = Filtre.actifs
    @State private var nouveau = false

    enum Filtre: String, CaseIterable, Identifiable {
        case actifs = "Actifs", soldeDu = "Solde dû", aCompleter = "À compléter", anciens = "Anciens"
        var id: String { rawValue }
    }

    var body: some View {
        Chargeur(etat: source.etat, reessayer: source.rafraichir) { d in
            let liste = filtrer(d)
            List {
                Section {
                    ForEach(liste) { r in
                        NavigationLink(value: ResidentCible(id: r.id)) {
                            LigneResident(resident: r, emplacement: r.emplacement_id.flatMap { d.emplacements[$0] })
                        }
                        .swipeActions(edge: .leading) {
                            if let t = r.telephone, let u = URL(string: "tel:" + t.filter { $0.isNumber || $0 == "+" }) {
                                Link(destination: u) { Label("Appeler", systemImage: "phone") }.tint(.green)
                            }
                        }
                    }
                } header: {
                    Text("\(liste.count) résident\(liste.count > 1 ? "s" : "")")
                }
            }
            .listStyle(.insetGrouped)
            .overlay {
                if liste.isEmpty {
                    if recherche.isEmpty {
                        ContentUnavailableView("Aucun résident", systemImage: "person.2", description: Text("Rien dans ce filtre."))
                    } else {
                        ContentUnavailableView.search(text: recherche)
                    }
                }
            }
            .safeAreaInset(edge: .top, spacing: 0) {
                Picker("Filtre", selection: $filtre) {
                    ForEach(Filtre.allCases) { f in Text(f.rawValue).tag(f) }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 16).padding(.bottom, 8)
            }
        }
        .navigationTitle("Résidents")
        .toolbarTitleDisplayMode(.large)
        .searchable(text: $recherche, prompt: "Nom, e-mail, téléphone, emplacement")
        .barreGestion()
        .charger(source)
        .navigationDestination(for: ResidentCible.self) { FicheResidentView(residentId: $0.id) }
        .sensoryFeedback(.selection, trigger: filtre)
    }

    private func filtrer(_ d: Donnees) -> [Resident] {
        let q = recherche.trimmingCharacters(in: .whitespaces)
        return d.residents.filter { r in
            switch filtre {
            case .actifs: guard r.estActif else { return false }
            case .soldeDu: guard r.estActif && r.soldeDu else { return false }
            case .aCompleter: guard r.estActif && r.aCompleter else { return false }
            case .anciens: guard !r.estActif else { return false }
            }
            guard !q.isEmpty else { return true }
            let empl = r.emplacement_id.flatMap { d.emplacements[$0] } ?? ""
            return [r.nomComplet, r.email ?? "", r.telephone ?? "", empl].contains { $0.localizedStandardContains(q) }
        }
    }
}

private struct LigneResident: View {
    let resident: Resident
    let emplacement: String?

    var body: some View {
        HStack(spacing: 12) {
            Avatar(nom: resident.nomComplet)
            VStack(alignment: .leading, spacing: 3) {
                Text(resident.nomComplet.isEmpty ? "Sans nom" : resident.nomComplet).font(.body.weight(.semibold))
                HStack(spacing: 6) {
                    if let e = emplacement { Text("Empl. \(e)").font(.footnote).foregroundStyle(.secondary) }
                    if resident.contrat?.signe != true { Pastille(texte: "Sans contrat", couleur: .red) }
                    if resident.assurance_expire_le == nil { Pastille(texte: "Assurance", couleur: .orange) }
                }
            }
            Spacer(minLength: 6)
            if let s = resident.solde, abs(s.valeur) > 0.004 {
                Text(s.euros)
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .foregroundStyle(s.valeur > 0 ? Color.red : Color.green)
            }
        }
    }
}

// MARK: - Fiche

struct FicheResidentView: View {
    let residentId: String

    struct Donnees { let fiche: FicheResident; let factures: [FactureG]; let reglements: [Reglement] }

    @Environment(Pont.self) private var pont
    @State private var source: Source<Donnees>
    @State private var apercu = ApercuFichier()
    @State private var encaisser = false
    @State private var message = false

    init(residentId: String) {
        self.residentId = residentId
        let rid = residentId
        _source = State(initialValue: Source {
            let api = ClientAPI.partage
            async let f = api.requete("/api/residents/\(rid)", as: FicheResident.self)
            async let fa = try? api.requete("/api/factures?resident_id=\(rid)", as: ReponseFacturesG.self)
            async let re = try? api.requete("/api/reglements?resident_id=\(rid)", as: ReponseReglements.self)
            let (ff, ffa, rre) = try await (f, fa, re)
            return Donnees(fiche: ff, factures: ffa?.factures ?? [], reglements: rre?.reglements ?? [])
        })
    }

    var body: some View {
        Chargeur(etat: source.etat, reessayer: source.rafraichir) { d in
            let r = d.fiche.resident
            let du = d.factures.filter { !["brouillon", "avoir", "annulee"].contains($0.statut) }.reduce(0) { $0 + $1.reste }
            List {
                Section {
                    HStack(spacing: 14) {
                        Avatar(nom: r.nomComplet, taille: 58)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(r.nomComplet).font(.title3.weight(.semibold))
                            if let e = d.fiche.emplacement {
                                Text("Emplacement \(e.numero?.valeur ?? "—")\(e.secteur.map { " · \($0)" } ?? "")")
                                    .font(.subheadline).foregroundStyle(.secondary)
                            }
                            if r.actif == false { Pastille(texte: "Ancien résident", couleur: .secondary) }
                        }
                    }
                    GlassEffectContainer(spacing: 10) {
                        HStack(spacing: 10) {
                            if let t = r.telephone, let u = URL(string: "tel:" + t.filter { $0.isNumber || $0 == "+" }) {
                                Link(destination: u) { Label("Appeler", systemImage: "phone.fill").frame(maxWidth: .infinity) }
                                    .buttonStyle(.glass)
                            }
                            Button { message = true } label: { Label("Écrire", systemImage: "bubble.left.fill").frame(maxWidth: .infinity) }
                                .buttonStyle(.glass)
                            Button { encaisser = true } label: { Label("Encaisser", systemImage: "eurosign").frame(maxWidth: .infinity) }
                                .buttonStyle(.glassProminent)
                        }
                        .labelStyle(.titleAndIcon)
                        .controlSize(.regular)
                    }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }

                Section("Compte") {
                    LabeledContent("Reste dû") {
                        Text(du > 0.004 ? Fmt.euros(du) : "À jour").foregroundStyle(du > 0.004 ? Color.red : Color.green)
                            .fontWeight(.semibold)
                    }
                    if let c = r.compte_comptable { LabeledContent("Compte client", value: c) }
                    Button {
                        apercu.ouvrirPDF(nom: "Relevé \(r.nomComplet).pdf", chemin: "/api/residents/\(r.id)/releve.pdf")
                    } label: { Label("Relevé de compte (PDF)", systemImage: "doc.richtext") }
                }

                Section("Coordonnées") {
                    if let e = r.email, !e.isEmpty, let u = URL(string: "mailto:" + e) {
                        Link(destination: u) { LabeledContent("E-mail", value: e) }
                    }
                    if let t = r.telephone, !t.isEmpty { LabeledContent("Téléphone", value: t) }
                    if let a = r.adresse, !a.isEmpty { LabeledContent("Adresse", value: a) }
                    if let s = r.raison_sociale, !s.isEmpty { LabeledContent("Société", value: s) }
                }

                Section("Assurance") {
                    LabeledContent("Échéance", value: r.assurance_expire_le.map { Fmt.jour($0) } ?? "Aucune attestation")
                    if let ref = r.assurance_ref, !ref.isEmpty { LabeledContent("Référence", value: ref) }
                }

                if !d.factures.isEmpty {
                    Section("Factures") {
                        ForEach(d.factures.prefix(12)) { f in
                            Button {
                                apercu.ouvrirLien(nom: "Facture \(f.numero ?? f.titre).pdf", chemin: "/api/factures/\(f.id)/pdf")
                            } label: { LigneFactureG(facture: f) }
                            .buttonStyle(.plain)
                        }
                    }
                }

                if !d.reglements.isEmpty {
                    Section("Règlements") {
                        ForEach(d.reglements.prefix(12)) { g in LigneReglement(reglement: g, nom: nil) }
                    }
                }

                if !d.fiche.documents.isEmpty {
                    Section("Documents") {
                        ForEach(d.fiche.documents) { doc in
                            Button {
                                apercu.ouvrirLien(nom: doc.nom_fichier ?? "Document", chemin: "/api/documents/\(doc.id)/url")
                            } label: {
                                Label {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(doc.nom_fichier ?? "Document").foregroundStyle(.primary)
                                        Text(Fmt.jour(doc.created_at)).font(.caption).foregroundStyle(.secondary)
                                    }
                                } icon: { Image(systemName: "doc") }
                            }
                        }
                    }
                }

                if let n = r.notes_internes, !n.isEmpty {
                    Section("Notes internes") { Text(n).font(.callout) }
                }

            }
            .navigationTitle(r.nomComplet)
            .toolbarTitleDisplayMode(.inline)
            .sheet(isPresented: $encaisser, onDismiss: { Task { await source.rafraichir() } }) {
                EncaisserView(residentInitial: ResidentCible(id: r.id), nomInitial: r.nomComplet)
            }
            .navigationDestination(isPresented: $message) {
                ConversationGestionView(residentId: r.id, nom: r.nomComplet)
            }
        }
        .charger(source)
        .apercu(apercu)
    }
}

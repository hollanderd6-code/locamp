import SwiftUI

struct TVAEncaissements: Decodable {
    struct Taux: Decodable { let base_ht: Montant; let tva: Montant; let ttc: Montant }
    let par_taux: [String: Taux]
    let total_tva_exigible: Montant
    let non_ventile: Montant
}

struct JournalEncaissements: Decodable {
    struct Ligne: Decodable, Identifiable { let mode: String; let libelle: String; let nb: Int; let montant: Montant; var id: String { mode } }
    struct Total: Decodable { let nb: Int; let montant: Montant }
    let lignes: [Ligne]
    let total: Total
}

/// Comptabilite : TVA exigible sur les encaissements, journal par moyen de
/// paiement, exports pour l'expert-comptable.
struct ComptabiliteView: View {
    @State private var debut = Calendar.current.date(from: DateComponents(year: Calendar.current.component(.year, from: .now), month: 1, day: 1)) ?? .now
    @State private var fin = Date.now
    @State private var tva: EtatChargement<TVAEncaissements> = .enCours
    @State private var journal: JournalEncaissements?
    @State private var export: URL?
    @State private var exportEnCours: String?

    private var du: String { debut.formatted(.iso8601.year().month().day()) }
    private var au: String { fin.formatted(.iso8601.year().month().day()) }

    var body: some View {
        List {
            Section("Période") {
                DatePicker("Du", selection: $debut, in: ...fin, displayedComponents: .date)
                DatePicker("Au", selection: $fin, in: debut...Date.now, displayedComponents: .date)
            }
            .environment(\.locale, Fmt.fr)

            Section {
                switch tva {
                case .enCours: HStack { Spacer(); ProgressView(); Spacer() }
                case .echec(let m): Label(m, systemImage: "exclamationmark.triangle").foregroundStyle(.secondary)
                case .pret(let t):
                    LabeledContent("TVA exigible") {
                        Text(t.total_tva_exigible.euros).font(.title3.weight(.bold).monospacedDigit())
                    }
                    ForEach(t.par_taux.keys.sorted { (Double($0) ?? 0) > (Double($1) ?? 0) }, id: \.self) { k in
                        let v = t.par_taux[k]!
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Taux \(k.replacingOccurrences(of: ".", with: ",")) %").font(.subheadline.weight(.semibold))
                            HStack {
                                Text("Base HT \(v.base_ht.euros)")
                                Spacer()
                                Text("TVA \(v.tva.euros)").fontWeight(.medium)
                            }
                            .font(.footnote.monospacedDigit()).foregroundStyle(.secondary)
                        }
                    }
                    if t.non_ventile.valeur > 0.004 {
                        Label("\(t.non_ventile.euros) encaissés sans facture affectée : TVA non ventilée.",
                              systemImage: "exclamationmark.triangle").font(.footnote).foregroundStyle(.orange)
                    }
                }
            } header: {
                Text("TVA sur les encaissements")
            } footer: {
                Text("Régime des encaissements : la TVA est due au paiement, ventilée selon les taux des factures réglées.")
            }

            if let j = journal, !j.lignes.isEmpty {
                Section("Encaissements par moyen") {
                    ForEach(j.lignes) { l in
                        LabeledContent {
                            Text(l.montant.euros).monospacedDigit()
                        } label: {
                            Text(l.libelle)
                            Text("\(l.nb) opération\(l.nb > 1 ? "s" : "")")
                        }
                    }
                    LabeledContent("Total") { Text(j.total.montant.euros).fontWeight(.semibold).monospacedDigit() }
                }
            }

            Section {
                boutonExport("Fichier des écritures comptables (FEC)", "doc.text", chemin: "/api/compta/fec", nom: "FEC_\(au).txt")
                boutonExport("Écritures (CSV, tableur)", "tablecells", chemin: "/api/compta/export.csv", nom: "ecritures_\(du)_\(au).csv")
                boutonExport("Export logiciel comptable", "square.and.arrow.up", chemin: "/api/compta/export-logiciel", nom: "export_compta_\(du)_\(au).txt")
            } header: {
                Text("Exports")
            } footer: {
                Text("Le FEC est le format exigé par l'administration fiscale. Partagez-le par Mail, AirDrop ou Fichiers.")
            }
        }
        .navigationTitle("Comptabilité")
        .toolbarTitleDisplayMode(.large)
        .barreGestion()
        .task(id: "\(ClientAPI.partage.revision)-\(du)-\(au)") { await charger() }
        .refreshable { await charger() }
        .sheet(item: $export) { url in PartageFichierG(url: url) }
    }

    private func boutonExport(_ titre: String, _ symbole: String, chemin: String, nom: String) -> some View {
        Button {
            Task { await exporter(chemin: chemin, nom: nom) }
        } label: {
            HStack {
                Label(titre, systemImage: symbole)
                Spacer()
                if exportEnCours == chemin { ProgressView() }
            }
        }
        .disabled(exportEnCours != nil)
    }

    private func charger() async {
        let q = "?debut=\(du)&fin=\(au)"
        do {
            let t = try await ClientAPI.partage.requete("/api/compta/tva-encaissements" + q, as: TVAEncaissements.self)
            withAnimation(.smooth) { tva = .pret(t) }
        } catch ClientAPI.Erreur.horsSession {
        } catch is CancellationError {
        } catch {
            tva = .echec(error.localizedDescription)
        }
        journal = try? await ClientAPI.partage.requete("/api/reglements/journal?du=\(du)&au=\(au)", as: JournalEncaissements.self)
    }

    private func exporter(chemin: String, nom: String) async {
        exportEnCours = chemin
        defer { exportEnCours = nil }
        do {
            let d = try await ClientAPI.partage.donnees(chemin + "?debut=\(du)&fin=\(au)")
            let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            try d.write(to: tmp)
            export = try ClientAPI.ranger(tmp, nom: nom)
        } catch {
            Pont.partage.afficherToast(error.localizedDescription, erreur: true)
        }
    }
}

extension URL: @retroactive Identifiable {
    public var id: String { absoluteString }
}

/// Feuille de partage iOS pour un fichier local.
struct PartageFichierG: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

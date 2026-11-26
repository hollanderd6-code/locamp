import SwiftUI

/// Accueil de la gestion : indicateurs de l'exercice et liste « A faire ».
struct AccueilGestionView: View {
    struct Donnees {
        let tdb: TableauDeBord
        let echeances: [Echeance]
        let aFacturer: Double
        let nbPrestations: Int
        let messagesNonLus: Int
    }

    @Environment(Pont.self) private var pont
    @State private var source = Source<Donnees> {
        let api = ClientAPI.partage
        let ex = api.exercice.isEmpty ? "" : "?" + api.exercice
        async let t = api.requete("/api/dashboard" + ex, as: TableauDeBord.self)
        async let e = try? api.requete("/api/echeances?horizon=60", as: ReponseEcheances.self)
        async let p = try? api.requete("/api/prestations?statut=en_cours", as: ReponsePrestations.self)
        struct NL: Decodable { let total: Int }
        async let m = try? api.requete("/api/messages/non-lus", as: NL.self)
        let (tdb, ech, pre, msg) = try await (t, e, p, m)
        let prest = pre?.prestations ?? []
        return Donnees(tdb: tdb, echeances: ech?.echeances ?? [],
                       aFacturer: prest.reduce(0) { $0 + ($1.montant_ttc?.valeur ?? 0) },
                       nbPrestations: prest.count, messagesNonLus: msg?.total ?? 0)
    }
    @State private var encaisser = false
    @State private var messageATous = false
    @State private var ouvert: ResidentCible?

    var body: some View {
        Chargeur(etat: source.etat, reessayer: source.rafraichir) { d in
            ScrollView {
                VStack(spacing: 18) {
                    indicateurs(d)
                    actions
                    if d.messagesNonLus > 0 {
                        Button { pont.onglet = .plus; pont.cheminPlus = Configuration.ecransPlus.filter { $0.id == "messagerie" } } label: {
                            Label("\(d.messagesNonLus) message\(d.messagesNonLus > 1 ? "s" : "") de résidents non lu\(d.messagesNonLus > 1 ? "s" : "")",
                                  systemImage: "bubble.left.and.bubble.right.fill")
                                .font(.subheadline.weight(.semibold))
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(14)
                        }
                        .buttonStyle(.plain)
                        .glassEffect(.regular.tint(Color.accentColor.opacity(0.12)).interactive(), in: .rect(cornerRadius: 18))
                    }
                    aFaire(d)
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
                .frame(maxWidth: 900)
                .frame(maxWidth: .infinity)
            }
        }
        .background(Color("Fond").ignoresSafeArea())
        .navigationTitle(salutation)
        .navigationSubtitle(Date.now.formatted(.dateTime.weekday(.wide).day().month(.wide).locale(Fmt.fr)))
        .toolbarTitleDisplayMode(.large)
        .barreGestion()
        .charger(source)
        .sheet(isPresented: $encaisser, onDismiss: { Task { await source.rafraichir() } }) { EncaisserView() }
        .sheet(isPresented: $messageATous) { MessageATous() }
        .navigationDestination(item: $ouvert) { FicheResidentView(residentId: $0.id) }
    }

    private var salutation: String {
        let nom = pont.etat?.contexte.utilisateur.nom ?? ""
        let prenom = nom.split(separator: " ").first.map(String.init) ?? ""
        return prenom.isEmpty ? "Accueil" : "Bonjour \(prenom)"
    }

    // MARK: Indicateurs

    @ViewBuilder private func indicateurs(_ d: Donnees) -> some View {
        let o = d.tdb.occupation
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 160), spacing: 12)], spacing: 12) {
            Indicateur(titre: "Occupation", valeur: "\(o.occupes)", suffixe: "/ \(o.total)",
                       detail: "\(o.taux) % · \(o.libres) libre\(o.libres > 1 ? "s" : "")",
                       progression: o.total > 0 ? Double(o.occupes) / Double(o.total) : nil, symbole: "map") {
                pont.onglet = Configuration.onglets.first(where: { $0.id == "carte" }) ?? pont.onglet
            }
            Indicateur(titre: "Encaissé sur l'exercice", valeur: d.tdb.encaisse > 0 ? Fmt.eurosCourts(d.tdb.encaisse) : "—",
                       detail: d.tdb.ca_mois.valeur > 0 ? "facturé : \(Fmt.eurosCourts(d.tdb.ca_mois.valeur))" : "rien de facturé sur la période",
                       symbole: "eurosign.circle") { ouvrirFacturation("reglements") }
            Indicateur(titre: "Impayés", valeur: d.tdb.impayes.total_du.valeur > 0 ? Fmt.eurosCourts(d.tdb.impayes.total_du.valeur) : "—",
                       detail: d.tdb.impayes.nombre > 0 ? "\(d.tdb.impayes.nombre) facture\(d.tdb.impayes.nombre > 1 ? "s" : "")" : "rien à recouvrer",
                       alerte: d.tdb.impayes.total_du.valeur > 0, symbole: "exclamationmark.triangle") { ouvrirFacturation("impayes") }
            Indicateur(titre: "À facturer", valeur: d.aFacturer > 0 ? Fmt.euros(d.aFacturer) : "—",
                       detail: d.nbPrestations > 0 ? "\(d.nbPrestations) prestation\(d.nbPrestations > 1 ? "s" : "") en cours" : "aucune prestation en cours",
                       symbole: "doc.badge.plus") { ouvrirFacturation("factures") }
        }
    }

    private func ouvrirFacturation(_ section: String) {
        SectionFacturation.demandee = section
        pont.onglet = Configuration.onglets.first(where: { $0.id == "factures" }) ?? pont.onglet
    }

    private var actions: some View {
        GlassEffectContainer(spacing: 10) {
            HStack(spacing: 10) {
                Button { encaisser = true } label: {
                    Label("Encaisser", systemImage: "eurosign").frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
                Button { messageATous = true } label: {
                    Label("Message à tous", systemImage: "megaphone").frame(maxWidth: .infinity)
                }
                .buttonStyle(.glass)
            }
            .controlSize(.large)
        }
    }

    // MARK: A faire

    @ViewBuilder private func aFaire(_ d: Donnees) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("À faire").font(.title3.weight(.semibold))
                Spacer()
                Text("\(d.echeances.count) action\(d.echeances.count > 1 ? "s" : "")").font(.subheadline).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 4)
            if d.echeances.isEmpty {
                Label("Rien d'urgent. Tout est en ordre.", systemImage: "checkmark.seal")
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(16)
                    .background(.background.secondary, in: .rect(cornerRadius: 18))
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(d.echeances.prefix(12).enumerated()), id: \.element.id) { i, e in
                        if i > 0 { Divider().padding(.leading, 52) }
                        Button {
                            if let r = e.resident_id { ouvert = ResidentCible(id: r) }
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: e.symbole)
                                    .foregroundStyle(e.statut == "a_venir" ? Color.orange : Color.red)
                                    .frame(width: 28)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("\(e.libelle) — \(e.resident_nom ?? "")").font(.subheadline.weight(.semibold)).lineLimit(2)
                                    Text(e.detail).font(.footnote).foregroundStyle(.secondary)
                                }
                                Spacer(minLength: 0)
                                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                            }
                            .padding(.horizontal, 14).padding(.vertical, 12)
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .background(.background.secondary, in: .rect(cornerRadius: 18))
            }
        }
    }
}

struct ResidentCible: Identifiable, Hashable { let id: String }

/// Une tuile d'indicateur, touchable.
struct Indicateur: View {
    let titre: String
    let valeur: String
    var suffixe: String? = nil
    let detail: String
    var progression: Double? = nil
    var alerte = false
    let symbole: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 6) {
                Label(titre, systemImage: symbole)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(alerte ? Color.red : Color.secondary)
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(valeur).font(.title.weight(.bold).monospacedDigit()).foregroundStyle(.primary)
                        .minimumScaleFactor(0.6).lineLimit(1)
                    if let suffixe { Text(suffixe).font(.subheadline).foregroundStyle(.secondary) }
                }
                if let progression {
                    ProgressView(value: progression).tint(Color.accentColor)
                }
                Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
            .frame(maxWidth: .infinity, minHeight: 110, alignment: .topLeading)
            .padding(14)
            .contentShape(.rect(cornerRadius: 20))
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 20))
    }
}

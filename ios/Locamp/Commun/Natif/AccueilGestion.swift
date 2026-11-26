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

    /// Les echeances regroupees par nature et urgence : 120 « assurance
    /// manquante » deviennent une seule ligne qu'on deplie.
    struct GroupeAFaire: Identifiable {
        let id: String
        let titre: String
        let symbole: String
        let couleur: Color
        let ordre: Int
        let elements: [Echeance]
    }

    private func groupes(_ liste: [Echeance]) -> [GroupeAFaire] {
        Dictionary(grouping: liste) { "\($0.type)-\($0.statut)" }.map { cle, el in
            let e = el[0]
            let n = el.count
            let (titre, ordre): (String, Int) = {
                switch (e.type, e.statut) {
                case ("assurance", "expiree"): return ("Assurance expirée", 0)
                case ("assurance", "manquante"): return ("Attestation d'assurance manquante", 2)
                case ("assurance", _): return ("Assurance à renouveler", 3)
                case ("contrat", "expiree"): return ("Contrat échu", 1)
                case ("contrat", _): return ("Contrat à renouveler", 4)
                case (_, "expiree"): return ("Document échu", 1)
                default: return ("Document arrivant à échéance", 5)
                }
            }()
            return GroupeAFaire(id: cle, titre: n > 1 ? "\(titre) · \(n)" : titre, symbole: e.symbole,
                                couleur: e.statut == "a_venir" ? .orange : .red, ordre: ordre,
                                elements: el.sorted { ($0.jours_restants ?? -9999) < ($1.jours_restants ?? -9999) })
        }
        .sorted { $0.ordre < $1.ordre }
    }

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
                    ForEach(Array(groupes(d.echeances).enumerated()), id: \.element.id) { i, g in
                        if i > 0 { Divider().padding(.leading, 52) }
                        GroupeAFaireVue(groupe: g) { ouvert = ResidentCible(id: $0) }
                    }
                }
                .background(.background.secondary, in: .rect(cornerRadius: 18))
            }
        }
    }
}

/// Un groupe « A faire » : une ligne, depliable sur la liste des residents.
private struct GroupeAFaireVue: View {
    let groupe: AccueilGestionView.GroupeAFaire
    let ouvrir: (String) -> Void
    @State private var deplie = false

    var body: some View {
        VStack(spacing: 0) {
            Button {
                if groupe.elements.count == 1, let r = groupe.elements[0].resident_id { ouvrir(r) }
                else { withAnimation(.smooth) { deplie.toggle() } }
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: groupe.symbole).foregroundStyle(groupe.couleur).frame(width: 28)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(groupe.titre).font(.subheadline.weight(.semibold))
                        Text(resume).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: groupe.elements.count == 1 ? "chevron.right" : "chevron.down")
                        .font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                        .rotationEffect(.degrees(deplie ? 180 : 0))
                }
                .padding(.horizontal, 14).padding(.vertical, 12)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)

            if deplie {
                VStack(spacing: 0) {
                    ForEach(groupe.elements) { e in
                        Button { if let r = e.resident_id { ouvrir(r) } } label: {
                            HStack {
                                Text(e.resident_nom ?? "—").font(.subheadline)
                                Spacer()
                                Text(e.detail).font(.caption).foregroundStyle(.secondary)
                                Image(systemName: "chevron.right").font(.caption2.weight(.semibold)).foregroundStyle(.tertiary)
                            }
                            .padding(.leading, 54).padding(.trailing, 14).padding(.vertical, 9)
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }

    private var resume: String {
        let noms = groupe.elements.compactMap(\.resident_nom)
        if noms.count == 1 { return "\(noms[0]) · \(groupe.elements[0].detail)" }
        let debut = noms.prefix(2).joined(separator: ", ")
        return noms.count > 2 ? "\(debut) et \(noms.count - 2) autre\(noms.count - 2 > 1 ? "s" : "")" : debut
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

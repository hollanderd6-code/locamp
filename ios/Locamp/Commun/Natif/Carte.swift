import SwiftUI

struct DonneesCarte: Decodable {
    struct Occupant: Decodable, Hashable { let id: String; let nom: String?; let prenom: String? }
    struct Empl: Decodable, Identifiable, Hashable {
        let id: String
        let numero: TexteSouple?
        let secteur: String?
        let type: String?
        let statut: String?
        let coord_x: Montant?
        let coord_y: Montant?
        let resident: Occupant?
        var num: String { numero?.valeur ?? "" }
        var occupant: String { [resident?.prenom, resident?.nom].compactMap { $0 }.joined(separator: " ") }
    }
    let emplacements: [Empl]
}

struct ElementCarte: Decodable, Identifiable {
    let id: String
    let type: String
    let libelle: String?
    let x: Montant
    let y: Montant
    let largeur: Montant?
    let hauteur: Montant?
    let x2: Montant?
    let y2: Montant?
    let couleur: String?
}
struct ReponseElements: Decodable { let elements: [ElementCarte] }

/// Etat d'un emplacement sur la carte (memes regles et couleurs que le site,
/// STATUT_STYLE dans backend/public/app.js).
enum EtatEmpl: String, CaseIterable, Identifiable {
    case occupe, impaye, libre, reserve, indisponible
    var id: String { rawValue }
    var titre: String {
        switch self {
        case .occupe: "Occupés"; case .impaye: "Impayés"; case .libre: "Libres"
        case .reserve: "Réservés"; case .indisponible: "Hors service"
        }
    }
    var fond: Color {
        switch self {
        case .occupe: Color(red: 0.184, green: 0.420, blue: 0.341)
        case .impaye: Color(red: 0.761, green: 0.255, blue: 0.047)
        case .libre: .white
        case .reserve: Color(red: 0.863, green: 0.902, blue: 0.984)
        case .indisponible: Color(red: 0.894, green: 0.902, blue: 0.890)
        }
    }
    var trait: Color {
        switch self {
        case .occupe, .impaye: fond
        case .libre: Color(red: 0.561, green: 0.651, blue: 0.600)
        case .reserve: Color(red: 0.231, green: 0.435, blue: 0.847)
        case .indisponible: Color(red: 0.788, green: 0.804, blue: 0.784)
        }
    }
    var texte: Color {
        switch self {
        case .occupe, .impaye: .white
        case .libre: Color(red: 0.227, green: 0.275, blue: 0.251)
        case .reserve: Color(red: 0.118, green: 0.247, blue: 0.580)
        case .indisponible: Color(red: 0.357, green: 0.400, blue: 0.373)
        }
    }
}

/// La carte du camping : plan zoomable ou grille par secteur. La
/// modification du plan reste sur le site pour l'instant.
struct CarteView: View {
    struct Donnees { let carte: DonneesCarte; let elements: [ElementCarte]; let enRetard: Set<String> }

    @State private var source = Source<Donnees> {
        let api = ClientAPI.partage
        async let c = api.requete("/api/emplacements/carte", as: DonneesCarte.self)
        async let e = try? api.requete("/api/carte-elements", as: ReponseElements.self)
        async let i = try? api.requete("/api/relances/impayes", as: Impayes.self)
        let (cc, ee, ii) = try await (c, e, i)
        return Donnees(carte: cc, elements: ee?.elements ?? [],
                       enRetard: Set((ii?.impayes ?? []).filter(\.en_retard).compactMap(\.resident_id)))
    }
    @State private var vue = 0
    @State private var filtre: EtatEmpl?
    @State private var recherche = ""
    @State private var choisi: DonneesCarte.Empl?

    var body: some View {
        Chargeur(etat: source.etat, reessayer: source.rafraichir) { d in
            let etat: (DonneesCarte.Empl) -> EtatEmpl = { e in
                if let r = e.resident { return d.enRetard.contains(r.id) ? .impaye : .occupe }
                if e.statut == "reserve" { return .reserve }
                if e.statut == "indisponible" { return .indisponible }
                return .libre
            }
            let q = recherche.trimmingCharacters(in: .whitespaces)
            let visible: (DonneesCarte.Empl) -> Bool = { e in
                (filtre == nil || etat(e) == filtre) && (q.isEmpty || e.num.localizedStandardContains(q) || e.occupant.localizedStandardContains(q))
            }
            VStack(spacing: 0) {
                Legende(compte: Dictionary(grouping: d.carte.emplacements, by: etat).mapValues(\.count),
                        total: d.carte.emplacements.count, filtre: $filtre)
                if vue == 0 {
                    PlanZoomable(emplacements: d.carte.emplacements, elements: d.elements, etat: etat, visible: visible) { choisi = $0 }
                } else {
                    GrilleSecteurs(emplacements: d.carte.emplacements, etat: etat, visible: visible) { choisi = $0 }
                }
            }
            .sheet(item: $choisi) { e in FicheEmplacement(emplacement: e, etat: etat(e)) }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            Picker("Vue", selection: $vue) { Text("Plan").tag(0); Text("Par secteur").tag(1) }
                .pickerStyle(.segmented).padding(.horizontal, 16).padding(.bottom, 6)
        }
        .navigationTitle("Carte")
        .toolbarTitleDisplayMode(.inline)
        .searchable(text: $recherche, prompt: "Emplacement ou résident")
        .barreGestion()
        .charger(source)
        .navigationDestination(for: ResidentCible.self) { FicheResidentView(residentId: $0.id) }
    }
}

private struct Legende: View {
    let compte: [EtatEmpl: Int]
    let total: Int
    @Binding var filtre: EtatEmpl?

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                puce(nil, "Tous \(total)")
                ForEach(EtatEmpl.allCases) { e in
                    if let n = compte[e], n > 0 { puce(e, "\(e.titre) \(n)") }
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 6)
        }
    }

    private func puce(_ e: EtatEmpl?, _ texte: String) -> some View {
        Button { withAnimation(.smooth) { filtre = filtre == e ? nil : e } } label: {
            HStack(spacing: 6) {
                if let e {
                    RoundedRectangle(cornerRadius: 3).fill(e.fond)
                        .overlay(RoundedRectangle(cornerRadius: 3).strokeBorder(e.trait, style: StrokeStyle(lineWidth: 1, dash: e == .libre ? [3, 2] : [])))
                        .frame(width: 12, height: 12)
                }
                Text(texte).font(.footnote.weight(.medium))
            }
            .padding(.horizontal, 10).padding(.vertical, 6)
        }
        .buttonStyle(.plain)
        .glassEffect(filtre == e ? Glass.regular.tint(Color.accentColor.opacity(0.25)).interactive() : Glass.regular.interactive(), in: .capsule)
    }
}

// MARK: - Plan

private struct PlanZoomable: View {
    let emplacements: [DonneesCarte.Empl]
    let elements: [ElementCarte]
    let etat: (DonneesCarte.Empl) -> EtatEmpl
    let visible: (DonneesCarte.Empl) -> Bool
    let choisir: (DonneesCarte.Empl) -> Void

    static let W: CGFloat = 1000, H: CGFloat = 620
    @State private var echelle: CGFloat = 1
    @GestureState private var pince: CGFloat = 1

    var body: some View {
        GeometryReader { geo in
            let base = geo.size.width / Self.W            // le plan tient en largeur
            let e = min(max(echelle * pince, 1), 5)
            ScrollView([.horizontal, .vertical], showsIndicators: false) {
                ZStack(alignment: .topLeading) {
                    Canvas { ctx, _ in dessinerDecor(&ctx) }
                        .frame(width: Self.W, height: Self.H)
                    ForEach(emplacements.filter { $0.coord_x != nil && $0.coord_y != nil }) { emp in
                        let s = etat(emp)
                        Button { choisir(emp) } label: { Pastille_(emp: emp, etat: s) }
                            .buttonStyle(.plain)
                            .opacity(visible(emp) ? 1 : 0.18)
                            .position(x: min(max(emp.coord_x!.valeur, 20), Self.W - 20),
                                      y: min(max(emp.coord_y!.valeur, 20), Self.H - 20))
                    }
                }
                .frame(width: Self.W, height: Self.H)
                .scaleEffect(base * e, anchor: .topLeading)
                .frame(width: Self.W * base * e, height: Self.H * base * e, alignment: .topLeading)
            }
            .background(Color(red: 0.937, green: 0.953, blue: 0.937))
            .gesture(MagnifyGesture().updating($pince) { v, s, _ in s = v.magnification }
                .onEnded { v in echelle = min(max(echelle * v.magnification, 1), 5) })
            .onTapGesture(count: 2) { withAnimation(.smooth) { echelle = echelle > 1.5 ? 1 : 2.5 } }
        }
    }

    private func dessinerDecor(_ ctx: inout GraphicsContext) {
        for el in elements {
            let x = el.x.valeur, y = el.y.valeur
            switch el.type {
            case "allee", "barriere":
                var p = Path()
                p.move(to: CGPoint(x: x, y: y))
                p.addLine(to: CGPoint(x: el.x2?.valeur ?? x + 260, y: el.y2?.valeur ?? y))
                if el.type == "allee" {
                    ctx.stroke(p, with: .color(.white), style: StrokeStyle(lineWidth: 20, lineCap: .round))
                } else {
                    ctx.stroke(p, with: .color(.gray), style: StrokeStyle(lineWidth: 3, lineCap: .round, dash: [8, 6]))
                }
            case "arbre":
                ctx.fill(Path(ellipseIn: CGRect(x: x - 13, y: y - 17, width: 26, height: 26)), with: .color(Color(red: 0.36, green: 0.55, blue: 0.39)))
            case "texte":
                ctx.draw(Text(el.libelle ?? "").font(.system(size: 13, weight: .semibold)).foregroundStyle(.secondary), at: CGPoint(x: x, y: y), anchor: .leading)
            default:
                let zone = el.type == "zone" || el.type == "eau"
                let w = el.largeur?.valeur ?? (zone ? 200 : 100), h = el.hauteur?.valeur ?? (zone ? 140 : 70)
                let r = CGRect(x: x, y: y, width: w, height: h)
                let forme = Path(roundedRect: r, cornerRadius: zone ? 22 : 10)
                let fond: Color = el.type == "eau" ? Color(red: 0.81, green: 0.90, blue: 0.94)
                    : zone ? Color(red: 0.86, green: 0.91, blue: 0.87) : .white
                ctx.fill(forme, with: .color(fond.opacity(zone ? 0.7 : 1)))
                ctx.stroke(forme, with: .color(.black.opacity(0.12)), lineWidth: 1)
                if let l = el.libelle ?? libelleDefaut(el.type) {
                    ctx.draw(Text(l).font(.system(size: 12, weight: .semibold)).foregroundStyle(Color.primary.opacity(0.75)),
                             at: CGPoint(x: r.midX, y: r.midY))
                }
            }
        }
    }

    private func libelleDefaut(_ t: String) -> String? {
        ["accueil": "Accueil", "sanitaires": "Sanitaires", "piscine": "Piscine", "restaurant": "Restaurant",
         "laverie": "Laverie", "aire_jeux": "Aire de jeux", "local": "Local", "parking": "Parking"][t]
    }
}

private struct Pastille_: View {
    let emp: DonneesCarte.Empl
    let etat: EtatEmpl

    var body: some View {
        VStack(spacing: 0) {
            Text(emp.num).font(.system(size: 11, weight: .bold))
            if let r = emp.resident {
                Text(initiales([r.prenom, r.nom].compactMap { $0 }.joined(separator: " ")))
                    .font(.system(size: 8, weight: .semibold)).opacity(0.85)
            }
        }
        .foregroundStyle(etat.texte)
        .frame(width: 42, height: 30)
        .background(etat.fond, in: .rect(cornerRadius: 7))
        .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(etat.trait, style: StrokeStyle(lineWidth: 1.2, dash: etat == .libre ? [4, 3] : [])))
        .contentShape(.rect)
        .accessibilityLabel("Emplacement \(emp.num), \(etat.titre)")
    }
}

// MARK: - Par secteur

private struct GrilleSecteurs: View {
    let emplacements: [DonneesCarte.Empl]
    let etat: (DonneesCarte.Empl) -> EtatEmpl
    let visible: (DonneesCarte.Empl) -> Bool
    let choisir: (DonneesCarte.Empl) -> Void

    var body: some View {
        let groupes = Dictionary(grouping: emplacements) { ($0.secteur ?? "").isEmpty ? "Sans secteur" : $0.secteur! }
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 18) {
                ForEach(groupes.keys.sorted(), id: \.self) { s in
                    let liste = groupes[s]!.sorted { $0.num.localizedStandardCompare($1.num) == .orderedAscending }
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(s).font(.headline)
                            Spacer()
                            Text("\(liste.filter { $0.resident != nil }.count) occupés sur \(liste.count)").font(.footnote).foregroundStyle(.secondary)
                        }
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 46), spacing: 6)], spacing: 6) {
                            ForEach(liste) { e in
                                Button { choisir(e) } label: { Pastille_(emp: e, etat: etat(e)).frame(maxWidth: .infinity) }
                                    .buttonStyle(.plain)
                                    .opacity(visible(e) ? 1 : 0.18)
                            }
                        }
                    }
                }
            }
            .padding(16)
        }
    }
}

// MARK: - Fiche d'un emplacement

private struct FicheEmplacement: View {
    let emplacement: DonneesCarte.Empl
    let etat: EtatEmpl
    @Environment(\.dismiss) private var fermer
    @State private var fiche: ResidentCible?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    LabeledContent("État") { Pastille(texte: etat.titre, couleur: etat == .libre ? .secondary : etat.trait) }
                    if let s = emplacement.secteur, !s.isEmpty { LabeledContent("Secteur", value: s) }
                    if let t = emplacement.type, !t.isEmpty { LabeledContent("Type", value: t) }
                }
                if let r = emplacement.resident {
                    Section("Occupant") {
                        NavigationLink(value: ResidentCible(id: r.id)) {
                            HStack(spacing: 12) {
                                Avatar(nom: emplacement.occupant, taille: 36)
                                Text(emplacement.occupant)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Emplacement \(emplacement.num)")
            .toolbarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("OK", systemImage: "checkmark") { fermer() } } }
            .navigationDestination(for: ResidentCible.self) { FicheResidentView(residentId: $0.id) }
        }
        .presentationDetents([.medium, .large])
    }
}

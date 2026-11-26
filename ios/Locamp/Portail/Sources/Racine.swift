import SwiftUI

/// Avant connexion : l'ecran de connexion. Ensuite : les quatre onglets.
struct RacineLocataire: View {
    @Environment(Session.self) private var session
    @State private var espace = Espace()

    var body: some View {
        @Bindable var session = session
        Group {
            if session.connecte {
                OngletsLocataire()
                    .environment(espace)
                    .transition(.opacity)
            } else {
                ConnexionView()
                    .transition(.opacity)
            }
        }
        .animation(.smooth, value: session.connecte)
        .overlay(alignment: .bottom) { ToastVue() }
        .sheet(item: $session.lien) { ActivationView(lien: $0) }
        .onChange(of: session.connecte) { _, c in
            if c { Task { await espace.charger() } } else { espace.vider() }
        }
        #if DEBUG
        .task { await ModeTest.demarrer() }
        #endif
    }
}

struct OngletsLocataire: View {
    @Environment(Session.self) private var session
    @Environment(Espace.self) private var espace
    @Environment(\.scenePhase) private var phase
    @State private var dernierChargement = Date.distantPast

    var body: some View {
        @Bindable var session = session
        TabView(selection: $session.onglet) {
            Tab("Accueil", systemImage: "house", value: Onglet.accueil) {
                NavigationStack { AccueilView() }
            }
            Tab("Factures", systemImage: "doc.text", value: Onglet.factures) {
                NavigationStack { FacturesView() }
            }
            .badge(espace.dues.filter { $0.retard > 0 }.count)
            Tab("Messages", systemImage: "bubble.left.and.bubble.right", value: Onglet.messages) {
                NavigationStack { MessagesView() }
            }
            .badge(session.nonLusMessages)
            Tab("Documents", systemImage: "folder", value: Onglet.documents) {
                NavigationStack { DocumentsView() }
            }
            .badge(session.aSigner)
        }
        .tabViewStyle(.sidebarAdaptable)
        .tabBarMinimizeBehavior(.onScrollDown)
        .onChange(of: session.onglet) { _, _ in UISelectionFeedbackGenerator().selectionChanged() }
        .task(id: session.revision) {
            dernierChargement = .now
            await espace.charger()
        }
        // Retour au premier plan : on actualise, au plus toutes les 30 s.
        .onChange(of: phase) { _, p in
            guard p == .active, Date.now.timeIntervalSince(dernierChargement) > 30 else { return }
            dernierChargement = .now
            Task { await espace.charger() }
        }
    }
}

#if DEBUG
/// Captures automatiques dans le simulateur (.github/workflows/ios.yml) :
/// connexion avec un compte de test, puis visite des ecrans en UN seul
/// lancement. A chaque etape l'app ecrit son nom dans Library/Caches/etape.txt
/// et attend que le simulateur ait capture l'ecran (fichier ok-<etape>).
/// Absent des versions publiees.
enum ModeTest {
    @MainActor static var actif: Bool { ProcessInfo.processInfo.environment["LOCAMP_CAPTURE"] == "1" }
    @MainActor static var ouvrirCompte = false
    /// Une fermeture par onglet (chacun a sa barre et sa feuille Compte).
    @MainActor static var fermetures: [String: () -> Void] = [:]
    @MainActor static func fermerCompte() { fermetures.values.forEach { $0() } }

    @MainActor static func demarrer() async {
        let env = ProcessInfo.processInfo.environment
        guard let email = env["LOCAMP_TEST_EMAIL"], let mdp = env["LOCAMP_TEST_MDP"], !email.isEmpty else { return }
        if !Session.partage.connecte {
            do {
                let r = try await API.requete("/api/portail/connexion", methode: "POST",
                                              corps: ["email": email, "mot_de_passe": mdp],
                                              authentifie: false, as: ReponseJeton.self)
                Session.partage.ouvrir(jeton: r.token)
            } catch {
                Session.partage.afficher("Test : \(error.localizedDescription)", erreur: true)
                await etape("echec-connexion")
                return
            }
        }
        try? await Task.sleep(for: .seconds(4))      // chargement de l'espace
        let s = Session.partage
        for o in Onglet.allCases {
            s.onglet = o
            try? await Task.sleep(for: .seconds(3))
            await etape(o.rawValue)
        }
        s.onglet = .accueil
        ouvrirCompte = true
        s.signalerNouveautes()
        try? await Task.sleep(for: .seconds(3))
        await etape("compte")
        fermerCompte()
        for o in [Onglet.accueil, .factures, .documents] {
            s.onglet = o
            try? await Task.sleep(for: .seconds(3))
            await etape("sombre-" + o.rawValue)
        }
        await etape("fin")
    }

    /// Publie l'etape et attend la capture (3 min au plus).
    @MainActor private static func etape(_ nom: String) async {
        let dossier = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        try? nom.write(to: dossier.appendingPathComponent("etape.txt"), atomically: true, encoding: .utf8)
        let ok = dossier.appendingPathComponent("ok-" + nom)
        for _ in 0..<360 {
            if FileManager.default.fileExists(atPath: ok.path) { return }
            try? await Task.sleep(for: .milliseconds(500))
        }
    }
}
#endif

import SwiftUI
import Security
import UserNotifications

/// Les quatre onglets de l'app.
enum Onglet: String, Hashable, CaseIterable {
    case accueil, factures, messages, documents
}

/// Un lien recu par e-mail, a traiter a l'ecran.
enum LienEmail: Identifiable, Equatable {
    case activation(String)
    case reinitialisation(String)
    var id: String {
        switch self {
        case .activation(let j): "a" + j
        case .reinitialisation(let j): "r" + j
        }
    }
    var jeton: String {
        switch self { case .activation(let j), .reinitialisation(let j): j }
    }
}

/// La session du locataire : son jeton (rangé dans le trousseau), l'onglet
/// affiche, et les signaux de rafraichissement entre ecrans.
@MainActor
@Observable
final class Session {
    static let partage = Session()

    private(set) var jeton: String?
    var connecte: Bool { jeton != nil }

    var onglet: Onglet = .accueil
    /// Lien d'activation / de nouveau mot de passe en attente.
    var lien: LienEmail?
    /// Incremente quand il faut recharger (notification recue, signature…).
    private(set) var revision = 0
    /// Message ephemere en bas de l'ecran.
    var toast: Toast?
    /// Pastilles des onglets.
    var nonLusMessages = 0
    var aSigner = 0

    @ObservationIgnored private var jetonPush: String?
    @ObservationIgnored private var pushEnregistre = false

    /// Adresse du serveur, lue dans Info.plist (reglage LOCAMP_URL).
    @ObservationIgnored let base: URL = {
        let brut = Bundle.main.object(forInfoDictionaryKey: "LocampURL") as? String ?? ""
        let u = URL(string: brut) ?? URL(string: "https://locamp.onrender.com/")!
        var c = URLComponents()
        c.scheme = u.scheme; c.host = u.host; c.port = u.port
        return c.url ?? u
    }()

    private init() {
        jeton = Trousseau.lire()
    }

    // MARK: Connexion

    func ouvrir(jeton: String) {
        self.jeton = jeton
        Trousseau.ecrire(jeton)
        onglet = .accueil
        revision += 1
        demanderPush()
    }

    /// Deconnexion : le jeton push est retire du serveur avant d'oublier la session.
    func fermer() async {
        if let jetonPush, pushEnregistre {
            _ = try? await API.requete("/api/portail/push/register", methode: "DELETE",
                                       corps: ["token": jetonPush], as: API.Vide.self)
        }
        pushEnregistre = false
        expirer()
    }

    /// Jeton refuse par le serveur (401) : retour a l'ecran de connexion.
    func expirer() {
        jeton = nil
        Trousseau.effacer()
        nonLusMessages = 0
        aSigner = 0
        onglet = .accueil
    }

    func signalerNouveautes() { revision += 1 }

    func afficher(_ message: String, erreur: Bool = false) {
        let t = Toast(message: message, erreur: erreur)
        UINotificationFeedbackGenerator().notificationOccurred(erreur ? .error : .success)
        withAnimation(.bouncy) { toast = t }
        Task {
            try? await Task.sleep(for: .seconds(erreur ? 5 : 3.5))
            if toast?.id == t.id { withAnimation(.smooth) { toast = nil } }
        }
    }

    // MARK: Liens recus par e-mail

    func ouvrirLien(_ url: URL) {
        guard let q = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else { return }
        func valeur(_ nom: String) -> String? { q.first { $0.name == nom }?.value.flatMap { $0.isEmpty ? nil : $0 } }
        if let a = valeur("activation") { lien = .activation(a) }
        else if let r = valeur("reset") { lien = .reinitialisation(r) }
        else if let t = valeur("token") {
            Task {
                do {
                    struct R: Decodable { let token: String }
                    let r = try await API.requete("/api/portail/session", methode: "POST",
                                                  corps: ["token": t], authentifie: false, as: R.self)
                    ouvrir(jeton: r.token)
                } catch {
                    afficher(error.localizedDescription, erreur: true)
                }
            }
        }
    }

    // MARK: Notifications push

    func demanderPush() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { ok, _ in
            guard ok else { return }
            DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
        }
        Task { await enregistrerPush() }
    }

    func recevoirJetonPush(_ j: String) {
        guard j != jetonPush else { return }
        jetonPush = j
        pushEnregistre = false
        Task { await enregistrerPush() }
    }

    private func enregistrerPush() async {
        guard connecte, let jetonPush, !pushEnregistre else { return }
        do {
            _ = try await API.requete("/api/portail/push/register", methode: "POST",
                                      corps: ["token": jetonPush, "platform": "ios"], as: API.Vide.self)
            pushEnregistre = true
        } catch {}
    }
}

struct Toast: Identifiable, Equatable {
    let id = UUID()
    let message: String
    let erreur: Bool
}

// MARK: - Trousseau

/// Le jeton de session dans le trousseau iOS (et non dans les reglages en
/// clair) : il ouvre l'acces aux factures et documents du locataire.
enum Trousseau {
    private static let service = "fr.locamp.portail.session"

    private static var requete: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: "jeton"]
    }

    static func lire() -> String? {
        var q = requete
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var res: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &res) == errSecSuccess, let d = res as? Data else { return nil }
        return String(data: d, encoding: .utf8)
    }

    static func ecrire(_ jeton: String) {
        effacer()
        var q = requete
        q[kSecValueData as String] = Data(jeton.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(q as CFDictionary, nil)
    }

    static func effacer() {
        SecItemDelete(requete as CFDictionary)
    }
}

import Foundation

/// Acces direct a l'API Locamp pour les ecrans natifs.
///
/// La session appartient au site : il la transmet a l'app par le pont
/// (message « auth ») a chaque connexion, changement de camping ou
/// deconnexion. Rien n'est stocke sur le disque.
@MainActor
final class ClientAPI {
    static let partage = ClientAPI()

    struct Identifiants: Equatable {
        var base: URL
        var jeton: String
        /// Camping actif (en-tete x-camping-id), app Gestion seulement.
        var camping: String?
    }

    var identifiants: Identifiants?

    enum Erreur: LocalizedError {
        case horsSession, sessionExpiree, serveur(String)
        var errorDescription: String? {
            switch self {
            case .horsSession: "Connexion en cours…"
            case .sessionExpiree: "Session expirée, reconnectez-vous."
            case .serveur(let m): m
            }
        }
    }

    struct Vide: Decodable {}

    func requete<T: Decodable>(_ chemin: String, methode: String = "GET",
                               corps: [String: Any]? = nil, as type: T.Type = T.self) async throws -> T {
        guard let id = identifiants, let url = URL(string: chemin, relativeTo: id.base) else {
            throw Erreur.horsSession
        }
        var r = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        r.httpMethod = methode
        r.setValue("Bearer \(id.jeton)", forHTTPHeaderField: "Authorization")
        if let c = id.camping { r.setValue(c, forHTTPHeaderField: "x-camping-id") }
        if let corps {
            r.httpBody = try JSONSerialization.data(withJSONObject: corps)
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, reponse) = try await URLSession.shared.data(for: r)
        let code = (reponse as? HTTPURLResponse)?.statusCode ?? 0
        if code == 401 {
            Pont.partage.sessionExpiree()
            throw Erreur.sessionExpiree
        }
        guard (200..<300).contains(code) else {
            let msg = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw Erreur.serveur(msg ?? "Erreur serveur (\(code)).")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}

// MARK: - Modeles

struct MessageFil: Decodable, Identifiable, Equatable {
    let id: String
    let auteur: String          // "camping" ou "resident"
    let corps: String
    let created_at: String
    var lu: Bool?

    var date: Date { DateISO.lire(created_at) }
}

struct ReponseFil: Decodable { let messages: [MessageFil] }
struct ReponseEnvoi: Decodable { let message: MessageFil }

struct Conversation: Decodable, Identifiable, Hashable {
    let resident_id: String
    let resident_nom: String
    let non_lus: Int
    let dernier_message: Dernier
    var id: String { resident_id }

    struct Dernier: Decodable, Hashable {
        let auteur: String
        let corps: String
        let date: String
    }
}

struct ReponseConversations: Decodable { let conversations: [Conversation] }

struct ResidentCourt: Decodable, Identifiable, Hashable {
    let id: String
    let nom: String?
    let prenom: String?
    let actif: Bool?
    var nomComplet: String { "\(prenom ?? "") \(nom ?? "")".trimmingCharacters(in: .whitespaces) }
}

struct ReponseResidents: Decodable { let residents: [ResidentCourt] }

enum DateISO {
    private static let avecFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let simple = ISO8601DateFormatter()

    static func lire(_ s: String) -> Date {
        avecFraction.date(from: s) ?? simple.date(from: s) ?? .now
    }
}

/// Initiales d'un nom : « Marie Dupont » -> « MD ».
func initiales(_ nom: String) -> String {
    nom.split(separator: " ").prefix(2).compactMap { $0.first.map(String.init) }.joined().uppercased()
}

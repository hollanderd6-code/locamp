import Foundation
import UniformTypeIdentifiers

/// Acces a l'API du portail locataire (backend/routes/portail.js).
@MainActor
enum API {
    struct Vide: Decodable {}

    enum Erreur: LocalizedError {
        case sessionExpiree
        case serveur(String)
        case reseau

        var errorDescription: String? {
            switch self {
            case .sessionExpiree: "Session expirée, reconnectez-vous."
            case .serveur(let m): m
            case .reseau: "Connexion impossible. Vérifiez votre réseau et réessayez."
            }
        }
    }

    /// Le serveur peut dormir (hebergement mis en veille) : on lui laisse
    /// le temps de se reveiller au premier appel.
    private static let reseau: URLSession = {
        let c = URLSessionConfiguration.default
        c.timeoutIntervalForRequest = 70
        c.waitsForConnectivity = true
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        c.httpAdditionalHeaders = ["User-Agent": "LocampLocataire-iOS/\(Bundle.main.versionCourte)"]
        return URLSession(configuration: c)
    }()

    private static func url(_ chemin: String) throws -> URL {
        guard let u = URL(string: chemin, relativeTo: Session.partage.base) else { throw Erreur.serveur("Adresse invalide.") }
        return u
    }

    private static func preparer(_ chemin: String, methode: String, authentifie: Bool) throws -> URLRequest {
        var r = URLRequest(url: try url(chemin))
        r.httpMethod = methode
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        if authentifie {
            guard let j = Session.partage.jeton else { throw Erreur.sessionExpiree }
            r.setValue("Bearer \(j)", forHTTPHeaderField: "Authorization")
        }
        return r
    }

    private static func executer(_ r: URLRequest, authentifie: Bool) async throws -> Data {
        let data: Data, rep: URLResponse
        do { (data, rep) = try await reseau.data(for: r) }
        catch let e as URLError where e.code == .cancelled { throw CancellationError() }
        catch { throw Erreur.reseau }
        let code = (rep as? HTTPURLResponse)?.statusCode ?? 0
        if code == 401 && authentifie {
            Session.partage.expirer()
            throw Erreur.sessionExpiree
        }
        guard (200..<300).contains(code) else {
            let msg = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw Erreur.serveur(msg ?? "Erreur du serveur (\(code)).")
        }
        return data
    }

    static func requete<T: Decodable>(_ chemin: String, methode: String = "GET", corps: [String: Any]? = nil,
                                      authentifie: Bool = true, as type: T.Type = T.self) async throws -> T {
        var r = try preparer(chemin, methode: methode, authentifie: authentifie)
        if let corps {
            r.httpBody = try JSONSerialization.data(withJSONObject: corps)
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let data = try await executer(r, authentifie: authentifie)
        if T.self == Vide.self { return Vide() as! T }
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw Erreur.serveur("Réponse inattendue du serveur.") }
    }

    /// Donnees brutes (export RGPD).
    static func donnees(_ chemin: String) async throws -> Data {
        try await executer(try preparer(chemin, methode: "GET", authentifie: true), authentifie: true)
    }

    /// Envoi d'un fichier (multipart/form-data).
    static func envoyerFichier(_ chemin: String, fichier: Data, nom: String, type: UTType?,
                               champs: [String: String]) async throws {
        var r = try preparer(chemin, methode: "POST", authentifie: true)
        let limite = "Locamp-\(UUID().uuidString)"
        r.setValue("multipart/form-data; boundary=\(limite)", forHTTPHeaderField: "Content-Type")
        var corps = Data()
        func ligne(_ s: String) { corps.append(Data((s + "\r\n").utf8)) }
        for (k, v) in champs {
            ligne("--\(limite)")
            ligne("Content-Disposition: form-data; name=\"\(k)\"")
            ligne("")
            ligne(v)
        }
        let nomPropre = nom.replacingOccurrences(of: "\"", with: "")
        ligne("--\(limite)")
        ligne("Content-Disposition: form-data; name=\"file\"; filename=\"\(nomPropre)\"")
        ligne("Content-Type: \(type?.preferredMIMEType ?? "application/octet-stream")")
        ligne("")
        corps.append(fichier)
        ligne("")
        ligne("--\(limite)--")
        r.httpBody = corps
        _ = try await executer(r, authentifie: true)
    }

    /// Telecharge un fichier (lien signe de courte duree) dans le dossier
    /// temporaire, pour l'apercu natif et le partage.
    static func telecharger(_ adresse: String, nom: String) async throws -> URL {
        guard let u = URL(string: adresse) else { throw Erreur.serveur("Lien invalide.") }
        let (tmp, rep): (URL, URLResponse)
        do { (tmp, rep) = try await reseau.download(from: u) } catch { throw Erreur.reseau }
        guard let h = rep as? HTTPURLResponse, (200..<300).contains(h.statusCode) else {
            throw Erreur.serveur("Fichier indisponible.")
        }
        let dossier = FileManager.default.temporaryDirectory.appendingPathComponent("Apercus", isDirectory: true)
        try? FileManager.default.createDirectory(at: dossier, withIntermediateDirectories: true)
        var propre = nom.replacingOccurrences(of: "/", with: "-").trimmingCharacters(in: .whitespaces)
        if propre.isEmpty { propre = "document" }
        if (propre as NSString).pathExtension.isEmpty, let ext = rep.suggestedFilename.map({ ($0 as NSString).pathExtension }), !ext.isEmpty {
            propre += "." + ext
        }
        let cible = dossier.appendingPathComponent(propre)
        try? FileManager.default.removeItem(at: cible)
        try FileManager.default.moveItem(at: tmp, to: cible)
        return cible
    }
}

extension Bundle {
    var versionCourte: String { object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0" }
}

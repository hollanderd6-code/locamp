import Foundation

// Miroir des reponses de backend/routes/portail.js.

/// Un nombre que Postgres peut renvoyer en nombre ou en texte (numeric).
struct Nombre: Decodable, Hashable {
    let valeur: Double
    init(_ v: Double) { valeur = v }
    init(from d: Decoder) throws {
        let c = try d.singleValueContainer()
        if let v = try? c.decode(Double.self) { valeur = v }
        else if let s = try? c.decode(String.self), let v = Double(s) { valeur = v }
        else { valeur = 0 }
    }
}

/// Un texte que la base peut renvoyer en nombre (numero d'emplacement…).
struct Texte: Decodable, Hashable {
    let valeur: String
    init(from d: Decoder) throws {
        let c = try d.singleValueContainer()
        if let s = try? c.decode(String.self) { valeur = s }
        else if let i = try? c.decode(Int.self) { valeur = String(i) }
        else if let v = try? c.decode(Double.self) { valeur = String(v) }
        else { valeur = "" }
    }
}

struct Moi: Decodable {
    struct Resident: Decodable {
        let id: String
        let civilite: String?
        let nom: String?
        let prenom: String?
        let email: String?
        let telephone: String?
        let adresse: String?
        var nomComplet: String { [prenom, nom].compactMap { $0 }.joined(separator: " ") }
        var appel: String { prenom?.isEmpty == false ? prenom! : (nom ?? "") }
    }
    struct Emplacement: Decodable {
        let numero: Texte?
        let secteur: String?
    }
    struct Camping: Decodable { let nom: String }

    let resident: Resident
    let emplacement: Emplacement?
    let camping: Camping
    let paiement_en_ligne: Bool?
}

struct Facture: Decodable, Identifiable, Hashable {
    let id: String
    let numero: String?
    let periode: String?
    let date_emission: String?
    let total_ttc: Nombre
    let montant_regle: Nombre?
    let statut: String
    let reste: Nombre
    let date_echeance: String?
    let jours_retard: Int?

    var annulee: Bool { statut == "avoir" || statut == "annulee" }
    var aRegler: Bool { !annulee && reste.valeur > 0.004 }
    var retard: Int { jours_retard ?? 0 }

    /// « Mars 2026 » pour une facture mensuelle, sinon la date.
    var titre: String {
        if let p = periode, p.count == 7, let d = Format.periode.date(from: p) {
            return Format.moisAnnee.string(from: d).capitalized(with: Format.fr)
        }
        if statut == "avoir" { return "Avoir" }
        return "Facture du \(Format.jour(date_emission))"
    }

    enum Etat { case payee, aPayer, retard, neutre }
    var etat: Etat {
        if annulee { return .neutre }
        if !aRegler { return .payee }
        return retard > 0 ? .retard : .aPayer
    }

    var libelleEtat: String {
        switch etat {
        case .neutre: statut == "avoir" ? "Avoir" : "Annulée"
        case .payee: "Payée"
        case .retard: "En retard · \(retard) j"
        case .aPayer: date_echeance.map { "À payer avant le \(Format.jour($0))" } ?? "À payer"
        }
    }
}
struct ReponseFactures: Decodable { let factures: [Facture] }

struct Prestation: Decodable, Identifiable {
    let id: String
    let type: String?
    let designation: String?
    let date_debut: String?
    let date_fin: String?
    let montant_ttc: Nombre?

    var libelleType: String {
        ["sejour": "Séjour", "vente": "Vente", "charge": "Charges", "caution": "Caution"][type ?? ""] ?? (type ?? "")
    }
}
struct ReponsePrestations: Decodable { let prestations: [Prestation] }

struct Document: Decodable, Identifiable, Hashable {
    let id: String
    let type: String?
    let nom_fichier: String?
    let created_at: String?

    var libelle: String { TypeDocument.libelle(type) }
}
struct ReponseDocuments: Decodable { let documents: [Document] }

enum TypeDocument: String, CaseIterable, Identifiable {
    case attestation_assurance, justificatif_domicile, piece_identite, autre
    var id: String { rawValue }
    var titre: String { Self.libelle(rawValue) }
    var symbole: String {
        switch self {
        case .attestation_assurance: "checkmark.shield"
        case .justificatif_domicile: "house"
        case .piece_identite: "person.text.rectangle"
        case .autre: "doc"
        }
    }
    static func libelle(_ t: String?) -> String {
        switch t {
        case "cni", "piece_identite": "Pièce d'identité"
        case "attestation_assurance": "Attestation d'assurance"
        case "justificatif_domicile": "Justificatif de domicile"
        case "depot_locataire": "Document déposé"
        case "autre", nil, "": "Document"
        default: t!.replacingOccurrences(of: "_", with: " ").capitalized(with: Format.fr)
        }
    }
}

struct DocumentSignature: Decodable, Identifiable, Hashable {
    let id: String
    let titre: String
    let message: String?
    let nb_pages: Int?
    let statut: String
    let date_envoi: String?
    let date_signature: String?
}
struct ReponseSignatures: Decodable {
    let a_signer: [DocumentSignature]
    let signes: [DocumentSignature]
}

struct ChampSignature: Decodable, Identifiable, Hashable {
    let id: String
    let type: String          // "signature", "case", "texte"
    let label: String?
    let requis: Bool?
}

struct DetailSignature: Decodable {
    let id: String
    let titre: String
    let message: String?
    let champs: [ChampSignature]
    let statut: String
    let url: String
    let consentement: String
}

struct NotificationPortail: Decodable, Identifiable, Hashable {
    let id: String
    let type: String?
    let titre: String
    let corps: String?
    let lu: Bool
    let created_at: String

    var symbole: String {
        switch type {
        case "nouveau_message": "bubble.left.fill"
        case "nouvelle_facture": "doc.text.fill"
        case "paiement_confirme": "checkmark.circle.fill"
        case "document_signe", "signature_demandee": "signature"
        default: "bell.fill"
        }
    }
}
struct ReponseNotifications: Decodable { let notifications: [NotificationPortail] }

struct Message: Decodable, Identifiable, Equatable {
    let id: String
    let auteur: String          // "resident" ou "camping"
    let corps: String
    let created_at: String
    let lu: Bool?
}
struct ReponseMessages: Decodable { let messages: [Message] }
struct ReponseEnvoiMessage: Decodable { let message: Message }

struct ReponseJeton: Decodable { let token: String; let message: String? }
struct ReponseMessageSimple: Decodable { let message: String?; let ok: Bool? }

// MARK: - Formats

enum Format {
    static let fr = Locale(identifier: "fr_FR")

    static let periode: DateFormatter = {
        let f = DateFormatter(); f.locale = fr; f.dateFormat = "yyyy-MM"; return f
    }()
    static let moisAnnee: DateFormatter = {
        let f = DateFormatter(); f.locale = fr; f.setLocalizedDateFormatFromTemplate("MMMMy"); return f
    }()
    private static let jourISO: DateFormatter = {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"; return f
    }()
    private static let isoFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
    private static let iso = ISO8601DateFormatter()

    static func date(_ s: String?) -> Date? {
        guard let s, !s.isEmpty else { return nil }
        return isoFraction.date(from: s) ?? iso.date(from: s) ?? jourISO.date(from: String(s.prefix(10)))
    }

    /// « 12 mars 2026 »
    static func jour(_ s: String?) -> String {
        guard let d = date(s) else { return "—" }
        return d.formatted(.dateTime.day().month(.wide).year().locale(fr))
    }

    static func euros(_ v: Double) -> String {
        v.formatted(.currency(code: "EUR").locale(fr))
    }
}

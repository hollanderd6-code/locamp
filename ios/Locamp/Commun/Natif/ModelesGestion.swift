import Foundation

// Miroir des reponses de l'API de gestion (backend/routes/*.js).

/// Un nombre que Postgres renvoie en nombre ou en texte (numeric).
struct Montant: Decodable, Hashable, Comparable {
    let valeur: Double
    init(_ v: Double) { valeur = v }
    init(from d: Decoder) throws {
        let c = try d.singleValueContainer()
        if let v = try? c.decode(Double.self) { valeur = v }
        else if let s = try? c.decode(String.self), let v = Double(s) { valeur = v }
        else { valeur = 0 }
    }
    static func < (a: Montant, b: Montant) -> Bool { a.valeur < b.valeur }
    var euros: String { Fmt.euros(valeur) }
}

/// Un texte que la base peut renvoyer en nombre (numero d'emplacement).
struct TexteSouple: Decodable, Hashable {
    let valeur: String
    init(from d: Decoder) throws {
        let c = try d.singleValueContainer()
        if let s = try? c.decode(String.self) { valeur = s }
        else if let i = try? c.decode(Int.self) { valeur = String(i) }
        else { valeur = "" }
    }
}

// MARK: - Tableau de bord

struct TableauDeBord: Decodable {
    struct Occupation: Decodable { let occupes: Int; let total: Int; let taux: Int; let libres: Int }
    struct Impayes: Decodable { let total_du: Montant; let nombre: Int }
    let occupation: Occupation
    let scoped: Bool?
    let ca_mois: Montant
    let encaissements_mois: [String: Montant]
    let impayes: Impayes

    var encaisse: Double { encaissements_mois.values.reduce(0) { $0 + $1.valeur } }
}

struct Echeance: Decodable, Identifiable, Hashable {
    let type: String            // assurance, contrat, document
    let cible_id: String
    let resident_id: String?
    let resident_nom: String?
    let echeance: String?
    let jours_restants: Int?
    let statut: String          // manquante, expiree, a_venir
    let titre: String?
    let contrat_numero: String?
    var id: String { type + cible_id }

    var libelle: String {
        switch type {
        case "assurance": "Attestation d'assurance"
        case "contrat": "Contrat \(contrat_numero ?? "") à renouveler"
        default: titre ?? "Document à échéance"
        }
    }
    var detail: String {
        switch statut {
        case "manquante": "aucune attestation"
        case "expiree": "expirée depuis \(abs(jours_restants ?? 0)) j"
        default: jours_restants.map { "échéance dans \($0) j" } ?? "à venir"
        }
    }
    var symbole: String {
        switch type {
        case "assurance": "checkmark.shield"
        case "contrat": "doc.text"
        default: "signature"
        }
    }
}
struct ReponseEcheances: Decodable { let echeances: [Echeance] }

struct Prestation: Decodable, Identifiable {
    let id: String
    let designation: String?
    let montant_ttc: Montant?
}
struct ReponsePrestations: Decodable { let prestations: [Prestation] }

// MARK: - Residents

struct Resident: Decodable, Identifiable, Hashable {
    struct Contrat: Decodable, Hashable { let date_fin: String?; let signe: Bool? }
    let id: String
    let civilite: String?
    let nom: String?
    let prenom: String?
    let email: String?
    let telephone: String?
    let emplacement_id: String?
    let actif: Bool?
    let assurance_expire_le: String?
    let solde: Montant?
    let contrat: Contrat?

    var nomComplet: String { [prenom, nom].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ") }
    var estActif: Bool { actif != false }
    var soldeDu: Bool { (solde?.valeur ?? 0) > 0.004 }
    var aCompleter: Bool { contrat?.signe != true || assurance_expire_le == nil }
}
struct ReponseResidents2: Decodable { let residents: [Resident] }

struct FicheResident: Decodable {
    struct Detail: Decodable {
        let id: String
        let civilite: String?
        let nom: String?
        let prenom: String?
        let email: String?
        let telephone: String?
        let adresse: String?
        let date_naissance: String?
        let notes_internes: String?
        let actif: Bool?
        let compte_comptable: String?
        let assurance_expire_le: String?
        let assurance_ref: String?
        let raison_sociale: String?
        var nomComplet: String { [prenom, nom].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ") }
    }
    struct Emplacement: Decodable { let id: String; let numero: TexteSouple?; let secteur: String?; let type: String?; let loyer_base: Montant? }
    struct Doc: Decodable, Identifiable { let id: String; let type: String?; let nom_fichier: String?; let date_expiration: String?; let created_at: String? }
    let resident: Detail
    let emplacement: Emplacement?
    let documents: [Doc]
}

struct Emplacement: Decodable, Identifiable, Hashable {
    let id: String
    let numero: TexteSouple?
    let secteur: String?
}
struct ReponseEmplacements: Decodable { let emplacements: [Emplacement] }

struct Contrat: Decodable, Identifiable, Hashable {
    let id: String
    let numero: String?
    let date_debut: String?
    let date_fin: String?
    let montant_mensuel: Montant?
    let statut: String
    var libelleStatut: String {
        ["brouillon": "Brouillon", "envoye": "En attente de signature", "signe": "Signé", "actif": "Actif",
         "annule": "Annulé", "expire": "Expiré", "renouvele": "Renouvelé"][statut] ?? statut
    }
    var couleur: String { statut }
}
struct ReponseContrats: Decodable { let contrats: [Contrat] }

// MARK: - Facturation

struct FactureG: Decodable, Identifiable, Hashable {
    let id: String
    let numero: String?
    let resident_id: String?
    let periode: String?
    let date_emission: String?
    let total_ttc: Montant
    let montant_regle: Montant?
    let statut: String

    var reste: Double { max(0, total_ttc.valeur - (montant_regle?.valeur ?? 0)) }
    var libelleStatut: String {
        ["brouillon": "Brouillon", "emise": "Émise", "partielle": "Partielle", "reglee": "Réglée",
         "en_retard": "En retard", "avoir": "Avoir", "annulee": "Annulée"][statut] ?? statut
    }
    var titre: String {
        if let p = periode, p.count == 7, let d = Fmt.periode.date(from: p) {
            let s = Fmt.moisAnnee.string(from: d)
            return s.prefix(1).uppercased() + s.dropFirst()
        }
        return statut == "avoir" ? "Avoir" : "Facture du \(Fmt.jour(date_emission))"
    }
}
struct ReponseFacturesG: Decodable { let factures: [FactureG] }

struct Reglement: Decodable, Identifiable, Hashable {
    let id: String
    let resident_id: String?
    let mode: String?
    let montant: Montant
    let date_reglement: String?
    let reference: String?
    let statut_cheque: String?
    let annule: Bool?
}
struct ReponseReglements: Decodable { let reglements: [Reglement] }

struct Impayes: Decodable {
    struct Ligne: Decodable, Identifiable, Hashable {
        let id: String
        let numero: String?
        let resident_id: String?
        let reste: Montant
        let jours_retard: Int
        let en_retard: Bool
    }
    struct Aging: Decodable { let a_echoir: Montant; let j0_30: Montant; let j31_60: Montant; let j61_90: Montant; let j90_plus: Montant }
    let impayes: [Ligne]
    let aging: Aging
    let total_du: Montant
}

struct MoyenPaiement: Decodable, Identifiable, Hashable {
    let code: String
    let libelle: String
    let type: String?
    var id: String { code }
    /// Reference obligatoire (meme regle que le serveur, routes/reglements.js).
    var referenceRequise: String? {
        ["cheque": "Numéro du chèque", "virement": "Libellé du virement", "ancv": "Numéro du titre ANCV"][type ?? code]
    }
}
struct ReponseMoyens: Decodable { let moyens: [MoyenPaiement] }

struct NotificationStaff: Decodable, Identifiable, Hashable {
    let id: String
    let type: String?
    let titre: String
    let corps: String?
    let entite: String?
    let entite_id: String?
    let lu: Bool
    let created_at: String
}
struct ReponseNotificationsStaff: Decodable { let notifications: [NotificationStaff] }

struct LienURL: Decodable { let url: String }

// MARK: - Formats

enum Fmt {
    static let fr = Locale(identifier: "fr_FR")
    static let periode: DateFormatter = { let f = DateFormatter(); f.locale = fr; f.dateFormat = "yyyy-MM"; return f }()
    static let moisAnnee: DateFormatter = { let f = DateFormatter(); f.locale = fr; f.setLocalizedDateFormatFromTemplate("MMMMy"); return f }()
    private static let jourISO: DateFormatter = { let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"; return f }()

    static func date(_ s: String?) -> Date? {
        guard let s, !s.isEmpty else { return nil }
        return DateISO.lireOptionnel(s) ?? jourISO.date(from: String(s.prefix(10)))
    }
    static func jour(_ s: String?) -> String {
        guard let d = date(s) else { return "—" }
        return d.formatted(.dateTime.day().month(.abbreviated).year().locale(fr))
    }
    static func euros(_ v: Double) -> String { v.formatted(.currency(code: "EUR").locale(fr)) }
    static func eurosCourts(_ v: Double) -> String {
        v.formatted(.currency(code: "EUR").precision(.fractionLength(0)).locale(fr))
    }
    static func modeLibelle(_ code: String?) -> String {
        ["espece": "Espèces", "cheque": "Chèque", "virement": "Virement", "carte": "Carte bancaire",
         "prelevement": "Prélèvement", "stripe": "Paiement en ligne", "ancv": "Chèques-vacances"][code ?? ""] ?? (code ?? "—")
    }
}

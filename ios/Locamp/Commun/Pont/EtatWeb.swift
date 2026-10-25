import Foundation

/// Ce que le site publie a chaque changement d'ecran (message « etat »).
/// Miroir exact de `lireEtat()` dans backend/public/natif.js.
struct EtatWeb: Decodable, Equatable {
    var version: Int
    var ecran: String
    var groupe: String
    var titre: String
    var retour: Bool
    var onglets: [SousOnglet]
    var ongletActif: String
    var actions: [ActionWeb]
    var recherche: Recherche?
    var badges: Badges
    var contexte: Contexte

    struct SousOnglet: Decodable, Equatable, Identifiable {
        var id: String
        var titre: String
        var badge: Int
    }

    struct ActionWeb: Decodable, Equatable, Identifiable {
        var id: String
        var titre: String
        var symbole: String
        var principal: Bool
        var destructif: Bool
        var desactive: Bool
    }

    struct Recherche: Decodable, Equatable {
        var invite: String
        var valeur: String
    }

    struct Badges: Decodable, Equatable {
        var factures: Int
        var messagerie: Int
        var notifications: Int
    }

    struct Contexte: Decodable, Equatable {
        var campings: [Choix]
        var campingActif: String?
        var nomCamping: String?
        var exercices: [Choix]
        var exerciceActif: String?
        var utilisateur: Utilisateur
    }

    struct Choix: Decodable, Equatable, Identifiable, Hashable {
        var id: String
        var nom: String
    }

    struct Utilisateur: Decodable, Equatable {
        var nom: String
        var email: String
        var admin: Bool

        var initiales: String {
            nom.split(whereSeparator: { $0 == " " || $0 == "." })
                .prefix(2).compactMap { $0.first.map { String($0).uppercased() } }.joined()
        }
    }

    /// L'action mise en avant (bouton Liquid Glass « prominent »).
    var actionPrincipale: ActionWeb? { actions.first(where: \.principal) }
    /// Les autres, rangees dans le menu « … ».
    var actionsSecondaires: [ActionWeb] {
        let p = actionPrincipale?.id
        return actions.filter { $0.id != p }
    }
}

/// Demande d'alerte native (askConfirm / askPrompt cote site).
struct DialogueWeb: Identifiable, Equatable {
    enum Genre: String { case confirmer, saisir }
    var id: String
    var genre: Genre
    var titre: String
    var message: String
    var ok: String
    var danger: Bool
    var valeur: String
    var invite: String
}

struct ToastWeb: Identifiable, Equatable {
    let id = UUID()
    var message: String
    var erreur: Bool
}

/// Un onglet natif. La liste est propre a chaque app (Configuration.swift).
struct OngletApp: Hashable, Identifiable {
    let id: String
    let titre: String
    let symbole: String
    /// Groupes web (cles de GROUPES_NAV, rubriques du portail) affiches
    /// par cet onglet. Le premier est l'ecran ouvert par defaut.
    let groupes: [String]
    /// Pastille de l'onglet, lue dans les badges publies par le site.
    var badge: KeyPath<EtatWeb.Badges, Int>? = nil
    /// Ecran 100 % natif a la place du site (messagerie).
    var natif: EcranNatif? = nil

    static func == (a: OngletApp, b: OngletApp) -> Bool { a.id == b.id }
    func hash(into h: inout Hasher) { h.combine(id) }

    /// L'onglet « Plus », qui regroupe les ecrans moins frequents.
    static let plus = OngletApp(id: "plus", titre: "Plus", symbole: "ellipsis", groupes: [])

    static var premier: OngletApp { Configuration.onglets[0] }

    /// Ou range-t-on un groupe web ?
    static func pour(groupe: String) -> (OngletApp, EcranPlus?) {
        if let o = Configuration.onglets.first(where: { $0.groupes.contains(groupe) }) { return (o, nil) }
        if let e = Configuration.ecransPlus.first(where: { $0.id == groupe }) { return (.plus, e) }
        return (premier, nil)
    }
}

/// Un ecran de l'onglet « Plus ».
struct EcranPlus: Hashable, Identifiable {
    let id: String
    let titre: String
    let symbole: String
    var badge: KeyPath<EtatWeb.Badges, Int>? = nil
    var natif: EcranNatif? = nil

    static func == (a: EcranPlus, b: EcranPlus) -> Bool { a.id == b.id }
    func hash(into h: inout Hasher) { h.combine(id) }
}

/// Les ecrans dessines entierement en SwiftUI, sans le site.
enum EcranNatif: Hashable {
    case messagerieGestion, messagerieLocataire
}

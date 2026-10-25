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

/// Les cinq onglets natifs. Les huit entrees du menu web s'y repartissent :
/// les quatre moins frequentes vivent sous « Plus ».
enum OngletApp: String, CaseIterable, Hashable {
    case accueil, carte, residents, factures, plus

    /// Groupe web (cle de GROUPES_NAV / data-nav) affiche par l'onglet.
    var groupe: String? {
        switch self {
        case .accueil: "dashboard"
        case .carte: "carte"
        case .residents: "residents"
        case .factures: "factures"
        case .plus: nil
        }
    }
}

enum EcranPlus: String, CaseIterable, Hashable, Identifiable {
    case messagerie, compteurs, compta, parametres
    var id: String { rawValue }

    var titre: String {
        switch self {
        case .messagerie: "Messagerie"
        case .compteurs: "Compteurs"
        case .compta: "Comptabilité"
        case .parametres: "Réglages"
        }
    }

    var symbole: String {
        switch self {
        case .messagerie: "bubble.left.and.bubble.right"
        case .compteurs: "gauge.with.dots.needle.33percent"
        case .compta: "chart.bar.xaxis"
        case .parametres: "gearshape"
        }
    }
}

extension OngletApp {
    /// Ou range-t-on un groupe web ?
    static func pour(groupe: String) -> (OngletApp, EcranPlus?) {
        if let o = OngletApp.allCases.first(where: { $0.groupe == groupe }) { return (o, nil) }
        if let e = EcranPlus(rawValue: groupe) { return (.plus, e) }
        return (.accueil, nil)
    }
}

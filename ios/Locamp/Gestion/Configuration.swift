import Foundation

/// Ce qui distingue l'app Gestion de l'app Locataire. Le reste du code
/// (Commun/) est partage.
enum Configuration {
    /// Fichiers du pont embarques (backend/public/natif.js / .css).
    static let fichiersPont = "natif"

    /// Onglets natifs : les huit entrees du menu web s'y repartissent,
    /// les quatre moins frequentes vivent sous « Plus ».
    static let onglets: [OngletApp] = [
        OngletApp(id: "accueil", titre: "Accueil", symbole: "square.grid.2x2", groupes: ["dashboard"]),
        OngletApp(id: "carte", titre: "Carte", symbole: "map", groupes: ["carte"]),
        OngletApp(id: "residents", titre: "Résidents", symbole: "person.2", groupes: ["residents"]),
        OngletApp(id: "factures", titre: "Facturation", symbole: "doc.text", groupes: ["factures"], badge: \.factures),
    ]

    static let ecransPlus: [EcranPlus] = [
        EcranPlus(id: "messagerie", titre: "Messagerie", symbole: "bubble.left.and.bubble.right", badge: \.messagerie,
                   natif: .messagerieGestion),
        EcranPlus(id: "compteurs", titre: "Compteurs", symbole: "gauge.with.dots.needle.33percent"),
        EcranPlus(id: "compta", titre: "Comptabilité", symbole: "chart.bar.xaxis"),
        EcranPlus(id: "parametres", titre: "Réglages", symbole: "gearshape"),
    ]

    /// Cloche des notifications dans la barre.
    static let cloche = true
    /// Plusieurs espaces camping : choix et creation dans le menu du compte.
    static let espacesCamping = true
    /// Paiement en ligne masque (regle App Store 3.1.1) : outil pro, non.
    static let paiementMasque = false

    /// Ecran a ouvrir quand on touche une notification push.
    static func ecran(pourNotification type: String?, entite: String?) -> String? {
        if type == "nouveau_message" { return "messagerie" }
        if type == "relance" || type == "paiement_recu" { return "impayes" }
        if entite == "facture" { return "factures" }
        return nil
    }
}

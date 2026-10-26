import Foundation

/// Ce qui distingue l'app Locataire de l'app Gestion. Le reste du code
/// (Commun/) est partage.
enum Configuration {
    /// Fichiers du pont embarques (backend/public/portail/natif-portail.js / .css).
    static let fichiersPont = "natif-portail"

    /// Les quatre rubriques du portail, en onglets natifs.
    static let onglets: [OngletApp] = [
        OngletApp(id: "solde", titre: "Accueil", symbole: "house", groupes: ["solde"]),
        OngletApp(id: "factures", titre: "Factures", symbole: "doc.text", groupes: ["factures"]),
        OngletApp(id: "messages", titre: "Messages", symbole: "bubble.left.and.bubble.right", groupes: ["messages"], badge: \.messagerie,
                  natif: .messagerieLocataire),
        OngletApp(id: "documents", titre: "Documents", symbole: "folder", groupes: ["documents"], badge: \.notifications),
    ]

    static let ecransPlus: [EcranPlus] = []

    static let cloche = false
    static let espacesCamping = false
    /// Le portail a sa propre connexion : pas de changement de mot de passe ici.
    static let motDePasse = false
    /// Le paiement en ligne passe par Stripe, hors achat integre : il est
    /// masque dans l'app (regle App Store 3.1.1), via window.LOCAMP_NATIVE.
    static let paiementMasque = true

    static func ecran(pourNotification type: String?, entite: String?) -> String? {
        if type == "nouveau_message" { return "messages" }
        if type == "document_signe" || entite == "document" { return "documents" }
        return "factures"
    }
}

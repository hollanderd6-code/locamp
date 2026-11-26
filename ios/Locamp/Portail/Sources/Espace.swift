import SwiftUI
import UserNotifications

/// Tout ce que l'espace du locataire affiche, charge en une fois (comme
/// chargerEspace() du portail web) et partage entre les onglets.
@MainActor
@Observable
final class Espace {
    private(set) var etat: Chargement<Void> = .enCours
    private(set) var moi: Moi?
    private(set) var factures: [Facture] = []
    private(set) var prestations: [Prestation] = []
    private(set) var documents: [Document] = []
    private(set) var aSigner: [DocumentSignature] = []
    private(set) var signes: [DocumentSignature] = []
    private(set) var notifications: [NotificationPortail] = []

    @ObservationIgnored private var enCours = false

    var dues: [Facture] { factures.filter(\.aRegler) }
    var totalDu: Double { dues.reduce(0) { $0 + $1.reste.valeur } }
    var retardMax: Int { dues.map(\.retard).max() ?? 0 }
    var nonLues: Int { notifications.filter { !$0.lu }.count }
    var messagesNonLus: [NotificationPortail] { notifications.filter { !$0.lu && $0.type == "nouveau_message" } }

    /// Le paiement en ligne passe par Stripe (service consomme hors de l'app :
    /// loyer, sejour). Laisse masque par prudence ; a activer ici quand la
    /// fiche App Store le mentionne (regle 3.1.3(e)).
    static let paiementDansApp = false
    var paiementPossible: Bool { Self.paiementDansApp && (moi?.paiement_en_ligne ?? false) }

    func charger() async {
        guard !enCours, Session.partage.connecte else { return }
        enCours = true
        defer { enCours = false }
        do {
            async let m = API.requete("/api/portail/moi", as: Moi.self)
            async let f = API.requete("/api/portail/factures", as: ReponseFactures.self)
            async let d = API.requete("/api/portail/documents", as: ReponseDocuments.self)
            async let p = try? API.requete("/api/portail/prestations", as: ReponsePrestations.self)
            async let s = try? API.requete("/api/portail/signatures", as: ReponseSignatures.self)
            async let n = try? API.requete("/api/portail/notifications?limit=40", as: ReponseNotifications.self)
            let (vm, vf, vd) = try await (m, f, d)
            let (vp, vs, vn) = await (p, s, n)
            withAnimation(.smooth) {
                moi = vm
                factures = vf.factures
                documents = vd.documents
                prestations = vp?.prestations ?? []
                aSigner = vs?.a_signer ?? []
                signes = vs?.signes ?? []
                notifications = vn?.notifications ?? []
                etat = .pret(())
            }
            majPastilles()
        } catch is CancellationError {
        } catch {
            if moi == nil { etat = .echec(error.localizedDescription) }
            else if case API.Erreur.sessionExpiree = error {} else {
                Session.partage.afficher(error.localizedDescription, erreur: true)
            }
        }
    }

    func chargerNotifications() async {
        if let n = try? await API.requete("/api/portail/notifications?limit=40", as: ReponseNotifications.self) {
            withAnimation(.smooth) { notifications = n.notifications }
            majPastilles()
        }
    }

    /// Ouvrir le fil vaut lecture : les notifications « nouveau message »
    /// passent a lu, la pastille de l'onglet s'efface.
    func marquerMessagesLus() async {
        let liste = messagesNonLus
        guard !liste.isEmpty else { return }
        for n in liste {
            _ = try? await API.requete("/api/portail/notifications/\(n.id)/lu", methode: "POST", as: API.Vide.self)
        }
        await chargerNotifications()
    }

    func marquerLue(_ n: NotificationPortail) async {
        _ = try? await API.requete("/api/portail/notifications/\(n.id)/lu", methode: "POST", as: API.Vide.self)
        await chargerNotifications()
    }

    func toutMarquerLu() async {
        do {
            _ = try await API.requete("/api/portail/notifications/tout-lu", methode: "POST", as: API.Vide.self)
            await chargerNotifications()
        } catch {
            Session.partage.afficher(error.localizedDescription, erreur: true)
        }
    }

    func vider() {
        moi = nil; factures = []; prestations = []; documents = []; aSigner = []; signes = []; notifications = []
        etat = .enCours
    }

    private func majPastilles() {
        let s = Session.partage
        s.nonLusMessages = messagesNonLus.count
        s.aSigner = aSigner.count
        UNUserNotificationCenter.current().setBadgeCount(nonLues)
    }
}

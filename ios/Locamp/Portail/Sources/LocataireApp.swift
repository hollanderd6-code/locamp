import SwiftUI
import UserNotifications
#if canImport(FirebaseMessaging)
import FirebaseCore
import FirebaseMessaging
#endif

/// « Mon camping » : l'espace locataire de Locamp, entierement en SwiftUI.
/// Aucune page web : chaque ecran parle directement a l'API du portail
/// (backend/routes/portail.js).
@main
struct LocataireApp: App {
    @UIApplicationDelegateAdaptor(AppDelegateLocataire.self) private var delegue
    @State private var session = Session.partage

    var body: some Scene {
        WindowGroup {
            RacineLocataire()
                .environment(session)
                .tint(Color.accentColor)
                // Liens recus par e-mail (activation, nouveau mot de passe,
                // lien de connexion) : https://…/portail/?activation=…
                .onOpenURL { session.ouvrirLien($0) }
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { a in
                    if let url = a.webpageURL { session.ouvrirLien(url) }
                }
        }
    }
}

/// Notifications push : Firebase Cloud Messaging, canal « portail »
/// (backend/lib/push.js). Le jeton est enregistre aupres du serveur des
/// que le locataire est connecte.
final class AppDelegateLocataire: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        #if canImport(FirebaseMessaging)
        if Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil {
            FirebaseApp.configure()
            Messaging.messaging().delegate = self
        }
        #endif
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        #if canImport(FirebaseMessaging)
        Messaging.messaging().apnsToken = deviceToken
        #endif
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async
        -> UNNotificationPresentationOptions {
        await MainActor.run { Session.partage.signalerNouveautes() }
        return [.banner, .sound, .badge]
    }

    /// Notification touchee : on ouvre l'onglet concerne.
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let d = response.notification.request.content.userInfo
        let type = d["type"] as? String
        let entite = d["entite"] as? String
        await MainActor.run {
            let s = Session.partage
            switch (type, entite) {
            case ("nouveau_message", _): s.onglet = .messages
            case ("document_signe", _), (_, "document"), (_, "signature"): s.onglet = .documents
            default: s.onglet = .factures
            }
            s.signalerNouveautes()
        }
    }
}

#if canImport(FirebaseMessaging)
extension AppDelegateLocataire: MessagingDelegate {
    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        guard let fcmToken else { return }
        Task { @MainActor in Session.partage.recevoirJetonPush(fcmToken) }
    }
}
#endif

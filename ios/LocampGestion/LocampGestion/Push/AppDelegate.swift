import UIKit
import UserNotifications
#if canImport(FirebaseMessaging)
import FirebaseCore
import FirebaseMessaging
#endif

/// Notifications push.
///
/// Le serveur envoie par Firebase Cloud Messaging (backend/lib/push.js,
/// canal « staff », projet locamp-gestion). L'app obtient donc un jeton FCM
/// et le confie au site, qui l'enregistre avec la session de l'utilisateur
/// (POST /api/push/register). Sans le paquet Firebase, l'app fonctionne,
/// simplement sans push.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        #if canImport(FirebaseMessaging)
        if Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil {
            FirebaseApp.configure()
            Messaging.messaging().delegate = self
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { ok, _ in
                guard ok else { return }
                DispatchQueue.main.async { application.registerForRemoteNotifications() }
            }
        }
        #endif
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        #if canImport(FirebaseMessaging)
        Messaging.messaging().apnsToken = deviceToken
        #endif
    }

    // Notification recue app ouverte : on l'affiche quand meme, en banniere.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async
        -> UNNotificationPresentationOptions {
        await MainActor.run { Pont.partage.appeler("recharger") }
        return [.banner, .sound, .badge]
    }

    // Notification touchee : on ouvre l'ecran concerne (memes regles que
    // l'ancienne app Capacitor, voir app.js « NOTIFICATIONS PUSH »).
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let d = response.notification.request.content.userInfo
        let type = d["type"] as? String
        let entite = d["entite"] as? String
        await MainActor.run {
            let pont = Pont.partage
            if type == "nouveau_message" { pont.naviguer("messagerie") }
            else if type == "relance" || type == "paiement_recu" { pont.naviguer("impayes") }
            else if entite == "facture" { pont.naviguer("factures") }
        }
    }
}

#if canImport(FirebaseMessaging)
extension AppDelegate: MessagingDelegate {
    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        guard let fcmToken else { return }
        Task { @MainActor in Pont.partage.recevoirJetonPush(fcmToken) }
    }
}
#endif

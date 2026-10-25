import SwiftUI

@main
struct LocampGestionApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            RacineView()
                .environment(Pont.partage)
                .tint(Color.accentColor)
                // Le site n'a pas encore de theme sombre.
                .preferredColorScheme(.light)
        }
    }
}

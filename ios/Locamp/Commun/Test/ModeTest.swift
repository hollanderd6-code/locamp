#if DEBUG
import SwiftUI

/// Captures automatiques dans le simulateur (.github/workflows/ios.yml),
/// app Gestion : connexion au site avec le compte de test, puis visite de
/// chaque onglet et de chaque ecran de « Plus », en UN seul lancement.
/// A chaque etape l'app ecrit son nom dans Library/Caches/etape.txt et
/// attend que le simulateur ait capture l'ecran (fichier ok-<etape>).
/// Absent des versions publiees.
enum ModeTest {
    @MainActor static func demarrer() async {
        let env = ProcessInfo.processInfo.environment
        guard let email = env["LOCAMP_TEST_EMAIL"], let mdp = env["LOCAMP_TEST_MDP"], !email.isEmpty else { return }
        let pont = Pont.partage

        // Le site est charge (natif.js a dit « pret »).
        for _ in 0..<180 where !pont.pret { try? await Task.sleep(for: .milliseconds(500)) }
        try? await Task.sleep(for: .seconds(1))

        if !pont.connecte {
            let args = (try? JSONSerialization.data(withJSONObject: [email, mdp]))
                .flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
            let js = """
            (function(a){var f=document.getElementById('login-form');if(!f)return false;
            document.getElementById('login-email').value=a[0];document.getElementById('login-password').value=a[1];
            f.requestSubmit();return true;})(\(args))
            """
            _ = try? await pont.webView.evaluateJavaScript(js)
            for _ in 0..<120 where !(pont.connecte && pont.etat != nil) {
                try? await Task.sleep(for: .milliseconds(500))
            }
        }
        guard pont.connecte else { await etape("echec-connexion"); return }
        try? await Task.sleep(for: .seconds(4))

        for o in Configuration.onglets {
            pont.onglet = o
            try? await Task.sleep(for: .seconds(4))
            await etape(o.id)
        }
        if !Configuration.ecransPlus.isEmpty {
            pont.onglet = .plus
            try? await Task.sleep(for: .seconds(2))
            await etape("plus")
            for e in Configuration.ecransPlus {
                pont.cheminPlus = [e]
                try? await Task.sleep(for: .seconds(4))
                await etape("plus-" + e.id)
            }
            pont.cheminPlus = []
        }
        await etape("fin")
    }

    /// Publie l'etape et attend la capture (3 min au plus).
    @MainActor static func etape(_ nom: String) async {
        let dossier = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        try? nom.write(to: dossier.appendingPathComponent("etape.txt"), atomically: true, encoding: .utf8)
        let ok = dossier.appendingPathComponent("ok-" + nom)
        for _ in 0..<360 {
            if FileManager.default.fileExists(atPath: ok.path) { return }
            try? await Task.sleep(for: .milliseconds(500))
        }
    }
}
#endif

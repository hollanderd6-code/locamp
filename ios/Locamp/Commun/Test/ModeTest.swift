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

        // Connexion par l'API (comme l'ecran natif), puis session confiee au
        // site. Plusieurs essais : le serveur peut etre en train de se reveiller.
        for essai in 0..<3 where !pont.connecte {
            if essai > 0 { try? await Task.sleep(for: .seconds(10)) }
            for _ in 0..<120 where !pont.pret { try? await Task.sleep(for: .milliseconds(500)) }
            var r = URLRequest(url: URL(string: "/api/auth/login", relativeTo: pont.adresse)!)
            r.httpMethod = "POST"
            r.timeoutInterval = 90
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            r.httpBody = try? JSONSerialization.data(withJSONObject: ["email": email, "password": mdp])
            struct L: Decodable { struct C: Decodable { let camping_id: String }; let token: String; let campings: [C] }
            guard let rep = try? await URLSession.shared.data(for: r),
                  let l = try? JSONDecoder().decode(L.self, from: rep.0) else { continue }
            let args = (try? JSONSerialization.data(withJSONObject: [l.token, l.campings.first?.camping_id ?? ""]))
                .flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
            _ = try? await pont.webView.evaluateJavaScript(
                "(function(a){localStorage.setItem('lc_token',a[0]);if(a[1])localStorage.setItem('lc_camping',a[1]);location.reload();})(\(args))")
            for _ in 0..<120 where !(pont.connecte && pont.etat != nil) {
                try? await Task.sleep(for: .milliseconds(500))
            }
        }
        guard pont.connecte else { await etape("echec-connexion"); return }
        try? await Task.sleep(for: .seconds(4))

        for o in Configuration.onglets {
            pont.onglet = o
            // La Carte est lourde : on laisse le temps a l'ecran suivant de s'afficher.
            try? await Task.sleep(for: .seconds(7))
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

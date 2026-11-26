import SwiftUI

/// Connexion de l'equipe (POST /api/auth/login), en natif. La session est
/// ensuite confiee au site (localStorage) pour les ecrans encore web.
struct ConnexionNative: View {
    @Environment(Pont.self) private var pont
    @State private var email = ""
    @State private var mdp = ""
    @State private var envoi = false
    @State private var erreur: String?
    @State private var provisoire: Provisoire?
    @State private var ouverture = false
    @FocusState private var champ: Int?

    struct Provisoire: Identifiable { let id = UUID(); let jeton: String; let camping: String?; let actuel: String; let prenom: String }

    struct ReponseLogin: Decodable {
        struct User: Decodable { let prenom: String?; let doit_changer_mdp: Bool? }
        struct Camp: Decodable { let camping_id: String }
        let token: String
        let user: User
        let campings: [Camp]
    }

    private var valide: Bool { email.contains("@") && !mdp.isEmpty }

    var body: some View {
        ScrollView {
            VStack(spacing: 26) {
                VStack(spacing: 12) {
                    Image("LogoApp")
                        .resizable().scaledToFit()
                        .frame(width: 84, height: 84)
                        .clipShape(.rect(cornerRadius: 22, style: .continuous))
                        .shadow(color: .black.opacity(0.12), radius: 16, y: 6)
                    Text("Locamp").font(.largeTitle.bold())
                    Text("La gestion de votre camping résidentiel.")
                        .font(.callout).foregroundStyle(.secondary)
                }
                .padding(.top, 56)

                GlassEffectContainer(spacing: 14) {
                    VStack(spacing: 14) {
                        VStack(spacing: 0) {
                            TextField("Adresse e-mail", text: $email)
                                .textContentType(.username).keyboardType(.emailAddress)
                                .textInputAutocapitalization(.never).autocorrectionDisabled()
                                .focused($champ, equals: 0).submitLabel(.next).onSubmit { champ = 1 }
                                .padding(.horizontal, 18).padding(.vertical, 15)
                            Divider().padding(.leading, 18)
                            SecureField("Mot de passe", text: $mdp)
                                .textContentType(.password)
                                .focused($champ, equals: 1).submitLabel(.go)
                                .onSubmit { if valide { Task { await connecter() } } }
                                .padding(.horizontal, 18).padding(.vertical, 15)
                        }
                        .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 22))

                        Button { Task { await connecter() } } label: {
                            Group { if envoi { ProgressView().tint(.white) } else { Text("Se connecter") } }
                                .font(.headline).frame(maxWidth: .infinity).padding(.vertical, 6)
                        }
                        .buttonStyle(.glassProminent)
                        .controlSize(.large)
                        .disabled(!valide || envoi)
                    }
                }

                if let erreur {
                    Label(erreur, systemImage: "exclamationmark.circle.fill")
                        .font(.subheadline).foregroundStyle(.red).multilineTextAlignment(.center)
                        .transition(.opacity)
                }

                Text("Mot de passe oublié ? L'administrateur de votre camping peut vous renvoyer une invitation.")
                    .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
            .frame(maxWidth: 480)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .background {
            ZStack {
                Color("Fond")
                LinearGradient(colors: [Color.accentColor.opacity(0.26), Color.accentColor.opacity(0.04), .clear],
                               startPoint: .top, endPoint: .center)
            }
            .ignoresSafeArea()
        }
        .overlay {
            // Session confiee au site : il se recharge et se connecte.
            if ouverture {
                VStack(spacing: 12) {
                    ProgressView().controlSize(.large)
                    Text("Ouverture de votre espace…").font(.footnote).foregroundStyle(.secondary)
                }
                .padding(28)
                .glassEffect(.regular, in: .rect(cornerRadius: 24))
            }
        }
        .animation(.smooth, value: erreur)
        .sheet(item: $provisoire) { p in
            NouveauMotDePasse(provisoire: p) { ouvrirSession(jeton: p.jeton, camping: p.camping) }
        }
    }

    private func connecter() async {
        champ = nil
        envoi = true; erreur = nil
        defer { envoi = false }
        do {
            var r = URLRequest(url: URL(string: "/api/auth/login", relativeTo: pont.adresse)!)
            r.httpMethod = "POST"
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            r.httpBody = try JSONSerialization.data(withJSONObject: ["email": email.trimmingCharacters(in: .whitespaces), "password": mdp])
            r.timeoutInterval = 70                       // le serveur peut se reveiller
            let (data, rep) = try await URLSession.shared.data(for: r)
            let code = (rep as? HTTPURLResponse)?.statusCode ?? 0
            guard (200..<300).contains(code) else {
                let m = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
                throw ClientAPI.Erreur.serveur(m ?? "Connexion impossible (\(code)).")
            }
            let l = try JSONDecoder().decode(ReponseLogin.self, from: data)
            if l.user.doit_changer_mdp == true {
                provisoire = Provisoire(jeton: l.token, camping: l.campings.first?.camping_id, actuel: mdp, prenom: l.user.prenom ?? "")
            } else {
                ouvrirSession(jeton: l.token, camping: l.campings.first?.camping_id)
            }
        } catch let e as URLError where e.code != .cancelled {
            erreur = "Connexion impossible. Vérifiez votre réseau et réessayez."
        } catch {
            UINotificationFeedbackGenerator().notificationOccurred(.error)
            erreur = error.localizedDescription
        }
    }

    /// Le site recoit la session et se recharge ; natif.js annonce ensuite
    /// « connecte » et l'app affiche ses onglets.
    private func ouvrirSession(jeton: String, camping: String?) {
        mdp = ""
        ouverture = true
        let args = (try? JSONSerialization.data(withJSONObject: [jeton, camping ?? ""]))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
        pont.webView.evaluateJavaScript("""
        (function(a){localStorage.setItem('lc_token',a[0]);if(a[1])localStorage.setItem('lc_camping',a[1]);location.reload();})(\(args))
        """, completionHandler: nil)
    }
}

/// Premier acces avec un mot de passe provisoire : on en choisit un.
private struct NouveauMotDePasse: View {
    let provisoire: ConnexionNative.Provisoire
    let termine: () -> Void
    @Environment(\.dismiss) private var fermer
    @Environment(Pont.self) private var pont
    @State private var nouveau = ""
    @State private var confirmation = ""
    @State private var envoi = false
    @State private var erreur: String?

    private var valide: Bool { nouveau.count >= 8 && nouveau == confirmation }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    SecureField("Nouveau mot de passe", text: $nouveau).textContentType(.newPassword)
                    SecureField("Confirmer", text: $confirmation).textContentType(.newPassword)
                } header: {
                    Text(provisoire.prenom.isEmpty ? "Bienvenue !" : "Bienvenue \(provisoire.prenom) !").textCase(nil)
                } footer: {
                    if !confirmation.isEmpty && nouveau != confirmation {
                        Text("Les deux mots de passe ne correspondent pas.").foregroundStyle(.red)
                    } else {
                        Text("Votre compte a été créé avec un mot de passe provisoire. Choisissez le vôtre : 8 caractères au moins.")
                    }
                }
                if let erreur { Section { Label(erreur, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red) } }
            }
            .navigationTitle("Votre mot de passe")
            .toolbarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Annuler", systemImage: "xmark") { fermer() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Valider", systemImage: "checkmark") { Task { await valider() } }
                        .buttonStyle(.glassProminent).disabled(!valide || envoi)
                }
            }
        }
        .interactiveDismissDisabled(envoi)
    }

    private func valider() async {
        envoi = true; erreur = nil
        defer { envoi = false }
        do {
            var r = URLRequest(url: URL(string: "/api/auth/mot-de-passe", relativeTo: pont.adresse)!)
            r.httpMethod = "POST"
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            r.setValue("Bearer \(provisoire.jeton)", forHTTPHeaderField: "Authorization")
            r.httpBody = try JSONSerialization.data(withJSONObject: ["actuel": provisoire.actuel, "nouveau": nouveau])
            let (data, rep) = try await URLSession.shared.data(for: r)
            let code = (rep as? HTTPURLResponse)?.statusCode ?? 0
            guard (200..<300).contains(code) else {
                let m = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
                throw ClientAPI.Erreur.serveur(m ?? "Erreur (\(code)).")
            }
            fermer()
            termine()
        } catch {
            erreur = error.localizedDescription
        }
    }
}

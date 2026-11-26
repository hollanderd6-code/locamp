import SwiftUI

/// Connexion : e-mail et mot de passe, sur un fond aux couleurs du camping,
/// formulaire et boutons en Liquid Glass.
struct ConnexionView: View {
    @Environment(Session.self) private var session
    @State private var email = ""
    @State private var mdp = ""
    @State private var envoi = false
    @State private var erreur: String?
    @State private var nonActive = false
    @State private var feuille: Feuille?
    @FocusState private var champ: Champ?

    enum Champ { case email, mdp }
    enum Feuille: String, Identifiable { case oubli, lien; var id: String { rawValue } }

    private var valide: Bool { email.contains("@") && !mdp.isEmpty }

    var body: some View {
        ScrollView {
            VStack(spacing: 28) {
                VStack(spacing: 14) {
                    Image("Logo")
                        .resizable().scaledToFit()
                        .frame(width: 84, height: 84)
                        .clipShape(.rect(cornerRadius: 22, style: .continuous))
                        .shadow(color: .black.opacity(0.12), radius: 16, y: 6)
                    Text("Mon camping")
                        .font(.largeTitle.bold())
                    Text("Votre espace locataire : factures, documents et messages avec votre camping.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .padding(.top, 48)

                GlassEffectContainer(spacing: 14) {
                    VStack(spacing: 14) {
                        VStack(spacing: 0) {
                            TextField("Adresse e-mail", text: $email)
                                .textContentType(.username)
                                .keyboardType(.emailAddress)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .focused($champ, equals: .email)
                                .submitLabel(.next)
                                .onSubmit { champ = .mdp }
                                .padding(.horizontal, 18).padding(.vertical, 15)
                            Divider().padding(.leading, 18)
                            SecureField("Mot de passe", text: $mdp)
                                .textContentType(.password)
                                .focused($champ, equals: .mdp)
                                .submitLabel(.go)
                                .onSubmit { if valide { Task { await connecter() } } }
                                .padding(.horizontal, 18).padding(.vertical, 15)
                        }
                        .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 22))

                        Button {
                            Task { await connecter() }
                        } label: {
                            Group {
                                if envoi { ProgressView().tint(.white) } else { Text("Se connecter") }
                            }
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 6)
                        }
                        .buttonStyle(.glassProminent)
                        .controlSize(.large)
                        .disabled(!valide || envoi)
                    }
                }

                if let erreur {
                    VStack(spacing: 10) {
                        Label(erreur, systemImage: "exclamationmark.circle.fill")
                            .font(.subheadline)
                            .foregroundStyle(.red)
                            .multilineTextAlignment(.center)
                        if nonActive {
                            Button("Définir mon mot de passe") { feuille = .oubli }
                                .buttonStyle(.glass)
                        }
                    }
                    .transition(.opacity.combined(with: .move(edge: .top)))
                }

                VStack(spacing: 14) {
                    Button("Mot de passe oublié ?") { feuille = .oubli }
                    Button("Recevoir un lien de connexion par e-mail") { feuille = .lien }
                }
                .font(.subheadline.weight(.medium))

                Label("Première visite ? Votre camping vous a envoyé une invitation par e-mail pour activer votre espace.",
                      systemImage: "envelope.open")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .glassEffect(.regular, in: .rect(cornerRadius: 18))
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
            .frame(maxWidth: 480)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .background { FondMarque().ignoresSafeArea() }
        .animation(.smooth, value: erreur)
        .sheet(item: $feuille) { f in
            DemandeEmailView(genre: f == .oubli ? .oubli : .lien, emailInitial: email)
        }
    }

    private func connecter() async {
        champ = nil
        envoi = true
        erreur = nil
        defer { envoi = false }
        do {
            let r = try await API.requete("/api/portail/connexion", methode: "POST",
                                          corps: ["email": email.trimmingCharacters(in: .whitespaces), "mot_de_passe": mdp],
                                          authentifie: false, as: ReponseJeton.self)
            mdp = ""
            session.ouvrir(jeton: r.token)
        } catch {
            UINotificationFeedbackGenerator().notificationOccurred(.error)
            erreur = error.localizedDescription
            nonActive = erreur?.contains("non activé") == true
        }
    }
}

/// Fond de l'ecran de connexion : degrade vert sapin discret, sous le verre.
struct FondMarque: View {
    var body: some View {
        ZStack {
            Color("Fond")
            LinearGradient(colors: [Color.accentColor.opacity(0.28), Color.accentColor.opacity(0.04), .clear],
                           startPoint: .top, endPoint: .center)
            Circle()
                .fill(Color.accentColor.opacity(0.18))
                .frame(width: 420, height: 420)
                .blur(radius: 90)
                .offset(x: 140, y: -260)
        }
    }
}

// MARK: - Mot de passe oublie / lien de connexion

struct DemandeEmailView: View {
    enum Genre { case oubli, lien }
    let genre: Genre
    @State var emailInitial: String
    @Environment(\.dismiss) private var fermer
    @State private var envoi = false
    @State private var reponse: String?
    @State private var erreur: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Adresse e-mail", text: $emailInitial)
                        .textContentType(.username)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } footer: {
                    Text(genre == .oubli
                         ? "Vous recevrez un e-mail pour choisir un nouveau mot de passe. Le lien ouvre directement l'app."
                         : "Vous recevrez un lien valable 30 minutes qui vous connecte sans mot de passe.")
                }
                if let reponse {
                    Section { Label(reponse, systemImage: "checkmark.circle.fill").foregroundStyle(.green) }
                }
                if let erreur {
                    Section { Label(erreur, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red) }
                }
            }
            .navigationTitle(genre == .oubli ? "Mot de passe oublié" : "Lien de connexion")
            .toolbarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer", systemImage: "xmark") { fermer() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Envoyer", systemImage: "paperplane") { Task { await envoyer() } }
                        .buttonStyle(.glassProminent)
                        .disabled(!emailInitial.contains("@") || envoi || reponse != nil)
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func envoyer() async {
        envoi = true; erreur = nil
        defer { envoi = false }
        do {
            let chemin = genre == .oubli ? "/api/portail/mdp-oublie" : "/api/portail/demande-acces"
            let r = try await API.requete(chemin, methode: "POST",
                                          corps: ["email": emailInitial.trimmingCharacters(in: .whitespaces)],
                                          authentifie: false, as: ReponseMessageSimple.self)
            withAnimation { reponse = r.message ?? "C'est envoyé. Consultez votre boîte de réception." }
        } catch {
            erreur = error.localizedDescription
        }
    }
}

// MARK: - Activation / nouveau mot de passe (lien recu par e-mail)

struct ActivationView: View {
    let lien: LienEmail
    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var fermer
    @State private var email: String?
    @State private var dejaActif = false
    @State private var mdp = ""
    @State private var mdp2 = ""
    @State private var envoi = false
    @State private var erreur: String?

    private var activation: Bool {
        if case .activation = lien { return !dejaActif }
        return false
    }
    /// Meme regle que le serveur : 8 caracteres, une lettre et un chiffre.
    private var valide: Bool {
        mdp.count >= 8 && mdp == mdp2
            && mdp.contains(where: \.isLetter) && mdp.contains(where: \.isNumber)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if let email { LabeledContent("Compte", value: email) }
                    SecureField("Nouveau mot de passe", text: $mdp).textContentType(.newPassword)
                    SecureField("Confirmer le mot de passe", text: $mdp2).textContentType(.newPassword)
                } header: {
                    Text(activation ? "Bienvenue ! Choisissez votre mot de passe pour activer votre espace."
                                    : "Choisissez votre nouveau mot de passe.")
                        .textCase(nil)
                } footer: {
                    if !mdp2.isEmpty && mdp != mdp2 {
                        Text("Les deux mots de passe ne correspondent pas.").foregroundStyle(.red)
                    } else {
                        Text("8 caractères au moins, dont une lettre et un chiffre.")
                    }
                }
                if let erreur {
                    Section { Label(erreur, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red) }
                }
            }
            .navigationTitle(activation ? "Activer mon espace" : "Nouveau mot de passe")
            .toolbarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler", systemImage: "xmark") { fermer() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(activation ? "Activer" : "Enregistrer", systemImage: "checkmark") { Task { await valider() } }
                        .buttonStyle(.glassProminent)
                        .disabled(!valide || envoi)
                }
            }
            .task {
                guard case .activation(let j) = lien else { return }
                struct V: Decodable { let email: String?; let deja_actif: Bool? }
                do {
                    let v = try await API.requete("/api/portail/activation/\(j)", authentifie: false, as: V.self)
                    email = v.email
                    dejaActif = v.deja_actif ?? false
                } catch {
                    erreur = error.localizedDescription
                }
            }
        }
        .interactiveDismissDisabled(envoi)
    }

    private func valider() async {
        envoi = true; erreur = nil
        defer { envoi = false }
        let chemin: String
        if case .activation = lien { chemin = "/api/portail/activation" } else { chemin = "/api/portail/mdp-reinit" }
        do {
            let r = try await API.requete(chemin, methode: "POST", corps: ["jeton": lien.jeton, "mot_de_passe": mdp],
                                          authentifie: false, as: ReponseJeton.self)
            session.ouvrir(jeton: r.token)
            session.afficher(r.message ?? "C'est fait.")
            fermer()
        } catch {
            erreur = error.localizedDescription
        }
    }
}

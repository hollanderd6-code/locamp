import SwiftUI

// MARK: - Barre commune aux onglets : compte a gauche, cloche a droite

extension View {
    func barreEspace() -> some View { modifier(BarreEspace()) }
}

private struct BarreEspace: ViewModifier {
    @Environment(Espace.self) private var espace
    @State private var compte = false
    @State private var notifications = false

    func body(content: Content) -> some View {
        content
            .toolbar {
                BoutonCompte(ouvert: $compte, initiales: initiales(espace.moi?.resident.nomComplet ?? ""))
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        notifications = true
                    } label: {
                        Label("Notifications", systemImage: espace.nonLues > 0 ? "bell.badge" : "bell")
                    }
                    .symbolRenderingMode(espace.nonLues > 0 ? .multicolor : .monochrome)
                    .badge(espace.nonLues)
                }
            }
            .sheet(isPresented: $compte) { CompteView() }
            .sheet(isPresented: $notifications) { NotificationsView() }
            #if DEBUG
            .onAppear { if ModeTest.ouvrirCompte { ModeTest.ouvrirCompte = false; compte = true } }
            #endif
    }
}

// MARK: - Notifications

struct NotificationsView: View {
    @Environment(Session.self) private var session
    @Environment(Espace.self) private var espace
    @Environment(\.dismiss) private var fermer

    var body: some View {
        NavigationStack {
            List(espace.notifications) { n in
                Button {
                    Task { await espace.marquerLue(n) }
                    switch n.type {
                    case "nouveau_message": session.onglet = .messages
                    case "nouvelle_facture", "paiement_confirme": session.onglet = .factures
                    case "document_signe", "signature_demandee": session.onglet = .documents
                    default: break
                    }
                    fermer()
                } label: {
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: n.symbole)
                            .foregroundStyle(Color.accentColor)
                            .frame(width: 36, height: 36)
                            .background(Color.accentColor.opacity(0.12), in: .rect(cornerRadius: 10))
                        VStack(alignment: .leading, spacing: 3) {
                            Text(n.titre).font(.body.weight(n.lu ? .regular : .semibold)).foregroundStyle(.primary)
                            if let c = n.corps, !c.isEmpty {
                                Text(c).font(.subheadline).foregroundStyle(.secondary).lineLimit(3)
                            }
                            if let d = Format.date(n.created_at) {
                                Text(d, format: .relative(presentation: .named)).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        Spacer(minLength: 0)
                        if !n.lu { Circle().fill(Color.accentColor).frame(width: 9, height: 9).padding(.top, 6) }
                    }
                }
                .swipeActions {
                    if !n.lu {
                        Button("Lu", systemImage: "envelope.open") { Task { await espace.marquerLue(n) } }
                            .tint(Color.accentColor)
                    }
                }
            }
            .overlay {
                if espace.notifications.isEmpty {
                    ContentUnavailableView("Vous êtes à jour", systemImage: "bell.slash",
                                           description: Text("Aucune notification pour le moment."))
                }
            }
            .refreshable { await espace.chargerNotifications() }
            .navigationTitle("Notifications")
            .toolbarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer", systemImage: "xmark") { fermer() }
                }
                if espace.nonLues > 0 {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Tout lu", systemImage: "checkmark.circle") { Task { await espace.toutMarquerLu() } }
                    }
                }
            }
        }
        .task { await espace.chargerNotifications() }
    }
}

// MARK: - Compte

struct CompteView: View {
    @Environment(Session.self) private var session
    @Environment(Espace.self) private var espace
    @Environment(\.dismiss) private var fermer
    @State private var deconnexion = false
    @State private var suppression = false
    @State private var motif = ""
    @State private var motDePasse = false
    @State private var export: URL?
    @State private var exportEnCours = false

    var body: some View {
        NavigationStack {
            List {
                if let m = espace.moi {
                    Section {
                        HStack(spacing: 14) {
                            Text(initiales(m.resident.nomComplet))
                                .font(.title2.weight(.semibold))
                                .foregroundStyle(.white)
                                .frame(width: 60, height: 60)
                                .background(Color.accentColor.gradient, in: .circle)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(m.resident.nomComplet).font(.title3.weight(.semibold))
                                if let e = m.resident.email { Text(e).font(.subheadline).foregroundStyle(.secondary) }
                            }
                        }
                        .padding(.vertical, 6)
                    }

                    Section("Mon séjour") {
                        LabeledContent("Camping", value: m.camping.nom)
                        if let n = m.emplacement?.numero?.valeur, !n.isEmpty {
                            LabeledContent("Emplacement", value: [n, m.emplacement?.secteur].compactMap { $0 }.joined(separator: " · "))
                        }
                        if let t = m.resident.telephone, !t.isEmpty { LabeledContent("Téléphone", value: t) }
                        if let a = m.resident.adresse, !a.isEmpty { LabeledContent("Adresse", value: a) }
                    }
                }

                Section {
                    Button { motDePasse = true } label: { Label("Changer mon mot de passe", systemImage: "key") }
                    if let u = URL(string: UIApplication.openSettingsURLString) {
                        Link(destination: u) { Label("Notifications de l'app", systemImage: "bell.badge") }
                    }
                } header: {
                    Text("Compte")
                } footer: {
                    Text("Pour modifier votre adresse, votre téléphone ou votre e-mail, écrivez à votre camping depuis Messages.")
                }

                Section {
                    Button {
                        Task { await exporter() }
                    } label: {
                        HStack {
                            Label("Télécharger mes données", systemImage: "arrow.down.doc")
                            Spacer()
                            if exportEnCours { ProgressView() }
                        }
                    }
                    .disabled(exportEnCours)
                    Link(destination: Session.partage.base.appendingPathComponent("confidentialite")) {
                        Label("Politique de confidentialité", systemImage: "hand.raised")
                    }
                    Button(role: .destructive) { suppression = true } label: {
                        Label("Supprimer mon compte", systemImage: "person.crop.circle.badge.xmark")
                    }
                } header: {
                    Text("Mes données")
                } footer: {
                    Text("Vos données sont gérées par votre camping. Une demande de suppression lui est transmise ; les factures restent conservées 10 ans, comme la loi l'impose.")
                }

                Section {
                    Button(role: .destructive) { deconnexion = true } label: {
                        Label("Se déconnecter", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                } footer: {
                    Text("Mon camping \(Bundle.main.versionCourte) · Locamp")
                        .frame(maxWidth: .infinity)
                        .padding(.top, 12)
                }
            }
            .navigationTitle("Mon compte")
            .toolbarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("OK", systemImage: "checkmark") { fermer() }
                }
            }
            .confirmationDialog("Se déconnecter de votre espace ?", isPresented: $deconnexion, titleVisibility: .visible) {
                Button("Se déconnecter", role: .destructive) {
                    fermer()
                    Task { await session.fermer() }
                }
            }
            .alert("Changer de mot de passe", isPresented: $motDePasse) {
                Button("Annuler", role: .cancel) {}
                Button("Envoyer le lien") { Task { await demanderMotDePasse() } }
            } message: {
                Text("Nous envoyons un lien à \(espace.moi?.resident.email ?? "votre adresse") pour choisir un nouveau mot de passe.")
            }
            .alert("Supprimer mon compte ?", isPresented: $suppression) {
                TextField("Motif (facultatif)", text: $motif)
                Button("Annuler", role: .cancel) { motif = "" }
                Button("Demander la suppression", role: .destructive) { Task { await demanderSuppression() } }
            } message: {
                Text("Votre camping recevra la demande et effacera votre compte et vos documents sous 30 jours. Vous serez ensuite déconnecté.")
            }
            .sheet(item: $export) { url in
                PartageFichier(url: url)
            }
        }
    }

    private func exporter() async {
        exportEnCours = true
        defer { exportEnCours = false }
        do {
            let data = try await API.donnees("/api/portail/mes-donnees")
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("mes_donnees_locamp.json")
            try data.write(to: url, options: .atomic)
            export = url
        } catch {
            session.afficher(error.localizedDescription, erreur: true)
        }
    }

    private func demanderMotDePasse() async {
        guard let e = espace.moi?.resident.email else { return }
        do {
            _ = try await API.requete("/api/portail/mdp-oublie", methode: "POST", corps: ["email": e],
                                      authentifie: false, as: ReponseMessageSimple.self)
            session.afficher("Lien envoyé à \(e)")
        } catch {
            session.afficher(error.localizedDescription, erreur: true)
        }
    }

    private func demanderSuppression() async {
        do {
            let r = try await API.requete("/api/portail/demande-suppression", methode: "POST",
                                          corps: ["motif": motif], as: ReponseMessageSimple.self)
            motif = ""
            fermer()
            session.afficher(r.message ?? "Demande transmise à votre camping.")
            await session.fermer()
        } catch {
            session.afficher(error.localizedDescription, erreur: true)
        }
    }
}

extension URL: @retroactive Identifiable {
    public var id: String { absoluteString }
}

/// Feuille de partage iOS pour un fichier local.
struct PartageFichier: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

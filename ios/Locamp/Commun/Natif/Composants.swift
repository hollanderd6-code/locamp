import SwiftUI
import QuickLook

// MARK: - Chargement

enum EtatChargement<T> {
    case enCours, pret(T), echec(String)
    var valeur: T? { if case .pret(let v) = self { v } else { nil } }
}

/// Roue, erreur avec « Reessayer », ou contenu.
struct Chargeur<T, Contenu: View>: View {
    let etat: EtatChargement<T>
    let reessayer: () async -> Void
    @ViewBuilder let contenu: (T) -> Contenu

    var body: some View {
        switch etat {
        case .enCours:
            ProgressView().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
        case .echec(let m):
            ContentUnavailableView {
                Label("Impossible d'afficher cette page", systemImage: "wifi.exclamationmark")
            } description: { Text(m) } actions: {
                Button("Réessayer") { Task { await reessayer() } }.buttonStyle(.glassProminent)
            }
        case .pret(let v):
            contenu(v)
        }
    }
}

/// Charge une valeur depuis l'API, et la recharge quand la session, le
/// camping ou l'exercice change (ClientAPI.revision).
@MainActor
@Observable
final class Source<T> {
    private(set) var etat: EtatChargement<T> = .enCours
    @ObservationIgnored private let charger: @MainActor () async throws -> T

    init(_ charger: @escaping @MainActor () async throws -> T) { self.charger = charger }

    func rafraichir() async {
        do {
            let v = try await charger()
            withAnimation(.smooth) { etat = .pret(v) }
        } catch is CancellationError {
        } catch ClientAPI.Erreur.horsSession {
            // le site n'a pas encore transmis la session : la revision suivante relancera
        } catch {
            if etat.valeur == nil { etat = .echec(error.localizedDescription) }
            else { Pont.partage.afficherToast(error.localizedDescription, erreur: true) }
        }
    }
}

extension View {
    /// Charge la source a l'apparition et a chaque changement de session.
    func charger<T>(_ s: Source<T>) -> some View {
        task(id: ClientAPI.partage.revision) { await s.rafraichir() }
            .refreshable { await s.rafraichir() }
    }
}

// MARK: - Apercu de fichier (PDF de facture, releve, document)

@MainActor
@Observable
final class ApercuFichier {
    var fichier: URL?
    private(set) var chargement: String?

    func ouvrir(nom: String, fichier: @escaping () async throws -> URL) {
        guard chargement == nil else { return }
        chargement = nom
        Task {
            defer { chargement = nil }
            do { self.fichier = try await fichier() }
            catch is CancellationError {}
            catch { Pont.partage.afficherToast(error.localizedDescription, erreur: true) }
        }
    }

    /// Lien signe renvoye par l'API ({ url }), puis telechargement.
    func ouvrirLien(nom: String, chemin: String) {
        ouvrir(nom: nom) {
            let l = try await ClientAPI.partage.requete(chemin, as: LienURL.self)
            return try await ClientAPI.partage.telecharger(l.url, nom: nom)
        }
    }

    /// PDF genere a la volee par l'API (corps binaire).
    func ouvrirPDF(nom: String, chemin: String) {
        ouvrir(nom: nom) {
            let d = try await ClientAPI.partage.donnees(chemin)
            let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            try d.write(to: tmp)
            return try ClientAPI.ranger(tmp, nom: nom)
        }
    }
}

extension View {
    func apercu(_ a: ApercuFichier) -> some View { modifier(ModApercu(apercu: a)) }
}

private struct ModApercu: ViewModifier {
    @Bindable var apercu: ApercuFichier
    func body(content: Content) -> some View {
        content
            .quickLookPreview($apercu.fichier)
            .overlay {
                if let nom = apercu.chargement {
                    VStack(spacing: 12) {
                        ProgressView().controlSize(.large)
                        Text(nom).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                    }
                    .padding(26)
                    .glassEffect(.regular, in: .rect(cornerRadius: 26))
                }
            }
            .animation(.smooth(duration: 0.2), value: apercu.chargement)
    }
}

// MARK: - Petits elements

struct Pastille: View {
    let texte: String
    let couleur: Color
    var body: some View {
        Text(texte)
            .font(.caption.weight(.semibold))
            .foregroundStyle(couleur)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(couleur.opacity(0.13), in: .capsule)
    }
}

struct Avatar: View {
    let nom: String
    var taille: CGFloat = 40
    var body: some View {
        Text(initiales(nom))
            .font(.system(size: taille * 0.36, weight: .semibold))
            .foregroundStyle(Color.accentColor)
            .frame(width: taille, height: taille)
            .background(Color.accentColor.opacity(0.12), in: .circle)
    }
}

func couleurStatut(_ statut: String) -> Color {
    switch statut {
    case "reglee": .green
    case "partielle", "emise": .orange
    case "en_retard": .red
    case "brouillon": .blue
    default: .secondary
    }
}

// MARK: - Barre du haut des ecrans natifs : compte, cloche

extension View {
    func barreGestion() -> some View { modifier(BarreGestion()) }
}

private struct BarreGestion: ViewModifier {
    @Environment(Pont.self) private var pont
    @State private var notifications = false

    func body(content: Content) -> some View {
        content
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if let etat = pont.etat { MenuCompte(etat: etat) }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    let n = pont.etat?.badges.notifications ?? 0
                    Button("Notifications", systemImage: n > 0 ? "bell.badge" : "bell") { notifications = true }
                        .symbolRenderingMode(n > 0 ? .multicolor : .monochrome)
                }
            }
            .sheet(isPresented: $notifications) { NotificationsGestionView() }
    }
}

struct NotificationsGestionView: View {
    @Environment(Pont.self) private var pont
    @Environment(\.dismiss) private var fermer
    @State private var source = Source { try await ClientAPI.partage.requete("/api/notifications?limit=50", as: ReponseNotificationsStaff.self).notifications }

    var body: some View {
        NavigationStack {
            Chargeur(etat: source.etat, reessayer: source.rafraichir) { liste in
                List(liste) { n in
                    Button {
                        Task {
                            _ = try? await ClientAPI.partage.requete("/api/notifications/\(n.id)/lu", methode: "POST", as: ClientAPI.Vide.self)
                            pont.rafraichirBadges()
                        }
                        fermer()
                        switch n.type {
                        case "nouveau_message": pont.naviguer("messagerie")
                        case "paiement_recu", "relance": pont.naviguer("impayes")
                        default: if n.entite == "facture" { pont.naviguer("factures") }
                        }
                    } label: {
                        HStack(alignment: .top, spacing: 12) {
                            Circle().fill(n.lu ? Color.clear : Color.accentColor).frame(width: 8, height: 8).padding(.top, 7)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(n.titre).font(.body.weight(n.lu ? .regular : .semibold)).foregroundStyle(.primary)
                                if let c = n.corps, !c.isEmpty { Text(c).font(.subheadline).foregroundStyle(.secondary).lineLimit(3) }
                                Text(DateISO.lire(n.created_at), format: .relative(presentation: .named))
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                .overlay {
                    if liste.isEmpty {
                        ContentUnavailableView("Vous êtes à jour", systemImage: "bell.slash", description: Text("Aucune notification."))
                    }
                }
            }
            .navigationTitle("Notifications")
            .toolbarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Fermer", systemImage: "xmark") { fermer() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Tout lu", systemImage: "checkmark.circle") {
                        Task {
                            _ = try? await ClientAPI.partage.requete("/api/notifications/tout-lu", methode: "POST", as: ClientAPI.Vide.self)
                            pont.rafraichirBadges()
                            await source.rafraichir()
                        }
                    }
                }
            }
            .charger(source)
        }
    }
}

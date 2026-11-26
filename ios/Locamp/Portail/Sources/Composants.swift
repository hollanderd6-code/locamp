import SwiftUI
import QuickLook

// MARK: - Chargement d'un ecran

/// Etat d'un ecran qui charge depuis l'API.
enum Chargement<T> {
    case enCours
    case pret(T)
    case echec(String)

    var valeur: T? { if case .pret(let v) = self { v } else { nil } }
}

/// Affiche la roue, l'erreur (avec Reessayer) ou le contenu.
struct VueChargement<T, Contenu: View>: View {
    let etat: Chargement<T>
    let reessayer: () async -> Void
    @ViewBuilder let contenu: (T) -> Contenu

    var body: some View {
        switch etat {
        case .enCours:
            ProgressView()
                .controlSize(.large)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .echec(let m):
            ContentUnavailableView {
                Label("Impossible d'afficher cette page", systemImage: "wifi.exclamationmark")
            } description: {
                Text(m)
            } actions: {
                Button("Réessayer") { Task { await reessayer() } }
                    .buttonStyle(.glassProminent)
            }
        case .pret(let v):
            contenu(v)
        }
    }
}

// MARK: - Pastille d'etat d'une facture

struct PastilleEtat: View {
    let facture: Facture

    var body: some View {
        Text(facture.libelleEtat)
            .font(.caption.weight(.semibold))
            .foregroundStyle(couleur)
            .padding(.horizontal, 9).padding(.vertical, 4)
            .background(couleur.opacity(0.13), in: .capsule)
    }

    private var couleur: Color {
        switch facture.etat {
        case .payee: .green
        case .aPayer: .orange
        case .retard: .red
        case .neutre: .secondary
        }
    }
}

// MARK: - Bouton du compte (en haut a gauche de chaque onglet)

struct BoutonCompte: ToolbarContent {
    @Binding var ouvert: Bool
    let initiales: String

    var body: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button { ouvert = true } label: {
                if initiales.isEmpty {
                    Image(systemName: "person.crop.circle")
                } else {
                    Text(initiales)
                        .font(.footnote.weight(.semibold))
                        .frame(width: 30, height: 30)
                }
            }
            .accessibilityLabel("Mon compte")
        }
    }
}

func initiales(_ nom: String) -> String {
    nom.split(separator: " ").prefix(2).compactMap { $0.first.map(String.init) }.joined().uppercased()
}

// MARK: - Toast

struct ToastVue: View {
    @Environment(Session.self) private var session

    var body: some View {
        if let t = session.toast {
            Label(t.message, systemImage: t.erreur ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(t.erreur ? Color.red : Color.primary)
                .padding(.horizontal, 18)
                .padding(.vertical, 12)
                .glassEffect(t.erreur ? Glass.regular.tint(Color.red.opacity(0.15)).interactive() : Glass.regular.interactive(), in: .capsule)
                .padding(.horizontal, 16)
                .padding(.bottom, 64)
                .onTapGesture { withAnimation(.smooth) { session.toast = nil } }
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .id(t.id)
        }
    }
}

// MARK: - Apercu d'un fichier (PDF de facture, document)

/// Ouvre un fichier du serveur dans l'apercu natif (QuickLook) : lecture,
/// annotation, partage, impression.
@MainActor
@Observable
final class Apercu {
    var fichier: URL?
    private(set) var chargement: String?

    func ouvrir(nom: String, lien: @escaping () async throws -> String) {
        guard chargement == nil else { return }
        chargement = nom
        Task {
            defer { chargement = nil }
            do {
                let adresse = try await lien()
                fichier = try await API.telecharger(adresse, nom: nom)
            } catch is CancellationError {
            } catch {
                Session.partage.afficher(error.localizedDescription, erreur: true)
            }
        }
    }
}

struct LienSigne: Decodable { let url: String }

extension View {
    /// Apercu QuickLook + roue pendant le telechargement.
    func apercu(_ a: Apercu) -> some View {
        modifier(ModificateurApercu(apercu: a))
    }
}

private struct ModificateurApercu: ViewModifier {
    @Bindable var apercu: Apercu

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
                    .transition(.scale(scale: 0.9).combined(with: .opacity))
                }
            }
            .animation(.smooth(duration: 0.2), value: apercu.chargement)
    }
}

// MARK: - En-tete de section

struct TitreSection: View {
    let texte: String
    var body: some View {
        Text(texte)
            .font(.title3.weight(.semibold))
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 4)
            .padding(.top, 8)
    }
}

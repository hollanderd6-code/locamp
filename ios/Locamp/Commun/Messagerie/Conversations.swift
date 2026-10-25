import SwiftUI
import UIKit

// MARK: - Gestion : boite de reception

@MainActor
@Observable
final class ConversationsModele {
    private(set) var conversations: [Conversation] = []
    private(set) var chargement = true
    private(set) var erreur: String?
    @ObservationIgnored private var boucle: Task<Void, Never>?

    func demarrer() {
        boucle?.cancel()
        boucle = Task { [weak self] in
            while !Task.isCancelled {
                await self?.charger()
                try? await Task.sleep(for: .seconds(15))
            }
        }
    }

    func arreter() { boucle?.cancel(); boucle = nil }

    func charger() async {
        do {
            let r = try await ClientAPI.partage.requete("/api/messages/conversations", as: ReponseConversations.self)
            if r.conversations != conversations { withAnimation(.smooth) { conversations = r.conversations } }
            erreur = nil
        } catch ClientAPI.Erreur.horsSession {
        } catch {
            if conversations.isEmpty { erreur = error.localizedDescription }
        }
        chargement = false
    }
}

struct ConversationsView: View {
    @Environment(Pont.self) private var pont
    @State private var modele = ConversationsModele()
    @State private var recherche = ""
    @State private var nouveau = false
    @State private var aTous = false
    @State private var ouverte: ResidentCourt?

    private var filtrees: [Conversation] {
        let q = recherche.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return modele.conversations }
        return modele.conversations.filter {
            $0.resident_nom.localizedStandardContains(q) || $0.dernier_message.corps.localizedStandardContains(q)
        }
    }

    var body: some View {
        List(filtrees) { c in
            NavigationLink {
                ConversationGestionView(residentId: c.resident_id, nom: c.resident_nom)
            } label: {
                LigneConversation(conversation: c)
            }
            .contextMenu {
                Button("Voir la fiche", systemImage: "person.crop.circle") { pont.naviguer("residents/\(c.resident_id)") }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Color("Fond"))
        .navigationTitle("Messagerie")
        .toolbarTitleDisplayMode(.large)
        .searchable(text: $recherche, prompt: "Rechercher un résident ou un message")
        .refreshable { await modele.charger() }
        .overlay {
            if filtrees.isEmpty {
                if modele.chargement { ProgressView() }
                else if let e = modele.erreur {
                    ContentUnavailableView("Messagerie indisponible", systemImage: "wifi.exclamationmark", description: Text(e))
                } else if !recherche.isEmpty {
                    ContentUnavailableView.search(text: recherche)
                } else {
                    ContentUnavailableView("Aucune conversation", systemImage: "bubble.left.and.bubble.right",
                                           description: Text("Les échanges avec vos résidents apparaîtront ici."))
                }
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("Message à un résident", systemImage: "person") { nouveau = true }
                    Button("Message à tous les résidents", systemImage: "person.3") { aTous = true }
                } label: {
                    Label("Nouveau message", systemImage: "square.and.pencil")
                }
            }
        }
        .sheet(isPresented: $nouveau) {
            ChoixResident { r in
                nouveau = false
                ouverte = r
            }
        }
        .sheet(isPresented: $aTous) { MessageATous() }
        .navigationDestination(item: $ouverte) { r in
            ConversationGestionView(residentId: r.id, nom: r.nomComplet)
        }
        .onAppear { modele.demarrer() }
        .onDisappear { modele.arreter() }
    }
}

private struct LigneConversation: View {
    let conversation: Conversation

    var body: some View {
        let c = conversation
        let nonLu = c.non_lus > 0
        HStack(spacing: 12) {
            Text(initiales(c.resident_nom))
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.accentColor)
                .frame(width: 44, height: 44)
                .background(Color.accentColor.opacity(0.12), in: .circle)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline) {
                    Text(c.resident_nom).font(.body.weight(nonLu ? .bold : .semibold)).lineLimit(1)
                    Spacer()
                    Text(DateISO.lire(c.dernier_message.date), format: .relative(presentation: .named))
                        .font(.caption)
                        .foregroundStyle(nonLu ? Color.accentColor : .secondary)
                }
                HStack(alignment: .top) {
                    Text((c.dernier_message.auteur == "camping" ? "Vous : " : "") + c.dernier_message.corps)
                        .font(.subheadline)
                        .foregroundStyle(nonLu ? .primary : .secondary)
                        .lineLimit(2)
                    Spacer(minLength: 8)
                    if nonLu {
                        Text("\(c.non_lus)")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 7).padding(.vertical, 3)
                            .background(Color.accentColor, in: .capsule)
                    }
                }
            }
        }
        .padding(.vertical, 4)
        .listRowBackground(Color.clear)
    }
}

/// Le fil avec un resident, cote camping.
struct ConversationGestionView: View {
    @Environment(Pont.self) private var pont
    let residentId: String
    let nom: String

    var body: some View {
        FilMessagesView(source: .gestion(resident: residentId),
                        invite: "Message à \(nom.split(separator: " ").first.map(String.init) ?? nom)",
                        videTitre: "Nouvelle conversation",
                        videTexte: "Le résident recevra votre message dans son espace et par e-mail.")
            .navigationTitle(nom)
            .toolbarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Fiche du résident", systemImage: "person.crop.circle") {
                        pont.naviguer("residents/\(residentId)")
                    }
                }
            }
            .toolbar(.hidden, for: .tabBar)
    }
}

// MARK: - Nouveau message

private struct ChoixResident: View {
    let choisir: (ResidentCourt) -> Void
    @Environment(\.dismiss) private var fermer
    @State private var residents: [ResidentCourt] = []
    @State private var recherche = ""
    @State private var chargement = true

    private var filtres: [ResidentCourt] {
        let actifs = residents.filter { $0.actif != false }
        let q = recherche.trimmingCharacters(in: .whitespaces)
        return q.isEmpty ? actifs : actifs.filter { $0.nomComplet.localizedStandardContains(q) }
    }

    var body: some View {
        NavigationStack {
            List(filtres) { r in
                Button { choisir(r) } label: {
                    HStack(spacing: 12) {
                        Text(initiales(r.nomComplet))
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(Color.accentColor)
                            .frame(width: 34, height: 34)
                            .background(Color.accentColor.opacity(0.12), in: .circle)
                        Text(r.nomComplet).foregroundStyle(.primary)
                    }
                }
            }
            .overlay { if chargement { ProgressView() } }
            .navigationTitle("Nouveau message")
            .toolbarTitleDisplayMode(.inline)
            .searchable(text: $recherche, placement: .navigationBarDrawer(displayMode: .always), prompt: "Résident")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler", systemImage: "xmark") { fermer() }
                }
            }
            .task {
                if let r = try? await ClientAPI.partage.requete("/api/residents", as: ReponseResidents.self) {
                    residents = r.residents
                }
                chargement = false
            }
        }
        .presentationDetents([.medium, .large])
    }
}

private struct MessageATous: View {
    @Environment(\.dismiss) private var fermer
    @Environment(Pont.self) private var pont
    @State private var texte = ""
    @State private var envoi = false
    @State private var erreur: String?
    @FocusState private var focus: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Votre message", text: $texte, axis: .vertical)
                        .lineLimit(6...14)
                        .focused($focus)
                } footer: {
                    Text("Envoyé à tous les résidents actifs : dans leur espace, par notification et par e-mail.")
                }
                if let erreur {
                    Section { Label(erreur, systemImage: "exclamationmark.triangle").foregroundStyle(.red) }
                }
            }
            .navigationTitle("Message à tous")
            .toolbarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler", systemImage: "xmark") { fermer() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Envoyer", systemImage: "paperplane") { Task { await envoyer() } }
                        .buttonStyle(.glassProminent)
                        .disabled(texte.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || envoi)
                }
            }
            .onAppear { focus = true }
        }
    }

    private func envoyer() async {
        envoi = true
        defer { envoi = false }
        do {
            struct Reponse: Decodable { let destinataires: Int? }
            let r = try await ClientAPI.partage.requete("/api/messages/groupe", methode: "POST",
                                                        corps: ["corps": texte], as: Reponse.self)
            pont.afficherToast("Message envoyé à \(r.destinataires ?? 0) résident\((r.destinataires ?? 0) > 1 ? "s" : "")")
            fermer()
        } catch {
            erreur = error.localizedDescription
        }
    }
}

// MARK: - Locataire : le fil avec le camping

struct MessagerieLocataireView: View {
    @Environment(Pont.self) private var pont

    var body: some View {
        FilMessagesView(source: .locataire,
                        invite: "Écrire au camping",
                        videTitre: "Écrivez à votre camping",
                        videTexte: "Une question, une demande, un souci sur votre emplacement ? Le camping vous répond ici.")
            .navigationTitle(pont.etat?.contexte.nomCamping ?? "Messages")
            .toolbarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if let etat = pont.etat { MenuCompte(etat: etat) }
                }
            }
            // Comme sur les autres onglets : balayer change d'onglet.
            .simultaneousGesture(
                DragGesture(minimumDistance: 30).onEnded { v in
                    let dx = v.translation.width, dy = v.translation.height
                    guard abs(dx) > 70, abs(dx) > 2 * abs(dy) else { return }
                    pont.ongletVoisin(dx < 0 ? 1 : -1)
                }
            )
    }
}

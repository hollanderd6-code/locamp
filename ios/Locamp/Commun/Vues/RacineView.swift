import SwiftUI
import UIKit

/// Racine de l'app : la connexion (web, plein ecran) puis les onglets natifs.
/// Les alertes, toasts et fenetres sont poses ici pour couvrir tous les ecrans.
struct RacineView: View {
    @Environment(Pont.self) private var pont

    var body: some View {
        @Bindable var pont = pont
        Group {
            if pont.connecte {
                OngletsView()
                    .transition(.opacity)
            } else {
                ConnexionView()
            }
        }
        .overlay(alignment: .bottom) { ToastVue() }
        .modifier(DialogueNatif())
        .sheet(item: $pont.fenetre) { FenetreVue(fenetre: $0) }
    }
}

/// Avant connexion : l'ecran de connexion du site, sans aucune barre.
struct ConnexionView: View {
    @Environment(Pont.self) private var pont

    var body: some View {
        WebViewHote(actif: !pont.connecte)
            .ignoresSafeArea()
            .background(Color("Fond"))
            .onAppear { pont.definirMarges(EdgeInsets()) }
            .overlay {
                if pont.chargement {
                    ProgressView()
                        .controlSize(.large)
                        .padding(28)
                        .glassEffect(.regular, in: .rect(cornerRadius: 24))
                }
            }
    }
}

// MARK: - Onglets

struct OngletsView: View {
    @Environment(Pont.self) private var pont

    var body: some View {
        @Bindable var pont = pont
        let b = pont.etat?.badges

        TabView(selection: $pont.onglet) {
            ForEach(Configuration.onglets) { o in
                Tab(o.titre, systemImage: o.symbole, value: o) {
                    NavigationStack {
                        if let n = o.natif { VueNative(ecran: n) }
                        else { EcranWeb(actif: pont.onglet == o, titreParDefaut: o.titre) }
                    }
                }
                .badge(o.badge.map { b?[keyPath: $0] ?? 0 } ?? 0)
            }
            if !Configuration.ecransPlus.isEmpty {
                Tab(OngletApp.plus.titre, systemImage: OngletApp.plus.symbole, value: OngletApp.plus) {
                    PlusView()
                }
                .badge(Configuration.ecransPlus.compactMap(\.badge).reduce(0) { $0 + (b?[keyPath: $1] ?? 0) })
            }
        }
        .tabViewStyle(.sidebarAdaptable)
        .onChange(of: pont.onglet) { _, o in
            UISelectionFeedbackGenerator().selectionChanged()
            pont.ongletChoisi(o)
        }
    }
}

// MARK: - Plus : les quatre ecrans moins frequents + le compte

struct PlusView: View {
    @Environment(Pont.self) private var pont

    var body: some View {
        @Bindable var pont = pont
        let etat = pont.etat
        let ctx = etat?.contexte

        NavigationStack(path: $pont.cheminPlus) {
            List {
                Section {
                    ForEach(Configuration.ecransPlus) { e in
                        NavigationLink(value: e) {
                            Label(e.titre, systemImage: e.symbole)
                        }
                        .badge(e.badge.map { etat?.badges[keyPath: $0] ?? 0 } ?? 0)
                    }
                }

                if let ctx {
                    Section("Espace") {
                        if !ctx.campings.isEmpty {
                            Picker(selection: Binding(
                                get: { ctx.campingActif ?? "" },
                                set: { pont.changerCamping($0) })
                            ) {
                                ForEach(ctx.campings) { Text($0.nom).tag($0.id) }
                            } label: { Label("Camping", systemImage: "tent") }
                        }
                        if !ctx.exercices.isEmpty {
                            Picker(selection: Binding(
                                get: { ctx.exerciceActif ?? "" },
                                set: { pont.changerExercice($0) })
                            ) {
                                ForEach(ctx.exercices) { Text($0.nom).tag($0.id) }
                            } label: { Label("Exercice", systemImage: "calendar") }
                        }
                        if Configuration.espacesCamping {
                            Button("Nouvel espace camping…", systemImage: "plus") { pont.changerCamping("__new__") }
                        }
                    }

                    Section {
                        Button {
                            pont.ouvrirNotifications()
                        } label: {
                            Label("Notifications", systemImage: "bell")
                        }
                        .badge(etat?.badges.notifications ?? 0)
                        Button("Se déconnecter", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) {
                            pont.deconnexion()
                        }
                    } header: {
                        Text(ctx.utilisateur.nom.isEmpty ? "Compte" : ctx.utilisateur.nom)
                    } footer: {
                        Text(ctx.utilisateur.admin ? "Administrateur" : "Gestionnaire")
                    }
                }
            }
            .navigationTitle("Plus")
            .navigationDestination(for: EcranPlus.self) { e in
                if let n = e.natif { VueNative(ecran: n) }
                else { EcranWeb(actif: pont.onglet == .plus && pont.cheminPlus.last == e, titreParDefaut: e.titre) }
            }
        }
        .onChange(of: pont.cheminPlus) { _, _ in pont.cheminPlusChange() }
    }
}

// MARK: - Toast

struct ToastVue: View {
    @Environment(Pont.self) private var pont

    var body: some View {
        if let t = pont.toast {
            Label(t.message, systemImage: t.erreur ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(t.erreur ? Color.red : Color.primary)
                .padding(.horizontal, 18)
                .padding(.vertical, 12)
                .glassEffect(t.erreur ? Glass.regular.tint(Color.red.opacity(0.18)).interactive() : Glass.regular.interactive(), in: .capsule)
                .padding(.horizontal, 16)
                .padding(.bottom, pont.connecte && !pont.superposition ? 70 : 24)
                .onTapGesture { withAnimation(.smooth) { pont.toast = nil } }
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .id(t.id)
                .accessibilityAddTraits(.isStaticText)
        }
    }
}

// MARK: - Alertes natives (askConfirm / askPrompt)

struct DialogueNatif: ViewModifier {
    @Environment(Pont.self) private var pont
    @State private var saisie = ""

    func body(content: Content) -> some View {
        let d = pont.dialogue
        content.alert(
            d?.titre.isEmpty == false ? d!.titre : (d?.message ?? ""),
            // Fermeture sans bouton (rare) : on repond « annuler » au tour
            // suivant, apres l'action du bouton touche s'il y en a une.
            isPresented: Binding(get: { pont.dialogue != nil }, set: { ouvert in
                guard !ouvert else { return }
                Task { @MainActor in if let d = pont.dialogue { pont.repondre(d, nil) } }
            }),
            presenting: d
        ) { d in
            if d.genre == .saisir {
                TextField(d.invite, text: $saisie)
            }
            Button("Annuler", role: .cancel) { pont.repondre(d, nil) }
            Button(d.ok, role: d.danger ? .destructive : nil) {
                pont.repondre(d, d.genre == .saisir ? saisie : true)
            }
        } message: { d in
            if !d.titre.isEmpty { Text(d.message) }
        }
        .onChange(of: pont.dialogue) { _, d in saisie = d?.valeur ?? "" }
    }
}

// MARK: - Fenetre ouverte par le site (PDF, impression…)

struct FenetreVue: View {
    let fenetre: FenetreWeb
    @Environment(\.dismiss) private var fermer

    var body: some View {
        NavigationStack {
            WebViewSimple(webView: fenetre.webView)
                .ignoresSafeArea(edges: .bottom)
                .navigationTitle(fenetre.webView.title ?? "")
                .toolbarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Fermer", systemImage: "xmark") { fermer() }
                    }
                    ToolbarItemGroup(placement: .topBarTrailing) {
                        Button("Imprimer", systemImage: "printer") { imprimer() }
                        if let url = fenetre.webView.url, url.scheme?.hasPrefix("http") == true {
                            ShareLink(item: url)
                        }
                    }
                }
        }
    }

    private func imprimer() {
        let pc = UIPrintInteractionController.shared
        pc.printFormatter = fenetre.webView.viewPrintFormatter()
        pc.present(animated: true)
    }
}

/// Aiguillage vers les ecrans 100 % natifs.
struct VueNative: View {
    let ecran: EcranNatif

    var body: some View {
        switch ecran {
        case .messagerieGestion: ConversationsView()
        case .messagerieLocataire: MessagerieLocataireView()
        }
    }
}

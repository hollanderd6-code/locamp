import SwiftUI
import UIKit

/// Un ecran du site, habille en natif : titre, boutons d'action et menu
/// en Liquid Glass dans la barre, sous-onglets en controle segmente,
/// recherche native. Le contenu web defile sous le verre.
struct EcranWeb: View {
    /// Vrai quand cet ecran est celui que l'on voit : c'est lui qui
    /// accueille le WKWebView et qui publie ses marges.
    let actif: Bool
    var titreParDefaut = "Locamp"

    @Environment(Pont.self) private var pont
    @State private var texteRecherche = ""

    private var etat: EtatWeb? { actif ? pont.etat : nil }

    var body: some View {
        // Le lecteur RESPECTE la zone sure : c'est ce qui lui fait mesurer la
        // hauteur des barres (ignoresSafeArea sur lui les remettrait a zero —
        // c'etait le haut des pages coupe). Seul le site deborde dessous.
        GeometryReader { geo in
            WebViewHote(actif: actif)
                .ignoresSafeArea()
                .onChange(of: geo.safeAreaInsets, initial: true) { _, m in if actif { pont.definirMarges(m) } }
                .onChange(of: actif) { _, a in if a { pont.definirMarges(geo.safeAreaInsets) } }
        }
        .background(Color("Fond").ignoresSafeArea())
        .navigationTitle(etat?.titre ?? titreParDefaut)
        .toolbarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(etat?.retour == true)
        .toolbar { if let etat { BarreEcran(etat: etat, pont: pont) } }
        .safeAreaInset(edge: .top, spacing: 0) {
            if let etat, etat.onglets.count > 1 { SousOnglets(etat: etat) }
        }
        .modifier(RechercheNative(recherche: etat?.recherche, texte: $texteRecherche))
        .toolbar(pont.superposition ? .hidden : .visible, for: .navigationBar)
        .toolbar(pont.superposition ? .hidden : .visible, for: .tabBar)
    }
}

// MARK: - Barre du haut

struct BarreEcran: ToolbarContent {
    let etat: EtatWeb
    let pont: Pont

    var body: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            if etat.retour {
                Button("Retour", systemImage: "chevron.backward") { pont.retour() }
            } else {
                MenuCompte(etat: etat)
            }
        }

        ToolbarItemGroup(placement: .topBarTrailing) {
            Button("Notifications", systemImage: etat.badges.notifications > 0 ? "bell.badge" : "bell") {
                pont.ouvrirNotifications()
            }
            .symbolRenderingMode(etat.badges.notifications > 0 ? .multicolor : .monochrome)

            if !etat.actionsSecondaires.isEmpty {
                Menu("Actions", systemImage: "ellipsis") {
                    ForEach(etat.actionsSecondaires) { a in
                        Button(role: a.destructif ? .destructive : nil) { pont.action(a) } label: {
                            Label(a.titre, systemImage: a.symbole)
                        }
                        .disabled(a.desactive)
                    }
                }
            }
        }

        if let p = etat.actionPrincipale {
            ToolbarSpacer(.fixed, placement: .topBarTrailing)
            ToolbarItem(placement: .topBarTrailing) {
                Button { pont.action(p) } label: { Label(p.titre, systemImage: p.symbole) }
                    .buttonStyle(.glassProminent)
                    .tint(Color.accentColor)
                    .disabled(p.desactive)
                    .accessibilityLabel(p.titre)
            }
        }
    }
}

/// Le menu du compte : camping actif, exercice, notifications, deconnexion.
struct MenuCompte: View {
    let etat: EtatWeb
    @Environment(Pont.self) private var pont

    var body: some View {
        let ctx = etat.contexte
        Menu {
            Section(ctx.utilisateur.nom.isEmpty ? "Compte" : ctx.utilisateur.nom) {
                if !ctx.campings.isEmpty {
                    Picker(selection: Binding(
                        get: { ctx.campingActif ?? "" },
                        set: { pont.changerCamping($0) })
                    ) {
                        ForEach(ctx.campings) { Text($0.nom).tag($0.id) }
                    } label: {
                        Label("Camping", systemImage: "tent")
                    }
                    .pickerStyle(.menu)
                }
                if !ctx.exercices.isEmpty {
                    Picker(selection: Binding(
                        get: { ctx.exerciceActif ?? "" },
                        set: { pont.changerExercice($0) })
                    ) {
                        ForEach(ctx.exercices) { Text($0.nom).tag($0.id) }
                    } label: {
                        Label("Exercice", systemImage: "calendar")
                    }
                    .pickerStyle(.menu)
                }
            }
            Button("Nouvel espace camping…", systemImage: "plus") { pont.changerCamping("__new__") }
            Divider()
            Button("Se déconnecter", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) {
                pont.deconnexion()
            }
        } label: {
            if ctx.utilisateur.initiales.isEmpty {
                Label("Compte", systemImage: "person.crop.circle")
            } else {
                Text(ctx.utilisateur.initiales)
                    .font(.footnote.weight(.semibold))
                    .frame(width: 30, height: 30)
                    .accessibilityLabel("Compte")
            }
        }
    }
}

// MARK: - Sous-onglets (Plan / Emplacements, Factures / Reglements / Impayes…)

struct SousOnglets: View {
    let etat: EtatWeb
    @Environment(Pont.self) private var pont

    var body: some View {
        Picker("Section", selection: Binding(
            get: { etat.ongletActif },
            set: { pont.sousOngletChoisi($0) })
        ) {
            ForEach(etat.onglets) { o in
                Text(o.badge > 0 ? "\(o.titre) (\(o.badge))" : o.titre).tag(o.id)
            }
        }
        .pickerStyle(.segmented)
        .padding(4)
        .glassEffect(.regular, in: .capsule)
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }
}

// MARK: - Recherche native

/// La barre de recherche iOS remplace le champ de recherche de la liste.
struct RechercheNative: ViewModifier {
    let recherche: EtatWeb.Recherche?
    @Binding var texte: String
    @Environment(Pont.self) private var pont

    func body(content: Content) -> some View {
        if let recherche {
            content
                .searchable(text: $texte, prompt: Text(recherche.invite))
                .onChange(of: texte) { _, t in if t != recherche.valeur { pont.rechercher(t) } }
                .onAppear { texte = recherche.valeur }
        } else {
            content
        }
    }
}

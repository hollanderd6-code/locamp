import SwiftUI

// MARK: - Modele du fil

@MainActor
@Observable
final class FilModele {
    struct Ligne: Identifiable, Equatable {
        enum Etat: Equatable { case envoye, enCours, echec }
        let id: String
        let moi: Bool
        let corps: String
        let date: Date
        var lu: Bool
        var etat: Etat = .envoye
    }

    private(set) var lignes: [Ligne] = []
    private(set) var chargement = true
    private(set) var erreur: String?
    @ObservationIgnored private var boucle: Task<Void, Never>?
    /// Appele quand un message du camping arrive (les pastilles suivent).
    @ObservationIgnored var nouveauRecu: () -> Void = {}

    func demarrer() {
        boucle?.cancel()
        boucle = Task { [weak self] in
            while !Task.isCancelled {
                await self?.charger()
                try? await Task.sleep(for: .seconds(6))
            }
        }
    }

    func arreter() { boucle?.cancel(); boucle = nil }

    func charger() async {
        do {
            let r = try await API.requete("/api/portail/messages", as: ReponseMessages.self)
            let enAttente = lignes.filter { $0.etat != .envoye }
            let recus = r.messages.map {
                Ligne(id: $0.id, moi: $0.auteur == "resident", corps: $0.corps,
                      date: Format.date($0.created_at) ?? .now, lu: $0.lu ?? false)
            }
            let connus = Set(lignes.map(\.id))
            let nouveau = !chargement && recus.contains { !$0.moi && !connus.contains($0.id) }
            let envoyes = lignes.filter { $0.etat == .envoye }
            if recus.map(\.id) != envoyes.map(\.id) || recus.map(\.lu) != envoyes.map(\.lu) {
                withAnimation(.smooth) { lignes = recus + enAttente }
            }
            erreur = nil
            if nouveau { nouveauRecu() }
        } catch is CancellationError {
        } catch {
            if lignes.isEmpty { erreur = error.localizedDescription }
        }
        chargement = false
    }

    func envoyer(_ texte: String) {
        let corps = texte.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !corps.isEmpty else { return }
        let l = Ligne(id: "local-" + UUID().uuidString, moi: true, corps: corps, date: .now, lu: false, etat: .enCours)
        withAnimation(.bouncy(duration: 0.35)) { lignes.append(l) }
        Task { await expedier(l) }
    }

    func reessayer(_ l: Ligne) {
        guard let i = lignes.firstIndex(of: l) else { return }
        lignes[i].etat = .enCours
        Task { await expedier(lignes[i]) }
    }

    private func expedier(_ l: Ligne) async {
        do {
            let r = try await API.requete("/api/portail/messages", methode: "POST", corps: ["corps": l.corps],
                                          as: ReponseEnvoiMessage.self)
            if let i = lignes.firstIndex(where: { $0.id == l.id }) {
                lignes[i] = Ligne(id: r.message.id, moi: true, corps: r.message.corps,
                                  date: Format.date(r.message.created_at) ?? .now, lu: false)
            }
        } catch {
            if let i = lignes.firstIndex(where: { $0.id == l.id }) { lignes[i].etat = .echec }
            UINotificationFeedbackGenerator().notificationOccurred(.error)
        }
    }
}

// MARK: - Vue

/// Le fil avec le camping, a la maniere de Messages.
struct MessagesView: View {
    @Environment(Espace.self) private var espace
    @State private var modele = FilModele()
    @State private var brouillon = ""
    @FocusState private var saisie: Bool

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                // Pile simple et non « Lazy » : un fil reste court, et une pile
                // paresseuse ancree en bas recalculait sa mise en page en boucle
                // (ecran fige a l'ouverture de Messages).
                VStack(spacing: 0) {
                    ForEach(jours, id: \.jour) { j in
                        Text(j.titre)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .padding(.top, 18).padding(.bottom, 8)
                        ForEach(Array(j.lignes.enumerated()), id: \.element.id) { i, l in
                            let prec = i > 0 ? j.lignes[i - 1] : nil
                            let suiv = i + 1 < j.lignes.count ? j.lignes[i + 1] : nil
                            Bulle(ligne: l,
                                  debutGroupe: !memeGroupe(prec, l),
                                  finGroupe: !memeGroupe(l, suiv),
                                  dernierDeMoi: l.id == dernierEnvoye?.id,
                                  reessayer: { modele.reessayer(l) })
                                .id(l.id)
                        }
                    }
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 8)
            }
            .scrollDismissesKeyboard(.interactively)
            .onAppear {
                if let id = modele.lignes.last?.id { proxy.scrollTo(id, anchor: .bottom) }
            }
            .onChange(of: modele.lignes.last?.id) { ancien, id in
                guard let id else { return }
                // Premier chargement : on se place en bas sans animation.
                if ancien == nil { proxy.scrollTo(id, anchor: .bottom) }
                else { withAnimation(.smooth) { proxy.scrollTo(id, anchor: .bottom) } }
            }
            .onChange(of: saisie) { _, actif in
                guard actif, let id = modele.lignes.last?.id else { return }
                Task { try? await Task.sleep(for: .milliseconds(250)); withAnimation { proxy.scrollTo(id, anchor: .bottom) } }
            }
        }
        .overlay { etatVide }
        .safeAreaInset(edge: .bottom, spacing: 0) { compositeur }
        .background(Color("Fond").ignoresSafeArea())
        .navigationTitle(espace.moi?.camping.nom ?? "Messages")
        .toolbarTitleDisplayMode(.inline)
        .barreEspace()
        .onAppear {
            modele.nouveauRecu = { Task { await espace.marquerMessagesLus() } }
            modele.demarrer()
            Task { await espace.marquerMessagesLus() }
        }
        .onDisappear { modele.arreter() }
    }

    // MARK: Regroupement

    private struct Jour { let jour: Date; let titre: String; let lignes: [FilModele.Ligne] }

    private var jours: [Jour] {
        let cal = Calendar.current
        let groupes = Dictionary(grouping: modele.lignes) { cal.startOfDay(for: $0.date) }
        return groupes.keys.sorted().map { d in
            Jour(jour: d, titre: titreJour(d), lignes: groupes[d]!.sorted { $0.date < $1.date })
        }
    }

    private func titreJour(_ d: Date) -> String {
        let cal = Calendar.current
        if cal.isDateInToday(d) { return "Aujourd'hui" }
        if cal.isDateInYesterday(d) { return "Hier" }
        let f = DateFormatter()
        f.locale = Format.fr
        f.setLocalizedDateFormatFromTemplate(cal.isDate(d, equalTo: .now, toGranularity: .year) ? "EEEEdMMMM" : "dMMMMy")
        let s = f.string(from: d)   // « mardi 14 juillet » -> « Mardi 14 juillet »
        return s.prefix(1).uppercased() + s.dropFirst()
    }

    private func memeGroupe(_ a: FilModele.Ligne?, _ b: FilModele.Ligne?) -> Bool {
        guard let a, let b else { return false }
        return a.moi == b.moi && abs(b.date.timeIntervalSince(a.date)) < 180
    }

    private var dernierEnvoye: FilModele.Ligne? { modele.lignes.last { $0.moi && $0.etat == .envoye } }

    @ViewBuilder private var etatVide: some View {
        if modele.lignes.isEmpty {
            if modele.chargement {
                ProgressView()
            } else if let e = modele.erreur {
                ContentUnavailableView {
                    Label("Messagerie indisponible", systemImage: "wifi.exclamationmark")
                } description: { Text(e) } actions: {
                    Button("Réessayer") { Task { await modele.charger() } }.buttonStyle(.glass)
                }
            } else {
                ContentUnavailableView("Écrivez à votre camping", systemImage: "bubble.left.and.bubble.right",
                                       description: Text("Une question, une demande, un souci sur votre emplacement ? Le camping vous répond ici."))
            }
        }
    }

    // MARK: Saisie

    private var compositeur: some View {
        let vide = brouillon.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return GlassEffectContainer(spacing: 10) {
            HStack(alignment: .bottom, spacing: 10) {
                TextField("Écrire au camping", text: $brouillon, axis: .vertical)
                    .lineLimit(1...6)
                    .focused($saisie)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 11)
                    .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 22))

                Button {
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    modele.envoyer(brouillon)
                    brouillon = ""
                } label: {
                    Image(systemName: "arrow.up")
                        .font(.body.weight(.bold))
                        .frame(width: 30, height: 30)
                }
                .buttonStyle(.glassProminent)
                .buttonBorderShape(.circle)
                .disabled(vide)
                .accessibilityLabel("Envoyer")
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 6)
        .padding(.bottom, 8)
    }
}

// MARK: - Bulle

private struct Bulle: View {
    let ligne: FilModele.Ligne
    let debutGroupe: Bool
    let finGroupe: Bool
    let dernierDeMoi: Bool
    let reessayer: () -> Void

    var body: some View {
        VStack(alignment: ligne.moi ? .trailing : .leading, spacing: 3) {
            HStack(alignment: .bottom, spacing: 6) {
                if ligne.moi { Spacer(minLength: 56) }
                if ligne.etat == .echec {
                    Button(action: reessayer) {
                        Image(systemName: "exclamationmark.circle.fill").foregroundStyle(.red).font(.title3)
                    }
                    .accessibilityLabel("Échec de l'envoi, réessayer")
                }
                Text(ligne.corps)
                    .font(.body)
                    .foregroundStyle(ligne.moi ? Color.white : Color.primary)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 9)
                    .background(fond, in: forme)
                    .opacity(ligne.etat == .enCours ? 0.65 : 1)
                    .contextMenu {
                        Button("Copier", systemImage: "doc.on.doc") { UIPasteboard.general.string = ligne.corps }
                    }
                if !ligne.moi { Spacer(minLength: 56) }
            }
            if finGroupe { pied }
        }
        .padding(.top, debutGroupe ? 8 : 2)
        .transition(.asymmetric(insertion: .move(edge: .bottom).combined(with: .opacity), removal: .opacity))
    }

    private var fond: AnyShapeStyle {
        ligne.moi ? AnyShapeStyle(Color.accentColor.gradient) : AnyShapeStyle(Color(uiColor: .secondarySystemBackground))
    }

    private var forme: UnevenRoundedRectangle {
        let grand: CGFloat = 20, petit: CGFloat = 6
        return ligne.moi
            ? UnevenRoundedRectangle(topLeadingRadius: grand, bottomLeadingRadius: grand,
                                     bottomTrailingRadius: finGroupe ? grand : petit,
                                     topTrailingRadius: debutGroupe ? grand : petit, style: .continuous)
            : UnevenRoundedRectangle(topLeadingRadius: debutGroupe ? grand : petit,
                                     bottomLeadingRadius: finGroupe ? grand : petit,
                                     bottomTrailingRadius: grand, topTrailingRadius: grand, style: .continuous)
    }

    @ViewBuilder private var pied: some View {
        let heure = ligne.date.formatted(date: .omitted, time: .shortened)
        Group {
            switch ligne.etat {
            case .enCours: Text("Envoi…")
            case .echec: Text("Non envoyé · touchez ! pour réessayer").foregroundStyle(.red)
            case .envoye:
                if ligne.moi && dernierDeMoi { Text(ligne.lu ? "Lu · \(heure)" : "Distribué · \(heure)") }
                else if ligne.moi { Text(heure) }
                else { Text("Le camping · \(heure)") }
            }
        }
        .font(.caption2)
        .foregroundStyle(.secondary)
        .padding(.horizontal, 6)
    }
}

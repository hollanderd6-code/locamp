import SwiftUI
import PDFKit
import PencilKit

/// Lire et signer un document envoye par le camping, ou consulter un
/// document deja signe. Le PDF s'affiche avec PDFKit, la signature se
/// trace au doigt ou a l'Apple Pencil (PencilKit).
struct SignatureView: View {
    let document: DocumentSignature
    @Environment(Session.self) private var session
    @Environment(Espace.self) private var espace
    @Environment(\.dismiss) private var retour

    @State private var detail: Chargement<DetailSignature> = .enCours
    @State private var fichier: URL?
    @State private var valeurs: [String: String] = [:]
    @State private var cases: [String: Bool] = [:]
    @State private var dessin = PKDrawing()
    @State private var consentement = false
    @State private var feuilleSignature = false
    @State private var envoi = false
    @State private var erreur: String?
    @State private var tailleTrace = CGSize(width: 600, height: 220)

    private var dejaSigne: Bool { document.statut == "signe" || detail.valeur?.statut == "signe" }

    var body: some View {
        VueChargement(etat: detail, reessayer: charger) { d in
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if let m = d.message, !m.isEmpty {
                        Label(m, systemImage: "text.bubble")
                            .font(.callout)
                            .padding(14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .glassEffect(.regular, in: .rect(cornerRadius: 18))
                    }

                    Group {
                        if let fichier, let pdf = PDFDocument(url: fichier) {
                            VuePDF(document: pdf)
                        } else {
                            ProgressView().frame(maxWidth: .infinity, minHeight: 300)
                        }
                    }
                    .frame(height: 520)
                    .clipShape(.rect(cornerRadius: 18))
                    .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(.quaternary))

                    if !dejaSigne { formulaire(d) }
                }
                .padding(16)
                .frame(maxWidth: 760)
                .frame(maxWidth: .infinity)
            }
            .safeAreaInset(edge: .bottom) {
                if !dejaSigne {
                    Button {
                        Task { await signer(d) }
                    } label: {
                        Group {
                            if envoi { ProgressView().tint(.white) } else { Label("Signer le document", systemImage: "signature") }
                        }
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                    }
                    .buttonStyle(.glassProminent)
                    .controlSize(.large)
                    .disabled(!pret(d) || envoi)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 8)
                }
            }
        }
        .background(Color("Fond").ignoresSafeArea())
        .navigationTitle(document.titre)
        .toolbarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        .toolbar {
            if let fichier {
                ToolbarItem(placement: .topBarTrailing) {
                    ShareLink(item: fichier) { Label("Partager", systemImage: "square.and.arrow.up") }
                }
            }
        }
        .sheet(isPresented: $feuilleSignature) {
            PadSignature(dessin: $dessin, taille: $tailleTrace)
        }
        .task { await charger() }
    }

    // MARK: Formulaire

    @ViewBuilder private func formulaire(_ d: DetailSignature) -> some View {
        let autres = d.champs.filter { $0.type != "signature" }
        if !autres.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                TitreSection(texte: "À compléter")
                ForEach(autres) { c in
                    if c.type == "case" {
                        Toggle(isOn: Binding(get: { cases[c.id] ?? false }, set: { cases[c.id] = $0 })) {
                            Text((c.label ?? "J'accepte") + (c.requis == true ? " *" : "")).font(.callout)
                        }
                        .toggleStyle(CaseACocher())
                    } else {
                        VStack(alignment: .leading, spacing: 6) {
                            Text((c.label ?? "Votre réponse") + (c.requis == true ? " *" : ""))
                                .font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
                            TextField("", text: Binding(get: { valeurs[c.id] ?? "" }, set: { valeurs[c.id] = $0 }))
                                .padding(.horizontal, 14).padding(.vertical, 11)
                                .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 14))
                        }
                    }
                }
            }
        }

        if d.champs.contains(where: { $0.type == "signature" }) {
            VStack(alignment: .leading, spacing: 10) {
                TitreSection(texte: "Votre signature")
                Button { feuilleSignature = true } label: {
                    ZStack {
                        RoundedRectangle(cornerRadius: 18).fill(.white)
                        if dessin.strokes.isEmpty {
                            Label("Toucher pour signer", systemImage: "hand.draw")
                                .font(.callout.weight(.medium))
                                .foregroundStyle(.secondary)
                        } else {
                            Image(uiImage: dessin.imageClaire(tailleTrace))
                                .resizable().scaledToFit().padding(10)
                        }
                    }
                    .frame(height: 150)
                    .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Color.accentColor.opacity(0.4),
                                                                             style: StrokeStyle(lineWidth: 1.5, dash: [6, 5])))
                }
                .buttonStyle(.plain)
                .environment(\.colorScheme, .light)
            }
        }

        VStack(alignment: .leading, spacing: 10) {
            Toggle(isOn: $consentement) {
                Text(d.consentement).font(.footnote)
            }
            .toggleStyle(CaseACocher())
            Text("Votre signature, la date, l'heure et l'empreinte du document sont enregistrées comme preuve.")
                .font(.caption).foregroundStyle(.secondary)
        }
        .padding(14)
        .glassEffect(.regular, in: .rect(cornerRadius: 18))

        if let erreur {
            Label(erreur, systemImage: "exclamationmark.triangle.fill").font(.callout).foregroundStyle(.red)
        }
    }

    private func pret(_ d: DetailSignature) -> Bool {
        guard consentement else { return false }
        for c in d.champs where c.requis == true {
            switch c.type {
            case "case": if cases[c.id] != true { return false }
            case "texte": if (valeurs[c.id] ?? "").trimmingCharacters(in: .whitespaces).isEmpty { return false }
            default: break
            }
        }
        if d.champs.contains(where: { $0.type == "signature" }) && dessin.strokes.isEmpty { return false }
        return true
    }

    // MARK: Reseau

    private func charger() async {
        do {
            let d = try await API.requete("/api/portail/signatures/\(document.id)", as: DetailSignature.self)
            detail = .pret(d)
            fichier = try? await API.telecharger(d.url, nom: d.titre + ".pdf")
        } catch is CancellationError {
        } catch {
            detail = .echec(error.localizedDescription)
        }
    }

    private func signer(_ d: DetailSignature) async {
        envoi = true; erreur = nil
        defer { envoi = false }
        var v: [String: Any] = [:]
        for c in d.champs {
            if c.type == "case" { v[c.id] = cases[c.id] ?? false }
            if c.type == "texte" { v[c.id] = (valeurs[c.id] ?? "").trimmingCharacters(in: .whitespaces) }
        }
        var png: Any = NSNull()
        if d.champs.contains(where: { $0.type == "signature" }) {
            let image = dessin.imageClaire(tailleTrace)
            if let data = image.pngData() { png = "data:image/png;base64," + data.base64EncodedString() }
        }
        do {
            let r = try await API.requete("/api/portail/signatures/\(d.id)/signer", methode: "POST",
                                          corps: ["valeurs": v, "signature_png": png, "consentement": true],
                                          as: ReponseMessageSimple.self)
            session.afficher(r.message ?? "Document signé")
            await espace.charger()
            retour()
        } catch {
            UINotificationFeedbackGenerator().notificationOccurred(.error)
            erreur = error.localizedDescription
        }
    }
}

/// Case a cocher (le Toggle d'iOS est un interrupteur, peu parlant pour
/// « J'accepte »).
struct CaseACocher: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button { configuration.isOn.toggle() } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: configuration.isOn ? "checkmark.square.fill" : "square")
                    .font(.title3)
                    .foregroundStyle(configuration.isOn ? Color.accentColor : .secondary)
                    .contentTransition(.symbolEffect(.replace))
                configuration.label
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.selection, trigger: configuration.isOn)
    }
}

// MARK: - PDF

struct VuePDF: UIViewRepresentable {
    let document: PDFDocument

    func makeUIView(context: Context) -> PDFView {
        let v = PDFView()
        v.autoScales = true
        v.displayMode = .singlePageContinuous
        v.displayDirection = .vertical
        v.backgroundColor = .secondarySystemBackground
        v.document = document
        return v
    }

    func updateUIView(_ v: PDFView, context: Context) {
        if v.document !== document { v.document = document }
    }
}

// MARK: - Pad de signature

/// Feuille ou l'on trace sa signature : grande zone blanche, encre noire,
/// au doigt comme au stylet.
struct PadSignature: View {
    @Binding var dessin: PKDrawing
    @Binding var taille: CGSize
    @Environment(\.dismiss) private var fermer
    @State private var brouillon = PKDrawing()

    var body: some View {
        NavigationStack {
            VStack(spacing: 14) {
                GeometryReader { geo in
                    ZStack(alignment: .bottomLeading) {
                        ToileSignature(dessin: $brouillon)
                        Rectangle().fill(.black.opacity(0.25)).frame(height: 1)
                            .padding(.horizontal, 24).padding(.bottom, 44)
                            .allowsHitTesting(false)
                    }
                    .background(.white, in: .rect(cornerRadius: 22))
                    .clipShape(.rect(cornerRadius: 22))
                    .onAppear { taille = geo.size }
                    .onChange(of: geo.size) { _, s in taille = s }
                }
                .environment(\.colorScheme, .light)
                Text("Signez avec le doigt dans le cadre blanc.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            .padding(16)
            .navigationTitle("Votre signature")
            .toolbarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler", systemImage: "xmark") { fermer() }
                }
                ToolbarItem(placement: .bottomBar) {
                    Button("Effacer", systemImage: "eraser") { brouillon = PKDrawing() }
                        .disabled(brouillon.strokes.isEmpty)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Valider", systemImage: "checkmark") {
                        dessin = brouillon
                        fermer()
                    }
                    .buttonStyle(.glassProminent)
                    .disabled(brouillon.strokes.isEmpty)
                }
            }
            .onAppear { brouillon = dessin }
        }
        .interactiveDismissDisabled()
    }
}

struct ToileSignature: UIViewRepresentable {
    @Binding var dessin: PKDrawing

    func makeUIView(context: Context) -> PKCanvasView {
        let c = PKCanvasView()
        c.drawingPolicy = .anyInput
        c.tool = PKInkingTool(.pen, color: .black, width: 3)
        c.backgroundColor = .clear
        c.isOpaque = false
        c.overrideUserInterfaceStyle = .light      // encre noire, meme en mode sombre
        c.isScrollEnabled = false
        c.drawing = dessin
        c.delegate = context.coordinator
        return c
    }

    func updateUIView(_ c: PKCanvasView, context: Context) {
        if c.drawing != dessin { c.drawing = dessin }
    }

    func makeCoordinator() -> Coordinateur { Coordinateur(dessin: $dessin) }

    final class Coordinateur: NSObject, PKCanvasViewDelegate {
        var dessin: Binding<PKDrawing>
        init(dessin: Binding<PKDrawing>) { self.dessin = dessin }
        func canvasViewDrawingDidChange(_ c: PKCanvasView) { dessin.wrappedValue = c.drawing }
    }
}

extension PKDrawing {
    /// L'image du trace en encre noire, quel que soit le mode (clair/sombre).
    func imageClaire(_ taille: CGSize) -> UIImage {
        var image = UIImage()
        UITraitCollection(userInterfaceStyle: .light).performAsCurrent {
            image = self.image(from: CGRect(origin: .zero, size: taille), scale: 2)
        }
        return image
    }
}

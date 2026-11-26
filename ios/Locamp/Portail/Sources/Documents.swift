import SwiftUI
import PhotosUI
import VisionKit
import UniformTypeIdentifiers

/// Documents : a signer en tete, puis le dossier du locataire et les
/// documents deja signes. « + » envoie un document au camping.
struct DocumentsView: View {
    @Environment(Espace.self) private var espace
    @State private var depot = false
    @State private var apercu = Apercu()

    var body: some View {
        VueChargement(etat: espace.etat, reessayer: espace.charger) { _ in
            List {
                if !espace.aSigner.isEmpty {
                    Section {
                        ForEach(espace.aSigner) { d in
                            NavigationLink(value: d) {
                                Label {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(d.titre).font(.body.weight(.semibold))
                                        Text("Signature demandée · \(d.nb_pages ?? 1) page\((d.nb_pages ?? 1) > 1 ? "s" : "")")
                                            .font(.footnote).foregroundStyle(Color.accentColor)
                                    }
                                } icon: {
                                    Image(systemName: "signature").foregroundStyle(Color.accentColor)
                                }
                            }
                        }
                    } header: {
                        Text("À signer")
                    }
                }

                Section {
                    ForEach(espace.documents) { d in
                        Button {
                            apercu.ouvrir(nom: d.nom_fichier ?? d.libelle) {
                                try await API.requete("/api/portail/documents/\(d.id)/url", as: LienSigne.self).url
                            }
                        } label: {
                            LigneDocument(titre: d.libelle, detail: [d.nom_fichier, Format.date(d.created_at).map {
                                $0.formatted(.dateTime.day().month(.abbreviated).year().locale(Format.fr))
                            }].compactMap { $0 }.joined(separator: " · "), symbole: symbole(d))
                        }
                        .buttonStyle(.plain)
                    }
                    Button { depot = true } label: {
                        Label("Envoyer un document au camping", systemImage: "plus.circle.fill")
                    }
                } header: {
                    Text("Mon dossier")
                } footer: {
                    Text("Attestation d'assurance, justificatif de domicile, pièce d'identité… Votre camping les reçoit aussitôt.")
                }

                if !espace.signes.isEmpty {
                    Section("Signés") {
                        ForEach(espace.signes) { d in
                            NavigationLink(value: d) {
                                LigneDocument(titre: d.titre, detail: "Signé le \(Format.jour(d.date_signature))",
                                              symbole: "checkmark.seal.fill")
                            }
                        }
                    }
                }
            }
            .refreshable { await espace.charger() }
        }
        .navigationTitle("Documents")
        .toolbarTitleDisplayMode(.large)
        .barreEspace()
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Envoyer un document", systemImage: "plus") { depot = true }
            }
        }
        .navigationDestination(for: DocumentSignature.self) { SignatureView(document: $0) }
        .sheet(isPresented: $depot) { DepotDocumentView() }
        .apercu(apercu)
    }

    private func symbole(_ d: Document) -> String {
        let ext = ((d.nom_fichier ?? "") as NSString).pathExtension.lowercased()
        if ["jpg", "jpeg", "png", "heic", "webp"].contains(ext) { return "photo" }
        if ext == "pdf" { return "doc.richtext" }
        return TypeDocument(rawValue: d.type ?? "")?.symbole ?? "doc"
    }
}

struct LigneDocument: View {
    let titre: String
    let detail: String
    let symbole: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: symbole)
                .font(.title3)
                .foregroundStyle(Color.accentColor)
                .frame(width: 38, height: 38)
                .background(Color.accentColor.opacity(0.12), in: .rect(cornerRadius: 11))
            VStack(alignment: .leading, spacing: 2) {
                Text(titre).font(.body.weight(.medium)).foregroundStyle(.primary)
                Text(detail).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .contentShape(.rect)
    }
}

// MARK: - Envoi d'un document

/// Un fichier pret a partir.
private struct FichierChoisi {
    var donnees: Data
    var nom: String
    var type: UTType
    var vignette: UIImage?
}

struct DepotDocumentView: View {
    @Environment(Session.self) private var session
    @Environment(Espace.self) private var espace
    @Environment(\.dismiss) private var fermer
    @State private var type = TypeDocument.attestation_assurance
    @State private var fichier: FichierChoisi?
    @State private var photo: PhotosPickerItem?
    @State private var importer = false
    @State private var scanner = false
    @State private var envoi = false
    @State private var erreur: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Type de document") {
                    Picker("Type", selection: $type) {
                        ForEach(TypeDocument.allCases) { t in
                            Label(t.titre, systemImage: t.symbole).tag(t)
                        }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                }

                Section {
                    if let f = fichier {
                        HStack(spacing: 12) {
                            if let v = f.vignette {
                                Image(uiImage: v).resizable().scaledToFill()
                                    .frame(width: 54, height: 54).clipShape(.rect(cornerRadius: 10))
                            } else {
                                Image(systemName: "doc.fill").font(.title).foregroundStyle(Color.accentColor)
                                    .frame(width: 54, height: 54)
                            }
                            VStack(alignment: .leading, spacing: 2) {
                                Text(f.nom).font(.body.weight(.medium)).lineLimit(2)
                                Text(ByteCountFormatter.string(fromByteCount: Int64(f.donnees.count), countStyle: .file))
                                    .font(.footnote).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button("Retirer", systemImage: "xmark.circle.fill") { withAnimation { fichier = nil } }
                                .labelStyle(.iconOnly).foregroundStyle(.secondary)
                        }
                    } else {
                        if VNDocumentCameraViewController.isSupported {
                            Button { scanner = true } label: { Label("Scanner un document", systemImage: "doc.viewfinder") }
                        }
                        PhotosPicker(selection: $photo, matching: .images) {
                            Label("Choisir une photo", systemImage: "photo.on.rectangle")
                        }
                        Button { importer = true } label: { Label("Choisir un fichier", systemImage: "folder") }
                    }
                } header: {
                    Text("Fichier")
                } footer: {
                    Text("15 Mo au plus. Les photos sont envoyées en JPEG.")
                }

                if let erreur {
                    Section { Label(erreur, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red) }
                }
            }
            .navigationTitle("Envoyer un document")
            .toolbarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler", systemImage: "xmark") { fermer() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Envoyer", systemImage: "paperplane") { Task { await envoyer() } }
                        .buttonStyle(.glassProminent)
                        .disabled(fichier == nil || envoi)
                }
            }
            .overlay {
                if envoi {
                    ProgressView("Envoi…")
                        .padding(24)
                        .glassEffect(.regular, in: .rect(cornerRadius: 22))
                }
            }
            .onChange(of: photo) { _, item in
                guard let item else { return }
                Task { await chargerPhoto(item) }
            }
            .fileImporter(isPresented: $importer, allowedContentTypes: [.pdf, .image, .item]) { r in
                if case .success(let url) = r { chargerFichier(url) }
            }
            .fullScreenCover(isPresented: $scanner) {
                ScannerDocument { pages in
                    scanner = false
                    if !pages.isEmpty { fichier = Self.pdf(de: pages, nom: type.titre) }
                }
                .ignoresSafeArea()
            }
        }
        .interactiveDismissDisabled(envoi)
    }

    private func chargerPhoto(_ item: PhotosPickerItem) async {
        defer { photo = nil }
        guard let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data),
              let jpeg = image.jpegData(compressionQuality: 0.82) else {
            erreur = "Cette photo n'a pas pu être lue."
            return
        }
        let date = Date.now.formatted(.iso8601.year().month().day())
        fichier = FichierChoisi(donnees: jpeg, nom: "Photo \(date).jpg", type: .jpeg,
                                vignette: image.preparingThumbnail(of: CGSize(width: 160, height: 160)))
    }

    private func chargerFichier(_ url: URL) {
        let acces = url.startAccessingSecurityScopedResource()
        defer { if acces { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { erreur = "Ce fichier n'a pas pu être lu."; return }
        let t = UTType(filenameExtension: url.pathExtension) ?? .data
        let vignette = t.conforms(to: .image) ? UIImage(data: data)?.preparingThumbnail(of: CGSize(width: 160, height: 160)) : nil
        fichier = FichierChoisi(donnees: data, nom: url.lastPathComponent, type: t, vignette: vignette)
    }

    /// Les pages scannees, assemblees en un PDF.
    private static func pdf(de pages: [UIImage], nom: String) -> FichierChoisi {
        let a4 = CGRect(x: 0, y: 0, width: 595, height: 842)
        let data = UIGraphicsPDFRenderer(bounds: a4).pdfData { ctx in
            for p in pages {
                ctx.beginPage()
                let echelle = min(a4.width / p.size.width, a4.height / p.size.height)
                let taille = CGSize(width: p.size.width * echelle, height: p.size.height * echelle)
                p.draw(in: CGRect(x: (a4.width - taille.width) / 2, y: (a4.height - taille.height) / 2,
                                  width: taille.width, height: taille.height))
            }
        }
        return FichierChoisi(donnees: data, nom: "\(nom).pdf", type: .pdf,
                             vignette: pages.first?.preparingThumbnail(of: CGSize(width: 160, height: 160)))
    }

    private func envoyer() async {
        guard let f = fichier else { return }
        guard f.donnees.count <= 15 * 1024 * 1024 else { erreur = "Fichier trop lourd (15 Mo au plus)."; return }
        envoi = true; erreur = nil
        defer { envoi = false }
        do {
            try await API.envoyerFichier("/api/portail/documents", fichier: f.donnees, nom: f.nom, type: f.type,
                                         champs: ["type": type.rawValue])
            session.afficher("Document envoyé au camping")
            await espace.charger()
            fermer()
        } catch {
            erreur = error.localizedDescription
        }
    }
}

/// Le scanner de documents d'iOS (detection des bords, redressement).
struct ScannerDocument: UIViewControllerRepresentable {
    let fini: ([UIImage]) -> Void

    func makeUIViewController(context: Context) -> VNDocumentCameraViewController {
        let vc = VNDocumentCameraViewController()
        vc.delegate = context.coordinator
        return vc
    }
    func updateUIViewController(_ vc: VNDocumentCameraViewController, context: Context) {}
    func makeCoordinator() -> Coordinateur { Coordinateur(fini: fini) }

    final class Coordinateur: NSObject, VNDocumentCameraViewControllerDelegate {
        let fini: ([UIImage]) -> Void
        init(fini: @escaping ([UIImage]) -> Void) { self.fini = fini }

        func documentCameraViewController(_ c: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
            fini((0..<scan.pageCount).map { scan.imageOfPage(at: $0) })
        }
        func documentCameraViewControllerDidCancel(_ c: VNDocumentCameraViewController) { fini([]) }
        func documentCameraViewController(_ c: VNDocumentCameraViewController, didFailWithError error: Error) { fini([]) }
    }
}

import SwiftUI
import UIKit
import WebKit

/// Le pont entre l'interface native (SwiftUI, Liquid Glass) et le site
/// Locamp affiche dans un WKWebView.
///
/// Un SEUL WKWebView pour toute l'app : le site est une application d'une
/// page (session, camping actif, caches en memoire). Chaque onglet natif
/// l'accueille a son tour (voir `WebViewHote`), et le pont pilote l'adresse
/// `#/…` du site. Le contrat des messages est decrit dans ios/README.md et
/// dans l'en-tete de backend/public/natif.js.
@MainActor
@Observable
final class Pont: NSObject {
    static let partage = Pont()

    // MARK: Etat publie par le site
    private(set) var pret = false
    private(set) var connecte = false
    private(set) var etat: EtatWeb?
    private(set) var superposition = false

    // MARK: Etat de l'interface native
    var onglet: OngletApp = .accueil
    var cheminPlus: [EcranPlus] = []
    var dialogue: DialogueWeb?
    var toast: ToastWeb?
    var fenetre: FenetreWeb?

    /// Dernier ecran vu dans chaque onglet : revenir sur « Facturation »
    /// rouvre « Reglements » si c'est la qu'on etait.
    @ObservationIgnored private var memoire: [OngletApp: String] = [:]
    @ObservationIgnored private var marges = UIEdgeInsets.zero
    @ObservationIgnored private var jetonPush: String?

    @ObservationIgnored let adresse: URL = {
        let brut = Bundle.main.object(forInfoDictionaryKey: "LocampURL") as? String
        return URL(string: brut ?? "") ?? URL(string: "https://locamp.onrender.com/")!
    }()

    @ObservationIgnored private(set) var webView: WKWebView!
    @ObservationIgnored private var destinations: [ObjectIdentifier: URL] = [:]

    override private init() {
        super.init()
        webView = fabriquerWebView()
    }

    // MARK: - Fabrication du WKWebView

    private func fabriquerWebView() -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        config.preferences.javaScriptCanOpenWindowsAutomatically = true
        config.applicationNameForUserAgent = "LocampiOS/\(Bundle.main.versionCourte)"

        let ucc = WKUserContentController()
        // Pose la classe des le premier octet : sans elle, la barre laterale
        // web apparaitrait une fraction de seconde avant natif.js.
        let amorce = """
        document.documentElement.classList.add('natif', 'natif-ios');
        window.LOCAMP_NATIF = { plateforme: 'ios', version: 1 };
        """
        ucc.addUserScript(WKUserScript(source: amorce, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        // Le pont est un singleton : la retention forte par le controleur
        // de contenu ne cree pas de fuite.
        ucc.add(self, name: "locamp")
        config.userContentController = ucc

        let wv = WKWebView(frame: .zero, configuration: config)
        wv.navigationDelegate = self
        wv.uiDelegate = self
        wv.allowsBackForwardNavigationGestures = true
        wv.allowsLinkPreview = false
        wv.isInspectable = true                       // Safari > Developpement, en debug comme en TestFlight
        wv.isOpaque = false
        wv.backgroundColor = UIColor(named: "Fond") ?? .systemBackground
        wv.scrollView.backgroundColor = wv.backgroundColor
        // Les marges sont donnees au site en CSS (--natif-haut / --natif-bas) :
        // le contenu defile SOUS les barres de verre, sans double decalage.
        wv.scrollView.contentInsetAdjustmentBehavior = .never
        wv.scrollView.keyboardDismissMode = .interactive

        let rafraichir = UIRefreshControl()
        rafraichir.addTarget(self, action: #selector(tirerPourRafraichir(_:)), for: .valueChanged)
        wv.scrollView.refreshControl = rafraichir

        wv.load(URLRequest(url: adresse))
        return wv
    }

    @objc private func tirerPourRafraichir(_ rc: UIRefreshControl) {
        appeler("recharger")
        Task { try? await Task.sleep(for: .milliseconds(700)); rc.endRefreshing() }
    }

    // MARK: - Natif -> site

    /// Appelle `window.LocampNatif.<fonction>(args…)`. Les arguments passent
    /// par JSON : aucune chaine n'est concatenee dans du JavaScript.
    func appeler(_ fonction: String, _ args: Any?...) {
        let liste = args.map { $0 ?? NSNull() }
        guard let data = try? JSONSerialization.data(withJSONObject: liste, options: [.fragmentsAllowed]),
              let json = String(data: data, encoding: .utf8) else { return }
        let js = "window.LocampNatif && window.LocampNatif.\(fonction).apply(window.LocampNatif, \(json));"
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    func naviguer(_ ecran: String) { appeler("naviguer", "#/" + ecran) }
    func action(_ a: EtatWeb.ActionWeb) {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        appeler("action", a.id)
    }
    func rechercher(_ texte: String) { appeler("rechercher", texte) }
    func changerCamping(_ id: String) { appeler("changerCamping", id) }
    func changerExercice(_ id: String) { appeler("changerExercice", id) }
    func ouvrirNotifications() { appeler("notifications") }
    func deconnexion() { appeler("deconnexion") }
    func retour() { appeler("retour") }

    func repondre(_ d: DialogueWeb, _ valeur: Any?) {
        dialogue = nil
        appeler("repondre", d.id, valeur)
    }

    func recevoirJetonPush(_ jeton: String) {
        jetonPush = jeton
        if pret { appeler("jetonPush", jeton) }
    }

    /// Hauteur des barres natives qui recouvrent la page.
    func definirMarges(_ m: EdgeInsets) {
        let ui = UIEdgeInsets(top: m.top, left: m.leading, bottom: m.bottom, right: m.trailing)
        guard ui != marges else { return }
        marges = ui
        appliquerMarges()
    }

    private func appliquerMarges() {
        webView.scrollView.verticalScrollIndicatorInsets = UIEdgeInsets(top: marges.top, left: 0, bottom: marges.bottom, right: 0)
        let js = """
        (function(s){s.setProperty('--natif-haut','\(Int(marges.top))px');s.setProperty('--natif-bas','\(Int(marges.bottom))px');})(document.documentElement.style);
        """
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    // MARK: - Onglets <-> adresses du site

    /// L'utilisateur a touche un onglet natif.
    func ongletChoisi(_ o: OngletApp) {
        if o == .plus {
            if let e = cheminPlus.last { allerSiBesoin(groupe: e.rawValue, ecran: memoire[.plus] ?? e.rawValue) }
            return
        }
        guard let g = o.groupe else { return }
        allerSiBesoin(groupe: g, ecran: memoire[o] ?? g)
    }

    /// Un ecran de « Plus » a ete ouvert ou ferme.
    func cheminPlusChange() {
        guard onglet == .plus, let e = cheminPlus.last else { return }
        allerSiBesoin(groupe: e.rawValue, ecran: e.rawValue)
    }

    func sousOngletChoisi(_ id: String) {
        guard id != etat?.ecran else { return }
        UISelectionFeedbackGenerator().selectionChanged()
        naviguer(id)
    }

    private func allerSiBesoin(groupe: String, ecran: String) {
        if etat?.groupe == groupe { return }
        naviguer(ecran)
    }

    /// Le site a change d'ecran (lien interne, notification…) : l'onglet
    /// natif suit.
    private func synchroniserOnglet(_ e: EtatWeb) {
        let (o, plus) = OngletApp.pour(groupe: e.groupe)
        if !e.retour { memoire[o] = e.ecran }
        if onglet != o { onglet = o }
        if o == .plus, let plus, cheminPlus.last != plus { cheminPlus = [plus] }
    }

    // MARK: - Presentation UIKit (partage, impression, alertes JS)

    func presenter(_ vc: UIViewController) {
        guard let racine = UIApplication.shared.connectedScenes
            .compactMap({ ($0 as? UIWindowScene)?.keyWindow?.rootViewController }).first else { return }
        var haut = racine
        while let p = haut.presentedViewController { haut = p }
        if let pop = vc.popoverPresentationController {
            pop.sourceView = haut.view
            pop.sourceRect = CGRect(x: haut.view.bounds.midX, y: haut.view.bounds.midY, width: 0, height: 0)
        }
        haut.present(vc, animated: true)
    }

    func afficherToast(_ message: String, erreur: Bool = false) {
        let t = ToastWeb(message: message, erreur: erreur)
        UINotificationFeedbackGenerator().notificationOccurred(erreur ? .error : .success)
        withAnimation(.bouncy) { toast = t }
        Task {
            try? await Task.sleep(for: .seconds(3.5))
            if toast?.id == t.id { withAnimation(.smooth) { toast = nil } }
        }
    }

    func partager(_ url: URL) {
        presenter(UIActivityViewController(activityItems: [url], applicationActivities: nil))
    }
}

// MARK: - Site -> natif

extension Pont: WKScriptMessageHandler {
    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let corps = message.body as? [String: Any], let type = corps["type"] as? String else { return }
        switch type {
        case "pret":
            pret = true
            appliquerMarges()
            if let jetonPush { appeler("jetonPush", jetonPush) }

        case "session":
            let c = corps["connecte"] as? Bool ?? false
            withAnimation(.smooth) { connecte = c }
            if !c { etat = nil; memoire = [:]; cheminPlus = []; onglet = .accueil }

        case "etat":
            guard let brut = corps["etat"],
                  let data = try? JSONSerialization.data(withJSONObject: brut),
                  let e = try? JSONDecoder().decode(EtatWeb.self, from: data) else { return }
            etat = e
            synchroniserOnglet(e)

        case "superposition":
            withAnimation(.smooth(duration: 0.25)) { superposition = corps["ouverte"] as? Bool ?? false }

        case "toast":
            afficherToast(corps["message"] as? String ?? "", erreur: corps["erreur"] as? Bool ?? false)

        case "dialogue":
            guard let id = corps["id"] as? String,
                  let genre = DialogueWeb.Genre(rawValue: corps["genre"] as? String ?? "") else { return }
            dialogue = DialogueWeb(
                id: id, genre: genre,
                titre: corps["titre"] as? String ?? "",
                message: corps["message"] as? String ?? "",
                ok: corps["ok"] as? String ?? "OK",
                danger: corps["danger"] as? Bool ?? false,
                valeur: corps["valeur"] as? String ?? "",
                invite: corps["invite"] as? String ?? "")

        default:
            break
        }
    }
}

// MARK: - Navigation

extension Pont: WKNavigationDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
        if action.shouldPerformDownload { decisionHandler(.download); return }
        guard let url = action.request.url else { decisionHandler(.allow); return }

        switch url.scheme?.lowercased() ?? "" {
        case "http", "https", "about", "blob", "data":
            break
        default:                                   // mailto:, tel:, sms:, maps…
            UIApplication.shared.open(url)
            decisionHandler(.cancel); return
        }
        // Un lien qui sort de Locamp, touche par l'utilisateur, part dans Safari.
        if action.targetFrame?.isMainFrame == true, action.navigationType == .linkActivated,
           url.host != adresse.host {
            UIApplication.shared.open(url)
            decisionHandler(.cancel); return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping @MainActor @Sendable (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(response.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        pret = false
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let e = error as NSError
        guard e.code != NSURLErrorCancelled else { return }
        afficherToast("Connexion impossible. Tirez pour réessayer.", erreur: true)
    }
}

// MARK: - Fichiers telecharges (exports CSV, FEC, Factur-X…)

extension Pont: WKDownloadDelegate {
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String, completionHandler: @escaping @MainActor @Sendable (URL?) -> Void) {
        let dossier = FileManager.default.temporaryDirectory.appendingPathComponent("Telechargements", isDirectory: true)
        try? FileManager.default.createDirectory(at: dossier, withIntermediateDirectories: true)
        let cible = dossier.appendingPathComponent(suggestedFilename)
        try? FileManager.default.removeItem(at: cible)
        destinations[ObjectIdentifier(download)] = cible
        completionHandler(cible)
    }

    func downloadDidFinish(_ download: WKDownload) {
        if let url = destinations.removeValue(forKey: ObjectIdentifier(download)) { partager(url) }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        destinations.removeValue(forKey: ObjectIdentifier(download))
        afficherToast("Téléchargement impossible.", erreur: true)
    }
}

// MARK: - Fenetres, alertes JavaScript

extension Pont: WKUIDelegate {
    /// window.open : PDF de facture, document signe, feuille de tournee a
    /// imprimer… La fenetre s'ouvre dans une feuille native.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        let popup = WKWebView(frame: .zero, configuration: configuration)
        popup.uiDelegate = self
        popup.isInspectable = true
        fenetre = FenetreWeb(webView: popup)
        return popup
    }

    func webViewDidClose(_ webView: WKWebView) {
        if fenetre?.webView === webView { fenetre = nil }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable () -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        presenter(a)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable (Bool) -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Annuler", style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: "Confirmer", style: .default) { _ in completionHandler(true) })
        presenter(a)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable (String?) -> Void) {
        let a = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        a.addTextField { $0.text = defaultText }
        a.addAction(UIAlertAction(title: "Annuler", style: .cancel) { _ in completionHandler(nil) })
        a.addAction(UIAlertAction(title: "Valider", style: .default) { _ in completionHandler(a.textFields?.first?.text) })
        presenter(a)
    }
}

/// Une fenetre ouverte par le site (window.open).
struct FenetreWeb: Identifiable {
    let id = UUID()
    let webView: WKWebView
}

extension Bundle {
    var versionCourte: String { object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0" }
}

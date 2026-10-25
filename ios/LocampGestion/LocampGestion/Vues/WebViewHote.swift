import SwiftUI
import UIKit
import WebKit

/// Accueille le WKWebView partage quand l'ecran est actif.
///
/// Chaque onglet a son propre hote, mais il n'existe qu'un WKWebView : il
/// est deplace dans l'hote de l'onglet visible. Un seul site, une seule
/// session, aucun rechargement en changeant d'onglet.
struct WebViewHote: UIViewRepresentable {
    let actif: Bool

    func makeUIView(context: Context) -> ConteneurWeb {
        let v = ConteneurWeb()
        v.backgroundColor = UIColor(named: "Fond")
        return v
    }

    func updateUIView(_ v: ConteneurWeb, context: Context) {
        v.actif = actif
    }

    static func dismantleUIView(_ v: ConteneurWeb, coordinator: ()) {
        v.actif = false
    }
}

/// L'hote UIKit du WKWebView partage.
///
/// Quand SwiftUI reconstruit un ecran (barre de recherche qui apparait,
/// changement d'onglet…), l'ancien et le nouvel hote coexistent un instant,
/// tous deux « actifs ». Si chacun deplacait le WKWebView a son tour, il
/// pouvait finir dans celui qui disparait : page blanche (Plan, Residents).
/// La regle est donc globale et deterministe : le WKWebView va a l'hote
/// actif, affiche a l'ecran, et le plus recemment affiche.
final class ConteneurWeb: UIView {
    private static let tous = NSHashTable<ConteneurWeb>.weakObjects()
    private static var compteur = 0

    /// Ordre d'arrivee a l'ecran : le plus recent l'emporte.
    private var rang = 0

    var actif = false {
        didSet { if actif != oldValue { Self.repartir() } }
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        Self.tous.add(self)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) non utilise") }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window != nil {
            Self.compteur += 1
            rang = Self.compteur
        }
        Self.repartir()
    }

    override func safeAreaInsetsDidChange() {
        super.safeAreaInsetsDidChange()
        signaler()
    }

    private static func repartir() {
        guard let wv = Pont.partage.webView else { return }
        let elu = tous.allObjects
            .filter { $0.actif && $0.window != nil }
            .max { $0.rang < $1.rang }
        guard let elu, wv.superview !== elu else { return }
        wv.removeFromSuperview()
        wv.translatesAutoresizingMaskIntoConstraints = false
        elu.addSubview(wv)
        NSLayoutConstraint.activate([
            wv.topAnchor.constraint(equalTo: elu.topAnchor),
            wv.bottomAnchor.constraint(equalTo: elu.bottomAnchor),
            wv.leadingAnchor.constraint(equalTo: elu.leadingAnchor),
            wv.trailingAnchor.constraint(equalTo: elu.trailingAnchor),
        ])
        elu.signaler()
    }

    /// Mesure aussi, cote UIKit, la place prise par les barres : deuxieme
    /// source pour les marges du site, au cas ou SwiftUI n'en donnerait pas.
    fileprivate func signaler() {
        guard let wv = Pont.partage.webView, wv.superview === self else { return }
        Pont.partage.definirMargesUIKit(safeAreaInsets)
    }
}

/// Le WKWebView d'une fenetre ouverte par le site (window.open).
struct WebViewSimple: UIViewRepresentable {
    let webView: WKWebView
    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ v: WKWebView, context: Context) {}
}

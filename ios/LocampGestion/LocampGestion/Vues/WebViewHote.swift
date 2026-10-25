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
        guard actif else { return }
        let wv = Pont.partage.webView!
        guard wv.superview !== v else { return }
        wv.removeFromSuperview()
        wv.translatesAutoresizingMaskIntoConstraints = false
        v.addSubview(wv)
        NSLayoutConstraint.activate([
            wv.topAnchor.constraint(equalTo: v.topAnchor),
            wv.bottomAnchor.constraint(equalTo: v.bottomAnchor),
            wv.leadingAnchor.constraint(equalTo: v.leadingAnchor),
            wv.trailingAnchor.constraint(equalTo: v.trailingAnchor),
        ])
    }
}

/// Mesure aussi, cote UIKit, la place prise par les barres : deuxieme
/// source pour les marges du site, au cas ou SwiftUI n'en donnerait pas.
final class ConteneurWeb: UIView {
    override func safeAreaInsetsDidChange() {
        super.safeAreaInsetsDidChange()
        signaler()
    }

    override func didAddSubview(_ subview: UIView) {
        super.didAddSubview(subview)
        signaler()
    }

    private func signaler() {
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

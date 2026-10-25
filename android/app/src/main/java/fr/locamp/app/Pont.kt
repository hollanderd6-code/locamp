package fr.locamp.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.FileProvider
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import fr.locamp.app.messagerie.ClientApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Le pont entre l'interface native (Compose, Material 3) et le site Locamp
 * affiche dans un WebView.
 *
 * Un SEUL WebView pour toute l'app : le site est une application d'une page
 * (session, camping actif, caches). La barre d'onglets native pilote son
 * adresse « #/… ». Le contrat des messages est le meme que sur iOS : voir
 * ios/README.md et l'en-tete de backend/public/natif.js.
 *
 * Le site parle a l'app par window.webkit.messageHandlers.locamp.postMessage
 * (l'API de WKWebView). Sur Android, un petit script pose au demarrage de
 * chaque page (SCRIPT_DEMARRAGE) fournit cette meme fonction et la relaie a
 * l'interface Java « LocampAndroid » : natif.js est identique sur les deux
 * plateformes.
 */
object Pont {
    const val PLUS = "plus"

    // ---- Etat publie par le site ----
    var pret by mutableStateOf(false); private set
    var chargement by mutableStateOf(true); private set
    var connecte by mutableStateOf(false); private set
    var etat by mutableStateOf<EtatWeb?>(null); private set
    var superposition by mutableStateOf(false); private set

    // ---- Etat de l'interface native ----
    var onglet by mutableStateOf(Configuration.onglets.first().id)
    var ecranPlus by mutableStateOf<String?>(null)
    var dialogue by mutableStateOf<DialogueWeb?>(null)
    var toast by mutableStateOf<Toast?>(null)
    var fenetre by mutableStateOf<WebView?>(null)

    data class Toast(val message: String, val erreur: Boolean, val id: Long = System.nanoTime())

    /** Dernier ecran vu dans chaque onglet : revenir sur « Facturation » rouvre « Reglements ». */
    private val memoire = mutableMapOf<String, String>()
    private var jetonPush: String? = null

    val adresse: String = BuildConfig.LOCAMP_URL
    private val hote: String? = Uri.parse(adresse).host
    private val origine: String = Uri.parse(adresse).let { "${it.scheme}://${it.host}" }

    var webView: WebView? = null; private set
    private var activite: Activity? = null
    private var choixFichier: ValueCallback<Array<Uri>>? = null
    var lancerChoixFichier: ((Intent) -> Unit)? = null

    private val principal = Handler(Looper.getMainLooper())
    private val portee = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    // =====================================================================
    // Fabrication du WebView
    // =====================================================================

    @SuppressLint("SetJavaScriptEnabled")
    fun creer(activity: Activity): WebView {
        activite = activity
        webView?.let { return it }

        val wv = WebView(activity)
        wv.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            javaScriptCanOpenWindowsAutomatically = true
            setSupportMultipleWindows(true)
            mediaPlaybackRequiresUserGesture = false
            userAgentString = "$userAgentString LocampAndroid/${BuildConfig.VERSION_NAME}"
        }
        wv.setBackgroundColor(0xFFF5F6F4.toInt())
        wv.addJavascriptInterface(InterfaceJs(), "LocampAndroid")

        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            // Seulement pour le site Locamp : une page tierce n'aurait pas acces au pont.
            WebViewCompat.addDocumentStartJavaScript(wv, scriptDemarrage(), setOf(origine))
        }
        wv.webViewClient = ClientNavigation()
        wv.webChromeClient = ClientChrome()
        wv.setDownloadListener { url, _, _, _, _ ->
            if (url.startsWith("http")) ouvrirAilleurs(Uri.parse(url))
        }

        webView = wv
        wv.loadUrl(adresse)
        return wv
    }

    fun detruire() {
        webView?.apply { stopLoading(); destroy() }
        webView = null
        activite = null
    }

    /** Pose de quoi parler a l'app avant tout script de la page. */
    private fun scriptDemarrage(): String = """
        (function () {
          if (window.__locampAndroid) return; window.__locampAndroid = true;
          window.LOCAMP_NATIF = { plateforme: 'android', version: 1 };
          ${if (Configuration.PAIEMENT_MASQUE) "window.LOCAMP_NATIVE = true;" else ""}
          var h = document.documentElement;
          if (h) {
            h.classList.add('natif', 'natif-android');
            h.style.setProperty('--natif-haut', '0px');
            h.style.setProperty('--natif-bas', '0px');
          }
          window.webkit = window.webkit || {};
          window.webkit.messageHandlers = window.webkit.messageHandlers || {};
          window.webkit.messageHandlers.locamp = {
            postMessage: function (m) { LocampAndroid.postMessage(JSON.stringify(m)); }
          };
          // Fichiers fabriques dans la page (exports CSV, FEC, Factur-X) : le
          // WebView ne sait pas les telecharger, on les confie a l'app.
          var clic = HTMLAnchorElement.prototype.click;
          HTMLAnchorElement.prototype.click = function () {
            if (this.hasAttribute('download') && /^(blob|data):/.test(this.href)) {
              var nom = this.getAttribute('download') || 'fichier';
              fetch(this.href).then(function (r) { return r.blob(); }).then(function (b) {
                var fr = new FileReader();
                fr.onload = function () {
                  LocampAndroid.fichier(nom, b.type || 'application/octet-stream', String(fr.result).split(',')[1] || '');
                };
                fr.readAsDataURL(b);
              });
              return;
            }
            return clic.apply(this, arguments);
          };
        })();
    """.trimIndent()

    /** Copie embarquee du pont : injectee si le site deploye ne l'a pas encore. */
    private fun pontEmbarque(): String? {
        val act = activite ?: return null
        fun lire(nom: String) = runCatching { act.assets.open(nom).bufferedReader().use { it.readText() } }.getOrNull()
        val js = lire("${Configuration.FICHIERS_PONT}.js") ?: return null
        val css = lire("${Configuration.FICHIERS_PONT}.css")
        val styles = if (css == null) "" else """
            if (!document.querySelector('link[href*="${Configuration.FICHIERS_PONT}.css"]')) {
              var st = document.createElement('style'); st.textContent = ${JSONArray().put(css)}[0]; document.head.appendChild(st);
            }
        """.trimIndent()
        return "if (!window.LocampNatif) {\n$styles\n$js\n}"
    }

    // =====================================================================
    // Natif -> site
    // =====================================================================

    /** Appelle window.LocampNatif.<fonction>(args…), arguments passes en JSON. */
    fun appeler(fonction: String, vararg args: Any?) {
        val liste = JSONArray()
        args.forEach { liste.put(it ?: JSONObject.NULL) }
        webView?.evaluateJavascript(
            "window.LocampNatif && window.LocampNatif.$fonction.apply(window.LocampNatif, $liste);", null,
        )
    }

    fun naviguer(ecran: String) = appeler("naviguer", "#/$ecran")
    fun action(a: EtatWeb.ActionWeb) = appeler("action", a.id)
    fun rechercher(texte: String) = appeler("rechercher", texte)
    fun changerCamping(id: String) = appeler("changerCamping", id)
    fun changerExercice(id: String) = appeler("changerExercice", id)
    fun ouvrirNotifications() = appeler("notifications")
    fun deconnexion() = appeler("deconnexion")
    fun retour() = appeler("retour")
    fun recharger() = appeler("recharger")
    fun rafraichirBadges() = appeler("rafraichirBadges")
    fun sessionExpiree() = appeler("recharger")

    /** Ferme le tiroir ou la fenetre web ouverte (touche Retour). */
    fun fermerSuperposition() {
        webView?.evaluateJavascript(
            "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));", null,
        )
    }

    fun repondre(d: DialogueWeb, valeur: Any?) {
        dialogue = null
        appeler("repondre", d.id, valeur)
    }

    fun recevoirJetonPush(jeton: String) {
        jetonPush = jeton
        if (pret) appeler("jetonPush", jeton)
    }

    fun afficherToast(message: String, erreur: Boolean = false) {
        toast = Toast(message, erreur)
    }

    // =====================================================================
    // Onglets <-> adresses du site
    // =====================================================================

    fun ongletChoisi(id: String) {
        if (id == PLUS) {
            ecranPlus?.let { allerSiBesoin(listOf(it), memoire[PLUS] ?: it) }
            return
        }
        val o = Configuration.onglets.firstOrNull { it.id == id } ?: return
        allerSiBesoin(o.groupes, memoire[id] ?: o.groupes.first())
    }

    fun ouvrirPlus(id: String?) {
        ecranPlus = id
        if (id != null) allerSiBesoin(listOf(id), id)
    }

    fun sousOngletChoisi(id: String) {
        if (id != etat?.ecran) naviguer(id)
    }

    private fun allerSiBesoin(groupes: List<String>, ecran: String) {
        val g = etat?.groupe
        if (g != null && g in groupes) return
        naviguer(ecran)
    }

    /** Le site a change d'ecran (lien interne, notification…) : l'onglet suit. */
    private fun synchroniser(e: EtatWeb) {
        val o = Configuration.onglets.firstOrNull { e.groupe in it.groupes }
        val plus = Configuration.ecransPlus.firstOrNull { it.id == e.groupe }
        val id = o?.id ?: if (plus != null) PLUS else Configuration.onglets.first().id
        if (!e.retour) memoire[id] = e.ecran
        if (onglet != id) onglet = id
        if (id == PLUS && plus != null && ecranPlus != plus.id) ecranPlus = plus.id
    }

    // =====================================================================
    // Site -> natif
    // =====================================================================

    private class InterfaceJs {
        @JavascriptInterface
        fun postMessage(json: String) {
            principal.post { recevoir(json) }
        }

        @JavascriptInterface
        fun fichier(nom: String, type: String, base64: String) {
            principal.post { enregistrerEtPartager(nom, type, base64) }
        }
    }

    private fun recevoir(json: String) {
        val m = runCatching { JSONObject(json) }.getOrNull() ?: return
        when (m.optString("type")) {
            "pret" -> {
                pret = true
                jetonPush?.let { appeler("jetonPush", it) }
            }
            "session" -> {
                val c = m.optBoolean("connecte")
                connecte = c
                if (!c) {
                    etat = null; memoire.clear(); ecranPlus = null
                    onglet = Configuration.onglets.first().id
                }
            }
            "etat" -> m.optJSONObject("etat")?.let {
                val e = EtatWeb.lire(it)
                etat = e
                synchroniser(e)
            }
            "auth" -> {
                val jeton = m.optStringOuNull("jeton")
                val base = m.optStringOuNull("base")
                ClientApi.identifiants = if (jeton != null && base != null)
                    ClientApi.Identifiants(base, jeton, m.optStringOuNull("camping")) else null
            }
            "superposition" -> superposition = m.optBoolean("ouverte")
            "toast" -> afficherToast(m.optString("message"), m.optBoolean("erreur"))
            "dialogue" -> dialogue = DialogueWeb(
                id = m.optString("id"),
                saisie = m.optString("genre") == "saisir",
                titre = m.optString("titre"),
                message = m.optString("message"),
                ok = m.optString("ok", "OK"),
                danger = m.optBoolean("danger"),
                valeur = m.optString("valeur"),
                invite = m.optString("invite"),
            )
        }
    }

    // =====================================================================
    // Navigation
    // =====================================================================

    private class ClientNavigation : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url
            return when (url.scheme?.lowercase()) {
                "http", "https" ->
                    // Un lien qui sort de Locamp, touche par l'utilisateur, part dans le navigateur.
                    if (url.host != hote && request.isForMainFrame && request.hasGesture()) {
                        ouvrirAilleurs(url); true
                    } else false
                "about", "blob", "data", "javascript" -> false
                else -> { ouvrirAilleurs(url); true }       // mailto:, tel:, geo:…
            }
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            pret = false
            chargement = true
            // WebView ancien (sans script de demarrage) : on pose le relais ici.
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                view.evaluateJavascript(scriptDemarrage(), null)
            }
        }

        override fun onPageFinished(view: WebView, url: String?) {
            chargement = false
            pontEmbarque()?.let { view.evaluateJavascript(it, null) }
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) {
                chargement = false
                afficherToast("Connexion impossible. Tirez vers le bas pour réessayer.", erreur = true)
            }
        }

        override fun onRenderProcessGone(view: WebView, detail: android.webkit.RenderProcessGoneDetail): Boolean {
            // Le moteur du WebView a ete arrete par le systeme : on repart d'un WebView neuf.
            val act = activite
            detruire()
            act?.recreate()
            return true
        }
    }

    private class ClientChrome : WebChromeClient() {
        override fun onShowFileChooser(
            view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams,
        ): Boolean {
            choixFichier?.onReceiveValue(null)
            choixFichier = callback
            val lancer = lancerChoixFichier ?: run { callback.onReceiveValue(null); choixFichier = null; return false }
            return try {
                lancer(params.createIntent()); true
            } catch (e: ActivityNotFoundException) {
                choixFichier = null; callback.onReceiveValue(null); false
            }
        }

        /** window.open : PDF, document signe, feuille a imprimer… */
        override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
            val act = activite ?: return false
            val popup = WebView(act)
            popup.settings.javaScriptEnabled = true
            popup.settings.domStorageEnabled = true
            popup.webViewClient = ClientFenetre()
            popup.webChromeClient = object : WebChromeClient() {
                override fun onCloseWindow(window: WebView) { fermerFenetre() }
            }
            (resultMsg.obj as WebView.WebViewTransport).webView = popup
            resultMsg.sendToTarget()
            fenetre = popup
            return true
        }
    }

    /**
     * Fenetre ouverte par le site. Une page fabriquee sur place (feuille de
     * tournee a imprimer) s'affiche dans l'app ; un document en ligne (PDF
     * de facture, piece jointe) s'ouvre dans l'application adaptee — le
     * WebView Android ne sait pas afficher un PDF.
     */
    private class ClientFenetre : WebViewClient() {
        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            if (url != null && url.startsWith("http")) {
                view.stopLoading()
                ouvrirAilleurs(Uri.parse(url))
                fermerFenetre()
            }
        }

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (request.url.scheme?.startsWith("http") == true) {
                ouvrirAilleurs(request.url); fermerFenetre(); return true
            }
            return false
        }
    }

    fun fermerFenetre() {
        fenetre?.destroy()
        fenetre = null
    }

    fun resultatChoixFichier(resultCode: Int, data: Intent?) {
        choixFichier?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
        choixFichier = null
    }

    // =====================================================================
    // Fichiers et liens externes
    // =====================================================================

    fun ouvrirAilleurs(uri: Uri) {
        val act = activite ?: return
        try {
            act.startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (e: ActivityNotFoundException) {
            afficherToast("Aucune application pour ouvrir ce lien.", erreur = true)
        }
    }

    private fun enregistrerEtPartager(nom: String, type: String, base64: String) {
        val act = activite ?: return
        portee.launch {
            val fichier = withContext(Dispatchers.IO) {
                runCatching {
                    val dossier = File(act.cacheDir, "telechargements").apply { mkdirs() }
                    val propre = nom.replace(Regex("[^\\w.\\- ]"), "_").ifBlank { "fichier" }
                    File(dossier, propre).apply { writeBytes(Base64.decode(base64, Base64.DEFAULT)) }
                }.getOrNull()
            }
            if (fichier == null) { afficherToast("Téléchargement impossible.", erreur = true); return@launch }
            val uri = FileProvider.getUriForFile(act, "${act.packageName}.fichiers", fichier)
            val envoi = Intent(Intent.ACTION_SEND).apply {
                this.type = type
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            act.startActivity(Intent.createChooser(envoi, nom))
        }
    }
}

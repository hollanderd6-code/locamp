package fr.locamp.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import fr.locamp.app.push.Push
import fr.locamp.app.ui.Racine
import fr.locamp.app.ui.ThemeLocamp

class MainActivity : ComponentActivity() {

    private val choixFichier = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        Pont.resultatChoixFichier(it.resultCode, it.data)
    }

    private val permissionNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        val demarrage = installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        // L'ecran de demarrage reste jusqu'a la premiere page (3 s au plus).
        val debut = SystemClock.uptimeMillis()
        demarrage.setKeepOnScreenCondition { !Pont.pret && SystemClock.uptimeMillis() - debut < 3_000 }

        Pont.lancerChoixFichier = { choixFichier.launch(it) }
        val webView = Pont.creer(this)
        setContent { ThemeLocamp { Racine(webView) } }

        demanderNotifications()
        Push.initialiser(this)
        traiterNotification(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        traiterNotification(intent)
    }

    override fun onResume() {
        super.onResume()
        Pont.webView?.onResume()
    }

    override fun onPause() {
        Pont.webView?.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        if (isFinishing) Pont.detruire()
        super.onDestroy()
    }

    private fun demanderNotifications() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            permissionNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    /** Notification touchee : on ouvre l'ecran concerne, une fois le site pret. */
    private fun traiterNotification(intent: Intent?) {
        val extras = intent?.extras ?: return
        // Seule une vraie notification ouvre un ecran : le lancement normal
        // de l'app porte parfois des extras sans rapport.
        if (!extras.containsKey("type") && !extras.containsKey("entite")) return
        val ecran = Configuration.ecranPourNotification(extras.getString("type"), extras.getString("entite")) ?: return
        window.decorView.postDelayed({ Pont.naviguer(ecran) }, if (Pont.pret) 0L else 1_500L)
    }
}

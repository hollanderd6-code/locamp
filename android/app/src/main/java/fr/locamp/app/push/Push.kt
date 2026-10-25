package fr.locamp.app.push

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import fr.locamp.app.MainActivity
import fr.locamp.app.Pont
import fr.locamp.app.R

/**
 * Notifications push : Firebase Cloud Messaging, comme l'app iOS.
 * L'app obtient un jeton FCM et le confie au site, qui l'enregistre avec la
 * session de l'utilisateur (backend/lib/push.js : canal « staff » pour la
 * gestion, « portail » pour le locataire). Sans google-services.json,
 * Firebase n'est pas initialise : l'app fonctionne, sans push.
 */
object Push {
    fun initialiser(ctx: Context) {
        if (FirebaseApp.getApps(ctx).isEmpty()) return
        FirebaseMessaging.getInstance().token.addOnSuccessListener { jeton ->
            if (!jeton.isNullOrBlank()) Pont.recevoirJetonPush(jeton)
        }
    }
}

class ServicePush : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        Handler(Looper.getMainLooper()).post { Pont.recevoirJetonPush(token) }
    }

    /**
     * App ouverte : Android n'affiche pas lui-meme la notification, on la
     * montre. App fermee, le systeme s'en charge et le toucher ouvre
     * MainActivity avec les donnees en extras.
     */
    override fun onMessageReceived(message: RemoteMessage) {
        val n = message.notification ?: return
        val ouvrir = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            message.data.forEach { (k, v) -> putExtra(k, v) }
        }
        val pi = PendingIntent.getActivity(
            this, message.messageId.hashCode(), ouvrir,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notif = NotificationCompat.Builder(this, "locamp")
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(getColor(R.color.sapin))
            .setContentTitle(n.title)
            .setContentText(n.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(n.body))
            .setAutoCancel(true)
            .setContentIntent(pi)
            .build()
        val autorise = android.os.Build.VERSION.SDK_INT < 33 ||
            androidx.core.content.ContextCompat.checkSelfPermission(this, android.Manifest.permission.POST_NOTIFICATIONS) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED
        if (autorise) NotificationManagerCompat.from(this).notify(message.messageId.hashCode(), notif)
    }
}

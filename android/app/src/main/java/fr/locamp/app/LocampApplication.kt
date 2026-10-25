package fr.locamp.app

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager

class LocampApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // Canal des notifications push (factures, messages, paiements…).
        val canal = NotificationChannel("locamp", "Locamp", NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = "Messages, factures et paiements"
        }
        getSystemService(NotificationManager::class.java)?.createNotificationChannel(canal)
    }
}

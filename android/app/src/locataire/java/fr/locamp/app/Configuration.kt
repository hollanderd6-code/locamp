package fr.locamp.app

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Home

/** Ce qui distingue l'app Locataire de l'app Gestion. Le reste du code est commun. */
object Configuration {
    const val FICHIERS_PONT = "natif-portail"

    /** Les quatre rubriques du portail, en onglets. */
    val onglets = listOf(
        Onglet("solde", "Accueil", Icons.Outlined.Home, Icons.Filled.Home, listOf("solde")),
        Onglet("factures", "Factures", Icons.Outlined.Description, Icons.Filled.Description, listOf("factures")),
        Onglet("messages", "Messages", Icons.AutoMirrored.Outlined.Chat, Icons.AutoMirrored.Filled.Chat, listOf("messages"),
            badge = { it.messagerie }, natif = EcranNatif.MessagerieLocataire),
        Onglet("documents", "Documents", Icons.Outlined.Folder, Icons.Filled.Folder, listOf("documents"),
            badge = { it.notifications }),
    )

    val ecransPlus = emptyList<EcranPlus>()

    const val CLOCHE = false
    const val ESPACES_CAMPING = false
    /** Paiement Stripe masque dans l'app, comme sur iOS et dans l'ancienne app. */
    const val PAIEMENT_MASQUE = true

    fun ecranPourNotification(type: String?, entite: String?): String? = when {
        type == "nouveau_message" -> "messages"
        type == "document_signe" || entite == "document" -> "documents"
        else -> "factures"
    }
}

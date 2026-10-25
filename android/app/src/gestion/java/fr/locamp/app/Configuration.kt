package fr.locamp.app

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Map
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Map
import androidx.compose.material.icons.outlined.People

/** Ce qui distingue l'app Gestion de l'app Locataire. Le reste du code est commun. */
object Configuration {
    /** Fichiers du pont embarques (assets, copies depuis backend/public). */
    const val FICHIERS_PONT = "natif"

    /** Les huit entrees du menu web : quatre onglets, les autres sous « Plus ». */
    val onglets = listOf(
        Onglet("accueil", "Accueil", Icons.Outlined.Dashboard, Icons.Filled.Dashboard, listOf("dashboard")),
        Onglet("carte", "Carte", Icons.Outlined.Map, Icons.Filled.Map, listOf("carte")),
        Onglet("residents", "Résidents", Icons.Outlined.People, Icons.Filled.People, listOf("residents")),
        Onglet("factures", "Facturation", Icons.Outlined.Description, Icons.Filled.Description, listOf("factures"),
            badge = { it.factures }),
    )

    val ecransPlus = listOf(
        EcranPlus("messagerie", "Messagerie", Icons.AutoMirrored.Filled.Chat, badge = { it.messagerie },
            natif = EcranNatif.MessagerieGestion),
        EcranPlus("compteurs", "Compteurs", Icons.Filled.Speed),
        EcranPlus("compta", "Comptabilité", Icons.Filled.BarChart),
        EcranPlus("parametres", "Réglages", Icons.Filled.Settings),
    )

    /** Cloche des notifications dans la barre du haut. */
    const val CLOCHE = true
    /** Plusieurs espaces camping : choix et creation dans le menu du compte. */
    const val ESPACES_CAMPING = true
    /** Paiement en ligne masque : outil professionnel, non. */
    const val PAIEMENT_MASQUE = false

    /** Ecran a ouvrir quand on touche une notification push. */
    fun ecranPourNotification(type: String?, entite: String?): String? = when {
        type == "nouveau_message" -> "messagerie"
        type == "relance" || type == "paiement_recu" -> "impayes"
        entite == "facture" -> "factures"
        else -> null
    }
}

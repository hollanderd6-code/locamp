package fr.locamp.app

import androidx.compose.ui.graphics.vector.ImageVector
import org.json.JSONArray
import org.json.JSONObject

/**
 * Ce que le site publie a chaque changement d'ecran (message « etat »).
 * Miroir de lireEtat() dans backend/public/natif.js et natif-portail.js,
 * et de EtatWeb.swift cote iOS.
 */
data class EtatWeb(
    val ecran: String,
    val groupe: String,
    val titre: String,
    val retour: Boolean,
    val onglets: List<SousOnglet>,
    val ongletActif: String,
    val actions: List<ActionWeb>,
    val recherche: Recherche?,
    val badges: Badges,
    val contexte: Contexte,
) {
    data class SousOnglet(val id: String, val titre: String, val badge: Int)
    data class ActionWeb(
        val id: String, val titre: String, val symbole: String,
        val principal: Boolean, val destructif: Boolean, val desactive: Boolean,
    )
    data class Recherche(val invite: String, val valeur: String)
    data class Badges(val factures: Int, val messagerie: Int, val notifications: Int)
    data class Choix(val id: String, val nom: String)
    data class Utilisateur(val nom: String, val email: String, val admin: Boolean) {
        val initiales: String
            get() = nom.split(' ', '.').filter { it.isNotBlank() }.take(2)
                .joinToString("") { it.first().uppercase() }
    }
    data class Contexte(
        val campings: List<Choix>,
        val campingActif: String?,
        val nomCamping: String?,
        val exercices: List<Choix>,
        val exerciceActif: String?,
        val utilisateur: Utilisateur,
    )

    /** L'action mise en avant (bouton flottant). */
    val actionPrincipale: ActionWeb? get() = actions.firstOrNull { it.principal }
    /** Les autres, dans le menu « ⋮ ». */
    val actionsSecondaires: List<ActionWeb> get() = actions.filter { it.id != actionPrincipale?.id }

    companion object {
        fun lire(o: JSONObject): EtatWeb {
            val b = o.optJSONObject("badges") ?: JSONObject()
            val c = o.optJSONObject("contexte") ?: JSONObject()
            val u = c.optJSONObject("utilisateur") ?: JSONObject()
            val r = o.optJSONObject("recherche")
            return EtatWeb(
                ecran = o.optString("ecran"),
                groupe = o.optString("groupe"),
                titre = o.optString("titre", "Locamp"),
                retour = o.optBoolean("retour"),
                onglets = o.optJSONArray("onglets").objets().map {
                    SousOnglet(it.optString("id"), it.optString("titre"), it.optInt("badge"))
                },
                ongletActif = o.optString("ongletActif"),
                actions = o.optJSONArray("actions").objets().map {
                    ActionWeb(
                        it.optString("id"), it.optString("titre"), it.optString("symbole"),
                        it.optBoolean("principal"), it.optBoolean("destructif"), it.optBoolean("desactive"),
                    )
                },
                recherche = r?.let { Recherche(it.optString("invite", "Rechercher"), it.optString("valeur")) },
                badges = Badges(b.optInt("factures"), b.optInt("messagerie"), b.optInt("notifications")),
                contexte = Contexte(
                    campings = c.optJSONArray("campings").objets().map { Choix(it.optString("id"), it.optString("nom")) },
                    campingActif = c.optStringOuNull("campingActif"),
                    nomCamping = c.optStringOuNull("nomCamping"),
                    exercices = c.optJSONArray("exercices").objets().map { Choix(it.optString("id"), it.optString("nom")) },
                    exerciceActif = c.optStringOuNull("exerciceActif"),
                    utilisateur = Utilisateur(u.optString("nom"), u.optString("email"), u.optBoolean("admin")),
                ),
            )
        }
    }
}

/** Demande d'alerte native (askConfirm / askPrompt cote site). */
data class DialogueWeb(
    val id: String,
    val saisie: Boolean,
    val titre: String,
    val message: String,
    val ok: String,
    val danger: Boolean,
    val valeur: String,
    val invite: String,
)

/** Les ecrans dessines entierement en Compose, sans le site. */
enum class EcranNatif { MessagerieGestion, MessagerieLocataire }

/** Un onglet de la barre de navigation. La liste est propre a chaque app (Configuration.kt). */
data class Onglet(
    val id: String,
    val titre: String,
    val icone: ImageVector,
    val iconeActive: ImageVector,
    /** Groupes web affiches par l'onglet ; le premier est l'ecran par defaut. */
    val groupes: List<String>,
    val badge: (EtatWeb.Badges) -> Int = { 0 },
    val natif: EcranNatif? = null,
)

/** Un ecran de l'onglet « Plus ». */
data class EcranPlus(
    val id: String,
    val titre: String,
    val icone: ImageVector,
    val badge: (EtatWeb.Badges) -> Int = { 0 },
    val natif: EcranNatif? = null,
)

// ---- petits outils JSON ----

fun JSONArray?.objets(): List<JSONObject> =
    if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }

fun JSONObject.optStringOuNull(cle: String): String? =
    if (isNull(cle) || !has(cle)) null else optString(cle).takeIf { it.isNotEmpty() }

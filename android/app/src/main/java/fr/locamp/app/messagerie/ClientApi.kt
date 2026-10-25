package fr.locamp.app.messagerie

import fr.locamp.app.Pont
import fr.locamp.app.objets
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.time.Instant
import java.time.OffsetDateTime

/**
 * Acces direct a l'API Locamp pour les ecrans natifs.
 *
 * La session appartient au site : il la transmet par le pont (message
 * « auth ») a chaque connexion, changement de camping ou deconnexion.
 * Rien n'est ecrit sur le disque.
 */
object ClientApi {
    data class Identifiants(val base: String, val jeton: String, val camping: String?)

    @Volatile
    var identifiants: Identifiants? = null

    class HorsSession : Exception("Connexion en cours…")
    class SessionExpiree : Exception("Session expirée, reconnectez-vous.")
    class ErreurServeur(message: String) : Exception(message)

    suspend fun requete(chemin: String, methode: String = "GET", corps: JSONObject? = null): JSONObject =
        withContext(Dispatchers.IO) {
            val id = identifiants ?: throw HorsSession()
            val cnx = URI(id.base).resolve(chemin).toURL().openConnection() as HttpURLConnection
            try {
                cnx.requestMethod = methode
                cnx.connectTimeout = 15_000
                cnx.readTimeout = 30_000
                cnx.useCaches = false
                cnx.setRequestProperty("Authorization", "Bearer ${id.jeton}")
                cnx.setRequestProperty("Accept", "application/json")
                id.camping?.let { cnx.setRequestProperty("x-camping-id", it) }
                if (corps != null) {
                    cnx.doOutput = true
                    cnx.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                    cnx.outputStream.use { it.write(corps.toString().toByteArray()) }
                }
                val code = cnx.responseCode
                val texte = (if (code in 200..299) cnx.inputStream else cnx.errorStream)
                    ?.bufferedReader()?.use { it.readText() } ?: ""
                if (code == 401) {
                    withContext(Dispatchers.Main) { Pont.sessionExpiree() }
                    throw SessionExpiree()
                }
                val json = runCatching { JSONObject(texte) }.getOrElse { JSONObject() }
                if (code !in 200..299) throw ErreurServeur(json.optString("error").ifBlank { "Erreur serveur ($code)." })
                json
            } finally {
                cnx.disconnect()
            }
        }
}

// ---- Modeles ----

data class MessageFil(val id: String, val auteur: String, val corps: String, val date: Instant, val lu: Boolean) {
    companion object {
        fun lire(o: JSONObject) = MessageFil(
            id = o.optString("id"),
            auteur = o.optString("auteur"),
            corps = o.optString("corps"),
            date = lireDate(o.optString("created_at")),
            lu = o.optBoolean("lu"),
        )
    }
}

data class Conversation(
    val residentId: String,
    val residentNom: String,
    val nonLus: Int,
    val dernierAuteur: String,
    val dernierCorps: String,
    val dernierDate: Instant,
) {
    companion object {
        fun lire(o: JSONObject): Conversation {
            val d = o.optJSONObject("dernier_message") ?: JSONObject()
            return Conversation(
                residentId = o.optString("resident_id"),
                residentNom = o.optString("resident_nom", "Résident"),
                nonLus = o.optInt("non_lus"),
                dernierAuteur = d.optString("auteur"),
                dernierCorps = d.optString("corps"),
                dernierDate = lireDate(d.optString("date")),
            )
        }
    }
}

data class ResidentCourt(val id: String, val nom: String, val actif: Boolean) {
    companion object {
        fun lire(o: JSONObject) = ResidentCourt(
            id = o.optString("id"),
            nom = "${o.optString("prenom").takeIf { it != "null" } ?: ""} ${o.optString("nom")}".trim(),
            actif = o.optBoolean("actif", true),
        )
    }
}

fun lireMessages(o: JSONObject) = o.optJSONArray("messages").objets().map { MessageFil.lire(it) }
fun lireConversations(o: JSONObject) = o.optJSONArray("conversations").objets().map { Conversation.lire(it) }
fun lireResidents(o: JSONObject) = o.optJSONArray("residents").objets().map { ResidentCourt.lire(it) }

fun lireDate(s: String): Instant =
    runCatching { OffsetDateTime.parse(s).toInstant() }.getOrElse { runCatching { Instant.parse(s) }.getOrElse { Instant.now() } }

/** « Marie Dupont » -> « MD ». */
fun initiales(nom: String): String =
    nom.split(' ').filter { it.isNotBlank() }.take(2).joinToString("") { it.first().uppercase() }

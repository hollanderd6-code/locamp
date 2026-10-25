package fr.locamp.app.messagerie

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.view.HapticFeedbackConstants
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import fr.locamp.app.Pont
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import java.util.UUID
import kotlin.math.abs

/** D'ou vient un fil, et qui est « moi ». */
data class SourceFil(
    val lecture: String,
    val ecriture: String,
    val champs: Map<String, String>,
    /** Auteur des messages affiches a droite : "resident" ou "camping". */
    val moi: String,
) {
    companion object {
        val locataire = SourceFil("/api/portail/messages", "/api/portail/messages", emptyMap(), "resident")
        fun gestion(residentId: String) = SourceFil(
            "/api/messages?resident_id=${java.net.URLEncoder.encode(residentId, "UTF-8")}",
            "/api/messages", mapOf("resident_id" to residentId), "camping",
        )
    }
}

/** Une ligne du fil, avec l'etat d'envoi des messages ecrits ici. */
data class Ligne(
    val id: String, val moi: Boolean, val corps: String, val date: Instant, val lu: Boolean,
    val etat: Etat = Etat.Envoye,
) {
    enum class Etat { Envoye, EnCours, Echec }
}

class FilModele(private val source: SourceFil) {
    val lignes = mutableStateListOf<Ligne>()
    var chargement by mutableStateOf(true); private set
    var erreur by mutableStateOf<String?>(null); private set

    suspend fun charger() {
        try {
            val recus = lireMessages(ClientApi.requete(source.lecture)).map {
                Ligne(it.id, it.auteur == source.moi, it.corps, it.date, it.lu)
            }
            val connus = lignes.map { it.id }.toSet()
            val nouveauxRecus = recus.any { !it.moi && it.id !in connus }
            val envoyes = lignes.filter { it.etat == Ligne.Etat.Envoye }
            if (recus.map { it.id to it.lu } != envoyes.map { it.id to it.lu }) {
                val enAttente = lignes.filter { it.etat != Ligne.Etat.Envoye }
                lignes.clear(); lignes.addAll(recus + enAttente)
            }
            erreur = null
            // Ouvrir le fil vaut lecture : les pastilles du site suivent.
            if (chargement || nouveauxRecus) Pont.rafraichirBadges()
        } catch (e: ClientApi.HorsSession) {
            // le site n'a pas encore transmis la session : on reessaie au tour suivant
        } catch (e: Exception) {
            if (lignes.isEmpty()) erreur = e.message
        }
        chargement = false
    }

    suspend fun envoyer(texte: String) {
        val corps = texte.trim()
        if (corps.isEmpty()) return
        val provisoire = Ligne("local-${UUID.randomUUID()}", true, corps, Instant.now(), false, Ligne.Etat.EnCours)
        lignes.add(provisoire)
        expedier(provisoire)
    }

    suspend fun reessayer(l: Ligne) {
        val i = lignes.indexOfFirst { it.id == l.id }.takeIf { it >= 0 } ?: return
        lignes[i] = l.copy(etat = Ligne.Etat.EnCours)
        expedier(lignes[i])
    }

    private suspend fun expedier(l: Ligne) {
        val champs = JSONObject(source.champs).put("corps", l.corps)
        try {
            val m = MessageFil.lire(ClientApi.requete(source.ecriture, "POST", champs).optJSONObject("message") ?: JSONObject())
            val i = lignes.indexOfFirst { it.id == l.id }
            if (i >= 0) lignes[i] = Ligne(m.id.ifBlank { l.id }, true, m.corps.ifBlank { l.corps }, m.date, false)
        } catch (e: Exception) {
            val i = lignes.indexOfFirst { it.id == l.id }
            if (i >= 0) lignes[i] = lignes[i].copy(etat = Ligne.Etat.Echec)
        }
    }
}

/** Un element affiche : un separateur de jour ou un message. */
private sealed interface Element {
    val cle: String
    data class Jour(val titre: String, override val cle: String) : Element
    data class Message(val ligne: Ligne, val debut: Boolean, val fin: Boolean, val dernierDeMoi: Boolean) : Element {
        override val cle get() = ligne.id
    }
}

private val zone: ZoneId get() = ZoneId.systemDefault()
private val fr = Locale.FRANCE

private fun titreJour(j: LocalDate): String {
    val auj = LocalDate.now(zone).toEpochDay()
    return when (j.toEpochDay()) {
        auj -> "Aujourd'hui"
        auj - 1 -> "Hier"
        else -> {
            val motif = if (j.year == LocalDate.now(zone).year) "EEEE d MMMM" else "d MMMM yyyy"
            j.format(DateTimeFormatter.ofPattern(motif, fr)).replaceFirstChar { it.titlecase(fr) }
        }
    }
}

/** Deux messages du meme auteur a moins de 3 minutes forment un groupe. */
private fun memeGroupe(a: Ligne?, b: Ligne?) =
    a != null && b != null && a.moi == b.moi && abs(b.date.epochSecond - a.date.epochSecond) < 180

private fun elements(lignes: List<Ligne>): List<Element> {
    val tri = lignes.sortedBy { it.date }
    val dernierDeMoi = tri.lastOrNull { it.moi && it.etat == Ligne.Etat.Envoye }?.id
    val out = mutableListOf<Element>()
    fun jour(l: Ligne) = l.date.atZone(zone).toLocalDate().toEpochDay()
    var jourPrec: Long? = null
    tri.forEachIndexed { i, l ->
        val j = jour(l)
        if (j != jourPrec) { out += Element.Jour(titreJour(LocalDate.ofEpochDay(j)), "jour-$j"); jourPrec = j }
        val prec = tri.getOrNull(i - 1)?.takeIf { jour(it) == j }
        val suiv = tri.getOrNull(i + 1)?.takeIf { jour(it) == j }
        out += Element.Message(l, !memeGroupe(prec, l), !memeGroupe(l, suiv), l.id == dernierDeMoi)
    }
    return out
}

/** Un fil de conversation, a la maniere d'une messagerie de telephone. */
@Composable
fun FilMessages(
    source: SourceFil,
    invite: String,
    videTitre: String,
    videTexte: String,
    modifier: Modifier = Modifier,
) {
    val modele = remember(source) { FilModele(source) }
    val portee = rememberCoroutineScope()
    val liste = rememberLazyListState()
    val vue = LocalView.current
    var brouillon by remember { mutableStateOf("") }

    // Nouveaux messages toutes les 6 s, tant que l'ecran est affiche.
    LaunchedEffect(source) {
        while (isActive) {
            modele.charger()
            delay(6_000)
        }
    }
    val elems = elements(modele.lignes)
    // Le fil est affiche a l'envers (le plus recent en bas, ancre au bas).
    LaunchedEffect(modele.lignes.size) { if (elems.isNotEmpty()) liste.animateScrollToItem(0) }

    Column(modifier.fillMaxSize()) {
        Box(Modifier.weight(1f).fillMaxWidth()) {
            LazyColumn(
                state = liste,
                reverseLayout = true,
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                items(elems.asReversed(), key = { it.cle }) { e ->
                    when (e) {
                        is Element.Jour -> Text(
                            e.titre,
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.fillMaxWidth().padding(top = 18.dp, bottom = 8.dp),
                        )
                        is Element.Message -> Bulle(e, reessayer = { portee.launch { modele.reessayer(e.ligne) } })
                    }
                }
            }
            if (modele.lignes.isEmpty()) {
                when {
                    modele.chargement -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                    modele.erreur != null -> EtatVide(
                        "Messagerie indisponible", modele.erreur ?: "",
                        Modifier.align(Alignment.Center),
                    ) { OutlinedButton(onClick = { portee.launch { modele.charger() } }) { Text("Réessayer") } }
                    else -> EtatVide(videTitre, videTexte, Modifier.align(Alignment.Center))
                }
            }
        }

        // ---- Saisie ----
        Row(
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            TextField(
                value = brouillon,
                onValueChange = { brouillon = it },
                placeholder = { Text(invite) },
                maxLines = 6,
                shape = RoundedCornerShape(28.dp),
                colors = TextFieldDefaults.colors(
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent,
                    disabledIndicatorColor = Color.Transparent,
                    focusedContainerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
                    unfocusedContainerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
                ),
                modifier = Modifier.weight(1f).animateContentSize(),
            )
            FilledIconButton(
                onClick = {
                    val t = brouillon
                    brouillon = ""
                    vue.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
                    portee.launch { modele.envoyer(t) }
                },
                enabled = brouillon.isNotBlank(),
                modifier = Modifier.size(56.dp),
            ) { Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Envoyer") }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun Bulle(e: Element.Message, reessayer: () -> Unit) {
    val l = e.ligne
    val ctx = LocalContext.current
    val grand = 20.dp
    val petit = 6.dp
    val forme = if (l.moi) RoundedCornerShape(
        topStart = grand, bottomStart = grand,
        topEnd = if (e.debut) grand else petit, bottomEnd = if (e.fin) grand else petit,
    ) else RoundedCornerShape(
        topStart = if (e.debut) grand else petit, bottomStart = if (e.fin) grand else petit,
        topEnd = grand, bottomEnd = grand,
    )
    val cs = MaterialTheme.colorScheme
    Column(
        horizontalAlignment = if (l.moi) Alignment.End else Alignment.Start,
        modifier = Modifier.fillMaxWidth().padding(top = if (e.debut) 8.dp else 2.dp),
    ) {
        Row(verticalAlignment = Alignment.Bottom) {
            if (l.etat == Ligne.Etat.Echec) {
                Icon(
                    Icons.Filled.ErrorOutline, contentDescription = "Échec de l'envoi, réessayer",
                    tint = cs.error,
                    modifier = Modifier.padding(end = 6.dp).size(24.dp).combinedClickable(onClick = reessayer),
                )
            }
            Surface(
                shape = forme,
                color = if (l.moi) cs.primary else cs.surfaceContainerHighest,
                contentColor = if (l.moi) cs.onPrimary else cs.onSurface,
                modifier = Modifier
                    .widthIn(max = 300.dp)   // laisse toujours une marge du cote oppose
                    .combinedClickable(
                        onClick = { if (l.etat == Ligne.Etat.Echec) reessayer() },
                        onLongClick = {
                            val cb = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                            cb.setPrimaryClip(ClipData.newPlainText("message", l.corps))
                        },
                    ),
            ) {
                Text(
                    l.corps,
                    style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 9.dp),
                )
            }
        }
        if (e.fin) {
            val heure = l.date.atZone(zone).toLocalTime()
                .format(DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(fr))
            val pied = when (l.etat) {
                Ligne.Etat.EnCours -> "Envoi…"
                Ligne.Etat.Echec -> "Non envoyé · toucher pour réessayer"
                Ligne.Etat.Envoye -> if (l.moi && e.dernierDeMoi) (if (l.lu) "Lu · $heure" else "Distribué · $heure") else heure
            }
            Text(
                pied,
                style = MaterialTheme.typography.labelSmall,
                color = if (l.etat == Ligne.Etat.Echec) cs.error else cs.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 6.dp, vertical = 3.dp),
            )
        }
    }
}

@Composable
fun EtatVide(titre: String, texte: String, modifier: Modifier = Modifier, action: (@Composable () -> Unit)? = null) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = modifier.padding(32.dp),
    ) {
        Surface(shape = RoundedCornerShape(50), color = MaterialTheme.colorScheme.primaryContainer, modifier = Modifier.size(64.dp)) {
            Box(contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.Forum, contentDescription = null, tint = MaterialTheme.colorScheme.onPrimaryContainer)
            }
        }
        Text(titre, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
        if (texte.isNotBlank()) {
            Text(texte, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center)
        }
        action?.invoke()
    }
}

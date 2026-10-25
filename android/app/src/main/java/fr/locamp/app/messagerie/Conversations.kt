package fr.locamp.app.messagerie

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Badge
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import fr.locamp.app.Pont
import fr.locamp.app.ui.MenuCompte
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import android.text.format.DateUtils
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.ui.input.pointer.pointerInput
import kotlin.math.abs

/** Conversation ouverte cote gestion : un resident. */
data class ConversationOuverte(val residentId: String, val nom: String)

// =====================================================================
// Gestion : boite de reception
// =====================================================================

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MessagerieGestion(retourPlus: () -> Unit) {
    var ouverte by remember { mutableStateOf<ConversationOuverte?>(null) }
    val o = ouverte
    if (o != null) {
        BackHandler { ouverte = null }
        ConversationGestion(o, retour = { ouverte = null })
        return
    }
    BackHandler { retourPlus() }

    val conversations = remember { mutableStateListOf<Conversation>() }
    var chargement by remember { mutableStateOf(true) }
    var actualisation by remember { mutableStateOf(false) }
    var erreur by remember { mutableStateOf<String?>(null) }
    var recherche by remember { mutableStateOf("") }
    var enRecherche by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    var choix by remember { mutableStateOf(false) }
    var aTous by remember { mutableStateOf(false) }
    val portee = rememberCoroutineScope()

    suspend fun charger() {
        try {
            val r = lireConversations(ClientApi.requete("/api/messages/conversations"))
            if (r != conversations.toList()) { conversations.clear(); conversations.addAll(r) }
            erreur = null
        } catch (e: ClientApi.HorsSession) {
        } catch (e: Exception) {
            if (conversations.isEmpty()) erreur = e.message
        }
        chargement = false
    }
    LaunchedEffect(Unit) { while (isActive) { charger(); delay(15_000) } }

    val q = recherche.trim()
    val filtrees = if (q.isEmpty()) conversations.toList() else conversations.filter {
        it.residentNom.contains(q, ignoreCase = true) || it.dernierCorps.contains(q, ignoreCase = true)
    }

    Scaffold(
        contentWindowInsets = WindowInsets(0),
        topBar = {
            TopAppBar(
                title = {
                    if (enRecherche) {
                        OutlinedTextField(
                            value = recherche, onValueChange = { recherche = it },
                            placeholder = { Text("Résident ou message") }, singleLine = true,
                            modifier = Modifier.fillMaxWidth().padding(end = 8.dp),
                        )
                    } else Text("Messagerie")
                },
                navigationIcon = {
                    IconButton(onClick = retourPlus) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Retour") }
                },
                actions = {
                    IconButton(onClick = { enRecherche = !enRecherche; if (!enRecherche) recherche = "" }) {
                        Icon(if (enRecherche) Icons.Filled.Close else Icons.Filled.Search, "Rechercher")
                    }
                    Box {
                        IconButton(onClick = { menu = true }) { Icon(Icons.Filled.Edit, "Nouveau message") }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(text = { Text("Message à un résident") },
                                leadingIcon = { Icon(Icons.Filled.Person, null) },
                                onClick = { menu = false; choix = true })
                            DropdownMenuItem(text = { Text("Message à tous les résidents") },
                                leadingIcon = { Icon(Icons.Filled.Groups, null) },
                                onClick = { menu = false; aTous = true })
                        }
                    }
                },
            )
        },
    ) { marges ->
        PullToRefreshBox(
            isRefreshing = actualisation,
            onRefresh = { portee.launch { actualisation = true; charger(); actualisation = false } },
            modifier = Modifier.padding(marges).fillMaxSize(),
        ) {
            LazyColumn(Modifier.fillMaxSize()) {
                items(filtrees, key = { it.residentId }) { c ->
                    LigneConversation(c) { ouverte = ConversationOuverte(c.residentId, c.residentNom) }
                    HorizontalDivider(Modifier.padding(start = 76.dp))
                }
            }
            if (filtrees.isEmpty()) {
                when {
                    chargement -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                    erreur != null -> EtatVide("Messagerie indisponible", erreur ?: "", Modifier.align(Alignment.Center))
                    q.isNotEmpty() -> EtatVide("Aucun résultat", "Rien ne correspond à « $q ».", Modifier.align(Alignment.Center))
                    else -> EtatVide("Aucune conversation", "Les échanges avec vos résidents apparaîtront ici.",
                        Modifier.align(Alignment.Center))
                }
            }
        }
    }

    if (choix) ChoixResident(fermer = { choix = false }) { r ->
        choix = false
        ouverte = ConversationOuverte(r.id, r.nom)
    }
    if (aTous) MessageATous(fermer = { aTous = false })
}

@Composable
private fun LigneConversation(c: Conversation, ouvrir: () -> Unit) {
    val nonLu = c.nonLus > 0
    val cs = MaterialTheme.colorScheme
    ListItem(
        modifier = Modifier.clickable(onClick = ouvrir),
        colors = ListItemDefaults.colors(containerColor = cs.surface),
        leadingContent = { Avatar(c.residentNom, 48) },
        headlineContent = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(c.residentNom, fontWeight = if (nonLu) FontWeight.Bold else FontWeight.SemiBold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Text(
                    DateUtils.getRelativeTimeSpanString(c.dernierDate.toEpochMilli()).toString(),
                    style = MaterialTheme.typography.labelSmall,
                    color = if (nonLu) cs.primary else cs.onSurfaceVariant,
                )
            }
        },
        supportingContent = {
            Row(verticalAlignment = Alignment.Top) {
                Text(
                    (if (c.dernierAuteur == "camping") "Vous : " else "") + c.dernierCorps,
                    maxLines = 2, overflow = TextOverflow.Ellipsis,
                    color = if (nonLu) cs.onSurface else cs.onSurfaceVariant,
                    modifier = Modifier.weight(1f),
                )
                if (nonLu) Badge(containerColor = cs.primary, modifier = Modifier.padding(start = 8.dp)) { Text("${c.nonLus}") }
            }
        },
    )
}

@Composable
fun Avatar(nom: String, taille: Int) {
    Surface(shape = CircleShape, color = MaterialTheme.colorScheme.primaryContainer, modifier = Modifier.size(taille.dp)) {
        Box(contentAlignment = Alignment.Center) {
            Text(initiales(nom), color = MaterialTheme.colorScheme.onPrimaryContainer,
                style = if (taille >= 44) MaterialTheme.typography.titleMedium else MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.SemiBold)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ConversationGestion(c: ConversationOuverte, retour: () -> Unit) {
    val prenom = c.nom.split(' ').firstOrNull { it.isNotBlank() } ?: c.nom
    Scaffold(
        contentWindowInsets = WindowInsets(0),
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Avatar(c.nom, 36)
                        Text(c.nom, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                },
                navigationIcon = { IconButton(onClick = retour) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Retour") } },
                actions = {
                    IconButton(onClick = { Pont.naviguer("residents/${c.residentId}") }) {
                        Icon(Icons.Outlined.AccountCircle, "Fiche du résident")
                    }
                },
            )
        },
    ) { marges ->
        FilMessages(
            source = SourceFil.gestion(c.residentId),
            invite = "Message à $prenom",
            videTitre = "Nouvelle conversation",
            videTexte = "Le résident recevra votre message dans son espace et par e-mail.",
            modifier = Modifier.padding(marges),
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ChoixResident(fermer: () -> Unit, choisir: (ResidentCourt) -> Unit) {
    val etat = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val residents = remember { mutableStateListOf<ResidentCourt>() }
    var chargement by remember { mutableStateOf(true) }
    var recherche by remember { mutableStateOf("") }
    LaunchedEffect(Unit) {
        runCatching { lireResidents(ClientApi.requete("/api/residents")) }.getOrNull()?.let {
            residents.clear(); residents.addAll(it.filter { r -> r.actif })
        }
        chargement = false
    }
    val q = recherche.trim()
    val filtres = if (q.isEmpty()) residents.toList() else residents.filter { it.nom.contains(q, ignoreCase = true) }

    ModalBottomSheet(onDismissRequest = fermer, sheetState = etat) {
        Column(Modifier.fillMaxWidth().heightIn(min = 400.dp)) {
            Text("Nouveau message", style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp))
            OutlinedTextField(
                value = recherche, onValueChange = { recherche = it },
                placeholder = { Text("Rechercher un résident") }, singleLine = true,
                leadingIcon = { Icon(Icons.Filled.Search, null) },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            )
            if (chargement) CircularProgressIndicator(Modifier.padding(32.dp).align(Alignment.CenterHorizontally))
            LazyColumn {
                items(filtres, key = { it.id }) { r ->
                    ListItem(
                        modifier = Modifier.clickable { choisir(r) },
                        leadingContent = { Avatar(r.nom, 40) },
                        headlineContent = { Text(r.nom) },
                    )
                }
            }
        }
    }
}

@Composable
private fun MessageATous(fermer: () -> Unit) {
    var texte by remember { mutableStateOf("") }
    var envoi by remember { mutableStateOf(false) }
    var erreur by remember { mutableStateOf<String?>(null) }
    val portee = rememberCoroutineScope()
    AlertDialog(
        onDismissRequest = { if (!envoi) fermer() },
        icon = { Icon(Icons.Filled.Groups, null) },
        title = { Text("Message à tous les résidents") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Envoyé à tous les résidents actifs : dans leur espace, par notification et par e-mail.",
                    style = MaterialTheme.typography.bodyMedium)
                OutlinedTextField(value = texte, onValueChange = { texte = it }, minLines = 4, maxLines = 10,
                    placeholder = { Text("Votre message") }, modifier = Modifier.fillMaxWidth())
                erreur?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            TextButton(
                enabled = texte.isNotBlank() && !envoi,
                onClick = {
                    envoi = true
                    portee.launch {
                        try {
                            val r = ClientApi.requete("/api/messages/groupe", "POST", JSONObject().put("corps", texte))
                            val n = r.optInt("destinataires")
                            Pont.afficherToast("Message envoyé à $n résident${if (n > 1) "s" else ""}")
                            fermer()
                        } catch (e: Exception) {
                            erreur = e.message
                        } finally { envoi = false }
                    }
                },
            ) { Text("Envoyer") }
        },
        dismissButton = { TextButton(onClick = fermer, enabled = !envoi) { Text("Annuler") } },
    )
}

// =====================================================================
// Locataire : le fil avec le camping
// =====================================================================

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MessagerieLocataire() {
    val etat = Pont.etat
    // Comme sur les autres onglets : balayer change d'onglet.
    var cumul by remember { mutableStateOf(0f) }
    Scaffold(
        contentWindowInsets = WindowInsets(0),
        modifier = Modifier.pointerInput(Unit) {
            detectHorizontalDragGestures(
                onDragStart = { cumul = 0f },
                onDragEnd = { if (abs(cumul) > 70.dp.toPx()) Pont.ongletVoisin(if (cumul < 0) 1 else -1) },
                onHorizontalDrag = { _, d -> cumul += d },
            )
        },
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(etat?.contexte?.nomCamping ?: "Messages", maxLines = 1, overflow = TextOverflow.Ellipsis)
                        if (etat?.contexte?.nomCamping != null) {
                            Text("Messages", style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                },
                navigationIcon = { if (etat != null) MenuCompte(etat) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface),
            )
        },
    ) { marges ->
        FilMessages(
            source = SourceFil.locataire,
            invite = "Écrire au camping",
            videTitre = "Écrivez à votre camping",
            videTexte = "Une question, une demande, un souci sur votre emplacement ? Le camping vous répond ici.",
            modifier = Modifier.padding(marges),
        )
    }
}

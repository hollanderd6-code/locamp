package fr.locamp.app.ui

import android.app.Activity
import android.content.Context
import android.print.PrintManager
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Draw
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Euro
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.NotificationsActive
import androidx.compose.material.icons.filled.PostAdd
import androidx.compose.material.icons.filled.Print
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SecondaryScrollableTabRow
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import fr.locamp.app.Configuration
import fr.locamp.app.EcranNatif
import fr.locamp.app.EtatWeb
import fr.locamp.app.Pont
import fr.locamp.app.messagerie.MessagerieGestion
import fr.locamp.app.messagerie.MessagerieLocataire

/**
 * Racine de l'app. Une seule structure, toujours la meme : le WebView reste
 * a sa place dans l'arbre (aucun rechargement), les barres natives
 * apparaissent autour de lui une fois connecte, et les ecrans natifs
 * (messagerie, « Plus ») se posent par-dessus.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun Racine(webView: WebView) {
    val activite = LocalContext.current as Activity
    val etat = Pont.etat
    val connecte = Pont.connecte
    val clavier = WindowInsets.isImeVisible

    // Ecran affiche : site, ecran natif, ou racine de « Plus ».
    val plusRacine = connecte && Pont.onglet == Pont.PLUS && Pont.ecranPlus == null
    val natif: EcranNatif? = if (!connecte) null else if (Pont.onglet == Pont.PLUS)
        Configuration.ecransPlus.firstOrNull { it.id == Pont.ecranPlus }?.natif
    else Configuration.onglets.firstOrNull { it.id == Pont.onglet }?.natif
    val ecranWeb = natif == null && !plusRacine

    val barres = connecte && !Pont.superposition
    val barreHaut = barres && ecranWeb && etat != null
    val barreBas = barres && !clavier

    // Touche Retour : du plus precis au plus general. Les ecrans natifs
    // (conversation…) declarent les leurs ensuite, et passent donc avant.
    BackHandler {
        when {
            !connecte -> if (webView.canGoBack()) webView.goBack() else activite.moveTaskToBack(true)
            Pont.superposition -> Pont.fermerSuperposition()
            etat?.retour == true && ecranWeb -> Pont.retour()
            Pont.onglet == Pont.PLUS && Pont.ecranPlus != null -> Pont.ouvrirPlus(null)
            Pont.onglet != Configuration.onglets.first().id -> {
                Pont.onglet = Configuration.onglets.first().id
                Pont.ongletChoisi(Pont.onglet)
            }
            else -> activite.moveTaskToBack(true)
        }
    }

    val snacks = remember { SnackbarHostState() }
    var snackErreur by remember { mutableStateOf(false) }
    LaunchedEffect(Pont.toast) {
        val t = Pont.toast ?: return@LaunchedEffect
        snackErreur = t.erreur
        snacks.currentSnackbarData?.dismiss()
        snacks.showSnackbar(t.message, withDismissAction = t.erreur)
    }

    Scaffold(
        contentWindowInsets = WindowInsets(0),
        topBar = {
            AnimatedVisibility(barreHaut, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
                if (etat != null) BarreHaut(etat)
            }
        },
        bottomBar = {
            AnimatedVisibility(barreBas, enter = expandVertically(), exit = shrinkVertically()) { BarreOnglets() }
        },
        floatingActionButton = {
            val p = etat?.actionPrincipale
            if (barreHaut && p != null) {
                ExtendedFloatingActionButton(
                    onClick = { Pont.action(p) },
                    icon = { Icon(iconePour(p.symbole), null) },
                    text = { Text(p.titre, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                )
            }
        },
        snackbarHost = {
            SnackbarHost(snacks) { d ->
                Snackbar(
                    d,
                    containerColor = if (snackErreur) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.inverseSurface,
                    contentColor = if (snackErreur) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.inverseOnSurface,
                )
            }
        },
    ) { marges ->
        var cadre = Modifier.fillMaxSize().padding(marges).background(Ivoire)
        // Sans barre native, le site doit lui-meme eviter la barre d'etat et
        // la barre de navigation du systeme (et le clavier).
        if (!barreHaut && ecranWeb) cadre = cadre.statusBarsPadding()
        if (!barreBas) cadre = cadre.navigationBarsPadding().imePadding()
        Box(cadre) {
            HoteWeb(webView, actualisable = connecte && !Pont.superposition)
            if (connecte && (plusRacine || natif != null)) {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
                    when {
                        plusRacine -> EcranPlusRacine()
                        natif == EcranNatif.MessagerieGestion -> MessagerieGestion(retourPlus = { Pont.ouvrirPlus(null) })
                        natif == EcranNatif.MessagerieLocataire -> MessagerieLocataire()
                    }
                }
            }
            if (!connecte && Pont.chargement) CircularProgressIndicator(Modifier.align(Alignment.Center))
        }
    }

    Pont.dialogue?.let { DialogueNatif(it) }
    Pont.fenetre?.let { FenetreWeb(it) }
}

// =====================================================================
// Barre du haut
// =====================================================================

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun BarreHaut(etat: EtatWeb) {
    var recherche by remember(etat.ecran) { mutableStateOf<String?>(null) }
    var menu by remember { mutableStateOf(false) }
    Column {
        TopAppBar(
            colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface),
            title = {
                val r = recherche
                if (r != null && etat.recherche != null) {
                    TextField(
                        value = r,
                        onValueChange = { recherche = it; Pont.rechercher(it) },
                        placeholder = { Text(etat.recherche.invite, maxLines = 1) },
                        singleLine = true,
                        colors = TextFieldDefaults.colors(
                            focusedContainerColor = Color.Transparent, unfocusedContainerColor = Color.Transparent,
                            focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent,
                        ),
                        modifier = Modifier.fillMaxWidth(),
                    )
                } else {
                    Text(etat.titre, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            },
            navigationIcon = {
                when {
                    etat.retour -> IconButton(onClick = { Pont.retour() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Retour") }
                    Pont.onglet == Pont.PLUS -> IconButton(onClick = { Pont.ouvrirPlus(null) }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "Retour")
                    }
                    else -> MenuCompte(etat)
                }
            },
            actions = {
                if (etat.recherche != null) {
                    IconButton(onClick = {
                        if (recherche == null) recherche = etat.recherche.valeur
                        else { recherche = null; Pont.rechercher("") }
                    }) { Icon(if (recherche == null) Icons.Filled.Search else Icons.Filled.Close, "Rechercher") }
                }
                if (Configuration.CLOCHE) {
                    IconButton(onClick = { Pont.ouvrirNotifications() }) {
                        val n = etat.badges.notifications
                        BadgedBox(badge = { if (n > 0) Badge { Text(if (n > 99) "99+" else "$n") } }) {
                            Icon(if (n > 0) Icons.Filled.NotificationsActive else Icons.Outlined.Notifications, "Notifications")
                        }
                    }
                }
                if (etat.actionsSecondaires.isNotEmpty()) {
                    Box {
                        IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, "Actions") }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            etat.actionsSecondaires.forEach { a ->
                                DropdownMenuItem(
                                    text = { Text(a.titre, color = if (a.destructif) MaterialTheme.colorScheme.error else Color.Unspecified) },
                                    leadingIcon = { Icon(iconePour(a.symbole), null) },
                                    enabled = !a.desactive,
                                    onClick = { menu = false; Pont.action(a) },
                                )
                            }
                        }
                    }
                }
            },
        )
        // Ecrans regroupes : Plan / Emplacements, Factures / Reglements / Impayes…
        if (etat.onglets.size > 1) {
            val i = etat.onglets.indexOfFirst { it.id == etat.ongletActif }.coerceAtLeast(0)
            SecondaryScrollableTabRow(
                selectedTabIndex = i,
                containerColor = MaterialTheme.colorScheme.surface,
                edgePadding = 8.dp,
            ) {
                etat.onglets.forEachIndexed { j, o ->
                    Tab(
                        selected = j == i,
                        onClick = { Pont.sousOngletChoisi(o.id) },
                        text = {
                            if (o.badge > 0) BadgedBox(badge = { Badge { Text("${o.badge}") } }) { Text(o.titre) }
                            else Text(o.titre)
                        },
                    )
                }
            }
        }
    }
}

// =====================================================================
// Barre d'onglets
// =====================================================================

@Composable
private fun BarreOnglets() {
    val badges = Pont.etat?.badges
    NavigationBar(containerColor = MaterialTheme.colorScheme.surfaceContainer) {
        Configuration.onglets.forEach { o ->
            val actif = Pont.onglet == o.id
            val n = badges?.let(o.badge) ?: 0
            NavigationBarItem(
                selected = actif,
                onClick = { choisir(o.id) },
                icon = {
                    BadgedBox(badge = { if (n > 0) Badge { Text(if (n > 99) "99+" else "$n") } }) {
                        Icon(if (actif) o.iconeActive else o.icone, null)
                    }
                },
                label = { Text(o.titre, maxLines = 1) },
            )
        }
        if (Configuration.ecransPlus.isNotEmpty()) {
            val actif = Pont.onglet == Pont.PLUS
            val n = badges?.let { b -> Configuration.ecransPlus.sumOf { it.badge(b) } } ?: 0
            NavigationBarItem(
                selected = actif,
                onClick = { if (actif) Pont.ouvrirPlus(null) else choisir(Pont.PLUS) },
                icon = {
                    BadgedBox(badge = { if (n > 0) Badge { Text("$n") } }) {
                        Icon(if (actif) Icons.Filled.MoreHoriz else Icons.Outlined.MoreHoriz, null)
                    }
                },
                label = { Text("Plus") },
            )
        }
    }
}

private fun choisir(id: String) {
    if (Pont.onglet == id) return
    Pont.onglet = id
    Pont.ongletChoisi(id)
}

/** Les icones demandees par le site (noms SF Symbols) en icones Material. */
fun iconePour(symbole: String): ImageVector = when (symbole) {
    "plus" -> Icons.Filled.Add
    "eurosign.circle" -> Icons.Filled.Euro
    "bubble.left.and.bubble.right" -> Icons.AutoMirrored.Filled.Chat
    "square.and.arrow.down" -> Icons.Filled.Download
    "printer" -> Icons.Filled.Print
    "doc.badge.plus" -> Icons.Filled.PostAdd
    "paperplane" -> Icons.AutoMirrored.Filled.Send
    "bell.badge" -> Icons.Filled.NotificationsActive
    "pencil" -> Icons.Filled.Edit
    "signature" -> Icons.Filled.Draw
    "trash" -> Icons.Filled.Delete
    else -> Icons.Filled.Bolt
}

// =====================================================================
// Le WebView, avec « tirer pour rafraichir »
// =====================================================================

@Composable
private fun HoteWeb(webView: WebView, actualisable: Boolean) {
    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { ctx ->
            SwipeRefreshLayout(ctx).apply {
                (webView.parent as? ViewGroup)?.removeView(webView)
                addView(webView, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
                setColorSchemeColors(Sapin.toArgb())
                // Le geste ne se declenche qu'en haut de la page.
                setOnChildScrollUpCallback { _, _ -> webView.scrollY > 0 }
                setOnRefreshListener {
                    Pont.recharger()
                    postDelayed({ isRefreshing = false }, 800)
                }
            }
        },
        update = { it.isEnabled = actualisable },
    )
}

// =====================================================================
// Alertes natives (askConfirm / askPrompt)
// =====================================================================

@Composable
private fun DialogueNatif(d: fr.locamp.app.DialogueWeb) {
    var saisie by remember(d.id) { mutableStateOf(d.valeur) }
    AlertDialog(
        onDismissRequest = { Pont.repondre(d, null) },
        title = { Text(d.titre.ifBlank { d.message }) },
        text = {
            Column {
                if (d.titre.isNotBlank() && d.message.isNotBlank()) Text(d.message)
                if (d.saisie) {
                    OutlinedTextField(
                        value = saisie, onValueChange = { saisie = it },
                        placeholder = { Text(d.invite) }, singleLine = true,
                        modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                    )
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { Pont.repondre(d, if (d.saisie) saisie else true) },
                colors = if (d.danger) ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)
                else ButtonDefaults.textButtonColors(),
            ) { Text(d.ok) }
        },
        dismissButton = { TextButton(onClick = { Pont.repondre(d, null) }) { Text("Annuler") } },
    )
}

// =====================================================================
// Fenetre ouverte par le site (feuille de tournee a imprimer…)
// =====================================================================

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FenetreWeb(popup: WebView) {
    val ctx = LocalContext.current
    Dialog(
        onDismissRequest = { Pont.fermerFenetre() },
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = { Text(popup.title ?: "", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    navigationIcon = { IconButton(onClick = { Pont.fermerFenetre() }) { Icon(Icons.Filled.Close, "Fermer") } },
                    actions = {
                        IconButton(onClick = {
                            val pm = ctx.getSystemService(Context.PRINT_SERVICE) as PrintManager
                            pm.print("Locamp", popup.createPrintDocumentAdapter("Locamp"), null)
                        }) { Icon(Icons.Filled.Print, "Imprimer") }
                    },
                )
            },
        ) { marges ->
            AndroidView(
                modifier = Modifier.padding(marges).fillMaxSize(),
                factory = { (popup.parent as? ViewGroup)?.removeView(popup); popup },
            )
        }
    }
}

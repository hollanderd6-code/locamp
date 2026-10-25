package fr.locamp.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.outlined.Cabin
import androidx.compose.material3.Badge
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LargeTopAppBar
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import fr.locamp.app.Configuration
import fr.locamp.app.EtatWeb
import fr.locamp.app.Pont
import fr.locamp.app.messagerie.Avatar

/** Le bouton du compte (initiales), en haut a gauche ; il ouvre la feuille du compte. */
@Composable
fun MenuCompte(etat: EtatWeb) {
    var ouverte by remember { mutableStateOf(false) }
    val nom = etat.contexte.utilisateur.nom
    IconButton(onClick = { ouverte = true }) { Avatar(nom.ifBlank { "?" }, 32) }
    if (ouverte) FeuilleCompte(etat) { ouverte = false }
}

/** Compte : camping actif, exercice, notifications, deconnexion. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FeuilleCompte(etat: EtatWeb, fermer: () -> Unit) {
    val ctx = etat.contexte
    val u = ctx.utilisateur
    ModalBottomSheet(onDismissRequest = fermer) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).navigationBarsPadding().padding(bottom = 16.dp)) {
            ListItem(
                leadingContent = { Avatar(u.nom.ifBlank { "?" }, 48) },
                headlineContent = { Text(u.nom.ifBlank { "Mon compte" }, fontWeight = FontWeight.SemiBold) },
                supportingContent = {
                    Text(
                        listOfNotNull(
                            if (Configuration.ESPACES_CAMPING) (if (u.admin) "Administrateur" else "Gestionnaire") else null,
                            ctx.nomCamping,
                        ).joinToString(" · ").ifBlank { u.email },
                    )
                },
                colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
            )

            if (ctx.campings.size > 1 || Configuration.ESPACES_CAMPING && ctx.campings.isNotEmpty()) {
                Titre("Camping")
                ctx.campings.forEach { c ->
                    ListItem(
                        modifier = Modifier.clickable { fermer(); Pont.changerCamping(c.id) },
                        leadingContent = { Icon(Icons.Outlined.Cabin, null) },
                        headlineContent = { Text(c.nom) },
                        trailingContent = { if (c.id == ctx.campingActif) Icon(Icons.Filled.Check, "Actif", tint = MaterialTheme.colorScheme.primary) },
                        colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
                    )
                }
                if (Configuration.ESPACES_CAMPING) {
                    ListItem(
                        modifier = Modifier.clickable { fermer(); Pont.changerCamping("__new__") },
                        leadingContent = { Icon(Icons.Filled.Add, null) },
                        headlineContent = { Text("Nouvel espace camping") },
                        colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
                    )
                }
            }

            if (ctx.exercices.isNotEmpty()) {
                Titre("Exercice")
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp),
                ) {
                    ctx.exercices.forEach { x ->
                        FilterChip(
                            selected = x.id == ctx.exerciceActif,
                            onClick = { Pont.changerExercice(x.id) },
                            label = { Text(x.nom.removePrefix("Exercice ")) },
                        )
                    }
                }
            }

            HorizontalDivider(Modifier.padding(vertical = 12.dp))
            if (Configuration.CLOCHE) {
                ListItem(
                    modifier = Modifier.clickable { fermer(); Pont.ouvrirNotifications() },
                    leadingContent = { Icon(Icons.Filled.Notifications, null) },
                    headlineContent = { Text("Notifications") },
                    trailingContent = { if (etat.badges.notifications > 0) Badge { Text("${etat.badges.notifications}") } },
                    colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
                )
            }
            ListItem(
                modifier = Modifier.clickable { fermer(); Pont.deconnexion() },
                leadingContent = { Icon(Icons.AutoMirrored.Filled.Logout, null, tint = MaterialTheme.colorScheme.error) },
                headlineContent = { Text("Se déconnecter", color = MaterialTheme.colorScheme.error) },
                colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
            )
        }
    }
}

@Composable
private fun Titre(texte: String) {
    Text(
        texte,
        style = MaterialTheme.typography.labelLarge,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(start = 24.dp, end = 24.dp, top = 16.dp, bottom = 6.dp),
    )
}

/** L'onglet « Plus » de la gestion : les ecrans moins frequents et le compte. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EcranPlusRacine() {
    val etat = Pont.etat
    var compte by remember { mutableStateOf(false) }
    val defilement = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    Scaffold(
        contentWindowInsets = WindowInsets(0),
        modifier = Modifier.nestedScroll(defilement.nestedScrollConnection),
        topBar = { LargeTopAppBar(title = { Text("Plus") }, scrollBehavior = defilement) },
    ) { marges ->
        LazyColumn(Modifier.padding(marges).fillMaxSize()) {
            items(Configuration.ecransPlus, key = { it.id }) { e ->
                val n = etat?.let { e.badge(it.badges) } ?: 0
                ListItem(
                    modifier = Modifier.clickable { Pont.ouvrirPlus(e.id) },
                    leadingContent = { Icon(e.icone, null, tint = MaterialTheme.colorScheme.primary) },
                    headlineContent = { Text(e.titre) },
                    trailingContent = {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (n > 0) Badge { Text("$n") }
                            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null)
                        }
                    },
                )
            }
            if (etat != null) {
                item { HorizontalDivider(Modifier.padding(vertical = 8.dp)) }
                item {
                    ListItem(
                        modifier = Modifier.clickable { compte = true },
                        leadingContent = { Avatar(etat.contexte.utilisateur.nom.ifBlank { "?" }, 40) },
                        headlineContent = { Text(etat.contexte.utilisateur.nom.ifBlank { "Mon compte" }) },
                        supportingContent = { Text(listOfNotNull(etat.contexte.nomCamping, "Camping, exercice, déconnexion").joinToString(" · ")) },
                        trailingContent = { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null) },
                    )
                }
            }
        }
    }
    if (compte && etat != null) FeuilleCompte(etat) { compte = false }
}

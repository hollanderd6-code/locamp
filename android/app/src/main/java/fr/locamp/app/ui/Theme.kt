package fr.locamp.app.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/*
 * Material 3 aux couleurs de Locamp : vert sapin, ivoire, laiton.
 * Toutes les surfaces sont definies : les valeurs par defaut de Material 3
 * tirent vers le violet, et se verraient sur chaque barre et chaque carte.
 * Le site n'ayant pas de theme sombre, l'app reste en clair.
 */
val Sapin = Color(0xFF1E5A46)
val SapinNuit = Color(0xFF0D3B2E)
val Ivoire = Color(0xFFF5F6F4)
val Laiton = Color(0xFFB8924A)

private val Couleurs = lightColorScheme(
    primary = Sapin,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFCDE8DB),
    onPrimaryContainer = SapinNuit,
    secondary = Color(0xFF4D6358),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFD3E8DC),
    onSecondaryContainer = Color(0xFF0B2018),
    tertiary = Laiton,
    onTertiary = Color.White,
    tertiaryContainer = Color(0xFFF3E2C2),
    onTertiaryContainer = Color(0xFF3A2A06),
    error = Color(0xFFB3261E),
    onError = Color.White,
    errorContainer = Color(0xFFF9DEDC),
    onErrorContainer = Color(0xFF410E0B),
    background = Ivoire,
    onBackground = Color(0xFF171D1A),
    surface = Color(0xFFF8F9F6),
    onSurface = Color(0xFF171D1A),
    surfaceVariant = Color(0xFFDCE5DE),
    onSurfaceVariant = Color(0xFF404944),
    surfaceTint = Sapin,
    inverseSurface = Color(0xFF2C322F),
    inverseOnSurface = Color(0xFFEDF2EE),
    inversePrimary = Color(0xFF9CD3BC),
    outline = Color(0xFF707973),
    outlineVariant = Color(0xFFC0C9C2),
    scrim = Color.Black,
    surfaceBright = Color(0xFFF8F9F6),
    surfaceDim = Color(0xFFD7DBD7),
    surfaceContainerLowest = Color.White,
    surfaceContainerLow = Color(0xFFF2F4F1),
    surfaceContainer = Color(0xFFECEFEB),
    surfaceContainerHigh = Color(0xFFE6E9E5),
    surfaceContainerHighest = Color(0xFFE0E4DF),
)

@Composable
fun ThemeLocamp(contenu: @Composable () -> Unit) {
    MaterialTheme(colorScheme = Couleurs, content = contenu)
}

# Apps Android natives — Locamp (Kotlin, Jetpack Compose, Material 3)

Un seul projet Android, **deux apps** (variantes Gradle) :

| Variante | Identifiant | Site affiché | Nom sur l'écran d'accueil |
|---|---|---|---|
| `gestion` | `locamp.onrender.com` | `/` (logiciel du camping) | Locamp Gestion |
| `locataire` | `fr.locamp.portail` | `/portail/` (espace locataire) | Mon camping |

L'app Gestion reprend l'identifiant de l'app actuelle du Play Store (la TWA
du dossier `app/` à la racine) : publiée avec la même clé d'importation, elle
la **remplace par une simple mise à jour** (versionCode 100 et plus).

C'est le pendant Android des apps iOS (`ios/Locamp`) : même pont avec le
site, mêmes écrans natifs, en Material 3 au lieu de Liquid Glass.

- **Natif (Compose, Material 3)** : barre d'onglets avec pastilles, barre du
  haut (titre, retour, recherche, cloche, menu ⋮), bouton d'action flottant
  pour l'action principale de l'écran, sous-onglets, feuille du compte
  (camping, exercice, déconnexion), alertes, messages en bas d'écran,
  tirer pour rafraîchir, touche Retour, partage des fichiers exportés,
  choix de fichiers pour les envois, impression, notifications push.
- **Messagerie 100 % native** : boîte de réception de la gestion (recherche,
  non-lus, nouveau message, message à tous) et fil de conversation
  (jours, bulles groupées, « Lu », reprise en cas d'échec).
- **Le reste** : le site, dans un WebView, sans son propre habillage.

## Organisation

```
android/
  app/src/main/        code commun : Pont.kt, ui/, messagerie/, push/
  app/src/gestion/     Configuration.kt, nom, icône de la gestion
  app/src/locataire/   Configuration.kt, nom, icône du locataire
```

Ce qui diffère d'une app à l'autre (onglets, cloche, camping, paiement
masqué, écran ouvert par une notification) est dans `Configuration.kt`.

## Ouvrir et lancer

1. Android Studio (récent) → *Open* → le dossier `android/`.
2. Laisser Gradle se synchroniser.
3. *Build Variants* (panneau à gauche) → `gestionDebug` ou `locataireDebug`.
4. Run ▶ sur un téléphone ou un émulateur.

En ligne de commande : `./gradlew assembleGestionDebug assembleLocataireDebug`.

## Notifications push (Firebase)

Télécharger depuis la console Firebase le `google-services.json` de chaque
app et le poser dans `app/src/gestion/` (projet `locamp-gestion`, app
Android `locamp.onrender.com`) et `app/src/locataire/` (projet
`locamp-portail`, app Android `fr.locamp.portail`). Sans ces fichiers, les
apps se construisent et fonctionnent, sans push.

## Publication

Créer `android/keystore.properties` (jamais dans Git) :

```
storeFile=/chemin/vers/cle.jks
storePassword=…
keyAlias=…
keyPassword=…
```

puis `./gradlew bundleGestionRelease bundleLocataireRelease` et envoyer les
`.aab` sur la Play Console.

## Le pont avec le site

Le même que sur iOS (`backend/public/natif.js`, `portail/natif-portail.js`,
voir `ios/README.md`). Le site parle à l'app par
`window.webkit.messageHandlers.locamp.postMessage` ; sur Android, un script
posé au démarrage de chaque page fournit cette fonction et la relaie à
l'interface `LocampAndroid`. Les fichiers du pont sont copiés depuis
`backend/public` à chaque build (une seule source pour iOS, Android et web).

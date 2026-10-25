# App iOS native — Locamp Gestion (Swift, Liquid Glass)

App SwiftUI pour iOS 26 / iPadOS 26. Tout l'habillage est **natif, en Liquid
Glass** : barre d'onglets, barre de titre, boutons d'action, menus, recherche,
alertes, toasts, feuilles. Le contenu des écrans reste celui du site
(`backend/public`), affiché dans un WKWebView qui défile **sous** le verre.

Elle remplace à terme l'app Capacitor `mobile/gestion` (même identifiant
`fr.locamp.gestion`, même projet Firebase).

## Ouvrir le projet (sur le Mac)

Prérequis : Xcode 26, [XcodeGen](https://github.com/yonaskolb/XcodeGen).

```bash
brew install xcodegen
cd ios/LocampGestion
xcodegen generate          # crée LocampGestion.xcodeproj depuis project.yml
open LocampGestion.xcodeproj
```

Dans Xcode : *Signing & Capabilities* → choisir l'équipe, puis Run.
Le `.xcodeproj` n'est pas versionné : `project.yml` fait foi. Après avoir
ajouté un fichier Swift, relancer `xcodegen generate`.

- Adresse du site : réglage `LOCAMP_URL` dans `project.yml` (par défaut
  `https://locamp.onrender.com/`). Pour tester un backend local, la changer
  puis régénérer.
- Push : le paquet Firebase est récupéré par Swift Package Manager.
  Sans lui (ou sans `GoogleService-Info.plist`), l'app fonctionne, sans push.
  Ajouter la capacité *Push Notifications* et la clé APNs dans la console
  Firebase du projet `locamp-gestion`.
- Inspecter le site dans l'app : Safari → Développement → (iPhone) → Locamp.

## Ce qui est natif

| Élément du site | Dans l'app iOS |
|---|---|
| Menu latéral (8 entrées) | Barre d'onglets Liquid Glass : Accueil, Carte, Résidents, Facturation, Plus (Messagerie, Compteurs, Comptabilité, Réglages). Barre latérale sur iPad. |
| Onglets en tête de page (`.sous-nav`) | Contrôle segmenté sur verre |
| Titre `h1` de la page | Titre de la barre de navigation |
| Boutons de `.page-head` | Bouton principal `glassProminent` + menu « … » |
| Champ `input.search` d'une liste | Barre de recherche iOS (`.searchable`) |
| Sélecteurs camping / exercice, déconnexion | Menu du compte (initiales, en haut à gauche) et onglet Plus |
| Cloche des notifications | Bouton de la barre (`bell` / `bell.badge`) |
| Badges impayés / messages | Badges des onglets |
| `askConfirm` / `askPrompt` | Alertes iOS |
| `toast()` | Toast en capsule de verre |
| `window.open` (PDF, impression) | Feuille native avec Imprimer / Partager |
| Téléchargements (CSV, FEC, Factur-X) | Feuille de partage iOS |
| Tirer pour rafraîchir | `UIRefreshControl` natif |
| Notifications push | Firebase natif, jeton transmis au site |

Restent en web : le contenu des écrans, le tiroir de fiche (`openDrawer`),
`askMois`, l'écran de connexion. Pendant qu'un panneau web recouvre la page,
l'app masque ses barres.

## Le pont site ↔ app

Côté site : `backend/public/natif.js` et `backend/public/natif.css`, chargés
par `index.html`. **Hors de l'app iOS, ils ne font rien** (pas de canal
`webkit.messageHandlers.locamp` → sortie immédiate ; pas de classe
`html.natif-ios` → aucune règle CSS ne s'applique).

Côté app : `LocampGestion/Pont/Pont.swift` (et les modèles `EtatWeb.swift`).

### Site → app (`webkit.messageHandlers.locamp.postMessage`)

| `type` | Contenu | Quand |
|---|---|---|
| `pret` | `version` | `natif.js` chargé |
| `session` | `connecte` | connexion / déconnexion |
| `etat` | `etat` : écran, groupe, titre, retour, onglets, actions, recherche, badges, contexte | après chaque rendu (dédoublonné) |
| `toast` | `message`, `erreur` | `toast()` |
| `dialogue` | `id`, `genre` (`confirmer`/`saisir`), `titre`, `message`, `ok`, `danger`, `valeur`, `invite` | `askConfirm` / `askPrompt` |
| `superposition` | `ouverte` | tiroir ou fenêtre web ouvert / fermé |

### App → site (`window.LocampNatif`)

`naviguer(hash)`, `action(id)`, `rechercher(texte)`, `changerCamping(id)`
(`'__new__'` = nouvel espace), `changerExercice(annee)`, `notifications()`,
`deconnexion()`, `recharger()`, `retour()`, `repondre(idDialogue, valeur)`,
`jetonPush(jeton)`.

Les marges des barres natives arrivent en CSS : `--natif-haut`, `--natif-bas`.

### Règles pour faire évoluer le site

- **Nouveau bouton d'en-tête** : rien à faire. Tout `button.btn` dans
  `.page-head` (ou sa `.toolbar`) devient un bouton natif ; `btn-primary` →
  bouton mis en avant, `btn-danger` → action destructive.
- **Icône** : devinée d'après le libellé ; l'imposer avec
  `data-sf="nom.du.symbole"` (SF Symbols).
- **Garder un bouton en web** : `data-natif="non"`.
- **Publier un bouton hors en-tête** : `data-natif`.
- **Nouvel écran** : l'ajouter à `routes` / `GROUPES_NAV` comme aujourd'hui ;
  s'il crée une entrée de menu, l'ajouter aussi à `OngletApp` ou `EcranPlus`
  (`EtatWeb.swift`).
- Changement du format d'un message : incrémenter `VERSION_PONT`
  (`natif.js`) et mettre à jour `EtatWeb.swift` dans le même commit.

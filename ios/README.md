# Apps iOS natives — Locamp (Swift, Liquid Glass)

Un seul projet Xcode, **deux apps** SwiftUI pour iOS 26 / iPadOS 26 :

| App | Identifiant | Site affiche | Nom sur l'ecran d'accueil |
|---|---|---|---|
| `LocampGestion` | `fr.locamp.gestion` | `/` (logiciel du camping) | Locamp Gestion |
| `LocampLocataire` | `fr.locamp.portail` | `/portail/` (espace locataire) | Mon camping |

Tout l'habillage est **natif, en Liquid Glass** : barre d'onglets, barre de
titre, boutons d'action, menus, recherche, alertes, toasts, feuilles. Le
contenu des ecrans reste celui du site (`backend/public`), affiche dans un
WKWebView qui defile **sous** le verre.

Elles remplacent a terme les apps Capacitor `mobile/gestion` et
`mobile/portail` (memes identifiants, memes projets Firebase).

## Organisation

```
ios/Locamp/
  project.yml            projet XcodeGen (les deux apps)
  Commun/                code natif partage : pont, vues, push
  Gestion/               Configuration.swift, icone, Firebase de la gestion
  Portail/               Configuration.swift, icone, Firebase du portail
  Config/                Info.plist et droits de chaque app
```

Ce qui differe d'une app a l'autre (onglets, cloche, choix du camping,
paiement masque, ecran ouvert par une notification) est dans
`Configuration.swift`. Le reste est commun.

## Ouvrir le projet (sur le Mac)

Prerequis : Xcode 26, [XcodeGen](https://github.com/yonaskolb/XcodeGen).

```bash
brew install xcodegen
cd ios/Locamp
xcodegen generate          # cree Locamp.xcodeproj depuis project.yml
open Locamp.xcodeproj
```

Dans Xcode, choisir le schema **LocampGestion** ou **LocampLocataire** en
haut, puis *Signing & Capabilities* → equipe, et Run.
Le `.xcodeproj` n'est pas versionne : `project.yml` fait foi. Apres avoir
ajoute un fichier Swift, relancer `xcodegen generate`.

- Adresse du site : reglage `LOCAMP_URL` de chaque cible dans `project.yml`.
- Push : Firebase (Swift Package Manager). Ajouter la capacite *Push
  Notifications* a chaque cible, et la cle APNs dans les projets Firebase
  `locamp-gestion` et `locamp-portail`. Sans Firebase, l'app fonctionne
  sans push.
- Paiement : masque dans l'app Locataire (`window.LOCAMP_NATIVE`, regle App
  Store 3.1.1), comme dans l'ancienne app Capacitor.
- Inspecter le site dans l'app : Safari → Developpement → (iPhone) → page.

## Ce qui est natif (app Gestion)

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

## App Locataire

Onglets natifs : Accueil, Factures, Messages (pastille des messages non
lus), Documents (pastille des documents a signer). L'ecran de signature
affiche un bouton Retour natif. Menu du compte : deconnexion (alerte iOS).
Tirer pour rafraichir recharge l'espace.

Pont : `backend/public/portail/natif-portail.js` et `natif-portail.css`,
meme contrat que celui de la gestion.

## Le pont site ↔ app

Côté site : `backend/public/natif.js` et `backend/public/natif.css`, chargés
par `index.html`. **Hors de l'app iOS, ils ne font rien** (pas de canal
`webkit.messageHandlers.locamp` → sortie immédiate ; pas de classe
`html.natif-ios` → aucune règle CSS ne s'applique).

Côté app : `Commun/Pont/Pont.swift` (et les modèles `EtatWeb.swift`).

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
  s'il crée une entrée de menu, l'ajouter aussi dans
  `Gestion/Configuration.swift` (onglets ou écrans « Plus »).
- Changement du format d'un message : incrémenter `VERSION_PONT`
  (`natif.js`) et mettre à jour `EtatWeb.swift` dans le même commit.

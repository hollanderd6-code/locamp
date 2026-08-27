# App mobile — Portail locataire Locamp (fr.locamp.portail)

App Capacitor qui embarque le front du portail locataire. Elle appelle l'API
Render en absolu (via `mobile-config.js` → `window.LOCAMP_API`) et masque le
paiement Stripe (`window.LOCAMP_NATIVE`) pour la conformité Apple.

## Prérequis (sur le Mac)
- Node 18+
- Xcode + CocoaPods (iOS) : `sudo gem install cocoapods`
- Android Studio (Android)

## Installation (une seule fois)
```bash
cd mobile/portail
npm install
npm run build:www          # assemble www/ depuis backend/public/portail
npx cap add ios
npx cap add android
npx cap sync
```

## Lancer / builder
```bash
npx cap open ios           # ouvre Xcode -> choisir l'équipe de signature, Run
npx cap open android       # ouvre Android Studio -> Run
```
Dans Xcode : Bundle Identifier = `fr.locamp.portail`, sélectionner ton équipe
(Signing & Capabilities), puis Run sur un appareil/simulateur.

## Après CHAQUE mise à jour du front portail
Le front vit dans `backend/public/portail`. Après l'avoir modifié/déployé :
```bash
cd mobile/portail
npm run build:www
npx cap sync
```
(puis rebuild dans Xcode / Android Studio)

## Icônes & splash (recommandé)
```bash
npm i -D @capacitor/assets
# place un logo 1024x1024 dans assets/icon.png et un fond dans assets/splash.png
npx capacitor-assets generate
```

## Notes
- `mobile-config.js` fixe l'URL de l'API (Render) et le drapeau natif. Pour
  pointer vers un autre backend : `LOCAMP_API_URL=https://... npm run build:www`.
- Le paiement en ligne est volontairement masqué dans l'app (garde-fou Apple 3.1.1).
- Polices Google + pdf.js sont chargés via CDN (l'app requiert le réseau, comme pour l'API).
- CORS backend : `capacitor://localhost` / `https://localhost` sont déjà autorisés.

# App mobile — Gestion Locamp (fr.locamp.gestion)

App Capacitor qui embarque le logiciel de gestion (front admin). Elle appelle
l'API Render en absolu via `mobile-config.js` (window.LOCAMP_API). Pas de
masquage de paiement : c'est un outil professionnel (B2B).

## Installation (une seule fois)
```bash
cd mobile/gestion
npm install
npm run build:www          # assemble www/ depuis backend/public
npx cap add ios
npx cap add android
npx cap sync
```

## Lancer / builder
```bash
npx cap open ios           # Xcode : Team de signature, Bundle ID fr.locamp.gestion, Run
npx cap open android       # Android Studio : Run
```

## Après CHAQUE mise à jour du front admin (backend/public/app.js, styles.css, index.html)
```bash
cd mobile/gestion
npm run build:www
npx cap sync
```

## Icônes & splash
```bash
npm i -D @capacitor/assets
# assets/icon.png (1024x1024) + assets/splash.png
npx capacitor-assets generate
```

## Notes
- Utilise un logo/couleur différents du portail pour distinguer les deux apps sur le store.
- CORS backend : origines Capacitor déjà autorisées.
- pdf.js (éditeur de zones de signature) est chargé dynamiquement par app.js — nécessite le réseau.

#!/usr/bin/env bash
# Assemble le dossier www/ embarqué de l'app portail depuis backend/public/portail.
# Réexécuter ce script à chaque mise à jour du front portail, puis `npx cap sync`.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/../../backend/public/portail"
WWW="$HERE/www"
API_URL="${LOCAMP_API_URL:-https://locamp.onrender.com}"

rm -rf "$WWW"; mkdir -p "$WWW"
cp "$SRC/index.html"  "$WWW/index.html"
cp "$SRC/portail.css" "$WWW/portail.css"
cp "$SRC/portail.js"  "$WWW/portail.js"

# mobile-config : base API absolue (Render) + drapeau app (masque le paiement Stripe)
cat > "$WWW/mobile-config.js" <<CFG
window.LOCAMP_API = '$API_URL';
window.LOCAMP_NATIVE = true;
CFG

# Chemins absolus -> relatifs, injection de mobile-config avant portail.js, nettoyage des liens web
perl -0pi -e "s{/portail/portail\.css}{portail.css}g; s{/portail/portail\.js}{portail.js}g;" "$WWW/index.html"
perl -0pi -e 's{<script src="portail\.js"></script>}{<script src="mobile-config.js"></script>\n<script src="portail.js"></script>}' "$WWW/index.html"
perl -0pi -e 's{\s*<link rel="manifest"[^>]*>}{}g; s{\s*<link rel="apple-touch-icon"[^>]*>}{}g;' "$WWW/index.html"

echo "OK -> $WWW"
ls -1 "$WWW"

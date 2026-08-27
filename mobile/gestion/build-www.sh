#!/usr/bin/env bash
# Assemble le dossier www/ embarqué de l'app GESTION depuis backend/public.
# Réexécuter après chaque mise à jour du front admin, puis `npx cap sync`.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/../../backend/public"
WWW="$HERE/www"
API_URL="${LOCAMP_API_URL:-https://locamp.onrender.com}"

rm -rf "$WWW"; mkdir -p "$WWW"
cp "$SRC/index.html" "$WWW/index.html"
cp "$SRC/styles.css" "$WWW/styles.css"
cp "$SRC/app.js"     "$WWW/app.js"

# mobile-config : base API absolue (Render). Pas de LOCAMP_NATIVE (outil pro).
cat > "$WWW/mobile-config.js" <<CFG
window.LOCAMP_API = '$API_URL';
CFG

# Chemins absolus -> relatifs + injection de mobile-config avant app.js + nettoyage liens web
perl -0pi -e 's{/styles\.css}{styles.css}g; s{(?<=["'"'"'/])app\.js}{app.js}g; s{src="/app\.js"}{src="app.js"}g;' "$WWW/index.html"
perl -0pi -e 's{(<script src="app\.js")}{<script src="mobile-config.js"></script>\n$1}' "$WWW/index.html"
perl -0pi -e 's{\s*<link rel="manifest"[^>]*>}{}g; s{\s*<link rel="apple-touch-icon"[^>]*>}{}g;' "$WWW/index.html"

echo "OK -> $WWW"; ls -1 "$WWW"

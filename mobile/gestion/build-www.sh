#!/usr/bin/env bash
# Assemble le dossier www/ embarque de l'app GESTION depuis backend/public.
# Reexecuter apres chaque mise a jour du front admin, puis `npx cap sync`.
#
# ── POURQUOI CE SCRIPT A ETE REECRIT ──────────────────────────────────
# La version precedente copiait trois fichiers (index.html, styles.css,
# app.js) et reecrivait les chemins a la main. Deux pannes en decoulaient,
# toutes deux silencieuses — le build reussissait, l'app etait morte :
#
#   1. Les references portent un anti-cache : `/app.js?v=1787574324`. La
#      regle perl visait `src="/app.js"` sans le `?v=`, donc ne remplacait
#      rien. Le chemin restait absolu, l'app cherchait
#      https://localhost/app.js et prenait un 404 : AUCUN JavaScript
#      charge. (La regle de repli, `s{(?<=["'/])app\.js}{app.js}`,
#      remplacait app.js par app.js — un non-evenement.)
#   2. marque.css et logo.svg sont apparus apres l'ecriture du script et
#      n'ont jamais ete ajoutes a la liste. Sans marque.css, aucun jeton
#      de couleur n'existe et l'interface s'affiche sans styles.
#
# La nouvelle version ne tient plus de liste : elle LIT index.html, copie
# tout ce qu'il reclame localement, et rend chaque chemin relatif —
# anti-cache compris. Puis elle VERIFIE qu'il ne reste aucune reference
# absolue et qu'aucun fichier ne manque, et s'arrete si c'est le cas.
# Un fichier ajoute au front sera desormais embarque sans toucher ici.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/../../backend/public"
WWW="$HERE/www"
API_URL="${LOCAMP_API_URL:-https://locamp.onrender.com}"

[ -f "$SRC/index.html" ] || { echo "ERREUR: $SRC/index.html introuvable." >&2; exit 1; }

rm -rf "$WWW"; mkdir -p "$WWW"
cp "$SRC/index.html" "$WWW/index.html"

# Les balises propres au web n'ont pas de sens dans une app : le manifeste
# PWA et l'icone Apple sont retires (l'app a les siens, cote natif).
perl -0pi -e 's{\s*<link rel="manifest"[^>]*>}{}g; s{\s*<link rel="apple-touch-icon"[^>]*>}{}g;' "$WWW/index.html"

# Tout ce que la page reclame en absolu, hors http(s):// et data:.
# On lit le HTML plutot que de maintenir une liste a la main.
REFS=$(perl -0ne 'while (m{(?:src|href)="(/[^"?#]+)}g) { print "$1\n" }' "$WWW/index.html" | sort -u)

MANQUANTS=""
for ref in $REFS; do
  rel="${ref#/}"                       # /icons/x.png -> icons/x.png
  if [ -f "$SRC/$rel" ]; then
    mkdir -p "$WWW/$(dirname "$rel")"
    cp "$SRC/$rel" "$WWW/$rel"
  else
    MANQUANTS="$MANQUANTS $rel"
  fi
done

if [ -n "$MANQUANTS" ]; then
  echo "ERREUR: fichiers reclames par index.html et absents de backend/public :" >&2
  for m in $MANQUANTS; do echo "  - $m" >&2; done
  echo "Corrigez index.html ou ajoutez ces fichiers avant de rebuilder." >&2
  exit 1
fi

# Chemins absolus -> relatifs. La classe [^"?#] s'arrete avant le ?v=,
# donc l'anti-cache est conserve tel quel : c'est lui qui garantit que le
# WebView ne ressort pas un ancien app.js de son cache.
perl -0pi -e 's{((?:src|href)=")/(?=[^"]*")}{$1}g' "$WWW/index.html"

# mobile-config : base API absolue (Render). Pas de LOCAMP_NATIVE (outil pro).
cat > "$WWW/mobile-config.js" <<CFG
window.LOCAMP_API = '$API_URL';
CFG

# mobile-config doit etre evalue AVANT app.js, qui lit window.LOCAMP_API
# des son chargement.
perl -0pi -e 's{(<script src="app\.js)}{<script src="mobile-config.js"></script>\n$1}' "$WWW/index.html"

# ---- Verifications : un build muet qui produit une app morte, jamais deux fois.
ERR=0
if grep -qE '(src|href)="/' "$WWW/index.html"; then
  echo "ERREUR: des chemins absolus subsistent dans index.html :" >&2
  grep -oE '(src|href)="/[^"]*"' "$WWW/index.html" | sed 's/^/  /' >&2
  ERR=1
fi
for f in index.html app.js styles.css marque.css mobile-config.js; do
  [ -s "$WWW/$f" ] || { echo "ERREUR: $f absent ou vide dans www/." >&2; ERR=1; }
done
grep -q 'src="mobile-config.js"' "$WWW/index.html" \
  || { echo "ERREUR: mobile-config.js n'est pas injecte dans index.html." >&2; ERR=1; }
perl -0ne 'exit(index($_, "mobile-config.js") < index($_, "\"app.js") ? 0 : 1)' "$WWW/index.html" \
  || { echo "ERREUR: mobile-config.js est charge apres app.js." >&2; ERR=1; }
[ "$ERR" = 0 ] || exit 1

echo "OK -> $WWW"; (cd "$WWW" && find . -type f | sed 's|^\./||' | sort)

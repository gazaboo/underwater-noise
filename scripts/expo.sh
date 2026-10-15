#!/usr/bin/env bash
# La carte du vacarme — lancement en mode exposition.
#
#   1. compile le client si nécessaire ;
#   2. lance le serveur avec config/expo.json5 (VACARME_MODE=expo) : demi-sphère, cible projecteur ;
#   3. attend qu'il réponde, puis ouvre Chromium en kiosque (plein écran, sans interface,
#      son autorisé sans geste, accélération GPU via Vulkan) ;
#   4. à la fermeture du navigateur, arrête le serveur.
#
# Usage : npm run expo        (ou scripts/expo.sh)
# Variables : PORT (défaut 8787), VACARME_BROWSER (chemin du navigateur), VACARME_URL_EXTRA (ex. "&hud=1").
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-8787}"
[ -f client/dist/index.html ] || npm run build

export VACARME_MODE=expo PORT
node --import tsx server/src/index.ts &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null || true' EXIT INT TERM

for _ in $(seq 1 120); do
  curl -s -o /dev/null "http://localhost:${PORT}/api/config" && break
  sleep 0.5
done

BROWSER="${VACARME_BROWSER:-$(command -v chromium-browser || command -v chromium || command -v google-chrome || true)}"
if [ -z "$BROWSER" ]; then
  echo "Aucun navigateur Chromium trouvé (VACARME_BROWSER=…)" >&2
  wait "$SERVER"
  exit 1
fi

"$BROWSER" \
  --kiosk --start-fullscreen --app="http://localhost:${PORT}/?${VACARME_URL_EXTRA:-}" \
  --autoplay-policy=no-user-gesture-required \
  --noerrdialogs --disable-infobars --disable-session-crashed-bubble --disable-features=Translate \
  --ignore-gpu-blocklist --use-angle=vulkan --enable-features=Vulkan \
  --user-data-dir="${XDG_CACHE_HOME:-$HOME/.cache}/vacarme-kiosk"

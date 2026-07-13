#!/usr/bin/env bash
# Downloads the self-hosted OFL webfonts used by the "paper" design system:
#   - Bricolage Grotesk (display)  -> src/app/fonts/BricolageGrotesk.woff2
#   - Hanken Grotesk (ui)          -> src/app/fonts/HankenGrotesk.woff2
#   - IBM Plex Mono (mono)         -> src/app/fonts/IBMPlexMono.woff2
#
# Safe to re-run: skips files that already exist. Safe to run offline: any
# font that fails to download is simply left absent, and the app falls back
# to system fonts for that slot (see src/app/app/layout.tsx / ThemeProvider).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FONTS_DIR="$SCRIPT_DIR/../src/app/fonts"
mkdir -p "$FONTS_DIR"

fetch() {
  local name="$1" dest="$2"; shift 2
  if [ -s "$dest" ]; then
    echo "skip: $name (already present at $dest)"
    return 0
  fi
  for url in "$@"; do
    echo "fetching $name from $url"
    if curl -fsSL --max-time 20 -o "$dest.tmp" "$url" 2>/dev/null && [ -s "$dest.tmp" ]; then
      mv "$dest.tmp" "$dest"
      echo "ok: $name -> $dest"
      return 0
    fi
    rm -f "$dest.tmp"
  done
  echo "warn: could not fetch $name (offline or source unavailable) — will fall back to system font"
  return 1
}

fetch "Bricolage Grotesk" "$FONTS_DIR/BricolageGrotesk.woff2" \
  "https://fonts.gstatic.com/s/bricolagegrotesque/v13/3y9U6as8bTXq_UyNsIqxq5EGFehyOWpKMOnDcRs8b1oJqrn9nJ0FzTNMAAsXnA.woff2" \
  "https://raw.githubusercontent.com/fontsource/font-files/main/fonts/google/bricolage-grotesque/files/bricolage-grotesque-latin-400-normal.woff2"

fetch "Hanken Grotesk" "$FONTS_DIR/HankenGrotesk.woff2" \
  "https://fonts.gstatic.com/s/hankengrotesk/v8/ieVw2YZDMXfRm0hDb4siFkfyRtVEBWk.woff2" \
  "https://raw.githubusercontent.com/fontsource/font-files/main/fonts/google/hanken-grotesk/files/hanken-grotesk-latin-400-normal.woff2"

fetch "IBM Plex Mono" "$FONTS_DIR/IBMPlexMono.woff2" \
  "https://fonts.gstatic.com/s/ibmplexmono/v19/-F63fjptAgt5VM-kVkqdyU8n1isw2FfegFq0PA.woff2" \
  "https://raw.githubusercontent.com/fontsource/font-files/main/fonts/google/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2"

echo "done."

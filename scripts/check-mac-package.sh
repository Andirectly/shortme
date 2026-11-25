#!/usr/bin/env bash
# Run from a normal GUI session, outside an agent's restrictive tool sandbox.
set -euo pipefail
cd "$(dirname "$0")/.."
APP="${1:-release/mac-arm64/Shortme.app}"
OUT="${2:-.tmp/mac-package-check}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
CUTAWAN_USER_DATA="$OUT/profile" CUTAWAN_PACKAGE_CHECK="$OUT/pipeline" \
  "$APP/Contents/MacOS/Shortme"
# UI-Smoketests (Einrichtung/Updates) entfallen: sie prüften Elemente der alten Cutawan-Oberfläche.

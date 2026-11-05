#!/usr/bin/env bash
# Download the third-party assets the film uses (not committed to the repository):
#   - CC0 textures and HDRI from ambientCG (https://ambientcg.com, CC0 1.0)
#   - Inter typeface (SIL Open Font License 1.1) from github.com/rsms/inter
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TEX="$ROOT/assets/tex"; FONTS="$ROOT/assets/fonts"
mkdir -p "$TEX" "$FONTS"
fetch() { # ambientCG asset id + variant
  local id=$1 var=$2 tmp; tmp=$(mktemp -d)
  curl -sSL -o "$tmp/a.zip" "https://ambientcg.com/get?file=${id}_${var}.zip"
  mkdir -p "$TEX/$id"; unzip -o -q "$tmp/a.zip" -d "$TEX/$id"; rm -rf "$tmp"
}
fetch Ground048 2K-JPG; fetch Bark003 2K-JPG; fetch LeafSet024 2K-JPG; fetch Grass004 2K-JPG; fetch DaySkyHDRI069A 4K
tmp=$(mktemp -d)
curl -sSL -o "$tmp/inter.zip" https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip
unzip -o -q "$tmp/inter.zip" -d "$tmp/inter"
cp "$tmp"/inter/extras/ttf/Inter-{Regular,Medium,SemiBold,Bold}.ttf "$FONTS/"
rm -rf "$tmp"
echo "assets ready in $ROOT/assets"

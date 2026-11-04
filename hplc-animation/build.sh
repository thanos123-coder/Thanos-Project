#!/usr/bin/env bash
# Builds hplc_explainer_el.mp4 (and the .srt) from the sources in this folder.
#
# Needs: Python 3 with edge-tts, numpy and pyloudnorm; Node.js with Playwright's Chromium; ffmpeg.
# Step 1 calls Microsoft's online Edge voices; every later step runs offline.
set -euo pipefail
cd "$(dirname "$0")"
PY=${PYTHON:-python3}

$PY tts.py                                 # Greek narration + word timings -> build/narration.wav, build/timeline.json
node render.cjs anchors build              # timing anchors and subtitle chunks from the animation
$PY audio.py                               # narration + pad + cues -> build/soundtrack.wav (-16 LUFS)
$PY subtitles.py                           # hplc_explainer_el.srt
rm -rf build/frames
node render.cjs frames build/frames 30 3   # 1920x1080 PNG frames

ffmpeg -y -v warning -stats \
  -framerate 30 -i build/frames/%06d.png -i build/soundtrack.wav \
  -vf "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p" \
  -c:v libx264 -preset slow -crf 17 -tune animation -profile:v high -g 60 \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv \
  -c:a aac -b:a 192k -ar 48000 \
  -movflags +faststart -metadata title="Πώς λειτουργεί το HPLC" -metadata language=ell \
  -shortest hplc_explainer_el.mp4

echo "done: $(pwd)/hplc_explainer_el.mp4"

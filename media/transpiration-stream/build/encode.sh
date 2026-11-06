#!/usr/bin/env bash
# Assemble the final film: rendered 4K frames + mixed soundtrack + English subtitles.
#   build/encode.sh <frames_dir> <mix_wav> <out_dir>
# Produces <out_dir>/transpiration_stream_4k.mp4: H.264 High, 3840x2160, 30 fps, burned-in
# English subtitles and AAC 48 kHz stereo. No soft subtitle track: MP4 players enable the only
# text track, which would double the burned-in subtitles (the .srt sidecar carries them as text).
# The video is encoded in 8-second segments that are kept once finished, so an interrupted
# run resumes where it stopped; the segments are then joined without re-encoding.
set -euo pipefail
FRAMES=${1:?frames dir}; MIX=${2:?mix wav}; OUT=${3:?out dir}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
read -r FPS N DUR < <(python3 -c "import json;t=json.load(open('$ROOT/timeline.json'));print(t['fps'],round(t['fps']*t['duration']),t['duration'])")
SEG=${SEG:-240}                  # frames per segment, a multiple of the 60-frame GOP
CRF=${CRF:-19}; PRESET=${PRESET:-medium}
mkdir -p "$OUT/segments"; OUT=$(cd "$OUT" && pwd); cd "$ROOT"
X264=(-c:v libx264 -preset "$PRESET" -crf "$CRF" -maxrate 11M -bufsize 22M -profile:v high -level:v 5.1 -g 60 -bf 3
  -x264-params "aq-mode=3:aq-strength=0.9:psy-rd=1.0,0.15:deblock=-1,-1"
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv)
LIST="$OUT/segments/list.txt"; : > "$LIST"
for ((s = 0; s < N; s += SEG)); do
  seg="$OUT/segments/s$(printf %05d "$s").mp4"
  echo "file '$seg'" >> "$LIST"
  [ -s "$seg" ] && continue
  # shift timestamps to film time for the subtitle renderer, then back to zero for the segment
  ffmpeg -hide_banner -loglevel error -y -framerate "$FPS" -start_number "$s" -i "$FRAMES/f%05d.jpg" \
    -frames:v $(( N - s < SEG ? N - s : SEG )) \
    -vf "setpts=PTS+$s/($FPS*TB),subtitles=output/transpiration_stream.en.ass:fontsdir=assets/fonts,setpts=PTS-STARTPTS,format=yuv420p" \
    "${X264[@]}" -an "$seg.part.mp4"
  mv "$seg.part.mp4" "$seg"; echo "segment $s done $(date -u +%H:%M:%S)"
done
ffmpeg -hide_banner -loglevel error -y -f concat -safe 0 -i "$LIST" -i "$MIX" \
  -map 0:v -map 1:a -c:v copy -c:a aac -b:a 256k -ar 48000 \
  -metadata:s:a:0 language=eng -t "$DUR" -movflags +faststart \
  -metadata title="The Transpiration Stream — From Soil to Atmosphere" "$OUT/transpiration_stream_4k.mp4"
ls -la "$OUT/transpiration_stream_4k.mp4"

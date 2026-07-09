#!/usr/bin/env bash
# Encode caploop.js frames into a high-quality MP4, honoring the real per-frame
# timestamps in manifest.json so motion timing matches what actually happened.
#
# Usage: frames-to-mp4.sh <framesDir> <outFile.mp4> [width=1920]
# Requires ffmpeg on PATH (macOS: export PATH="/opt/homebrew/bin:$PATH").
set -euo pipefail
DIR="${1:?frames dir}"
OUT="${2:?output mp4}"
WIDTH="${3:-1920}"

command -v ffmpeg >/dev/null 2>&1 || { echo "ffmpeg not found on PATH" >&2; exit 1; }
[ -f "$DIR/manifest.json" ] || { echo "no manifest.json in $DIR" >&2; exit 1; }

python3 - "$DIR" <<'PY'
import json,sys,os
d=sys.argv[1]
m=json.load(open(os.path.join(d,'manifest.json')))
frames=m['frames']
lines=[]
for i,fr in enumerate(frames):
    lines.append(f"file '{fr['file']}'")
    if i < len(frames)-1:
        dur=max((frames[i+1]['t']-fr['t'])/1000.0,0.01)
        lines.append(f"duration {dur:.3f}")
# hold the last frame a beat
lines.append(f"file '{frames[-1]['file']}'")
lines.append("duration 1.2")
lines.append(f"file '{frames[-1]['file']}'")
open(os.path.join(d,'list.txt'),'w').write("\n".join(lines))
print("frames",len(frames),"span_s",round((frames[-1]['t']-frames[0]['t'])/1000.0,2))
PY

( cd "$DIR" && ffmpeg -y -f concat -safe 0 -i list.txt \
	-vf "scale=${WIDTH}:-2:flags=lanczos,format=yuv420p" -r 30 \
	-c:v libx264 -preset slow -crf 20 -movflags +faststart "$OUT" >/dev/null 2>&1 )
echo "wrote $OUT"
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,duration -of default=noprint_wrappers=1 "$OUT" 2>/dev/null || true

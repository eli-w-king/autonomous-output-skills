#!/usr/bin/env bash
# Build a crisp, palette-optimized GIF from caploop.js frames (fallback preview for
# places that will not render an inline video). Prefer the MP4 for actual demos.
#
# Usage: frames-to-gif.sh <framesDir> <outFile.gif> [width=1000] [fps=12]
set -euo pipefail
DIR="${1:?frames dir}"
OUT="${2:?output gif}"
WIDTH="${3:-1000}"
FPS="${4:-12}"

command -v ffmpeg >/dev/null 2>&1 || { echo "ffmpeg not found on PATH" >&2; exit 1; }
[ -f "$DIR/list.txt" ] || { echo "run frames-to-mp4.sh first (it writes list.txt), or create it" >&2; exit 1; }

PAL="$(mktemp -t pal).png"
( cd "$DIR" && ffmpeg -y -f concat -safe 0 -i list.txt \
	-vf "fps=${FPS},scale=${WIDTH}:-1:flags=lanczos,palettegen=stats_mode=diff" "$PAL" >/dev/null 2>&1 )
( cd "$DIR" && ffmpeg -y -f concat -safe 0 -i list.txt -i "$PAL" \
	-lavfi "fps=${FPS},scale=${WIDTH}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3" "$OUT" >/dev/null 2>&1 )
rm -f "$PAL"
echo "wrote $OUT"

#!/usr/bin/env bash
# mp4-to-gif.sh — convert an MP4 to an upload-safe animated GIF.
#
# UserTesting's media uploader accepts ONLY JPEG / PNG / GIF (MP4 is rejected),
# so any walkthrough video must be converted to GIF before it can be attached
# to a study step. Uses a two-pass palette for good quality at small size.
#
# Usage:
#   mp4-to-gif.sh <input.mp4> [output.gif] [fps] [width]
# Defaults: fps=8, width=900 (height auto, aspect preserved).
#
# Requires: ffmpeg.
set -euo pipefail

IN="${1:?usage: mp4-to-gif.sh <input.mp4> [out.gif] [fps] [width]}"
OUT="${2:-${IN%.*}.gif}"
FPS="${3:-8}"
WIDTH="${4:-900}"

command -v ffmpeg >/dev/null || { echo "ffmpeg not found on PATH" >&2; exit 1; }
[ -f "$IN" ] || { echo "input not found: $IN" >&2; exit 1; }

ffmpeg -y -loglevel error -i "$IN" \
  -vf "fps=${FPS},scale=${WIDTH}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" \
  "$OUT"

# Report size so the caller can sanity-check (keep GIFs lean).
BYTES=$(wc -c < "$OUT" | tr -d ' ')
echo "$OUT (${BYTES} bytes)"

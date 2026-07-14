#!/usr/bin/env bash
# make-walkthrough.sh — stitch ordered PNG screenshots into an MP4 walkthrough.
#
# Usage:
#   make-walkthrough.sh <media-dir> [output.mp4] [default-hold-seconds]
#
# Looks for top-level *.png files in <media-dir> (sorted by name) plus any
# <media-dir>/frames/*.png (played fast, ~1s each, as a "running" montage).
# Normalizes every frame to 1280x720 on a dark background and concatenates them
# with per-frame hold times. Name your screenshots with zero-padded prefixes
# (00-, 01-, 02-, …) so lexical sort == flow order.
#
# Requires: ffmpeg.
set -euo pipefail

MEDIA="${1:?usage: make-walkthrough.sh <media-dir> [out.mp4] [hold-seconds]}"
OUT="${2:-$MEDIA/walkthrough.mp4}"
HOLD="${3:-2.5}"

command -v ffmpeg >/dev/null || { echo "ffmpeg not found on PATH" >&2; exit 1; }
[ -d "$MEDIA" ] || { echo "media dir not found: $MEDIA" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
CONCAT="$WORK/concat.txt"; : > "$CONCAT"

i=0
add_frame() { # $1=file  $2=hold
  local n; n=$(printf "%04d" "$i")
  ffmpeg -y -loglevel error -i "$1" \
    -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x1e1e1e" \
    "$WORK/n$n.png"
  printf "file '%s'\nduration %s\n" "$WORK/n$n.png" "$2" >> "$CONCAT"
  i=$((i+1))
}

shopt -s nullglob
for f in "$MEDIA"/*.png; do add_frame "$f" "$HOLD"; done
for f in "$MEDIA"/frames/*.png; do add_frame "$f" 1; done
shopt -u nullglob

[ "$i" -gt 0 ] || { echo "no .png frames found in $MEDIA" >&2; exit 1; }

# concat demuxer needs the last file repeated (with no trailing duration)
last=$(printf "%04d" $((i-1)))
echo "file '$WORK/n$last.png'" >> "$CONCAT"

ffmpeg -y -loglevel error -f concat -safe 0 -i "$CONCAT" \
  -vsync vfr -pix_fmt yuv420p -c:v libx264 -movflags +faststart "$OUT"

echo "$OUT"

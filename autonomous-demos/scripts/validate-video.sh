#!/usr/bin/env bash
# Validate a demo video before anyone sees it: codec, pixel format, size, frame rate, duration,
# faststart, and a FULL decode (a successful upload or a playable first second proves nothing; one
# truncated stimulus MP4 broke a live study). Also extracts the first, middle, and last frames so
# they can be eyeballed with an image viewer.
#
# Usage: validate-video.sh <video.mp4> [--width W] [--height H] [--fps N] [--min-seconds S] [--max-seconds S]
# Exit code 0 only when every check passes. Requires ffmpeg and ffprobe on PATH.
set -euo pipefail

VIDEO="${1:?usage: validate-video.sh <video.mp4> [--width W] [--height H] [--fps N] [--min-seconds S] [--max-seconds S]}"
shift
WANT_W=""; WANT_H=""; WANT_FPS=""; MIN_S=""; MAX_S=""
while [ $# -gt 0 ]; do
	case "$1" in
		--width) WANT_W="$2"; shift 2 ;;
		--height) WANT_H="$2"; shift 2 ;;
		--fps) WANT_FPS="$2"; shift 2 ;;
		--min-seconds) MIN_S="$2"; shift 2 ;;
		--max-seconds) MAX_S="$2"; shift 2 ;;
		*) echo "unknown option $1" >&2; exit 2 ;;
	esac
done

command -v ffprobe >/dev/null || { echo "ffprobe not found on PATH" >&2; exit 2; }
[ -f "$VIDEO" ] || { echo "no such file: $VIDEO" >&2; exit 2; }

FAIL=0
fail() { echo "FAIL $1"; FAIL=1; }
pass() { echo "ok   $1"; }

IFS=, read -r CODEC W H PIX RATE < <(ffprobe -v error -select_streams v:0 \
	-show_entries stream=codec_name,width,height,pix_fmt,avg_frame_rate -of csv=p=0 "$VIDEO")
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$VIDEO")

[ "$CODEC" = "h264" ] && pass "codec h264" || fail "codec is $CODEC (want h264)"
[ "$PIX" = "yuv420p" ] && pass "pix_fmt yuv420p" || fail "pix_fmt is $PIX (want yuv420p for compatibility)"
pass "size ${W}x${H}, frame rate $RATE, duration ${DUR}s"
[ -z "$WANT_W" ] || [ "$W" = "$WANT_W" ] || fail "width $W (want $WANT_W)"
[ -z "$WANT_H" ] || [ "$H" = "$WANT_H" ] || fail "height $H (want $WANT_H)"
[ -z "$WANT_FPS" ] || awk "BEGIN{split(\"$RATE\",r,\"/\"); f=(r[2]>0)?r[1]/r[2]:0; exit !(f>$WANT_FPS-0.01 && f<$WANT_FPS+0.01)}" || fail "frame rate $RATE (want $WANT_FPS)"
[ -z "$MIN_S" ] || awk "BEGIN{exit !($DUR >= $MIN_S)}" || fail "duration ${DUR}s shorter than ${MIN_S}s"
[ -z "$MAX_S" ] || awk "BEGIN{exit !($DUR <= $MAX_S)}" || fail "duration ${DUR}s longer than ${MAX_S}s"

FIRST_ATOM=$(ffprobe -v trace "$VIDEO" 2>&1 | grep -m1 -oE "type:'(moov|mdat)'" || true)
[ "$FIRST_ATOM" = "type:'moov'" ] && pass "faststart (moov before mdat)" || fail "not faststart; re-encode with -movflags +faststart"

ERRORS=$(ffmpeg -v error -i "$VIDEO" -f null - 2>&1 | head -5 || true)
[ -z "$ERRORS" ] && pass "full decode clean" || fail "decode errors: $ERRORS"

FRAMES_DIR="${VIDEO%.*}-check"
mkdir -p "$FRAMES_DIR"
for POS in start middle end; do
	case "$POS" in
		start) T=0.5 ;;
		middle) T=$(awk "BEGIN{print $DUR/2}") ;;
		end) T=$(awk "BEGIN{t=$DUR-0.5; if (t<0) t=0; print t}") ;;
	esac
	ffmpeg -y -loglevel error -ss "$T" -i "$VIDEO" -frames:v 1 "$FRAMES_DIR/$POS.png"
done
pass "frames for review in $FRAMES_DIR (start, middle, end); delete the folder before delivery"

exit $FAIL

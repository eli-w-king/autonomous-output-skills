#!/usr/bin/env bash
# Keep a lab's review worktree current and its review server up, with nobody watching. Each round it can mirror a
# remote drop (drop.mjs pull), runs drop-sync.sh whenever a -latest.txt pointer changed, and starts the review server
# when its port stops answering. Run it detached on the hub, where the drop folder is local. A laptop may run its own
# copy as a mirror (set LAB_PULL), but nothing in the lab may depend on that copy.
#
# Configure it with the environment drop-sync.sh reads (LAB_REPO, LAB_DROP, LAB and the rest), plus:
#   LAB_EVERY       seconds between rounds (default 20)
#   LAB_PULL        a drop.mjs to mirror the drop into LAB_DROP before each round (optional; for a remote drop)
#   LAB_SERVE       the command that serves the review worktree, run from it; {PORT} becomes LAB_SERVE_PORT (optional)
#   LAB_SERVE_PORT  the review server's port, checked with curl (default 4600)
#   LAB_STATE       the folder for watch.log, watch.pid, serve.log and serve.pid (default <LAB_DROP>/../watch)
#
# Usage: drop-watch.sh [--once]
# Stop it with the pid in watch.pid, and the review server with the pid in serve.pid; never by name.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
: "${LAB_REPO:?set LAB_REPO to the repository}"
: "${LAB_DROP:?set LAB_DROP to the drop folder}"
mkdir -p "$LAB_DROP"
LAB_DROP="$(cd "$LAB_DROP" && pwd)"
export LAB_DROP
LAB="${LAB:-lab}"
EVERY="${LAB_EVERY:-20}"
PORT="${LAB_SERVE_PORT:-4600}"
STATE="${LAB_STATE:-$(dirname "$LAB_DROP")/watch}"
mkdir -p "$STATE"
LOG="$STATE/watch.log"
REPO="$(git -C "$LAB_REPO" rev-parse --show-toplevel)" || { echo "not a repository: $LAB_REPO" >&2; exit 1; }
WT="${LAB_WT:-$REPO.worktrees/lab-$LAB-review}"

log() { echo "$(date '+%F %T') $*" >> "$LOG"; }
answers() { curl -s -o /dev/null -m 5 "http://127.0.0.1:$PORT/"; }
signature() { cat "$LAB_DROP"/*-latest.txt 2>/dev/null | cksum | cut -d' ' -f1; }

last=""
round() {
	local sig out cmd
	if [ -n "${LAB_PULL:-}" ]; then
		node "$LAB_PULL" pull "$LAB_DROP" --match '\.bundle$|-latest\.txt$' >/dev/null 2>>"$LOG" || { log "pull failed; will retry"; return; }
	fi
	[ -f "$LAB_DROP/${LAB_KIT:-kit}-latest.txt" ] || return
	sig=$(signature)
	if [ "$sig" != "$last" ]; then
		if out=$(bash "$HERE/drop-sync.sh" 2>&1); then
			last="$sig"
			log "synced: $(echo "$out" | tail -1)"
		else
			log "sync failed; will retry: $(echo "$out" | tail -3 | tr '\n' ' ')"
		fi
	fi
	if [ -n "${LAB_SERVE:-}" ] && [ -d "$WT" ] && ! answers; then
		cmd="${LAB_SERVE//\{PORT\}/$PORT}"
		(cd "$WT" && { nohup bash -c "$cmd" >> "$STATE/serve.log" 2>&1 & echo $! > "$STATE/serve.pid"; })
		log "started the review server on $PORT (pid $(cat "$STATE/serve.pid")): $cmd"
	fi
}

echo $$ > "$STATE/watch.pid"
log "watch started (pid $$, every ${EVERY}s, drop $LAB_DROP)"
if [ "${1:-}" = "--once" ]; then round; exit 0; fi
while true; do
	round
	sleep "$EVERY"
done

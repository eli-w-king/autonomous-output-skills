#!/usr/bin/env bash
# Create or update a GitHub issue via the REST API using the machine's stored git
# credential (so no PAT juggling). Handles the two traps hit in practice:
#   * GitHub MCP `issue_write` only RENDERS A FORM in-editor; it does not create the
#     issue. Use this REST helper for unattended creation instead.
#   * Forks have Issues DISABLED by default -> POST returns HTTP 410
#     "Issues has been disabled". Pass --enable-issues to PATCH the repo first.
#
# NOTE: this creates a plain issue and bypasses repo issue templates. For a public
# flagship repo (e.g. microsoft/vscode) confirm with the user before posting.
#
# NOTE: the REST API CANNOT upload a video attachment for a native inline player.
# That requires a signed-in browser drag/drop (see SKILL.md, Phase 6).
#
# Usage:
#   create-issue.sh create <owner> <repo> <title> <bodyFile> [--enable-issues]
#   create-issue.sh patch  <owner> <repo> <issueNumber> <bodyFile> [--title "New title"]
set -euo pipefail
MODE="${1:?create|patch}"; OWNER="${2:?owner}"; REPO="${3:?repo}"

TOKEN="$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p')"
[ -n "$TOKEN" ] || { echo "no github.com git credential found" >&2; exit 1; }
API="https://api.github.com/repos/$OWNER/$REPO"
H_AUTH="Authorization: Bearer $TOKEN"
H_ACC="Accept: application/vnd.github+json"
H_VER="X-GitHub-Api-Version: 2022-11-28"

if [ "$MODE" = "create" ]; then
	TITLE="${4:?title}"; BODYFILE="${5:?body file}"; shift 5 || true
	if [ "${1:-}" = "--enable-issues" ]; then
		curl -sS -X PATCH -H "$H_AUTH" -H "$H_ACC" -H "$H_VER" "$API" -d '{"has_issues":true}' >/dev/null
	fi
	PAYLOAD="$(python3 -c "import json,sys;print(json.dumps({'title':sys.argv[1],'body':open(sys.argv[2]).read()}))" "$TITLE" "$BODYFILE")"
	RESP="$(mktemp)"; CODE="$(curl -sS -o "$RESP" -w '%{http_code}' -X POST -H "$H_AUTH" -H "$H_ACC" -H "$H_VER" "$API/issues" -d "$PAYLOAD")"
	echo "HTTP=$CODE"; python3 -c "import json;d=json.load(open('$RESP'));print(d.get('html_url') or d.get('message'))"; rm -f "$RESP"
elif [ "$MODE" = "patch" ]; then
	NUM="${4:?issue number}"; BODYFILE="${5:?body file}"; shift 5 || true
	NEWTITLE=""; [ "${1:-}" = "--title" ] && NEWTITLE="${2:-}"
	PAYLOAD="$(python3 -c "import json,sys;d={'body':open(sys.argv[1]).read()};t=sys.argv[2];\
(d.__setitem__('title',t) if t else None);print(json.dumps(d))" "$BODYFILE" "$NEWTITLE")"
	RESP="$(mktemp)"; CODE="$(curl -sS -o "$RESP" -w '%{http_code}' -X PATCH -H "$H_AUTH" -H "$H_ACC" -H "$H_VER" "$API/issues/$NUM" -d "$PAYLOAD")"
	echo "HTTP=$CODE"; python3 -c "import json;d=json.load(open('$RESP'));print(d.get('html_url') or d.get('message'))"; rm -f "$RESP"
else
	echo "unknown mode: $MODE" >&2; exit 2
fi

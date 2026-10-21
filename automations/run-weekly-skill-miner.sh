#!/bin/bash
# Run the weekly skill miner in the background on macOS, with Copilot CLI and launchd.
#
#   run-weekly-skill-miner.sh --install     schedule it: checks at 9:00, 13:00, 17:00, 21:00, and at login.
#                                           It runs on Saturdays, catches up after a missed Saturday, and
#                                           retries the next day after a failed run.
#   run-weekly-skill-miner.sh --uninstall   remove the schedule
#   run-weekly-skill-miner.sh --status      the schedule, the last run, and the latest report
#   run-weekly-skill-miner.sh --check       test the setup without running (add --llm to also get a one-word
#                                           reply from the model with the run's exact settings)
#   run-weekly-skill-miner.sh --now         run now, even if a file changed in the last hour
#   run-weekly-skill-miner.sh --rehearse [--since ISO-TIME]
#                                           a full run on copies of the repo, the installed skills, and the
#                                           private state that publishes nothing (to test changes)
#   run-weekly-skill-miner.sh               what launchd runs: start a run only when one is due
#
# The runner does the deterministic parts and the agent does the judgment. Before the agent starts,
# the runner takes the lock, waits if anything in the repo or the installed skills changed in the last
# hour, fetches origin, merges origin/main when that is clean, freezes the window, and collects the
# messages. The agent (Copilot CLI) then follows the procedure in weekly-skill-miner.md with no GitHub
# credentials and with network, publishing, and history-rewriting commands blocked. Afterward the
# runner checks the result (clean tree, tools/ and automations/ unchanged, the validator, the commit
# identity), squashes everything since origin/main into one commit, and pushes it.
#
# Why launchd instead of a VS Code Agents window automation: automation runs use the agent sandbox,
# which blocks GitHub and the git settings this job needs. Reports go to ~/.copilot/skill-miner/reports
# because macOS asks for permission before a background job can write to a cloud-synced Desktop.
set -u

SCRIPT="$(cd "$(dirname "$0")" && pwd -P)/$(basename "$0")"
SESSIONS="${COPILOT_SESSION_STATE:-$HOME/.copilot/session-state}"
LABEL="com.autonomous-output-skills.weekly-skill-update"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
MODEL="${SKILL_MINER_MODEL:-claude-opus-5.5}"
TIME_LIMIT="${SKILL_MINER_TIME_LIMIT:-14400}"
MARKER='[weekly-skill-miner]'
COAUTHOR='Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>'
PROTECTED_PATHS="tools automations"
REHEARSAL=0
FORCE=0
BOUNDED_PID=
LOCK_OWNED=0
REPORT=
RUN_DIR=
PUBLISH_RESULT=

use_paths() { # repo skills-dir miner-dir
	REPO="$1"
	SKILLS="$2"
	MINER="$3"
	BACKUPS="$(dirname "$SKILLS")/skills-backup"
	REPORTS="$MINER/reports"
	LOGS="$MINER/logs"
	LOCK="$MINER/lock"
	PROCEDURE="$REPO/automations/weekly-skill-miner.md"
	mkdir -p "$LOGS" "$REPORTS"
	chmod 700 "$MINER" 2>/dev/null
}
use_paths "$(cd "$(dirname "$0")/.." && pwd -P)" "${COPILOT_SKILLS_DIR:-$HOME/.copilot/skills}" "${SKILL_MINER_DIR:-$HOME/.copilot/skill-miner}"
REAL_MINER="$MINER"

note() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOGS/scheduler.log"; }
say() { printf '%s\n' "$*"; }
tilde() { printf '%s' "${1/#$HOME/~}"; }
utc_now() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }

json_get() { # file key
	python3 - "$1" "$2" <<'PY' 2>/dev/null
import json, sys
try:
    value = json.load(open(sys.argv[1])).get(sys.argv[2])
except Exception:
    value = None
print('' if value is None else value)
PY
}

json_set() { # file key=value... (key:=N stores an integer)
	python3 - "$@" <<'PY'
import json, os, sys, tempfile
path = sys.argv[1]
try:
    data = json.load(open(path))
except FileNotFoundError:
    data = {}
except ValueError:
    os.replace(path, path + '.corrupt')
    data = {}
for item in sys.argv[2:]:
    if ':=' in item:
        key, value = item.split(':=', 1)
        data[key] = int(value)
    else:
        key, value = item.split('=', 1)
        data[key] = value
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path) or '.')
with os.fdopen(fd, 'w') as f:
    json.dump(data, f, indent=2)
    f.write('\n')
os.replace(tmp, path)
PY
}

# Run a command in its own process group with a time limit; a signal to the runner stops the group.
bounded() { # seconds command...
	python3 -c '
import os, signal, subprocess, sys
child = subprocess.Popen(sys.argv[2:], start_new_session=True, stdin=subprocess.DEVNULL)
def stop():
    for sig, wait in ((signal.SIGTERM, 30), (signal.SIGKILL, 5)):
        try:
            os.killpg(child.pid, sig)
            child.wait(timeout=wait)
            return
        except (ProcessLookupError, subprocess.TimeoutExpired):
            pass
def on_signal(*_):
    stop()
    sys.exit(143)
for s in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
    signal.signal(s, on_signal)
try:
    sys.exit(child.wait(timeout=int(sys.argv[1])))
except subprocess.TimeoutExpired:
    stop()
    sys.exit(124)
' "$@" &
	BOUNDED_PID=$!
	wait "$BOUNDED_PID"
	local code=$?
	BOUNDED_PID=
	return "$code"
}

on_signal() {
	[ -n "$BOUNDED_PID" ] && kill -TERM "$BOUNDED_PID" 2>/dev/null && wait "$BOUNDED_PID" 2>/dev/null
	note "stopped by a signal"
	exit 143
}

release_lock() { if [ "$LOCK_OWNED" = 1 ]; then rm -rf "$LOCK"; LOCK_OWNED=0; fi; }
trap release_lock EXIT
trap on_signal TERM INT HUP

acquire_lock() {
	if mkdir "$LOCK" 2>/dev/null; then
		printf '%s\n' "$$" > "$LOCK/pid"
		LOCK_OWNED=1
		return 0
	fi
	local pid age
	pid="$(cat "$LOCK/pid" 2>/dev/null)"
	age=$(( $(date +%s) - $(stat -f %m "$LOCK" 2>/dev/null || date +%s) ))
	[ "$age" -lt 600 ] && return 1
	if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && [ "$age" -lt $(( TIME_LIMIT + 3600 )) ]; then
		return 1
	fi
	note "removing a stale lock (pid ${pid:-unknown}, $(( age / 60 )) minutes old)"
	rm -rf "$LOCK"
	mkdir "$LOCK" 2>/dev/null || return 1
	printf '%s\n' "$$" > "$LOCK/pid"
	LOCK_OWNED=1
}

version_gt() { [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -t. -k1,1n -k2,2n -k3,3n -k4,4n | tail -1)" = "$1" ]; }

# The newest Copilot CLI on this Mac, found fresh each time so a Node or CLI upgrade is picked up.
find_copilot() {
	local best="" best_version="" candidate version
	for candidate in "${COPILOT_BIN:-}" "$(command -v copilot 2>/dev/null)" "$HOME"/.nvm/versions/node/*/bin/copilot \
		/opt/homebrew/bin/copilot /usr/local/bin/copilot; do
		[ -n "$candidate" ] && [ -x "$candidate" ] || continue
		version="$(PATH="$(dirname "$candidate"):$PATH" "$candidate" --version 2>/dev/null | grep -oE '[0-9]+(\.[0-9]+)+' | head -1)"
		[ -n "$version" ] || continue
		if [ -z "$best" ] || version_gt "$version" "$best_version"; then
			best="$candidate"
			best_version="$version"
		fi
	done
	[ -n "$best" ] && printf '%s\n' "$best"
}

prompt_text() { awk '/^```text$/ { inside = 1; next } /^```$/ { if (inside) exit } inside' "$PROCEDURE" 2>/dev/null; }

managed_skills() {
	local dir
	for dir in "$REPO"/*/; do [ -f "$dir/SKILL.md" ] && basename "$dir"; done
}

recent_change() {
	local hit skill
	hit="$(find "$REPO" -path "$REPO/.git" -prune -o -type f -mmin -60 -print 2>/dev/null | head -1)"
	if [ -z "$hit" ]; then
		for skill in $(managed_skills); do
			hit="$(find "$SKILLS/$skill" -type f -mmin -60 -print 2>/dev/null | head -1)"
			[ -n "$hit" ] && break
		done
	fi
	[ -n "$hit" ] && tilde "$hit"
}

git_busy() { # prints the in-progress operation, if any
	local dir item
	dir="$(git -C "$REPO" rev-parse --git-dir 2>/dev/null)" || return 1
	case "$dir" in /*) ;; *) dir="$REPO/$dir" ;; esac
	for item in MERGE_HEAD rebase-merge rebase-apply CHERRY_PICK_HEAD REVERT_HEAD BISECT_LOG; do
		[ -e "$dir/$item" ] && { printf '%s\n' "$item"; return 0; }
	done
	return 1
}

# Every MCP server the CLI would load (user, workspace, plugin, and built-in), so all can be turned
# off. Fails closed: if the list cannot be read, the run does not start.
mcp_servers() { # copilot
	local listing
	listing="$(cd "$REPO" && PATH="$(dirname "$1"):$PATH" bounded 120 "$1" mcp list 2>&1)" || return 1
	printf '%s\n' "$listing" | python3 -c '
import json, os, re, sys
names = []
for line in sys.stdin:
    match = re.match(r"^\s{2,}(\S.*?) \(([A-Za-z]+)\)\s*$", line)
    if match and match.group(1) not in names:
        names.append(match.group(1))
config = os.path.expanduser("~/.copilot/mcp-config.json")
if os.path.exists(config):
    servers = json.load(open(config)).get("mcpServers", {})
    if not isinstance(servers, dict):
        sys.exit(1)
    names += [name for name in servers if name not in names]
if not names:
    sys.exit(1)
if "computer-use" not in names:
    names.append("computer-use")
print("\n".join(names))
'
}

write_agent_gitconfig() { # the agent gets an identity and no credential helpers
	local file="$MINER/agent.gitconfig"
	printf '[user]\n\tname = %s\n\temail = %s\n[credential]\n\thelper =\n' \
		"$(git config --global user.name)" "$(git config --global user.email)" > "$file"
	printf '%s\n' "$file"
}

build_agent_args() { # copilot prompt model usage-file
	local name servers
	AGENT_ARGS=(-p "$2" --model "$3" --no-ask-user --autopilot --max-autopilot-continues 10 --stream off --allow-all-tools
		--add-dir "$SKILLS" --add-dir "$BACKUPS" --add-dir "$MINER" --add-dir "$SESSIONS"
		--disable-builtin-mcps --log-dir "$LOGS/cli" --usage-output-file "$4")
	for name in 'git push' 'git fetch' 'git pull' 'git remote' 'git credential' 'git credential-osxkeychain' \
		'git reset' 'git clean' 'git stash' 'git rebase' 'git update-ref' 'git filter-branch' 'git commit-tree' \
		'gh:*' 'curl:*' 'wget:*' 'ssh:*' 'scp:*' 'rsync:*' 'nc:*' 'open:*' 'osascript:*' 'security:*' \
		'launchctl:*' 'crontab:*'; do
		AGENT_ARGS+=("--deny-tool=shell($name)")
	done
	AGENT_ARGS+=(--deny-tool=url --deny-tool=computer-use)
	[ -n "${SKILL_MINER_MAX_AI_CREDITS:-}" ] && AGENT_ARGS+=(--max-ai-credits "$SKILL_MINER_MAX_AI_CREDITS")
	servers="$(mcp_servers "$1")" || return 1
	while IFS= read -r name; do
		[ -n "$name" ] && AGENT_ARGS+=(--disable-mcp-server "$name")
	done <<EOF
$servers
EOF
}

run_agent() { # copilot prompt model usage-file output-file seconds
	local gitconfig
	mkdir -p "$SKILLS" "$BACKUPS" "$LOGS/cli" || return 1
	gitconfig="$(write_agent_gitconfig)"
	build_agent_args "$1" "$2" "$3" "$4" || return 3
	cd "$REPO" || return 1
	bounded "$6" env -u GH_TOKEN -u GITHUB_TOKEN -u GH_ENTERPRISE_TOKEN \
		PATH="$(dirname "$1"):$PATH" GIT_CONFIG_GLOBAL="$gitconfig" GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0 \
		GIT_ASKPASS=/usr/bin/false SSH_ASKPASS=/usr/bin/false COPILOT_SKILLS_DIR="$SKILLS" SKILL_MINER_DIR="$MINER" \
		SKILL_MINER_REPO="$REPO" SKILL_MINER_RUNNER=1 \
		nice -n 10 caffeinate -i "$1" "${AGENT_ARGS[@]}" > "$5" 2>&1
}

compose_prompt() {
	prompt_text
	printf '\nThis run (set by the runner):\n'
	printf -- '- Repo: %s\n' "$(tilde "$REPO")"
	printf -- '- Installed skills: %s\n' "$(tilde "$SKILLS")"
	printf -- '- Private state: %s\n' "$(tilde "$MINER")"
	printf -- '- Run folder: %s\n' "$(tilde "$RUN_DIR")"
	printf -- '- Collected messages: %s (stats.json, digest-part-NN.md, checkpoints.txt, messages.jsonl)\n' "$(tilde "$RUN_DIR/collect")"
	printf -- '- Window: %s to %s\n' "$WINDOW_START" "$WINDOW_END"
	printf -- '- Report file: %s\n' "$(tilde "$REPORT")"
	printf -- '- Commit message file: %s\n' "$(tilde "$RUN_DIR/commit-message.txt")"
}

protected_worktree() {
	git ls-files -z --cached --others --exclude-standard -- $PROTECTED_PATHS | while IFS= read -r -d '' file; do
		[ -f "$file" ] || continue
		local mode=100644
		[ -x "$file" ] && mode=100755
		printf '%s %s\t%s\n' "$mode" "$(git hash-object -- "$file")" "$file"
	done
}

protected_tree() { git ls-tree -r "$1" -- $PROTECTED_PATHS | awk -F '\t' '{ split($1, meta, " "); print meta[1] " " meta[3] "\t" $2 }'; }

# Each protected file must end the run as it started or as origin/main has it.
protected_changes() { # before-listing
	protected_tree HEAD > "$RUN_DIR/protected-after.txt"
	protected_tree origin/main > "$RUN_DIR/protected-origin.txt"
	python3 - "$1" "$RUN_DIR/protected-after.txt" "$RUN_DIR/protected-origin.txt" <<'PY'
import sys
def load(path):
    entries = {}
    for line in open(path):
        meta, _, name = line.rstrip('\n').partition('\t')
        if name:
            entries[name] = meta
    return entries
before, after, origin = (load(path) for path in sys.argv[1:4])
changed = [name for name in sorted(set(before) | set(after) | set(origin)) if after.get(name) not in (before.get(name), origin.get(name))]
print(' '.join(changed))
sys.exit(1 if changed else 0)
PY
}

identity_public() { # commit: every author or committer email is a noreply address or already in origin/main
	local email
	for email in $(git log -1 --format='%ae %ce' "$1"); do
		case "$email" in *@users.noreply.github.com) continue ;; esac
		git log origin/main --format='%ae%n%ce' | grep -qixF "$email" || return 1
	done
}

repo_url() { git remote get-url origin | sed -E 's#^git@github.com:#https://github.com/#; s#\.git$##'; }

prepare() { # returns 0 ready, 1 failed (FAIL_REASON), 2 postponed (POSTPONE_REASON)
	local tool busy recent name
	cd "$REPO" 2>/dev/null || { FAIL_REASON="the repo folder is missing: $(tilde "$REPO")"; return 1; }
	for tool in collect-messages.py sync-skills.py validate-skills.py; do
		[ -f "tools/$tool" ] || { FAIL_REASON="tools/$tool is missing from the repo"; return 1; }
	done
	case "$(prompt_text)" in "$MARKER"*) ;; *) FAIL_REASON="the prompt block in automations/weekly-skill-miner.md is missing"; return 1 ;; esac
	[ "$(git symbolic-ref --short -q HEAD)" = main ] || { FAIL_REASON="the repo is not on its main branch"; return 1; }
	if busy="$(git_busy)"; then
		FAIL_REASON="a git operation is in progress in the repo ($busy). Finish or abort it in $(tilde "$REPO")."
		return 1
	fi
	if [ "$REHEARSAL" = 0 ] && [ "$FORCE" = 0 ] && recent="$(recent_change)"; then
		POSTPONE_REASON="a file changed in the last hour ($recent)"
		return 2
	fi
	if ! bounded 300 git fetch --quiet origin > "$LOGS/fetch.log" 2>&1; then
		FAIL_REASON="git fetch origin failed (see $(tilde "$LOGS/fetch.log"))"
		return 1
	fi
	if ! git merge-base --is-ancestor origin/main HEAD && [ -z "$(git status --porcelain)" ]; then
		if git merge --no-edit --quiet origin/main > "$LOGS/merge.log" 2>&1; then
			note "merged origin/main"
		else
			git_busy > /dev/null && git merge --abort > /dev/null 2>&1
			note "origin/main does not merge cleanly; the agent will merge it"
		fi
	fi
	WINDOW_END="$(utc_now)"
	WINDOW_START="$(json_get "$MINER/state.json" last_mined_through)"
	[ -n "$WINDOW_START" ] || WINDOW_START="$(date -u -v-8d '+%Y-%m-%dT%H:%M:%SZ')"
	RUN_DIR="$MINER/runs/$(date '+%Y-%m-%d')"
	local n=2 base="$RUN_DIR"
	while [ -e "$RUN_DIR" ]; do RUN_DIR="$base-$n"; n=$(( n + 1 )); done
	mkdir -p "$RUN_DIR"
	REPORT="$REPORTS/$(basename "$RUN_DIR") weekly skill update.txt"
	protected_worktree > "$RUN_DIR/protected-before.txt"
	name="$(git config user.name | awk '{ print $1 }')"
	if ! bounded 900 python3 tools/collect-messages.py --since "$WINDOW_START" --until "$WINDOW_END" \
		--out "$RUN_DIR/collect" --state-dir "$SESSIONS" ${name:+--name "$name"} > "$RUN_DIR/collect.log" 2>&1; then
		FAIL_REASON="collecting messages failed (see $(tilde "$RUN_DIR/collect.log"))"
		return 1
	fi
	return 0
}

# Check the agent's work, squash everything since origin/main into one commit, and push it.
publish() {
	local busy old tree base new changed message="$RUN_DIR/final-commit-message.txt"
	PUBLISH_RESULT=""
	cd "$REPO" || { PUBLISH_RESULT="Not published: the repo folder is missing."; return 1; }
	[ "$(git symbolic-ref --short -q HEAD)" = main ] || { PUBLISH_RESULT="Not published: the repo is not on main."; return 1; }
	busy="$(git_busy)" && { PUBLISH_RESULT="Not published: a git operation is still in progress ($busy)."; return 1; }
	[ -z "$(git status --porcelain)" ] || { PUBLISH_RESULT="Not published: the repo has uncommitted changes after the run (a session may be editing it). The next run publishes them."; return 1; }
	git merge-base --is-ancestor origin/main HEAD || { PUBLISH_RESULT="Not published: origin/main is not merged into main yet. The next run merges it."; return 1; }
	old="$(git rev-parse HEAD)"
	tree="$(git rev-parse 'HEAD^{tree}')"
	base="$(git rev-parse origin/main)"
	if [ "$tree" = "$(git rev-parse 'origin/main^{tree}')" ]; then
		PUBLISH_RESULT="Nothing to publish this week."
		return 0
	fi
	if ! changed="$(protected_changes "$RUN_DIR/protected-before.txt")"; then
		PUBLISH_RESULT="Not published: the run changed files it must not change ($changed)."
		return 1
	fi
	python3 - "$RUN_DIR/commit-message.txt" "$message" "$(basename "$RUN_DIR")" "$COAUTHOR" <<'PY'
import re, sys
source, target, run, coauthor = sys.argv[1:5]
try:
    lines = open(source, encoding='utf-8').read().splitlines()
except OSError:
    lines = []
lines = [line.rstrip() for line in lines if not re.match(r'(?i)^(co-authored-by|copilot-session|signed-off-by):', line.strip())]
while lines and not lines[-1]:
    lines.pop()
while lines and not lines[0]:
    lines.pop(0)
if not lines:
    lines = [f'Weekly skill update, week of {run[:10]}']
open(target, 'w', encoding='utf-8').write('\n'.join(lines) + '\n\n' + coauthor + '\n')
PY
	new="$(git commit-tree "$tree" -p "$base" -F "$message")" || { PUBLISH_RESULT="Not published: could not create the commit."; return 1; }
	git update-ref -m "weekly skill update: one commit on top of origin/main" refs/heads/main "$new" "$old" || {
		PUBLISH_RESULT="Not published: main moved during the check."
		return 1
	}
	if ! identity_public "$new"; then
		git update-ref refs/heads/main "$old" "$new"
		PUBLISH_RESULT="Not published: the commit email is not public in this repo yet. Set a GitHub noreply address with git config user.email."
		return 1
	fi
	if ! python3 tools/validate-skills.py --private-terms "$MINER/private-terms.txt" --base origin/main --commits origin/main \
		--quiet > "$RUN_DIR/validate-before-push.txt" 2>&1; then
		git update-ref refs/heads/main "$old" "$new"
		PUBLISH_RESULT="Not published: the validator found problems (see $(tilde "$RUN_DIR/validate-before-push.txt"))."
		return 1
	fi
	if [ "$REHEARSAL" = 1 ]; then
		PUBLISH_RESULT="Rehearsal: would publish $(git rev-parse --short "$new"); nothing was pushed."
		return 0
	fi
	if bounded 300 git push --quiet origin refs/heads/main:refs/heads/main > "$RUN_DIR/push.log" 2>&1; then
		PUBLISH_RESULT="Published: $(repo_url)/commit/$new"
		json_set "$MINER/runner.json" "last_published=$new"
		return 0
	fi
	PUBLISH_RESULT="Not published: git push failed (see $(tilde "$RUN_DIR/push.log")). Your skills on this Mac are updated; the next run tries again."
	return 1
}

report_line() { # text: add a line to this run's report (creating a short one if the agent wrote none)
	[ -n "$REPORT" ] || REPORT="$REPORTS/$(date '+%Y-%m-%d') weekly skill update.txt"
	[ -f "$REPORT" ] || printf 'Weekly skill update, %s\n' "$(date '+%Y-%m-%d')" > "$REPORT"
	printf '\n%s\n' "$1" >> "$REPORT"
}

fail() { # reason
	local failures
	note "failed: $1"
	if [ "$REHEARSAL" = 0 ]; then
		failures="$(json_get "$MINER/runner.json" failures)"
		json_set "$MINER/runner.json" "last_result=failed: $1" "failures:=$(( ${failures:-0} + 1 ))"
	fi
	report_line "The weekly skill update did not finish: $1
Nothing was published. Logs: $(tilde "${RUN_DIR:-$LOGS}")
It tries again at the next scheduled check. To run it now: $(tilde "$SCRIPT") --now"
}

prune() {
	find "$MINER/runs" -mindepth 1 -maxdepth 1 -type d -mtime +56 -exec rm -rf {} + 2>/dev/null
	find "$REAL_MINER/rehearsals" -mindepth 1 -maxdepth 1 -type d -mtime +30 -exec rm -rf {} + 2>/dev/null
	find "$LOGS/cli" -type f -mtime +60 -delete 2>/dev/null
	if [ -f "$LOGS/scheduler.log" ] && [ "$(wc -l < "$LOGS/scheduler.log")" -gt 3000 ]; then
		tail -n 2000 "$LOGS/scheduler.log" > "$LOGS/scheduler.log.tmp" && mv "$LOGS/scheduler.log.tmp" "$LOGS/scheduler.log"
	fi
	return 0
}

run_flow() {
	local code copilot started
	FAIL_REASON=""
	POSTPONE_REASON=""
	if ! acquire_lock; then
		note "another run is active; not starting"
		return 0
	fi
	prepare
	code=$?
	if [ "$code" -eq 2 ]; then
		note "postponed: $POSTPONE_REASON"
		return 0
	fi
	[ "$REHEARSAL" = 1 ] || json_set "$MINER/runner.json" "last_attempt=$(utc_now)"
	if [ "$code" -ne 0 ]; then fail "$FAIL_REASON"; return 1; fi
	if ! copilot="$(find_copilot)"; then fail "Copilot CLI was not found on this Mac."; return 1; fi
	note "starting $(basename "$RUN_DIR") with $MODEL (window $WINDOW_START to $WINDOW_END)"
	started=$(date +%s)
	run_agent "$copilot" "$(compose_prompt)" "$MODEL" "$RUN_DIR/usage.json" "$RUN_DIR/agent.log" "$TIME_LIMIT"
	code=$?
	if [ "$code" -eq 3 ]; then fail "the list of MCP servers to turn off could not be read"; return 1; fi
	if [ "$code" -ne 0 ] && [ $(( $(date +%s) - started )) -lt 180 ] && [ "$MODEL" != auto ]; then
		note "agent exited $code within 3 minutes; retrying with --model auto"
		run_agent "$copilot" "$(compose_prompt)" auto "$RUN_DIR/usage.json" "$RUN_DIR/agent.log.retry" "$TIME_LIMIT"
		code=$?
	fi
	note "agent finished with exit $code"
	if [ "$code" -eq 124 ]; then fail "the run took longer than $(( TIME_LIMIT / 60 )) minutes and was stopped."; return 1; fi
	if [ "$code" -ne 0 ] || [ "$(json_get "$MINER/state.json" last_run)" != "$WINDOW_END" ]; then
		fail "the agent stopped before finishing (exit $code; see $(tilde "$RUN_DIR/agent.log"))."
		return 1
	fi
	publish
	note "$PUBLISH_RESULT"
	report_line "$PUBLISH_RESULT"
	[ "$REHEARSAL" = 1 ] || json_set "$MINER/runner.json" "last_success=$(utc_now)" "failures:=0" "last_result=$PUBLISH_RESULT"
	prune
	return 0
}

due() {
	python3 - "$MINER/runner.json" <<'PY'
import datetime as dt, json, sys
try:
    data = json.load(open(sys.argv[1]))
except FileNotFoundError:
    data = {}
except ValueError:
    print('runner.json is not valid JSON (it is reset after this report)')
    sys.exit(2)
def parse(value):
    try:
        moment = dt.datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return moment if moment.tzinfo else moment.replace(tzinfo=dt.timezone.utc)
    except (TypeError, ValueError):
        return None
def answer(is_due, reason):
    print(reason)
    sys.exit(10 if is_due else 11)
now = dt.datetime.now(dt.timezone.utc)
attempt, success = parse(data.get('last_attempt')), parse(data.get('last_success'))
failures = int(data.get('failures') or 0)
saturday = dt.datetime.now().weekday() == 5
if attempt and now - attempt < dt.timedelta(hours=20):
    answer(False, 'already attempted in the last 20 hours')
if failures:
    if failures < 3:
        answer(True, f'retrying after {failures} failed run(s)')
    answer(saturday, 'Saturday retry after repeated failures' if saturday else 'waiting for Saturday after repeated failures')
if saturday and (success is None or now - success >= dt.timedelta(days=5)):
    answer(True, 'Saturday run')
if success and now - success >= dt.timedelta(days=8):
    answer(True, 'catching up on a missed Saturday')
answer(False, 'not due')
PY
}

rehearse() { # [--since ISO-TIME]
	local since="" root item code
	[ "${1:-}" = --since ] && since="${2:-}"
	root="$REAL_MINER/rehearsals/$(date '+%Y%m%d-%H%M%S')"
	mkdir -p "$root/miner"
	chmod 700 "$REAL_MINER/rehearsals" 2>/dev/null
	say "Rehearsal folder: $(tilde "$root")"
	git clone --quiet --no-local "$REPO" "$root/repo" || return 1
	git -C "$root/repo" checkout --quiet -B main "$(git -C "$REPO" rev-parse HEAD)" || return 1
	rsync -a --exclude .git "$REPO/" "$root/repo/"
	git -C "$root/repo" remote set-url origin "$(git -C "$REPO" remote get-url origin)"
	rsync -a "$SKILLS/" "$root/skills/"
	for item in private private-terms.txt state.json ledger.json installed-manifest.json installed-snapshot; do
		[ -e "$MINER/$item" ] && cp -R "$MINER/$item" "$root/miner/"
	done
	[ -n "$since" ] && json_set "$root/miner/state.json" "last_mined_through=$since"
	REHEARSAL=1
	use_paths "$root/repo" "$root/skills" "$root/miner"
	run_flow
	code=$?
	say "${PUBLISH_RESULT:-The run did not finish.}"
	say "Report: $(tilde "${REPORT:-$REPORTS}")"
	say "Changes: git -C $(tilde "$REPO") diff origin/main"
	return "$code"
}

xml_escape() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

install_job() {
	local hour intervals=""
	find_copilot > /dev/null || { say "Copilot CLI was not found. Install it, then run --install again."; return 1; }
	for hour in 9 13 17 21; do
		intervals="$intervals		<dict><key>Hour</key><integer>$hour</integer><key>Minute</key><integer>0</integer></dict>
"
	done
	mkdir -p "$HOME/Library/LaunchAgents"
	cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>$LABEL</string>
	<key>ProgramArguments</key>
	<array>
		<string>/bin/bash</string>
		<string>$(xml_escape "$SCRIPT")</string>
	</array>
	<key>StartCalendarInterval</key>
	<array>
$intervals	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>EnvironmentVariables</key>
	<dict>
		<key>PATH</key>
		<string>$(xml_escape "$PATH")</string>
	</dict>
	<key>StandardOutPath</key>
	<string>$(xml_escape "$LOGS/launchd.log")</string>
	<key>StandardErrorPath</key>
	<string>$(xml_escape "$LOGS/launchd.log")</string>
</dict>
</plist>
EOF
	plutil -lint "$PLIST" > /dev/null || { say "The schedule file did not validate: $(tilde "$PLIST")"; return 1; }
	launchctl bootout "gui/$(id -u)/$LABEL" > /dev/null 2>&1
	if launchctl bootstrap "gui/$(id -u)" "$PLIST"; then
		say "Scheduled. It runs on Saturdays (checks at 9:00, 13:00, 17:00, 21:00, and at login)."
		say "Reports: $(tilde "$REPORTS")"
	else
		say "launchctl could not load $(tilde "$PLIST")"
		return 1
	fi
}

uninstall_job() {
	launchctl bootout "gui/$(id -u)/$LABEL" > /dev/null 2>&1
	rm -f "$PLIST"
	say "Removed the schedule. Nothing else was deleted."
}

status() {
	local latest
	if launchctl print "gui/$(id -u)/$LABEL" > /dev/null 2>&1; then
		say "Schedule: on (runs on Saturdays; checks at 9:00, 13:00, 17:00, 21:00, and at login)"
	else
		say "Schedule: off (run --install)"
	fi
	python3 - "$MINER/runner.json" "$MINER/state.json" <<'PY'
import json, sys
for path, keys in ((sys.argv[1], ('last_attempt', 'last_success', 'failures', 'last_result')), (sys.argv[2], ('last_mined_through',))):
    try:
        data = json.load(open(path))
    except Exception:
        data = {}
    for key in keys:
        if key in data:
            print(f'{key}: {data[key]}')
PY
	latest="$(ls -1t "$REPORTS"/*.txt 2>/dev/null | head -1)"
	if [ -n "$latest" ]; then
		say "Latest report: $(tilde "$latest")"
		sed -n '1,15p' "$latest" | sed 's/^/  /'
	fi
	[ -f "$LOGS/scheduler.log" ] && { say "Scheduler log:"; tail -5 "$LOGS/scheduler.log" | sed 's/^/  /'; }
	return 0
}

check() { # [--llm]
	local failed=0 copilot dir servers out gitconfig
	if copilot="$(find_copilot)"; then
		say "ok    Copilot CLI $(PATH="$(dirname "$copilot"):$PATH" "$copilot" --version 2>/dev/null | head -1 | grep -oE '[0-9]+(\.[0-9]+)+'): $(tilde "$copilot")"
	else
		say "FAIL  Copilot CLI not found"
		failed=1
	fi
	case "$(prompt_text)" in "$MARKER"*) say "ok    prompt block found" ;; *) say "FAIL  prompt block missing in $(tilde "$PROCEDURE")"; failed=1 ;; esac
	for dir in collect-messages.py sync-skills.py validate-skills.py; do
		[ -f "$REPO/tools/$dir" ] || { say "FAIL  missing tools/$dir"; failed=1; }
	done
	if python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' 2>/dev/null; then
		say "ok    $(python3 --version 2>&1): $(tilde "$(command -v python3)")"
	else
		say "FAIL  python3 3.8 or newer is needed"
		failed=1
	fi
	[ -f "$MINER/private-terms.txt" ] && say "ok    private terms file" || { say "FAIL  missing $(tilde "$MINER/private-terms.txt")"; failed=1; }
	for dir in "$MINER" "$SKILLS" "$REPORTS"; do
		if mkdir -p "$dir" 2>/dev/null && touch "$dir/.write-test" 2>/dev/null && rm -f "$dir/.write-test"; then
			say "ok    can write $(tilde "$dir")"
		else
			say "FAIL  cannot write $(tilde "$dir")"
			failed=1
		fi
	done
	ls "$SESSIONS" > /dev/null 2>&1 && say "ok    can read $(tilde "$SESSIONS")" || { say "FAIL  cannot read $(tilde "$SESSIONS")"; failed=1; }
	if bounded 120 git -C "$REPO" fetch --quiet origin > /dev/null 2>&1; then say "ok    git fetch"; else say "FAIL  git fetch origin"; failed=1; fi
	if bounded 120 git -C "$REPO" push --dry-run --quiet origin refs/remotes/origin/main:refs/heads/main > /dev/null 2>&1; then
		say "ok    the runner can push (dry run, nothing sent)"
	else
		say "FAIL  git push --dry-run (the runner needs GitHub credentials)"
		failed=1
	fi
	gitconfig="$(write_agent_gitconfig)"
	if GIT_CONFIG_GLOBAL="$gitconfig" GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/usr/bin/false \
		bounded 120 git -C "$REPO" push --dry-run --quiet origin refs/remotes/origin/main:refs/heads/main > /dev/null 2>&1; then
		say "FAIL  the agent's git could push (it should have no credentials)"
		failed=1
	else
		say "ok    the agent's git has no push credentials"
	fi
	if [ -n "${copilot:-}" ] && servers="$(mcp_servers "$copilot")"; then
		say "ok    MCP servers turned off for the run: $(printf '%s' "$servers" | tr '\n' ' ')"
	else
		say "FAIL  could not list MCP servers"
		failed=1
	fi
	if [ "${1:-}" = --llm ] && [ -n "${copilot:-}" ]; then
		out="$LOGS/check-agent.log"
		run_agent "$copilot" "$MARKER Connectivity check. Do not use any tools. Reply with exactly the word READY." \
			"$MODEL" "$LOGS/usage-check.json" "$out" 300
		if grep -qw READY "$out"; then say "ok    $MODEL replied with the run's settings"; else say "FAIL  model check (see $(tilde "$out"))"; failed=1; fi
	fi
	if launchctl print "gui/$(id -u)/$LABEL" > /dev/null 2>&1; then say "ok    scheduled"; else say "note  not scheduled (run --install)"; fi
	return "$failed"
}

case "${1:-}" in
	--install) install_job ;;
	--uninstall) uninstall_job ;;
	--status) status ;;
	--check) check "${2:-}" ;;
	--now) FORCE=1; run_flow ;;
	--rehearse) shift; rehearse "$@" ;;
	"")
		reason="$(due)"
		rc=$?
		case "$rc" in
			10) note "due: $reason"; run_flow ;;
			11) note "skipped: $reason" ;;
			*) fail "the schedule check could not run (exit $rc): $reason" ;;
		esac
		;;
	*) sed -n '2,15p' "$0"; exit 2 ;;
esac

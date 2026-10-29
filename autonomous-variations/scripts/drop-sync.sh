#!/usr/bin/env bash
# Merge a lab's kit and every delivered variation into one review worktree, from the bundles in a drop folder. Run
# it on the hub against the drop server's own folder, or on any machine against a mirror made by drop.mjs pull.
#
# For the kit and each variation, <kind>-latest.txt names a bundle and its SHA-256. The bundle is checked (SHA-256,
# git bundle verify) and fetched into refs/lab/<kind>. Then the review branch is reset to the kit, every variation is
# merged into it (a conflict skips that variation and says so), and the lab's manifest tool runs when it exists.
# The review worktree belongs to this script: it is reset on every run, so never edit it by hand.
#
# Configure it with the environment:
#   LAB_REPO      the repository (required)
#   LAB_DROP      the folder with the bundles and the -latest.txt pointers (required)
#   LAB           the lab's name (default lab); the defaults below derive from it
#   LAB_WT        the review worktree (default <repo>.worktrees/lab-<LAB>-review)
#   LAB_BRANCH    the review branch (default lab-<LAB>-review)
#   LAB_DIR       the lab's folder in the repo (default labs/<LAB>)
#   LAB_MANIFEST  the manifest tool, relative to the worktree (default <LAB_DIR>/tools/manifest.mjs; empty skips it)
#   LAB_KIT       the kit's kind (default kit)
#   LAB_KINDS     an extended regex for the variations' kinds (default v[0-9]+)
#   LAB_REFNS     where fetched bundles land (default refs/lab)
#   LAB_BASE      a commit every box has, checked before anything else (optional)
#
# The last line reads "review <sha>: merged <kinds>; skipped <kinds>". Exits 1 when the kit is missing or broken.
# Runs on macOS bash 3.2 and in Git Bash on Windows.
set -euo pipefail

: "${LAB_REPO:?set LAB_REPO to the repository}"
: "${LAB_DROP:?set LAB_DROP to the drop folder}"
LAB="${LAB:-lab}"
REPO="$(git -C "$LAB_REPO" rev-parse --show-toplevel)"
DROP="$(cd "$LAB_DROP" && pwd)"
WT="${LAB_WT:-$REPO.worktrees/lab-$LAB-review}"
BRANCH="${LAB_BRANCH:-lab-$LAB-review}"
LABDIR="${LAB_DIR:-labs/$LAB}"
MANIFEST="${LAB_MANIFEST-$LABDIR/tools/manifest.mjs}"
KIT="${LAB_KIT:-kit}"
KINDS="${LAB_KINDS:-v[0-9]+}"
NS="${LAB_REFNS:-refs/lab}"

# Merges need an identity; a fresh dev box may have none.
git -C "$REPO" config user.name >/dev/null 2>&1 || export GIT_AUTHOR_NAME="lab review" GIT_COMMITTER_NAME="lab review"
git -C "$REPO" config user.email >/dev/null 2>&1 || export GIT_AUTHOR_EMAIL="lab-review@localhost" GIT_COMMITTER_EMAIL="lab-review@localhost"

sha256() {
	if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
	else shasum -a 256 "$1" | cut -d' ' -f1; fi
}
join() { local out="" x; for x in "$@"; do out="${out:+$out, }$x"; done; echo "${out:-none}"; }

fetch_kind() { # <kind>: fetch the bundle its pointer names into $NS/<kind>
	local kind="$1" latest commit file sha head
	latest="$DROP/$kind-latest.txt"
	[ -f "$latest" ] || { echo "  $kind: no pointer yet"; return 1; }
	commit=$(sed -n 1p "$latest" | tr -d '\r ')
	file=$(sed -n 2p "$latest" | tr -d '\r ')
	sha=$(sed -n 3p "$latest" | tr -d '\r ' | tr 'A-F' 'a-f')
	case "$file" in "$kind"-*.bundle) ;; *) echo "  $kind: its pointer names no $kind bundle"; return 1 ;; esac
	if [ "$(git -C "$REPO" rev-parse -q --verify "$NS/$kind^{commit}" 2>/dev/null || true)" = "$commit" ]; then
		echo "  $NS/$kind = ${commit:0:9}"
		return 0
	fi
	[ -f "$DROP/$file" ] || { echo "  $kind: $file is not here yet"; return 1; }
	[ "$(sha256 "$DROP/$file")" = "$sha" ] || { echo "  $kind: $file does not match its SHA-256"; return 1; }
	git -C "$REPO" bundle verify "$DROP/$file" >/dev/null 2>&1 \
		|| { echo "  $kind: $file fails git bundle verify (this repo may lack its base)"; return 1; }
	head=$(git -C "$REPO" bundle list-heads "$DROP/$file" | awk -v c="$commit" '$1 == c { print $2; exit }')
	[ -n "$head" ] || { echo "  $kind: $file has no ref at ${commit:0:9}"; return 1; }
	git -C "$REPO" fetch -q "$DROP/$file" "+$head:$NS/$kind" || { echo "  $kind: git fetch failed"; return 1; }
	echo "  $NS/$kind <- $file (${commit:0:9})"
}

if [ -n "${LAB_BASE:-}" ]; then
	git -C "$REPO" cat-file -e "$LAB_BASE^{commit}" 2>/dev/null || { echo "the repository lacks the base $LAB_BASE" >&2; exit 1; }
fi
echo "kit:"
fetch_kind "$KIT" || { echo "no usable kit yet; nothing merged" >&2; exit 1; }

echo "variations:"
got=()
skipped=()
for latest in "$DROP"/*-latest.txt; do
	[ -e "$latest" ] || continue
	kind=$(basename "$latest" -latest.txt)
	[ "$kind" != "$KIT" ] || continue
	echo "$kind" | grep -Eqx "$KINDS" || continue
	if fetch_kind "$kind"; then got+=("$kind"); else skipped+=("$kind"); fi
done

if [ ! -d "$WT" ]; then
	git -C "$REPO" worktree add -q -B "$BRANCH" "$WT" "$NS/$KIT"
fi
cd "$WT"
[ -z "$(git status --porcelain)" ] || { echo "the review worktree has changes this script would discard: $WT" >&2; exit 1; }
git reset -q --hard "$NS/$KIT"
merged=()
# ${arr[@]+"${arr[@]}"}: macOS bash 3.2 treats an empty array as unset under set -u.
for kind in ${got[@]+"${got[@]}"}; do
	if git merge -q --no-edit -m "Merge $kind" "$NS/$kind" >/dev/null 2>&1; then
		merged+=("$kind")
	else
		git merge --abort >/dev/null 2>&1 || git reset -q --hard HEAD
		skipped+=("$kind (conflict)")
		echo "  $kind: merge conflict, skipped"
	fi
done
if [ -n "$MANIFEST" ] && [ -f "$MANIFEST" ]; then
	if node "$MANIFEST" >/dev/null 2>&1; then
		git add -A "$LABDIR"
		git diff --cached --quiet || git commit -q -m "Review manifest"
	else
		echo "  the manifest tool failed: node $MANIFEST"
	fi
fi
echo "review $(git rev-parse --short HEAD): merged $(join ${merged[@]+"${merged[@]}"}); skipped $(join ${skipped[@]+"${skipped[@]}"})"

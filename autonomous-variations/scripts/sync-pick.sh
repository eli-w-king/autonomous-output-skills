#!/usr/bin/env bash
# Copy a picked variation's files verbatim from a lab commit into the integration worktree, and record where they
# came from in <dst-dir>/SOURCE.md.
#
# Usage (run from the integration worktree):
#   sync-pick.sh [--repo <path>] <ref> <src-dir> <dst-dir> <file>...
#
#   --repo    the repository that holds <ref> (default: the current one; lab worktrees share it)
#   ref       a lab branch, tag or commit hash, for example lab-blog or the hash the lab sent
#   src-dir   the lab's folder inside that repository, for example labs/blog ("." for the root)
#   dst-dir   where the copies live in the integration worktree, for example site/blog
#   file...   paths relative to src-dir; they keep their layout under dst-dir
#
# Files are read from the commit (git cat-file), never from a working tree, so a lab that is mid-edit cannot leak
# half-finished files. Every file is checked before anything is written. Files listed by the previous SOURCE.md that
# are no longer in the list are removed. Never edit the copies by hand: change the lab, commit, and sync again.
set -euo pipefail

usage() { sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-2}"; }

REPO=.
while [[ $# -gt 0 ]]; do
	case "$1" in
		--repo) [[ $# -ge 2 ]] || usage; REPO="$2"; shift 2 ;;
		-h|--help) usage 0 ;;
		--) shift; break ;;
		-*) echo "unknown option: $1" >&2; usage ;;
		*) break ;;
	esac
done
[[ $# -ge 4 ]] || usage

REF="$1"; SRC="$2"; DST="$3"; shift 3
FILES=("$@")

SRC="${SRC#./}"; SRC="${SRC%/}"
[[ "$SRC" == "." ]] && SRC=""
DST="${DST%/}"

git -C "$REPO" rev-parse --git-dir > /dev/null 2>&1 || { echo "not a git repository: $REPO" >&2; exit 1; }
COMMIT="$(git -C "$REPO" rev-parse --verify --quiet "$REF^{commit}")" || { echo "unknown ref: $REF" >&2; exit 1; }
SHORT="$(git -C "$REPO" rev-parse --short "$COMMIT")"
NAME="$(basename "$(git -C "$REPO" rev-parse --show-toplevel)")"

srcpath() { if [[ -n "$SRC" ]]; then printf '%s/%s' "$SRC" "$1"; else printf '%s' "$1"; fi; }

# Check every file first, so a bad list writes nothing.
for f in "${FILES[@]}"; do
	case "$f" in
		/*|../*|*/../*|*/..|..) echo "file paths must stay inside src-dir: $f" >&2; exit 1 ;;
	esac
	if [[ "$(git -C "$REPO" cat-file -t "$COMMIT:$(srcpath "$f")" 2>/dev/null)" != "blob" ]]; then
		echo "not a file in $REF ($SHORT): $(srcpath "$f")" >&2
		exit 1
	fi
done

mkdir -p "$DST"

# Remove files the previous sync wrote that the new list drops.
if [[ -f "$DST/SOURCE.md" ]]; then
	while IFS= read -r old; do
		keep=0
		for f in "${FILES[@]}"; do [[ "$f" == "$old" ]] && keep=1 && break; done
		case "$old" in /*|../*|*/../*|*/..|..|"") continue ;; esac
		if [[ $keep == 0 && -f "$DST/$old" ]]; then
			rm -f "$DST/$old"
			echo "removed $DST/$old (no longer synced)"
		fi
	done < <(sed -n 's/^- `\(.*\)`$/\1/p' "$DST/SOURCE.md")
fi

for f in "${FILES[@]}"; do
	p="$(srcpath "$f")"
	mkdir -p "$DST/$(dirname "$f")"
	git -C "$REPO" cat-file blob "$COMMIT:$p" > "$DST/$f"
	mode="$(git -C "$REPO" ls-tree "$COMMIT" -- "$p" | awk '{print $1}')"
	if [[ "$mode" == "100755" ]]; then chmod +x "$DST/$f"; fi
done

ARGS=""
[[ "$REPO" != "." ]] && ARGS="--repo $REPO "
ARGS+="$REF ${SRC:-.} $DST ${FILES[*]}"

{
	echo "# Source"
	echo
	echo "Copied verbatim by \`sync-pick.sh\` from \`$REF\` at \`$SHORT\` (\`${SRC:-.}\` in $NAME):"
	echo
	for f in "${FILES[@]}"; do echo "- \`$f\`"; done
	echo
	echo "Don't edit these files here. Change the lab, commit it, and sync again:"
	echo
	echo "    sync-pick.sh $ARGS"
} > "$DST/SOURCE.md"

echo "synced ${#FILES[@]} file(s) from $REF ($SHORT) to $DST"

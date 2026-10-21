#!/usr/bin/env python3
"""Keep the installed skills (~/.copilot/skills) and this repo in sync, in both directions.

Copilot CLI and VS Code (Insiders and Stable, including the Agents window) load personal skills from
~/.copilot/skills, so whatever is installed there is what every new session uses. Sessions also
improve skills in place, both in that folder and in this repo. This tool brings those edits back
into the repo before anything is reinstalled, so no edit is lost and the repo stays the source of
truth.

  status            show how installed copies differ from the repo (changes nothing)
  harvest           bring edits made to installed copies into the repo working tree (3-way merge)
  resolve PATH...   after merging a reported conflict into the repo by hand, mark it resolved
  install           copy the repo's skills into ~/.copilot/skills and record what was installed

Base tracking: install keeps an exact snapshot of what it installed plus a manifest in
~/.copilot/skill-miner/, so harvest knows precisely which installed files changed since and merges
them against the right base. After a file is harvested (or resolved), its installed content becomes
the new base, so install can proceed. Without a snapshot for a file (first run), the base is the
committed version of the file that is most similar to the installed copy, and anything that is not a
clean edit of the current repo version goes through a 3-way merge instead of overwriting.

Safety: only skills that exist in this repo (top-level folders with a SKILL.md) are managed; other
skills in ~/.copilot/skills are never touched. Symlinks are never followed or adopted. Install stages
complete copies first, re-checks that nobody edited an installed copy since the check, swaps one
skill at a time with rollback, and writes the snapshot and manifest last.

Usage: sync-skills.py status|harvest|resolve|install [PATH...] [--dry-run] [--json] [--include-new] [--force]
Environment: COPILOT_SKILLS_DIR (default ~/.copilot/skills), SKILL_MINER_DIR (default ~/.copilot/skill-miner)
Exit codes: 0 ok, 2 usage error, 3 conflicts or unharvested edits (nothing overwritten), 4 install rolled back
"""
import argparse
import datetime as dt
import difflib
import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SKILLS = Path(os.environ.get('COPILOT_SKILLS_DIR', '~/.copilot/skills')).expanduser()
STATE = Path(os.environ.get('SKILL_MINER_DIR', '~/.copilot/skill-miner')).expanduser()
MANIFEST = STATE / 'installed-manifest.json'
SNAPSHOT = STATE / 'installed-snapshot'
SKIP = {'.DS_Store', '__pycache__', 'node_modules', '.git'}
PENDING = ('installed-edited', 'installed-added', 'installed-deleted', 'both-changed')
KEEP_BACKUPS = 8


def fingerprint(path):
    """Content hash plus the executable bit, so mode-only edits are visible too."""
    mode = 'x' if path.stat().st_mode & stat.S_IXUSR else '-'
    return hashlib.sha256(path.read_bytes()).hexdigest() + mode


def tree(root):
    """Relative path -> fingerprint for every regular file under root. Symlinks are listed as such."""
    out = {}
    if not root.is_dir() or root.is_symlink():
        return out
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        dirnames[:] = [d for d in dirnames if d not in SKIP and not (Path(dirpath) / d).is_symlink()]
        for name in filenames:
            if name in SKIP or name.endswith('.pyc'):
                continue
            p = Path(dirpath) / name
            if p.is_symlink():
                out[str(p.relative_to(root))] = 'symlink'
            elif p.is_file():
                out[str(p.relative_to(root))] = fingerprint(p)
    return out


def has_symlink(root):
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        for name in dirnames + filenames:
            if (Path(dirpath) / name).is_symlink():
                return True
    return False


def git(*args, binary=False):
    r = subprocess.run(['git', '-C', str(REPO), *args], capture_output=True)
    if r.returncode != 0:
        return None
    return r.stdout if binary else r.stdout.decode().strip()


def repo_skills():
    return sorted(p.name for p in REPO.iterdir() if p.is_dir() and not p.is_symlink() and (p / 'SKILL.md').is_file())


def load_manifest():
    if MANIFEST.is_file():
        return json.loads(MANIFEST.read_text())
    return {'commit': None, 'skills': {}}


def write_atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + '.tmp')
    tmp.write_bytes(data)
    os.replace(tmp, path)


def record_base(manifest, skill, rel, installed_path):
    """The installed content of this file is now accounted for in the repo: make it the base."""
    snap = SNAPSHOT / skill / rel
    if installed_path is None:
        manifest['skills'].setdefault(skill, {}).pop(rel, None)
        if snap.exists():
            snap.unlink()
        return
    snap.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(installed_path, snap)
    manifest['skills'].setdefault(skill, {})[rel] = fingerprint(installed_path)


def save_manifest(manifest):
    write_atomic(MANIFEST, json.dumps(manifest, indent=1).encode())


def similar_base(skill, rel, installed_bytes):
    """First run only: the committed version most similar to the installed copy, or None if the
    installed copy is byte-identical to some commit (then it is simply older or current)."""
    gpath = f'{skill}/{rel}'
    best, best_ratio = None, -1.0
    lines = installed_bytes.decode('utf-8', 'replace').splitlines()
    for commit in (git('log', '--format=%H', '-n', '60', '--', gpath) or '').split():
        content = git('show', f'{commit}:{gpath}', binary=True)
        if content is None:
            continue
        if content == installed_bytes:
            return None
        ratio = difflib.SequenceMatcher(None, content.decode('utf-8', 'replace').splitlines(), lines, autojunk=False).ratio()
        if ratio > best_ratio:
            best, best_ratio = content, ratio
    return best if best is not None else b''


def classify():
    manifest = load_manifest()
    entries = []
    for skill in repo_skills():
        inst_root, repo_root = SKILLS / skill, REPO / skill
        if inst_root.is_symlink():
            entries.append({'skill': skill, 'path': '', 'state': 'symlinked-install (left alone; replace it with a real folder)'})
            continue
        inst, repo = tree(inst_root), tree(repo_root)
        base = manifest['skills'].get(skill, {})
        for rel in sorted(set(inst) | set(repo) | set(base)):
            i, r, b = inst.get(rel), repo.get(rel), base.get(rel)
            if 'symlink' in (i, r):
                entries.append({'skill': skill, 'path': rel, 'state': 'symlink (ignored)'})
                continue
            if i == r and (i is not None or b is None):
                continue
            entry = {'skill': skill, 'path': rel}
            if rel in base:
                entry['base_source'] = 'snapshot'
                if i == r:
                    entry['state'] = 'deleted-both'
                elif i is None:
                    entry['state'] = 'installed-deleted' if r == b else ('repo-newer' if r is not None and b is None else 'both-changed')
                elif r is None:
                    entry['state'] = 'repo-deleted' if i == b else 'both-changed'
                elif i == b:
                    entry['state'] = 'repo-newer'
                elif r == b:
                    entry['state'] = 'installed-edited'
                else:
                    entry['state'] = 'both-changed'
            else:
                entry['base_source'] = 'git history'
                if i is None:
                    entry['state'] = 'repo-newer'
                elif r is None:
                    # A stale copy of a file the repo deleted must not come back; an edited one is a conflict.
                    content = similar_base(skill, rel, (inst_root / rel).read_bytes())
                    if content is None:
                        entry['state'] = 'repo-deleted'
                    elif content == b'':
                        entry['state'] = 'installed-added'
                    else:
                        entry['state'] = 'both-changed'
                        entry['inferred_base'] = content.decode('utf-8', 'replace')
                else:
                    installed_bytes = (inst_root / rel).read_bytes()
                    repo_bytes = (repo_root / rel).read_bytes()
                    if installed_bytes == repo_bytes:
                        entry['state'] = 'mode-changed'
                    else:
                        content = similar_base(skill, rel, installed_bytes)
                        if content is None:
                            entry['state'] = 'repo-newer'
                        elif content == repo_bytes:
                            entry['state'] = 'installed-edited'
                        else:
                            entry['state'] = 'both-changed'
                            entry['inferred_base'] = content.decode('utf-8', 'replace')
            entries.append(entry)
    extra = []
    known = set(manifest['skills'])
    managed = set(repo_skills())
    if SKILLS.is_dir():
        for d in sorted(SKILLS.iterdir()):
            if d.name in managed or not (d / 'SKILL.md').exists():
                continue
            if d.is_symlink():
                kind = 'symlink (ignored)'
            elif (d / '.bundled-version').exists():
                kind = 'bundled (ignored)'
            elif d.name in known:
                kind = 'removed-from-repo (install backs it up and removes it)'
            elif has_symlink(d):
                kind = 'local-only, contains symlinks (not adoptable)'
            else:
                kind = 'local-only (created outside the repo; harvest --include-new adds it)'
            extra.append({'skill': d.name, 'state': kind})
    return manifest, entries, extra


def base_bytes(entry):
    if 'inferred_base' in entry:
        return entry['inferred_base'].encode()
    snap = SNAPSHOT / entry['skill'] / entry['path']
    return snap.read_bytes() if snap.is_file() else b''


def cmd_status(args):
    _, entries, extra = classify()
    if args.json:
        print(json.dumps({'repo': str(REPO), 'skills_dir': str(SKILLS), 'manifest': MANIFEST.is_file(),
                          'files': [{k: v for k, v in e.items() if k != 'inferred_base'} for e in entries],
                          'other_skills': extra}, indent=1))
        return 0
    print(f'repo {REPO}\ninstalled {SKILLS}\nbase {"snapshot from last install" if MANIFEST.is_file() else "none yet (inferred from git history)"}\n')
    if not entries:
        print('installed copies match the repo')
    for e in entries:
        print(f"{e['state']:18} {e['skill']}/{e['path']}")
    for x in extra:
        print(f"{'':18} {x['skill']}: {x['state']}")
    pending = [e for e in entries if e['state'] in PENDING]
    newer = [e for e in entries if e['state'] in ('repo-newer', 'repo-deleted', 'mode-changed')]
    print(f'\n{len(pending)} installed edit(s) to harvest, {len(newer)} repo change(s) to install')
    return 0


def cmd_harvest(args):
    manifest, entries, extra = classify()
    stamp = dt.datetime.now().strftime('%Y%m%d-%H%M%S')
    conflicts, applied = [], []
    for e in entries:
        if e['state'] not in PENDING and e['state'] != 'deleted-both':
            continue
        src, dst = SKILLS / e['skill'] / e['path'], REPO / e['skill'] / e['path']
        label = f"{e['skill']}/{e['path']}"
        if e['state'] in ('installed-edited', 'installed-added'):
            applied.append(f"{e['state']}: {label}")
            if not args.dry_run:
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dst)
                record_base(manifest, e['skill'], e['path'], src)
        elif e['state'] == 'installed-deleted':
            applied.append(f'deleted (a session removed it): {label}')
            if not args.dry_run:
                dst.unlink()
                record_base(manifest, e['skill'], e['path'], None)
        elif e['state'] == 'deleted-both':
            if not args.dry_run:
                record_base(manifest, e['skill'], e['path'], None)
        else:
            ours = dst.read_bytes() if dst.is_file() else None
            theirs = src.read_bytes() if src.is_file() else None
            base = base_bytes(e)
            merged, result = b'', 1
            if ours is not None and theirs is not None and b'\0' not in ours + theirs + base:
                with tempfile.TemporaryDirectory() as tmp:
                    t = Path(tmp)
                    (t / 'ours').write_bytes(ours)
                    (t / 'base').write_bytes(base)
                    (t / 'theirs').write_bytes(theirs)
                    r = subprocess.run(['git', 'merge-file', '-p', '-L', 'repo', '-L', 'base', '-L', 'installed',
                                        str(t / 'ours'), str(t / 'base'), str(t / 'theirs')], capture_output=True)
                    result, merged = r.returncode, r.stdout
            if result == 0:
                applied.append(f'merged both sides: {label}')
                if not args.dry_run:
                    dst.write_bytes(merged)
                    record_base(manifest, e['skill'], e['path'], src)
            else:
                out = STATE / 'conflicts' / stamp / e['skill'] / e['path']
                conflicts.append(f'{label}  (saved as {out}.repo|.base|.installed|.merged-with-markers)')
                if not args.dry_run:
                    out.parent.mkdir(parents=True, exist_ok=True)
                    for suffix, data in (('repo', ours), ('base', base), ('installed', theirs), ('merged-with-markers', merged)):
                        Path(f'{out}.{suffix}').write_bytes(data or b'')
    for x in extra:
        if x['state'].startswith('local-only (') and args.include_new:
            applied.append(f"new skill: {x['skill']}")
            if not args.dry_run:
                shutil.copytree(SKILLS / x['skill'], REPO / x['skill'], symlinks=True,
                                ignore=shutil.ignore_patterns(*SKIP, '*.pyc'))
    if not args.dry_run and applied:
        save_manifest(manifest)
    print(f"{'would apply' if args.dry_run else 'applied'} {len(applied)} change(s)" + ''.join(f'\n  {a}' for a in applied))
    if conflicts:
        print(f'{len(conflicts)} conflict(s); the repo files were left unchanged. Merge each one into the repo file by hand,'
              f' then run: sync-skills.py resolve <skill/path>' + ''.join(f'\n  {c}' for c in conflicts))
    local_only = [x['skill'] for x in extra if x['state'].startswith('local-only (')]
    if local_only and not args.include_new:
        print('local-only skills not in the repo (review them, then rerun with --include-new): ' + ', '.join(local_only))
    return 3 if conflicts else 0


def cmd_resolve(args):
    if not args.paths:
        print('usage: sync-skills.py resolve <skill/path> [...]  (after merging the conflict into the repo file)')
        return 2
    manifest = load_manifest()
    for p in args.paths:
        skill, _, rel = p.partition('/')
        repo_file, installed = REPO / skill / rel, SKILLS / skill / rel
        if repo_file.is_file() and b'<<<<<<<' in repo_file.read_bytes():
            print(f'{p}: the repo file still has conflict markers; finish the merge first')
            return 3
        record_base(manifest, skill, rel, installed if installed.is_file() else None)
        print(f'resolved {p}: the installed edit is recorded as merged; install will replace the installed copy')
    save_manifest(manifest)
    return 0


def prune_backups(root):
    if not root.is_dir():
        return
    olds = sorted(p for p in root.iterdir() if p.is_dir())
    for old in olds[:-KEEP_BACKUPS]:
        shutil.rmtree(old, ignore_errors=True)


def cmd_install(args):
    manifest, entries, extra = classify()
    pending = [e for e in entries if e['state'] in PENDING]
    if pending and not args.force:
        print('refusing to install: installed copies have edits that are not in the repo yet. Run harvest first.')
        for e in pending:
            print(f"  {e['state']}: {e['skill']}/{e['path']}")
        return 3
    skills = repo_skills()
    changed = sorted({e['skill'] for e in entries if not e['state'].startswith('symlink')} |
                     {s for s in skills if not (SKILLS / s).exists()})
    removed = [x['skill'] for x in extra if x['state'].startswith('removed-from-repo')]
    print(f"{'would install' if args.dry_run else 'installing'} {len(changed)} skill(s): {', '.join(changed) or 'none'}")
    if removed:
        print(f"{'would remove' if args.dry_run else 'removing'} skills no longer in the repo: {', '.join(removed)}")
    if args.dry_run:
        return 0
    stamp = dt.datetime.now().strftime('%Y%m%d-%H%M%S')
    SKILLS.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix='.skills-staging-', dir=SKILLS.parent))
    backup = SKILLS.parent / 'skills-backup' / stamp
    done = []
    try:
        for s in changed:
            shutil.copytree(REPO / s, staging / s, symlinks=True, ignore=shutil.ignore_patterns(*SKIP, '*.pyc'))
            if tree(staging / s) != tree(REPO / s):
                raise RuntimeError(f'staged copy of {s} does not match the repo')
        before = {s: tree(SKILLS / s) for s in changed + removed}
        _, again, _ = classify()
        if [e for e in again if e['state'] in PENDING] and not args.force:
            raise RuntimeError('an installed copy was edited during install; run harvest again')
        for s in changed + removed:
            if tree(SKILLS / s) != before[s]:
                raise RuntimeError(f'{s} changed during install; run harvest again')
        for s in changed + removed:
            moved = (SKILLS / s).exists()
            if moved:
                backup.mkdir(parents=True, exist_ok=True)
                os.replace(SKILLS / s, backup / s)
            done.append((s, moved))
            if s in changed:
                if os.environ.get('SYNC_SKILLS_FAIL_AT') == s:
                    raise RuntimeError(f'simulated failure while installing {s}')
                os.replace(staging / s, SKILLS / s)
    except Exception as error:
        for s, moved in reversed(done):
            if (SKILLS / s).exists():
                shutil.rmtree(SKILLS / s, ignore_errors=True)
            if moved and (backup / s).exists():
                os.replace(backup / s, SKILLS / s)
        shutil.rmtree(staging, ignore_errors=True)
        print(f'install rolled back, nothing changed: {error}')
        return 4
    shutil.rmtree(staging, ignore_errors=True)
    new_snapshot = STATE / f'installed-snapshot.{stamp}'
    for s in skills:
        if (SKILLS / s).is_dir():
            shutil.copytree(SKILLS / s, new_snapshot / s, symlinks=True, ignore=shutil.ignore_patterns(*SKIP, '*.pyc'))
    old_snapshot = STATE / f'installed-snapshot.old-{stamp}'
    if SNAPSHOT.exists():
        os.replace(SNAPSHOT, old_snapshot)
    os.replace(new_snapshot, SNAPSHOT)
    shutil.rmtree(old_snapshot, ignore_errors=True)
    save_manifest({
        'commit': git('rev-parse', 'HEAD'), 'repo_dirty': bool(git('status', '--porcelain')),
        'installed_at': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
        'skills': {s: tree(SKILLS / s) for s in skills},
    })
    prune_backups(SKILLS.parent / 'skills-backup')
    if backup.exists():
        print(f'previous copies backed up to {backup}')
    print(f'installed; base recorded in {STATE}')
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('command', choices=['status', 'harvest', 'resolve', 'install'])
    parser.add_argument('paths', nargs='*', help='resolve: skill/path entries to mark as merged')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--json', action='store_true', help='status only')
    parser.add_argument('--include-new', action='store_true', help='harvest: also copy local-only skills into the repo')
    parser.add_argument('--force', action='store_true', help='install even if installed copies have unharvested edits')
    args = parser.parse_args()
    STATE.mkdir(parents=True, exist_ok=True)
    return {'status': cmd_status, 'harvest': cmd_harvest, 'resolve': cmd_resolve, 'install': cmd_install}[args.command](args)


if __name__ == '__main__':
    sys.exit(main())

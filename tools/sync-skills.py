#!/usr/bin/env python3
"""Keep the installed skills (~/.copilot/skills) and the skills repo in sync, in both directions, on
every machine.

Copilot CLI and VS Code (Insiders and Stable, including the Agents window) load personal skills from
~/.copilot/skills, so whatever is installed there is what every new session uses. Sessions also
improve skills in place, both in that folder and in this repo. This tool brings those edits back
into the repo before anything is reinstalled, so no edit is lost and the repo stays the source of
truth.

  status            show how installed copies differ from the repo (changes nothing)
  harvest           bring edits made to installed copies into the repo working tree (3-way merge)
  resolve PATH...   after merging a reported conflict into the repo by hand, mark it resolved
  install           copy the repo's skills into ~/.copilot/skills and record what was installed
  sync              what the schedule runs on every machine (below)
  setup             point this machine's clone at the private repo (origin) and the public one (public)
  schedule          run sync once a day and at logon (Task Scheduler, launchd, or a crontab line), at the time
                    private/sync-schedule.txt sets for this machine (daily at 10:30 without that file)
  sync-status       the settings, the schedule, the last runs, and open conflicts

Two repos: the private repo (remote origin) has everything, including private/, and the public repo
(remote public) gets the same tree without private/ through tools/publish-public.py. sync pushes only
to origin. setup records the private repo's URL and GitHub account in ~/.copilot/skills-sync.json and
gives that one URL its own git credential helper, which asks GitHub CLI for that account's token, so
the public remote keeps GitHub CLI's default account.

sync takes a lock, skips the run while the weekly miner holds its lock, and exits within seconds when
nothing changed (one git ls-remote and a fingerprint check). Otherwise it pulls (fast-forward),
harvests edits made to installed copies and commits them, with any other edits in this clone, as
"Sync from <host>: <skills>"; blocks secrets (validate-skills.py --secrets-only); rebases or merges
onto origin/main and pushes; then installs. On a conflict it pushes the local version to a branch
conflict/<host>/<time> and leaves that skill as it is installed. A skill named in retired.txt is
backed up and removed from ~/.copilot/skills; edits a session made to it are first saved under
private/rescued/<host>/. Each run appends one line, with its duration, to ~/.copilot/skills-sync.log.
It never prompts (GIT_TERMINAL_PROMPT=0, GCM_INTERACTIVE=never).

Schedule: private/sync-schedule.txt in the private repo says when each machine syncs. Every sync reads
it after pulling; when the rule for this machine changed, it re-registers its own job (only a job that
runs this clone's sync-skills.py), records it in private/machines/<host>.txt, and commits that, so a
change to the file reaches every machine at its next run. launchd cannot reload a job from inside it,
so on macOS a helper reloads it right after the run, and the next run confirms it.

Base tracking: install keeps an exact snapshot of what it installed plus a manifest in
~/.copilot/skill-miner/, so harvest knows precisely which installed files changed since and merges
them against the right base. After a file is harvested (or resolved), its installed content becomes
the new base, so install can proceed. Without a snapshot for a file (first run), the base is the
committed version of the file that is most similar to the installed copy, and anything that is not a
clean edit of the current repo version goes through a 3-way merge instead of overwriting. Text is
compared with LF line endings, so a CRLF copy on Windows is not an edit; install writes LF.

Safety: only skills that exist in this repo (top-level folders with a SKILL.md) are managed; other
skills in ~/.copilot/skills are never touched. Symlinks are never followed or adopted. Install stages
complete copies first, re-checks that nobody edited an installed copy since the check, swaps one
skill at a time with rollback, leaves alone a skill whose installed copy has unharvested edits, and
writes the snapshot and manifest last.

Usage: sync-skills.py status|harvest|resolve|install [PATH...] [--dry-run] [--json] [--include-new] [--force]
       sync-skills.py sync [--repo CLONE]
       sync-skills.py setup --private-url URL --private-user NAME [--public-url URL] [--public-user NAME] [--host NAME]
       sync-skills.py schedule [--daily HH:MM | --every MINUTES] [--remove]
       sync-skills.py sync-status
Environment: COPILOT_SKILLS_DIR (default ~/.copilot/skills), SKILL_MINER_DIR (default ~/.copilot/skill-miner)
Exit codes: 0 ok, 1 error, 2 usage error, 3 conflicts or unharvested edits (nothing overwritten), 4 install rolled back
"""
import argparse
import datetime as dt
import difflib
import fnmatch
import hashlib
import html
import json
import os
import plistlib
import re
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]  # --repo changes it
VALIDATOR = Path(__file__).resolve().parent / 'validate-skills.py'
SKILLS = Path(os.environ.get('COPILOT_SKILLS_DIR', '~/.copilot/skills')).expanduser()
STATE = Path(os.environ.get('SKILL_MINER_DIR', '~/.copilot/skill-miner')).expanduser()
MANIFEST = STATE / 'installed-manifest.json'
SNAPSHOT = STATE / 'installed-snapshot'
HOME_DIR = SKILLS.parent
SETTINGS = Path(os.environ.get('SKILLS_SYNC_SETTINGS', str(HOME_DIR / 'skills-sync.json'))).expanduser()
SYNC_LOG = HOME_DIR / 'skills-sync.log'
SYNC_LOCK = HOME_DIR / 'skills-sync.lock'
MINER_LOCK = STATE / 'lock'
SYNC_STATE = STATE / 'sync-state.json'
BACKUPS = HOME_DIR / 'skills-backup'
SKIP = {'.DS_Store', '__pycache__', 'node_modules', '.git'}
PENDING = ('installed-edited', 'installed-added', 'installed-deleted', 'both-changed')
KEEP_BACKUPS = 20
KEEP_CRLF = {'.cmd', '.bat'}
QUIET_SECONDS = 120
# The private-only my-taste skill: the one machine whose settings name my_taste_source (where its daily update
# writes the skill) copies these files in when they change there. .publishignore keeps my-taste/ out of every publish.
MY_TASTE_FILES = ('SKILL.md', 'references/vscode-conventions.md')
INBOX_DAYS = 14
MINER_FILES = (  # private/skill-miner/<name> in the repo <-> ~/.copilot/skill-miner/<path>
    ('voice-samples.md', 'private/voice-samples.md'),
    ('notes.md', 'private/notes.md'),
    ('state.json', 'state.json'),
    ('ledger.json', 'ledger.json'),
    ('runner.json', 'runner.json'),
)
CLI_DEFAULTS = {'model': 'claude-opus-5.5', 'effortLevel': 'max', 'contextTier': 'long_context'}
CLI_SUBAGENTS = ('explore', 'task', 'general-purpose', 'rubber-duck', 'code-review', 'research', 'security-review')
CLI_DEFAULTS_VERSION = 1
MAX_COMMIT_BYTES = 5 * 1024 * 1024
DEFAULT_PUBLIC_URL = 'https://github.com/eli-w-king/autonomous-output-skills.git'
DEFAULT_PUBLIC_USER = 'eli-w-king'
TASK_NAME = os.environ.get('SKILLS_SYNC_TASK', 'Autonomous skills sync')
OLD_TASK_NAME = 'Autonomous skills update'
LAUNCHD_LABEL = os.environ.get('SKILLS_SYNC_LABEL', 'com.autonomous-output-skills.skills-sync')
# When each machine syncs: one rule per line, read by every sync (see read_schedule_rules).
SCHEDULE_FILE = 'private/sync-schedule.txt'
DEFAULT_SCHEDULE = 'daily 10:30'
RELOAD_MARKER = STATE / 'schedule-reloaded.txt'
COAUTHOR = 'Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>'

GIT_ENV = {k: v for k, v in os.environ.items() if k not in ('GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN')}
GIT_ENV.update(GIT_TERMINAL_PROMPT='0', GCM_INTERACTIVE='never', GIT_EDITOR='true', GIT_MERGE_AUTOEDIT='no')


# ---------------------------------------------------------------- files and fingerprints

def is_text(data):
    return b'\0' not in data[:8192]


def normalized(data, name=''):
    """Text with LF line endings (Windows batch files keep CRLF), binary files as they are."""
    if not is_text(data) or Path(name).suffix.lower() in KEEP_CRLF:
        return data
    return data.replace(b'\r\n', b'\n')


def content(path):
    return normalized(path.read_bytes(), path.name)


def fingerprint(path):
    """Content hash (LF line endings) plus the executable bit, so mode-only edits are visible too."""
    mode = 'x' if path.stat().st_mode & stat.S_IXUSR else '-'
    return hashlib.sha256(content(path)).hexdigest() + mode


def tree(root):
    """Relative path (with /) -> fingerprint for every regular file under root. Symlinks are listed as such."""
    out = {}
    if not root.is_dir() or root.is_symlink():
        return out
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP and not (Path(dirpath) / d).is_symlink())
        for name in filenames:
            if name in SKIP or name.endswith('.pyc'):
                continue
            p = Path(dirpath) / name
            rel = p.relative_to(root).as_posix()
            if p.is_symlink():
                out[rel] = 'symlink'
            elif p.is_file():
                out[rel] = fingerprint(p)
    return out


def crlf_files(root):
    """Text files that still have CRLF line endings (an older install on Windows)."""
    out = []
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        dirnames[:] = [d for d in dirnames if d not in SKIP and not (Path(dirpath) / d).is_symlink()]
        for name in filenames:
            p = Path(dirpath) / name
            if name in SKIP or p.is_symlink() or Path(name).suffix.lower() in KEEP_CRLF:
                continue
            data = p.read_bytes()
            if is_text(data) and b'\r\n' in data:
                out.append(p.relative_to(root).as_posix())
    return out


def has_symlink(root):
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        for name in dirnames + filenames:
            if (Path(dirpath) / name).is_symlink():
                return True
    return False


def copy_skill(src, dst):
    """Copy a skill folder, writing text files with LF line endings."""
    for dirpath, dirnames, filenames in os.walk(src, followlinks=False):
        dirnames[:] = [d for d in dirnames if d not in SKIP and not (Path(dirpath) / d).is_symlink()]
        target = dst / Path(dirpath).relative_to(src)
        target.mkdir(parents=True, exist_ok=True)
        for name in filenames:
            if name in SKIP or name.endswith('.pyc'):
                continue
            s, d = Path(dirpath) / name, target / name
            if s.is_symlink():
                try:
                    os.symlink(os.readlink(s), d)
                except OSError:
                    pass
                continue
            d.write_bytes(content(s))
            shutil.copymode(s, d)


def retry(fn):
    """Windows refuses to move a folder while another process has a file in it open; wait a little."""
    for attempt in range(1, 7):
        try:
            return fn()
        except PermissionError:
            if attempt == 6:
                raise
            time.sleep(0.5 * attempt)


def write_atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + '.tmp')
    tmp.write_bytes(data)
    os.replace(tmp, path)


def tilde(path):
    text = str(path)
    home = str(Path.home())
    return '~' + text[len(home):] if text.startswith(home) else text


def now_iso():
    return dt.datetime.now().astimezone().isoformat(timespec='seconds')


# ---------------------------------------------------------------- git

def git(*args, binary=False):
    r = subprocess.run(['git', '-C', str(REPO), *args], capture_output=True, env=GIT_ENV)
    if r.returncode != 0:
        return None
    return r.stdout if binary else r.stdout.decode('utf-8', 'replace').strip()


def g(*args, timeout=120, input=None, env=None):
    """git in the repo: (exit code, stdout, stderr) as text."""
    r = subprocess.run(['git', '-C', str(REPO), *args], capture_output=True, timeout=timeout, input=input,
                       env=env or GIT_ENV)
    return r.returncode, r.stdout.decode('utf-8', 'replace').strip(), r.stderr.decode('utf-8', 'replace').strip()


def first_error(text):
    lines = [line.strip() for line in (text or '').splitlines() if line.strip()]
    for line in lines:
        if line.startswith(('fatal:', 'error:', 'remote:', 'ERROR')):
            return line[:200]
    return (lines[0] if lines else 'no output')[:200]


def rev(ref):
    return git('rev-parse', '-q', '--verify', ref) or ''


def count(spec):
    out = git('rev-list', '--count', spec)
    return int(out) if out and out.isdigit() else 0


def is_ancestor(a, b):
    return subprocess.run(['git', '-C', str(REPO), 'merge-base', '--is-ancestor', a, b], capture_output=True,
                          env=GIT_ENV).returncode == 0


def git_busy():
    gd = git('rev-parse', '--git-dir')
    if not gd:
        return 'not a git repository'
    gd = Path(gd) if Path(gd).is_absolute() else REPO / gd
    for item in ('MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG'):
        if (gd / item).exists():
            return item
    return None


def dirty_paths():
    """(status, path) for every changed, added, deleted, or untracked file in the clone."""
    r = subprocess.run(['git', '-C', str(REPO), '--no-optional-locks', 'status', '--porcelain=v1', '-z',
                        '--untracked-files=all'], capture_output=True, env=GIT_ENV)
    items = r.stdout.decode('utf-8', 'surrogateescape').split('\0')
    out, i = [], 0
    while i < len(items):
        entry = items[i]
        i += 1
        if len(entry) < 4:
            continue
        xy, path = entry[:2], entry[3:]
        if 'R' in xy or 'C' in xy:
            i += 1  # the old name follows
        out.append((xy, path))
    return out


def same_url(a, b):
    def norm(u):
        u = (u or '').strip().rstrip('/')
        return (u[:-4] if u.endswith('.git') else u).lower()
    return bool(a) and norm(a) == norm(b)


def repo_skills():
    return sorted(p.name for p in REPO.iterdir() if p.is_dir() and not p.is_symlink() and (p / 'SKILL.md').is_file())


def retired_names():
    """Skill names in retired.txt (one per line, # comments) that the repo no longer has."""
    f = REPO / 'retired.txt'
    if not f.is_file():
        return []
    current = set(repo_skills())
    names = []
    for line in f.read_text(encoding='utf-8').splitlines():
        name = line.split('#', 1)[0].strip()
        if name and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*', name) and name not in current:
            names.append(name)
    return names


_versions = {}


def committed_versions(gpath, limit=60):
    """Every committed version of a file (LF line endings), newest first."""
    if gpath not in _versions:
        out = []
        for commit in (git('log', '--format=%H', '-n', str(limit), '--', gpath) or '').split():
            blob = git('show', f'{commit}:{gpath}', binary=True)
            if blob is not None:
                out.append(normalized(blob, gpath))
        _versions[gpath] = out
    return _versions[gpath]


# ---------------------------------------------------------------- manifest and classification

def load_manifest():
    if MANIFEST.is_file():
        data = json.loads(MANIFEST.read_text(encoding='utf-8-sig'))
        data.setdefault('skills', {})
        return data
    return {'commit': None, 'skills': {}}


def save_manifest(manifest):
    write_atomic(MANIFEST, json.dumps(manifest, indent=1).encode())


def record_base(manifest, skill, rel, installed_path, undo=None):
    """The installed content of this file is now accounted for in the repo: make it the base."""
    snap = SNAPSHOT / skill / rel
    if undo is not None:
        undo.append((skill, rel, snap.read_bytes() if snap.is_file() else None))
    if installed_path is None:
        manifest['skills'].setdefault(skill, {}).pop(rel, None)
        if snap.exists():
            snap.unlink()
        return
    snap.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(installed_path, snap)
    manifest['skills'].setdefault(skill, {})[rel] = fingerprint(installed_path)


def rollback_bases(undo, manifest_before):
    """Undo record_base calls, so the edits they accounted for count as unharvested again."""
    for skill, rel, old in reversed(undo):
        snap = SNAPSHOT / skill / rel
        if old is None:
            if snap.exists():
                snap.unlink()
        else:
            snap.parent.mkdir(parents=True, exist_ok=True)
            snap.write_bytes(old)
    if manifest_before is None:
        if MANIFEST.exists():
            MANIFEST.unlink()
    else:
        write_atomic(MANIFEST, manifest_before)


def merge3(ours, base, theirs):
    """git merge-file: (clean, merged bytes). Binary input never merges."""
    if b'\0' in ours + base + theirs:
        return False, b''
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        (t / 'ours').write_bytes(ours)
        (t / 'base').write_bytes(base)
        (t / 'theirs').write_bytes(theirs)
        r = subprocess.run(['git', 'merge-file', '-p', '-L', 'repo', '-L', 'base', '-L', 'installed',
                            str(t / 'ours'), str(t / 'base'), str(t / 'theirs')], capture_output=True, env=GIT_ENV)
        return r.returncode == 0, r.stdout


def infer_base(skill, rel, installed, repo_bytes):
    """First run only (no snapshot): which committed version the installed copy grew from.

    None means there is nothing to harvest: the installed copy matches a commit, or every change in it
    is already in the repo (a 3-way merge against some earlier version gives exactly the repo file; for
    example, its edits were harvested or rescued elsewhere and the repo moved on). Otherwise the
    committed version most similar to the installed copy, or b'' when the file was never committed."""
    versions = committed_versions(f'{skill}/{rel}')
    if installed in versions:
        return None
    lines = installed.decode('utf-8', 'replace').splitlines()
    ranked = sorted(versions, key=lambda v: difflib.SequenceMatcher(
        None, v.decode('utf-8', 'replace').splitlines(), lines, autojunk=False).ratio(), reverse=True)
    if repo_bytes is not None:
        for version in ranked[:12]:
            if version != repo_bytes and merge3(repo_bytes, version, installed) == (True, repo_bytes):
                return None
    return ranked[0] if ranked else b''


def classify():
    manifest = load_manifest()
    entries = []
    skills = repo_skills()
    for skill in skills:
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
                    entry['state'] = 'installed-deleted' if r == b else 'both-changed'
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
                    found = infer_base(skill, rel, content(inst_root / rel), None)
                    if found is None:
                        entry['state'] = 'repo-deleted'
                    elif found == b'':
                        entry['state'] = 'installed-added'
                    else:
                        entry['state'] = 'both-changed'
                        entry['inferred_base'] = found
                else:
                    installed_bytes, repo_bytes = content(inst_root / rel), content(repo_root / rel)
                    if installed_bytes == repo_bytes:
                        entry['state'] = 'mode-changed'
                    else:
                        found = infer_base(skill, rel, installed_bytes, repo_bytes)
                        if found is None:
                            entry['state'] = 'repo-newer'
                        elif found == repo_bytes:
                            entry['state'] = 'installed-edited'
                        else:
                            entry['state'] = 'both-changed'
                            entry['inferred_base'] = found
            entries.append(entry)
        if os.name == 'nt' and inst_root.is_dir():
            listed = {e['path'] for e in entries if e['skill'] == skill}
            for rel in crlf_files(inst_root):
                if rel not in listed and inst.get(rel) == repo.get(rel):
                    entries.append({'skill': skill, 'path': rel, 'state': 'line-endings'})
    extra = []
    known = set(manifest['skills'])
    managed = set(skills)
    retired = set(retired_names())
    if SKILLS.is_dir():
        for d in sorted(SKILLS.iterdir()):
            if d.name in managed or not d.is_dir():
                continue
            if d.name not in retired and not (d / 'SKILL.md').exists():
                continue
            if d.is_symlink():
                kind = 'symlink (ignored)'
            elif (d / '.bundled-version').exists():
                kind = 'bundled (ignored)'
            elif d.name in retired:
                kind = 'retired (install backs it up and removes it)'
            elif d.name in known:
                kind = 'removed-from-repo (install backs it up and removes it)'
            elif has_symlink(d):
                kind = 'local-only, contains symlinks (not adoptable)'
            else:
                kind = 'local-only (created outside the repo; harvest --include-new adds it)'
            extra.append({'skill': d.name, 'state': kind})
    return manifest, entries, extra


def removals(extra):
    return [x['skill'] for x in extra if x['state'].startswith(('retired', 'removed-from-repo'))]


def unrescued_edits(name, manifest):
    """Files in an installed skill that is going away, edited since the last install and in no commit."""
    root, base = SKILLS / name, manifest['skills'].get(name)
    out = []
    for rel, fp in tree(root).items():
        if fp == 'symlink' or (base is not None and base.get(rel) == fp):
            continue
        data = content(root / rel)
        if any(v == data for v in committed_versions(f'{name}/{rel}')):
            continue
        out.append(rel)
    return out


def base_bytes(entry):
    if 'inferred_base' in entry:
        return entry['inferred_base']
    snap = SNAPSHOT / entry['skill'] / entry['path']
    return content(snap) if snap.is_file() else b''


# ---------------------------------------------------------------- status, harvest, resolve, install

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
    newer = [e for e in entries if e['state'] in ('repo-newer', 'repo-deleted', 'mode-changed', 'line-endings')]
    print(f'\n{len(pending)} installed edit(s) to harvest, {len(newer)} repo change(s) to install')
    return 0


def host_slug(name):
    return re.sub(r'[^a-z0-9-]+', '-', name.lower()).strip('-') or 'host'


def host_name(settings=None):
    return (settings or {}).get('host') or socket.gethostname().split('.')[0]


def do_harvest(dry_run=False, include_new=False, undo=None, host=None):
    """Bring installed edits into the repo working tree. Returns (applied, conflicts, written paths)."""
    manifest, entries, extra = classify()
    stamp = dt.datetime.now().strftime('%Y%m%d-%H%M%S')
    conflicts, applied, written = [], [], []
    recorded = 0
    for e in entries:
        if e['state'] not in PENDING and e['state'] != 'deleted-both':
            continue
        src, dst = SKILLS / e['skill'] / e['path'], REPO / e['skill'] / e['path']
        label = f"{e['skill']}/{e['path']}"
        if e['state'] in ('installed-edited', 'installed-added'):
            applied.append(f"{e['state']}: {label}")
            if not dry_run:
                dst.parent.mkdir(parents=True, exist_ok=True)
                dst.write_bytes(content(src))
                shutil.copymode(src, dst)
                written.append(label)
                record_base(manifest, e['skill'], e['path'], src, undo)
                recorded += 1
        elif e['state'] == 'installed-deleted':
            applied.append(f'deleted (a session removed it): {label}')
            if not dry_run:
                dst.unlink()
                written.append(label)
                record_base(manifest, e['skill'], e['path'], None, undo)
                recorded += 1
        elif e['state'] == 'deleted-both':
            if not dry_run:
                record_base(manifest, e['skill'], e['path'], None, undo)
                recorded += 1
        else:
            ours = content(dst) if dst.is_file() else None
            theirs = content(src) if src.is_file() else None
            base = base_bytes(e)
            merged, result = b'', 1
            if ours is not None and theirs is not None:
                clean, merged = merge3(ours, base, theirs)
                result = 0 if clean else 1
            if result == 0:
                applied.append(f'merged both sides: {label}')
                if not dry_run:
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    dst.write_bytes(merged)
                    written.append(label)
                    record_base(manifest, e['skill'], e['path'], src, undo)
                    recorded += 1
            else:
                out = STATE / 'conflicts' / stamp / e['skill'] / e['path']
                conflicts.append({'path': label, 'saved': str(out), 'installed': theirs,
                                  'executable': bool(src.is_file() and src.stat().st_mode & stat.S_IXUSR)})
                if not dry_run:
                    out.parent.mkdir(parents=True, exist_ok=True)
                    for suffix, data in (('repo', ours), ('base', base), ('installed', theirs), ('merged-with-markers', merged)):
                        Path(f'{out}.{suffix}').write_bytes(data or b'')
    # A skill that is going away (retired.txt, or gone from the repo): keep what sessions wrote in it.
    slug = host_slug(host or host_name(load_settings()))
    for name in removals(extra):
        for rel in unrescued_edits(name, manifest):
            target = f'private/rescued/{slug}/{name}/{rel}'
            applied.append(f'rescued from {name} (going away): {rel} -> {target}')
            if not dry_run:
                src = SKILLS / name / rel
                dst = REPO / target
                dst.parent.mkdir(parents=True, exist_ok=True)
                dst.write_bytes(content(src))
                written.append(target)
                record_base(manifest, name, rel, src, undo)
                recorded += 1
    for x in extra:
        if x['state'].startswith('local-only (') and include_new:
            applied.append(f"new skill: {x['skill']}")
            if not dry_run:
                shutil.copytree(SKILLS / x['skill'], REPO / x['skill'], symlinks=True,
                                ignore=shutil.ignore_patterns(*SKIP, '*.pyc'))
                written.append(x['skill'])
    if not dry_run and recorded:
        save_manifest(manifest)
    return applied, conflicts, written, extra


def cmd_harvest(args):
    applied, conflicts, _, extra = do_harvest(dry_run=args.dry_run, include_new=args.include_new)
    print(f"{'would apply' if args.dry_run else 'applied'} {len(applied)} change(s)" + ''.join(f'\n  {a}' for a in applied))
    if conflicts:
        print(f'{len(conflicts)} conflict(s); the repo files were left unchanged. Merge each one into the repo file by hand,'
              f' then run: sync-skills.py resolve <skill/path>' + ''.join(
                  f"\n  {c['path']}  (saved as {c['saved']}.repo|.base|.installed|.merged-with-markers)" for c in conflicts))
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
    """Keep the newest backups this tool made (<date>-<time> folders); leave other folders alone."""
    if not root.is_dir():
        return
    mine = sorted(p for p in root.iterdir() if p.is_dir() and re.fullmatch(r'\d{8}-\d{6}(-\d+)?', p.name))
    for old in mine[:-KEEP_BACKUPS]:
        shutil.rmtree(old, ignore_errors=True)


def swap_snapshot(new_snapshot, old_snapshot):
    """Put the new snapshot in place. A scanner holding a fresh file open can block a folder rename on Windows,
    so retry, then copy; if neither works, put the old snapshot back so it still matches the manifest."""
    had = SNAPSHOT.exists()
    if had:
        retry(lambda: os.replace(SNAPSHOT, old_snapshot))
    try:
        try:
            retry(lambda: os.replace(new_snapshot, SNAPSHOT))
        except OSError:
            shutil.rmtree(SNAPSHOT, ignore_errors=True)
            shutil.copytree(new_snapshot, SNAPSHOT, symlinks=True)
    except Exception:
        shutil.rmtree(SNAPSHOT, ignore_errors=True)
        if had:
            retry(lambda: os.replace(old_snapshot, SNAPSHOT))
        raise
    for leftover in STATE.glob('installed-snapshot.*'):
        if re.fullmatch(r'installed-snapshot\.(old-)?\d{8}-\d{6}(-\d+)?', leftover.name) and leftover.is_dir():
            shutil.rmtree(leftover, ignore_errors=True)


def do_install(dry_run=False, force=False):
    """Returns (exit code, installed skills, removed skills, notes)."""
    manifest, entries, extra = classify()
    notes = []
    pending = set() if force else {e['skill'] for e in entries if e['state'] in PENDING}
    skills = repo_skills()
    changed = sorted(({e['skill'] for e in entries if not e['state'].startswith('symlink')} |
                      {s for s in skills if not (SKILLS / s).exists()}) - pending)
    going = removals(extra)
    kept = [] if force else [n for n in going if unrescued_edits(n, manifest)]
    going = [n for n in going if n not in kept]
    if pending:
        notes.append('left as installed until harvested (edits not in the repo yet): ' + ', '.join(sorted(pending)))
    if kept:
        notes.append('kept until harvested (edits in a skill that is going away): ' + ', '.join(kept))
    code = 3 if pending or kept else 0
    head = git('rev-parse', 'HEAD')
    current = (not changed and not going and manifest.get('commit') == head and
               sorted(manifest.get('skipped') or []) == sorted(pending) and set(manifest['skills']) == set(skills))
    if dry_run or current:
        return code, changed, going, notes
    stamp = dt.datetime.now().strftime('%Y%m%d-%H%M%S')
    SKILLS.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix='.skills-staging-', dir=SKILLS.parent))
    backup = BACKUPS / stamp
    n = 2
    while backup.exists():
        backup = BACKUPS / f'{stamp}-{n}'
        n += 1
    done = []
    try:
        for s in changed:
            copy_skill(REPO / s, staging / s)
            if tree(staging / s) != tree(REPO / s):
                raise RuntimeError(f'staged copy of {s} does not match the repo')
        before = {s: tree(SKILLS / s) for s in changed + going}
        _, again, _ = classify()
        if {e['skill'] for e in again if e['state'] in PENDING} - pending and not force:
            raise RuntimeError('an installed copy was edited during install; run harvest again')
        for s in changed + going:
            if tree(SKILLS / s) != before[s]:
                raise RuntimeError(f'{s} changed during install; run harvest again')
        for s in changed + going:
            moved = (SKILLS / s).exists()
            if moved:
                backup.mkdir(parents=True, exist_ok=True)
                retry(lambda: os.replace(SKILLS / s, backup / s))
            done.append((s, moved))
            if s in changed:
                if os.environ.get('SYNC_SKILLS_FAIL_AT') == s:
                    raise RuntimeError(f'simulated failure while installing {s}')
                retry(lambda: os.replace(staging / s, SKILLS / s))
    except Exception as error:
        for s, moved in reversed(done):
            if (SKILLS / s).exists():
                shutil.rmtree(SKILLS / s, ignore_errors=True)
            if moved and (backup / s).exists():
                os.replace(backup / s, SKILLS / s)
        shutil.rmtree(staging, ignore_errors=True)
        notes.append(f'install rolled back, nothing changed: {error}')
        return 4, [], [], notes
    shutil.rmtree(staging, ignore_errors=True)
    new_snapshot = STATE / f'installed-snapshot.{stamp}'
    for s in skills:
        source = SNAPSHOT / s if s in pending else SKILLS / s
        if source.is_dir():
            shutil.copytree(source, new_snapshot / s, symlinks=True, ignore=shutil.ignore_patterns(*SKIP, '*.pyc'))
    new_snapshot.mkdir(parents=True, exist_ok=True)
    swap_snapshot(new_snapshot, STATE / f'installed-snapshot.old-{stamp}')
    save_manifest({
        'commit': head, 'repo_dirty': bool(git('status', '--porcelain')),
        'installed_at': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
        'skipped': sorted(pending),
        'skills': {s: (manifest['skills'].get(s, {}) if s in pending else tree(SKILLS / s)) for s in skills},
    })
    prune_backups(BACKUPS)
    if backup.exists():
        notes.append(f'previous copies backed up to {tilde(backup)}')
    return code, changed, going, notes


def cmd_install(args):
    code, changed, going, notes = do_install(dry_run=args.dry_run, force=args.force)
    for note in notes:
        print(note)
    print(f"{'would install' if args.dry_run else 'installed'} {len(changed)} skill(s): {', '.join(changed) or 'none'}")
    if going:
        print(f"{'would remove' if args.dry_run else 'removed'} (backed up first): {', '.join(going)}")
    if code == 0 and not args.dry_run:
        print(f'base recorded in {STATE}')
    return code


# ---------------------------------------------------------------- settings, locks, log

def load_settings():
    try:
        return json.loads(SETTINGS.read_text(encoding='utf-8-sig'))
    except (FileNotFoundError, ValueError):
        return {}


def save_settings(settings):
    write_atomic(SETTINGS, (json.dumps(settings, indent=1) + '\n').encode())


def load_state():
    try:
        return json.loads(SYNC_STATE.read_text(encoding='utf-8-sig'))
    except (FileNotFoundError, ValueError):
        return {}


def save_state(state):
    conflicts = state.get('conflicts', {})
    if len(conflicts) > 50:
        state['conflicts'] = dict(list(conflicts.items())[-50:])
    write_atomic(SYNC_STATE, (json.dumps(state, indent=1) + '\n').encode())


def pid_alive(pid):
    if os.name == 'nt':
        import ctypes
        kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
        handle = kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return ctypes.get_last_error() == 5  # access denied: it exists
        try:
            code = ctypes.c_ulong()
            kernel32.GetExitCodeProcess(handle, ctypes.byref(code))
            return code.value == 259  # STILL_ACTIVE
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except PermissionError:
        return True
    except OSError:
        return False
    return True


def lock_owner_alive(lock, name):
    try:
        return pid_alive(int((lock / name).read_text(encoding='utf-8').split()[0]))
    except (OSError, ValueError, IndexError):
        return None


def take_lock(lock, stale_after):
    for _ in range(2):
        try:
            lock.mkdir()
        except FileExistsError:
            try:
                age = time.time() - lock.stat().st_mtime
            except FileNotFoundError:
                continue
            if age < stale_after and (age < 60 or lock_owner_alive(lock, 'owner') is not False):
                return False
            shutil.rmtree(lock, ignore_errors=True)
            continue
        (lock / 'owner').write_text(f'{os.getpid()} {socket.gethostname()} {now_iso()}\n', encoding='utf-8')
        return True
    return False


def miner_running():
    """The weekly miner holds ~/.copilot/skill-miner/lock (with its pid) for the whole run."""
    if not MINER_LOCK.is_dir():
        return False
    try:
        age = time.time() - MINER_LOCK.stat().st_mtime
    except FileNotFoundError:
        return False
    if age > 6 * 3600:
        return False
    alive = lock_owner_alive(MINER_LOCK, 'pid')
    return alive is not False or age < 600


class Run:
    def __init__(self, host):
        self.host, self.result, self.head, self.notes = host, 'ok', '', []

    def note(self, text):
        self.notes.append(text)


def write_log(run, started):
    line = (f"{now_iso()} {run.host} {run.result} {time.monotonic() - started:.1f}s {run.head[:7] or '-'} "
            f"{'; '.join(run.notes) or 'no changes'}")
    try:
        if SYNC_LOG.is_file() and SYNC_LOG.stat().st_size > 1_000_000:
            keep = SYNC_LOG.read_text(encoding='utf-8', errors='replace').splitlines()[-3000:]
            write_atomic(SYNC_LOG, ('\n'.join(keep) + '\n').encode())
        with open(SYNC_LOG, 'a', encoding='utf-8') as f:
            f.write(line + '\n')
    except OSError:
        pass
    print(line)


# ---------------------------------------------------------------- sync

def fix_line_endings():
    """Rewrite with LF the unmodified text files an older Windows checkout left with CRLF. Re-adding them
    refreshes the index: git trusts the recorded size, so a file that only got shorter would look edited."""
    if os.name != 'nt':
        return 0
    r = subprocess.run(['git', '-C', str(REPO), 'ls-files', '--eol', '-z'], capture_output=True, env=GIT_ENV)
    fixed = []
    for entry in r.stdout.decode('utf-8', 'surrogateescape').split('\0'):
        meta, _, path = entry.partition('\t')
        fields = meta.split()
        if len(fields) < 2 or fields[0] != 'i/lf' or fields[1] != 'w/crlf' or 'eol=crlf' in meta:
            continue
        f = REPO / path
        lf = f.read_bytes().replace(b'\r\n', b'\n')
        if git('show', f':{path}', binary=True) == lf:
            f.write_bytes(lf)
            fixed.append(path)
    if fixed:
        spec = b''.join(p.encode('utf-8', 'surrogateescape') + b'\0' for p in fixed)
        g('--literal-pathspecs', 'add', '--pathspec-from-file=-', '--pathspec-file-nul', input=spec)
    return len(fixed)


def installed_matches(manifest, head):
    """The fast check: the last install was of HEAD and nobody changed an installed copy since."""
    skills = repo_skills()
    if manifest.get('commit') != head or manifest.get('skipped') or set(manifest['skills']) != set(skills):
        return False
    if any((SKILLS / n).is_dir() for n in retired_names()):
        return False
    return all(tree(SKILLS / s) == manifest['skills'].get(s) for s in skills)


def inbox_due(settings):
    """The daily export of my own messages is due (once per local day, unless turned off in the settings)."""
    return settings.get('inbox', True) is not False and load_state().get('inbox_day') != dt.date.today().isoformat()


def message_fingerprint(text):
    """Matches collect-messages.py: a text one session sends to another arrives there unchanged."""
    return hashlib.sha256(re.sub(r'\s+', ' ', text or '').strip().encode('utf-8')).hexdigest()


def local_date(ts):
    try:
        return dt.datetime.fromisoformat(ts.replace('Z', '+00:00')).astimezone().date()
    except ValueError:
        return dt.date.today()


def collect_human(run, since, until, timeout=900):
    """My typed messages in this machine's sessions over [since, until), from tools/collect-messages.py:
    (rows, not_mine, sent, flagged, stats), or None after noting why. rows are kind "human" only, minus the
    lines the secret scan flags; not_mine holds the ids of everything else; sent holds (time, fingerprint)
    for every text this machine's agents sent to another session."""
    collector = Path(__file__).resolve().parent / 'collect-messages.py'
    name = (git('config', 'user.name') or '').split(' ')[0]
    sent_root = REPO / 'private' / 'inbox-sent'
    with tempfile.TemporaryDirectory() as tmp:
        command = [sys.executable, str(collector), '--since', since, '--until', until, '--out', tmp]
        if name:
            command += ['--name', name]
        if sent_root.is_dir():
            command += ['--sent-fingerprints', str(sent_root)]
        r = subprocess.run(command, capture_output=True, text=True, timeout=timeout, encoding='utf-8', errors='replace')
        if r.returncode:
            run.note(f'inbox export skipped ({first_error(r.stderr)})')
            return None
        rows, not_mine, sent = [], set(), []
        with open(Path(tmp) / 'messages.jsonl', encoding='utf-8') as f:
            for line in f:
                if line.strip():
                    row = json.loads(line)
                    if row.get('kind') == 'human':
                        rows.append(row)
                    else:
                        not_mine.add(row.get('id'))
        sent_file = Path(tmp) / 'sent.txt'
        if sent_file.is_file():
            for line in sent_file.read_text(encoding='utf-8').splitlines():
                ts, _, fp = line.strip().rpartition(' ')
                if re.fullmatch(r'[0-9a-f]{64}', fp):
                    sent.append((ts, fp))
        try:
            stats = json.loads((Path(tmp) / 'stats.json').read_text(encoding='utf-8'))
        except (OSError, ValueError):
            stats = {}
        scan = Path(tmp) / 'human.jsonl'
        scan.write_text(''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in rows), encoding='utf-8')
        flagged = set()
        if rows:
            ok, out = scan_files([scan])
            for m in re.finditer(r':(\d+): looks like a ', out):
                flagged.add(int(m.group(1)) - 1)
        rows = [row for i, row in enumerate(rows) if i not in flagged]
    return rows, not_mine, sent, len(flagged), stats


def known_fingerprints():
    known = set()
    for path in (REPO / 'private' / 'inbox-sent').glob('*/*.txt'):
        known.update(re.findall(r'\b[0-9a-f]{64}\b', path.read_text(encoding='utf-8', errors='ignore')))
    return known


def merge_rows(path, new_rows, not_mine, known):
    """Add new rows to a jsonl file (by id) and drop rows that are not mine or match a sent fingerprint.
    Returns (changed, removed): whether the file changed, and how many earlier rows were dropped."""
    existing = {}
    if path.is_file():
        for line in path.read_text(encoding='utf-8').splitlines():
            if line.strip():
                row = json.loads(line)
                existing[row['id']] = row
    merged = dict(existing)
    for row in new_rows:
        merged.setdefault(row['id'], row)
    kept = {i: row for i, row in merged.items()
            if i not in not_mine and message_fingerprint(row.get('text')) not in known}
    removed = sum(1 for i in existing if i not in kept)
    if path.is_file() and kept.keys() == existing.keys():
        return False, removed
    if not kept:
        if path.is_file():
            path.unlink()
            return True, removed
        return False, removed
    path.parent.mkdir(parents=True, exist_ok=True)
    ordered = sorted(kept.values(), key=lambda row: (row['ts'], row['id']))
    path.write_text(''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in ordered), encoding='utf-8', newline='\n')
    return True, removed


def export_inbox(settings, run, slug):
    """Once a day: the messages I typed to agents in this machine's sessions (kind "human" only; no agent
    briefs, automations, or autopilot) go to private/inbox/<host>/<yyyy-mm-dd>.jsonl, by the day they were
    sent. A line the secret scan flags is dropped. Text that an agent sent to a session reads like mine, so
    the fingerprints of what this machine's agents sent go to private/inbox-sent/<host>/<yyyy-mm-dd>.txt,
    and every export drops rows that match any machine's fingerprints (another machine's can arrive a day
    later). Only the last INBOX_DAYS days stay in the tree; private/ is never published. No model calls:
    tools/collect-messages.py reads only sessions active in the window."""
    state = load_state()
    now = dt.datetime.now(dt.timezone.utc)
    since = state.get('inbox_until') or (now - dt.timedelta(days=2)).strftime('%Y-%m-%dT%H:%M:%SZ')
    until = now.strftime('%Y-%m-%dT%H:%M:%SZ')
    got = collect_human(run, since, until)
    if got is None:
        return []
    rows, not_mine, sent_rows, flagged, _ = got
    cutoff = dt.date.today() - dt.timedelta(days=INBOX_DAYS)
    written = []
    sent_folder = REPO / 'private' / 'inbox-sent' / slug
    sent_by_day = {}
    for ts, fp in sent_rows:
        day = local_date(ts)
        if day >= cutoff:
            sent_by_day.setdefault(day.isoformat(), set()).add(fp)
    for day, fps in sorted(sent_by_day.items()):
        path = sent_folder / f'{day}.txt'
        have = set(path.read_text(encoding='utf-8').split()) if path.is_file() else set()
        if fps <= have:
            continue
        sent_folder.mkdir(parents=True, exist_ok=True)
        path.write_text(''.join(f'{fp}\n' for fp in sorted(have | fps)), encoding='utf-8', newline='\n')
        written.append(path.relative_to(REPO).as_posix())
    known = known_fingerprints()
    folder = REPO / 'private' / 'inbox' / slug
    by_day = {}
    for row in rows:
        by_day.setdefault(local_date(row['ts']).isoformat(), []).append(row)
    days = set(by_day) | ({p.stem for p in folder.glob('*.jsonl')} if folder.is_dir() else set())
    relayed = 0
    for day in sorted(days):
        try:
            if dt.date.fromisoformat(day) < cutoff:
                continue
        except ValueError:
            continue
        path = folder / f'{day}.jsonl'
        changed, removed = merge_rows(path, by_day.get(day, []), not_mine, known)
        relayed += removed
        if changed:
            written.append(path.relative_to(REPO).as_posix())
    for old_folder, pattern in ((folder, '*.jsonl'), (sent_folder, '*.txt')):
        if not old_folder.is_dir():
            continue
        for path in old_folder.glob(pattern):
            try:
                day = dt.date.fromisoformat(path.stem)
            except ValueError:
                continue
            if day < cutoff:
                path.unlink()
                written.append(path.relative_to(REPO).as_posix())
    state = load_state()
    state.update(inbox_until=until, inbox_day=dt.date.today().isoformat())
    save_state(state)
    extra = [f'{flagged} dropped by the secret scan'] if flagged else []
    if relayed:
        extra.append(f'{relayed} earlier row(s) removed as relayed')
    run.note(f"inbox: {len(rows)} message(s){''.join(', ' + e for e in extra)}")
    return written


def backfill_inbox(run, slug, request):
    """A one-time export over a long window (for example since March), asked for with backfill-inbox:
    the same rows as the daily export, in private/inbox-backfill/<host>/<yyyy-mm>.jsonl by local month, with
    manifest.json (window, counts, and each file's rows and SHA-256). The daily export's pruning leaves this
    folder alone; delete it once whoever asked for it has read it. private/ is never published."""
    since = request.get('since')
    until = request.get('until') or dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    got = collect_human(run, since, until, timeout=3600)
    if got is None:
        return []
    rows, not_mine, _, flagged, stats = got
    known = known_fingerprints()
    folder = REPO / 'private' / 'inbox-backfill' / slug
    by_month = {}
    for row in rows:
        by_month.setdefault(local_date(row['ts']).isoformat()[:7], []).append(row)
    months = set(by_month) | ({p.stem for p in folder.glob('*.jsonl')} if folder.is_dir() else set())
    written, removed = [], 0
    for month in sorted(months):
        path = folder / f'{month}.jsonl'
        changed, gone = merge_rows(path, by_month.get(month, []), not_mine, known)
        removed += gone
        if changed:
            written.append(path.relative_to(REPO).as_posix())
    files = []
    for path in (sorted(folder.glob('*.jsonl')) if folder.is_dir() else []):
        data = path.read_bytes()
        files.append({'name': path.name, 'rows': data.count(b'\n'), 'sha256': hashlib.sha256(data).hexdigest()})
    manifest = {
        'host': run.host, 'since': since, 'until': until, 'generated_at': now_iso(),
        'collector_commit': git('rev-parse', '--short', 'HEAD'), 'rows_kept': 'kind "human" only',
        'messages_by_kind': stats.get('messages', {}), 'relayed_by_fingerprint': stats.get('relayed_by_fingerprint', 0),
        'dropped_by_secret_scan': flagged, 'earlier_rows_removed': removed,
        'rows': sum(f['rows'] for f in files), 'files': files,
    }
    folder.mkdir(parents=True, exist_ok=True)
    (folder / 'manifest.json').write_text(json.dumps(manifest, indent=1) + '\n', encoding='utf-8', newline='\n')
    written.append((folder / 'manifest.json').relative_to(REPO).as_posix())
    state = load_state()
    state.pop('inbox_backfill', None)
    save_state(state)
    run.note(f"inbox backfill: {manifest['rows']} message(s) from {since[:10]} to {until[:10]}"
             f"{f', {flagged} dropped by the secret scan' if flagged else ''}")
    return written


# ---------------------------------------------------------------- the miner's private state

MISSING, INVALID = object(), object()


def miner_pairs():
    """(repo path, local file) for the weekly miner's private state and the private terms."""
    pairs = [(f'private/skill-miner/{name}', STATE / local) for name, local in MINER_FILES]
    return pairs + [('private/private-terms.txt', STATE / 'private-terms.txt')]


def read_norm(path):
    try:
        return normalized(path.read_bytes(), path.name)
    except (FileNotFoundError, NotADirectoryError):
        return None


def miner_base(rel):
    return STATE / 'sync-base' / rel


def id_list(value):
    if not isinstance(value, list) or not all(isinstance(x, dict) and 'id' in x for x in value):
        return False
    try:
        return len({x['id'] for x in value}) == len(value)
    except TypeError:
        return False


def merge_values(b, l, r):
    """Structural 3-way merge of JSON values: (merged, conflicts). Objects merge key by key, lists of objects
    with an "id" merge entry by entry, and a value both sides changed differently keeps this machine's."""
    if l == r:
        return l, 0
    if l == b:
        return r, 0
    if r == b:
        return l, 0
    if isinstance(l, dict) and isinstance(r, dict):
        base = b if isinstance(b, dict) else {}
        out, n = {}, 0
        for key in list(r) + [k for k in l if k not in r]:
            value, c = merge_values(base.get(key, MISSING), l.get(key, MISSING), r.get(key, MISSING))
            n += c
            if value is not MISSING:
                out[key] = value
        return out, n
    if id_list(l) and id_list(r):
        base = {x['id']: x for x in b} if id_list(b) else {}
        mine, theirs = {x['id']: x for x in l}, {x['id']: x for x in r}
        out, n = [], 0
        for key in [x['id'] for x in r] + [x['id'] for x in l if x['id'] not in theirs]:
            value, c = merge_values(base.get(key, MISSING), mine.get(key, MISSING), theirs.get(key, MISSING))
            n += c
            if value is not MISSING:
                out.append(value)
        return out, n
    return l, 1


def parse_json(data):
    if data is None:
        return MISSING
    try:
        return json.loads(data.decode('utf-8-sig'))
    except (ValueError, UnicodeDecodeError):
        return INVALID


def merge_state_file(rel, b, l, r):
    """(merged bytes or None, conflicts) for one file both sides changed."""
    if rel.endswith('.json'):
        pb, pl, pr = parse_json(b), parse_json(l), parse_json(r)
        if pl is INVALID and pr is INVALID:
            return None, 0
        if pl is INVALID:
            return r, 0
        if pr is INVALID:
            return l, 0
        merged, n = merge_values(MISSING if pb is INVALID else pb, pl, pr)
        if merged is pl:
            return l, n
        if merged is pr:
            return r, n
        return (json.dumps(merged, indent=2, ensure_ascii=False) + '\n').encode('utf-8'), n
    if rel.endswith('private-terms.txt'):
        # A set of lines: everything either side has, minus what either side removed since the base.
        def lines(data):
            return (data or b'').decode('utf-8', 'replace').splitlines()
        base, mine, theirs = lines(b), lines(l), lines(r)
        gone = (set(base) - set(mine)) | (set(base) - set(theirs))
        out, seen = [], set()
        for line in theirs + mine:
            if not line.strip() or line in gone or line in seen:
                continue
            seen.add(line)
            out.append(line)
        return ('\n'.join(out) + '\n').encode('utf-8'), 0
    clean, out = merge3(l, b or b'', r)
    if clean:
        return out, 0
    # The notes and voice samples are mostly added to: keep both sides' lines rather than markers.
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        for name, data in (('ours', l), ('base', b or b''), ('theirs', r)):
            (t / name).write_bytes(data)
        u = subprocess.run(['git', 'merge-file', '-p', '--union', str(t / 'ours'), str(t / 'base'), str(t / 'theirs')],
                           capture_output=True, env=GIT_ENV)
    return u.stdout, 1


def looks_secret(data, rel):
    with tempfile.TemporaryDirectory() as tmp:
        scan = Path(tmp) / Path(rel).name
        scan.write_bytes(data)
        ok, _ = scan_files([scan])
    return not ok


def miner_settled():
    """Every state file is the same here, in the clone, and in the last agreed base (the sync's fast path)."""
    for rel, local in miner_pairs():
        r, l = read_norm(REPO / rel), read_norm(local)
        if r != l or (r is not None and read_norm(miner_base(rel)) != r):
            return False
    return True


def sync_miner_state(run):
    """The weekly miner's private state and the private terms, the same on every machine through the private
    repo (private/skill-miner/ and private/private-terms.txt; private/ is never published). Each file is
    merged 3-way against the version this machine and origin last agreed on (~/.copilot/skill-miner/sync-base/):
    JSON by key and by "id", the terms by line, the notes and voice samples with git merge-file (keeping both
    sides' lines where they overlap). Text that looks like a secret never goes to the repo. Deletions never
    spread: a machine without a file gets the repo's, and a file the repo stops carrying stays where it is.
    A local file is backed up before it is replaced. Returns the repo paths written (to commit)."""
    written, updated = [], []
    stamp = dt.datetime.now().strftime('%Y%m%d-%H%M%S')
    for rel, local in miner_pairs():
        rp, bp = REPO / rel, miner_base(rel)
        r, l, b = read_norm(rp), read_norm(local), read_norm(bp)
        if r == l:
            continue
        new_repo = new_local = None
        if r is None:
            if b is not None:
                bp.unlink()
                run.note(f'{rel} is no longer in the repo; kept {tilde(local)}')
                continue
            new_repo = l
        elif l is None or l == b:
            new_local = r
        elif r == b:
            new_repo = l
        else:
            merged, conflicts = merge_state_file(rel, b, l, r)
            if merged is None:
                run.note(f'{rel}: neither copy is valid JSON; left both as they are')
                continue
            if conflicts:
                run.note(f"{rel}: {conflicts} change(s) made on both sides; kept this machine's")
            new_repo = merged if merged != r else None
            new_local = merged if merged != l else None
        if new_repo is not None:
            if looks_secret(new_repo, rel):
                run.note(f'{rel}: not synced, it has text that looks like a secret ({tilde(local)})')
                continue
            rp.parent.mkdir(parents=True, exist_ok=True)
            write_atomic(rp, new_repo)
            written.append(rel)
        if new_local is not None:
            if local.is_file():
                keep = STATE / 'backups' / stamp / local.relative_to(STATE)
                keep.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(local, keep)
            local.parent.mkdir(parents=True, exist_ok=True)
            write_atomic(local, new_local)
            updated.append(local.name)
    if updated:
        prune_backups(STATE / 'backups')
        run.note(f"miner state updated here: {', '.join(updated)}")
    return written


def settle_miner_bases():
    """Record the versions this machine and origin/main agree on, as the base for the next merge. Only what
    origin has counts, so a rebase that fails later can never make a local edit look already merged."""
    for rel, local in miner_pairs():
        bp, l = miner_base(rel), read_norm(local)
        o = git('show', f'refs/remotes/origin/main:{rel}', binary=True)
        o = normalized(o, rel) if o is not None else None
        if o is not None and o == l:
            if read_norm(bp) != l:
                bp.parent.mkdir(parents=True, exist_ok=True)
                write_atomic(bp, l)
        elif o is None and l is None and bp.exists():
            bp.unlink()


# ---------------------------------------------------------------- Copilot CLI defaults

def cli_settings_path():
    home = os.environ.get('COPILOT_HOME')
    return (Path(home).expanduser() if home else HOME_DIR) / 'settings.json'


def cli_defaults_due(settings):
    state = load_state()
    return (settings.get('cli_defaults', True) is not False and state.get('cli_defaults') != CLI_DEFAULTS_VERSION
            and state.get('cli_defaults_tried') != dt.date.today().isoformat())


def apply_cli_defaults(run=None):
    """Once per machine: Copilot CLI's user defaults become the top model, max effort, and the long context,
    and every built-in sub-agent inherits them (a CLI session started with no flags, and its sub-agents, then
    run at those settings). The values it replaced are kept in sync-state.json for `cli-defaults --undo`.
    Later changes are left alone; "cli_defaults": false in ~/.copilot/skills-sync.json skips it."""
    path = cli_settings_path()
    try:
        data = json.loads(path.read_text(encoding='utf-8-sig')) if path.is_file() else {}
    except (ValueError, OSError):
        data = None
    if not isinstance(data, dict):
        state = load_state()
        state['cli_defaults_tried'] = dt.date.today().isoformat()  # try again tomorrow, not every run
        save_state(state)
        if run:
            run.note(f'Copilot CLI defaults not set: {tilde(path)} is not plain JSON')
        return False
    before = {k: data.get(k) for k in CLI_DEFAULTS}
    before['subagents'] = data.get('subagents')
    data.update(CLI_DEFAULTS)
    subagents = data.get('subagents') if isinstance(data.get('subagents'), dict) else {}
    agents = subagents.get('agents') if isinstance(subagents.get('agents'), dict) else {}
    for name in CLI_SUBAGENTS:
        entry = agents.get(name) if isinstance(agents.get(name), dict) else {}
        entry.update(model='inherit', effortLevel='inherit', contextTier='inherit')
        agents[name] = entry
    subagents['agents'] = agents
    data['subagents'] = subagents
    path.parent.mkdir(parents=True, exist_ok=True)
    write_atomic(path, (json.dumps(data, indent=2) + '\n').encode('utf-8'))
    state = load_state()
    state.setdefault('cli_defaults_before', before)
    state['cli_defaults'] = CLI_DEFAULTS_VERSION
    save_state(state)
    if run:
        run.note('Copilot CLI defaults set: claude-opus-5.5, max effort, long context, sub-agents inherit')
    return True


def cmd_cli_defaults(args):
    path = cli_settings_path()
    if not args.undo:
        ok = apply_cli_defaults()
        print(f"{'set' if ok else 'not set (the file is not plain JSON)'}: {tilde(path)}")
        return 0 if ok else 1
    state = load_state()
    before = state.get('cli_defaults_before')
    if before is None:
        print('nothing to undo: the sync has not changed the Copilot CLI defaults on this machine')
        return 1
    data = json.loads(path.read_text(encoding='utf-8-sig')) if path.is_file() else {}
    for key, value in before.items():
        if value is None:
            data.pop(key, None)
        else:
            data[key] = value
    write_atomic(path, (json.dumps(data, indent=2) + '\n').encode('utf-8'))
    state.pop('cli_defaults_before', None)
    state['cli_defaults'] = CLI_DEFAULTS_VERSION  # undone on purpose: the sync does not set them again
    save_state(state)
    print(f'restored the earlier Copilot CLI defaults in {tilde(path)}')
    return 0


def summarize(paths, limit=5):
    tops = []
    for p in paths:
        top = p.split('/', 1)[0]
        if top not in tops:
            tops.append(top)
    return ', '.join(tops[:limit]) + (f' and {len(tops) - limit} more' if len(tops) > limit else '')


def commit_paths(paths, subject, applied, harvested):
    """Stage these paths and commit what actually changed. Returns (committed paths, error)."""
    spec = b''.join(p.encode('utf-8', 'surrogateescape') + b'\0' for p in paths)
    rc, _, err = g('--literal-pathspecs', 'add', '-A', '--pathspec-from-file=-', '--pathspec-file-nul', input=spec)
    if rc:
        return None, err
    staged = (git('diff', '--cached', '--name-only') or '').splitlines()
    if not staged:
        return [], ''
    details = applied + [f'edited in the clone: {p}' for p in staged if p not in harvested]
    lines = [f'{subject}: {summarize(staged)}', ''] + [f'- {d}' for d in details[:40]]
    if len(details) > 40:
        lines.append(f'- and {len(details) - 40} more')
    rc, _, err = g('commit', '-q', '-F', '-', input=('\n'.join(lines + ['', COAUTHOR]) + '\n').encode('utf-8'))
    return (staged, '') if rc == 0 else (None, err)


def scan_files(paths):
    r = subprocess.run([sys.executable, str(VALIDATOR), '--scan-files', *map(str, paths)],
                       capture_output=True, text=True, timeout=300)
    return r.returncode == 0, r.stdout


def secret_check(ref, run):
    r = subprocess.run([sys.executable, str(VALIDATOR), '--repo', str(REPO), '--secrets-only', '--commits', ref,
                        '--quiet'], capture_output=True, text=True, timeout=600, env=GIT_ENV)
    if r.returncode == 0:
        return True
    report = STATE / 'logs' / f"sync-secrets-{dt.datetime.now().strftime('%Y%m%d-%H%M%S')}.txt"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(r.stdout + r.stderr, encoding='utf-8')
    run.note(f'blocked: the secret check failed, nothing pushed (see {tilde(report)}; to fix, run git reset --soft '
             f'origin/main in {tilde(REPO)}, remove the secret, and let the next run commit again)')
    return False


def signature(kind, items):
    return hashlib.sha256(json.dumps([kind, sorted(items)]).encode()).hexdigest()[:16]


def integrate():
    """Bring origin/main into main: rebase the local commits, or merge when they include a merge.
    Returns ('ok', []), ('conflict', paths) or ('failed', [error]); after a conflict or failure, main is as it was."""
    if git('rev-list', '--merges', 'refs/remotes/origin/main..HEAD'):
        rc, _, err = g('merge', '--no-edit', '-q', 'refs/remotes/origin/main', timeout=300)
        abort = ('merge', '--abort')
    else:
        rc, _, err = g('rebase', '-q', 'refs/remotes/origin/main', timeout=300)
        abort = ('rebase', '--abort')
    if rc == 0:
        return 'ok', []
    paths = (git('diff', '--name-only', '--diff-filter=U') or '').splitlines()
    if git_busy():
        g(*abort)
    return ('conflict', paths) if paths else ('failed', [first_error(err)])


def push_branch(source, branch, run):
    rc, _, err = g('push', '-q', 'origin', f'{source}:refs/heads/{branch}', timeout=300)
    if rc:
        run.note(f'could not push {branch} ({first_error(err)})')
    return rc == 0


def integration_conflict(paths, run, state, slug, undo, manifest_before, secrets_ok):
    """Local commits do not apply on origin/main: put them on a branch, and make main match origin again.
    The installed edits stay installed; their bases are rolled back, so the next run harvests them again."""
    stamp = dt.datetime.now().strftime('%Y%m%d-%H%M%S')
    sig = signature('rebase', [(p, git('rev-parse', f'HEAD:{p}') or '') for p in paths])
    branch = state.setdefault('conflicts', {}).get(sig)
    if not branch:
        if not secrets_ok:
            run.note('conflict with origin/main; the local commits failed the secret check, so they stay local')
            return
        branch = f'conflict/{slug}/{stamp}'
        if not push_branch('HEAD', branch, run):
            run.note('conflict with origin/main; the local commits stay local until the branch is pushed')
            return
        state['conflicts'][sig] = branch
    run.note(f"conflict with origin/main in {', '.join(paths[:5])}; the local commits are on {branch}")
    if dirty_paths():
        run.note('main keeps the local commits until the clone has no uncommitted edits')
        return
    g('reset', '-q', '--hard', 'refs/remotes/origin/main')
    rollback_bases(undo, manifest_before)


def harvest_conflicts(conflicts, run, state, slug):
    """Installed copies and main both changed the same lines: push the installed versions to a branch."""
    files = {c['path']: (c['installed'], c['executable']) for c in conflicts}
    sig = signature('harvest', [(p, hashlib.sha256(data or b'').hexdigest()) for p, (data, _) in files.items()])
    branch = state.setdefault('conflicts', {}).get(sig)
    names = ', '.join(sorted(files)[:5])
    if branch:
        run.note(f'still in conflict: {names} (see {branch})')
        return
    with tempfile.TemporaryDirectory() as tmp:
        scan = []
        for i, (p, (data, _)) in enumerate(sorted(files.items())):
            if data is not None:
                f = Path(tmp) / f'{i}.txt'
                f.write_bytes(data)
                scan.append(f)
        if scan and not scan_files(scan)[0]:
            run.note(f'conflict in {names}; the installed versions failed the secret check, so no branch was pushed')
            return
        env = dict(GIT_ENV, GIT_INDEX_FILE=str(Path(tmp) / 'index'))
        if g('read-tree', 'HEAD', env=env)[0]:
            run.note(f'conflict in {names}; could not build the branch')
            return
        for p, (data, executable) in sorted(files.items()):
            if data is None:
                g('update-index', '--force-remove', '--', p, env=env)
                continue
            rc, blob, _ = g('hash-object', '-w', '--stdin', input=data)
            g('update-index', '--add', '--cacheinfo', f"{'100755' if executable else '100644'},{blob},{p}", env=env)
        rc, tree_id, _ = g('write-tree', env=env)
    stamp = dt.datetime.now().strftime('%Y%m%d-%H%M%S')
    message = (f'Sync from {run.host}: conflict in {names}\n\nThe installed copies on {run.host} changed these files, and so '
               f'did main since they were installed.\nThis commit has the installed versions on top of main. Merge them '
               f'into main by hand;\nthe next sync on {run.host} picks the result up.\n\n{COAUTHOR}\n')
    rc, sha, err = g('commit-tree', tree_id, '-p', 'HEAD', '-F', '-', input=message.encode())
    branch = f'conflict/{slug}/{stamp}'
    if rc or not push_branch(sha, branch, run):
        run.note(f'conflict in {names}; the branch was not pushed, next run tries again')
        return
    state['conflicts'][sig] = branch
    run.note(f'conflict: {names} changed here and on main; the installed versions are on {branch}')


def my_taste_pending(settings):
    """my-taste files that changed in the my_taste_source folder since this machine last copied them in, as
    (repo path, LF bytes, sha256). Only a machine whose settings name a source has any."""
    source = settings.get('my_taste_source')
    if not source:
        return []
    root = Path(source).expanduser()
    copied = load_state().get('my_taste_copied') or {}
    pending = []
    for rel in MY_TASTE_FILES:
        try:
            data = (root / rel).read_bytes().replace(b'\r\n', b'\n')
        except OSError:
            continue
        digest = hashlib.sha256(data).hexdigest()
        if copied.get(rel) != digest:
            pending.append((f'my-taste/{rel}', data, digest))
    return pending


def copy_my_taste(settings, run):
    """Copy the changed my-taste files into the clone (the source wins only when it changes, so an edit harvested
    from another machine stays until the next update there). Returns the paths written."""
    pending = my_taste_pending(settings)
    if not pending:
        return []
    written = []
    for path, data, _ in pending:
        dest = REPO / path
        if not dest.is_file() or dest.read_bytes() != data:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
            written.append(path)
    state = load_state()
    state.setdefault('my_taste_copied', {}).update({path.split('/', 1)[1]: digest for path, _, digest in pending})
    save_state(state)
    if written:
        run.note(f"my-taste: copied {', '.join(p.split('/', 1)[1] for p in written)}")
    return written


def sync_once(settings, run):
    slug = host_slug(run.host)
    if git('symbolic-ref', '--short', '-q', 'HEAD') != 'main':
        run.result = 'error'
        run.note('the clone is not on main; switch it back to main')
        return 1
    busy = git_busy()
    if busy:
        run.result = 'error'
        run.note(f'a git operation is in progress in {tilde(REPO)} ({busy}); finish or abort it')
        return 1
    if not same_url(git('remote', 'get-url', 'origin'), settings['private_url']):
        run.result = 'error'
        run.note('origin is not the private repo; run sync-skills.py setup')
        return 1
    head = rev('HEAD')
    run.head = head
    rc, out, err = g('ls-remote', '--quiet', 'origin', 'refs/heads/main', timeout=90)
    online = rc == 0 and bool(out)
    remote = out.split()[0] if online else ''
    tracking = rev('refs/remotes/origin/main')
    manifest = load_manifest()
    if (online and remote == head == tracking and not dirty_paths() and installed_matches(manifest, head)
            and not inbox_due(settings) and not load_state().get('inbox_backfill') and not cli_defaults_due(settings)
            and miner_settled() and not my_taste_pending(settings) and not schedule_due(settings)):
        return 0
    if cli_defaults_due(settings):
        apply_cli_defaults(run)
    if not online:
        run.note(f'offline ({first_error(err)}): harvested and installed locally')

    # Pull first, so installed edits are merged against the newest main.
    if online and remote != tracking:
        rc, _, err = g('fetch', '-q', '--prune', 'origin', timeout=300)
        if rc:
            run.note(f'fetch failed ({first_error(err)})')
            online = False
        tracking = rev('refs/remotes/origin/main')
    if online and tracking and head != tracking and is_ancestor(head, tracking):
        if g('merge', '--ff-only', '-q', 'refs/remotes/origin/main', timeout=300)[0] == 0:
            run.note(f'pulled {head[:7]}..{tracking[:7]}')
    fixed = fix_line_endings()
    if fixed:
        run.note(f'line endings fixed in {fixed} file(s)')

    # Harvest, then commit with any other edits in the clone that have been quiet for a while.
    manifest_before = MANIFEST.read_bytes() if MANIFEST.is_file() else None
    undo = []
    applied, conflicts, written, _ = do_harvest(undo=undo, host=slug)
    if inbox_due(settings):
        exported = export_inbox(settings, run, slug)
        written += exported
        applied += [f'inbox: {p}' for p in exported]
    request = load_state().get('inbox_backfill')
    if request:
        done = backfill_inbox(run, slug, request)
        written += done
        applied += [f'inbox backfill: {p}' for p in done]
    state_files = sync_miner_state(run)
    written += state_files
    applied += [f'miner state: {p}' for p in state_files]
    taste = copy_my_taste(settings, run)
    written += taste
    applied += [f'my-taste: {p}' for p in taste]
    schedule_files = apply_schedule(settings, run, slug)
    written += schedule_files
    applied += [f'schedule: {p}' for p in schedule_files]
    harvested = set(written)
    waiting, too_big, to_commit = [], [], []
    now = time.time()
    for xy, path in dirty_paths():
        if path not in harvested and not any(path.startswith(w.rstrip('/') + '/') for w in harvested):
            try:
                st = (REPO / path).stat()
            except FileNotFoundError:
                st = None
            if st and now - st.st_mtime < QUIET_SECONDS:
                waiting.append(path)
                continue
            if st and xy == '??' and st.st_size > MAX_COMMIT_BYTES:
                too_big.append(path)
                continue
        to_commit.append(path)
    if to_commit:
        committed, err = commit_paths(to_commit, f'Sync from {run.host}', applied, harvested)
        if committed is None:
            run.result = 'error'
            run.note(f'commit failed ({first_error(err)})')
            return 1
        if committed:
            run.note(f'committed {summarize(committed)}')
    if waiting:
        run.note(f'{len(waiting)} file(s) in the clone changed in the last {QUIET_SECONDS} s; the next run commits them')
    if too_big:
        run.note(f"not committed, over 5 MB: {', '.join(too_big[:3])}")

    # Secret check, then rebase or merge onto origin/main and push.
    state = load_state()
    secrets_ok = True
    if online:
        if count('refs/remotes/origin/main..HEAD'):
            secrets_ok = secret_check('refs/remotes/origin/main', run)
        for attempt in (1, 2):
            ahead, behind = count('refs/remotes/origin/main..HEAD'), count('HEAD..refs/remotes/origin/main')
            if behind:
                if waiting or too_big:
                    run.note('pull waits for the edits in progress')
                    break
                if not ahead:
                    g('merge', '--ff-only', '-q', 'refs/remotes/origin/main', timeout=300)
                else:
                    status, paths = integrate()
                    if status == 'failed':
                        run.result = 'error'
                        run.note(f'could not rebase onto origin/main ({paths[0]}); the local commits stay local')
                        break
                    if status == 'conflict':
                        integration_conflict(paths, run, state, slug, undo, manifest_before, secrets_ok)
                        run.result = 'conflict'
                        run.head = rev('HEAD')
                        save_state(state)
                        return 3
            ahead = count('refs/remotes/origin/main..HEAD')
            if not ahead or not secrets_ok:
                break
            rc, _, err = g('push', '-q', 'origin', 'HEAD:refs/heads/main', timeout=300)
            if rc == 0:
                run.note(f'pushed {ahead} commit(s)')
                break
            if attempt == 2 or g('fetch', '-q', 'origin', timeout=300)[0]:
                run.result = 'error'
                run.note(f'push failed ({first_error(err)})')
                break
    if not secrets_ok:
        run.result = 'blocked'
    if online and secrets_ok and not count('refs/remotes/origin/main..HEAD'):
        settle_miner_bases()
    if conflicts:
        if online:
            harvest_conflicts(conflicts, run, state, slug)
        else:
            run.note(f"conflict in {', '.join(c['path'] for c in conflicts[:5])}; saved under {tilde(STATE / 'conflicts')}")
        if run.result == 'ok':
            run.result = 'conflict'
    save_state(state)

    code, changed, going, notes = do_install()
    run.notes.extend(n for n in notes if not n.startswith('previous copies'))
    if code == 4:
        run.result = 'error'
    if changed:
        run.note(f"installed {', '.join(changed)}")
    if going:
        run.note(f"removed {', '.join(going)} (backed up)")
    run.head = rev('HEAD')
    if run.result == 'error':
        return 1
    return 3 if conflicts or run.result == 'conflict' else 0


def cmd_backfill_inbox(args):
    """Ask for a one-time export of my typed messages since --since, then run a sync that does it."""
    if not args.since:
        print('backfill-inbox needs --since, for example --since 2026-03-01T00:00:00Z')
        return 2
    try:
        for value in filter(None, (args.since, args.until)):
            dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError as error:
        print(f'not an ISO time: {error}')
        return 2
    state = load_state()
    state['inbox_backfill'] = {k: v for k, v in (('since', args.since), ('until', args.until)) if v}
    save_state(state)
    print(f"backfill of {args.since} to {args.until or 'now'} requested; running a sync now (a busy sync does it next run)")
    return cmd_sync(args)


def cmd_sync(args):
    started = time.monotonic()
    settings = load_settings()
    run = Run(host_name(settings))
    if not settings.get('private_url'):
        run.result = 'error'
        run.note('not set up: run sync-skills.py setup --private-url <url> --private-user <name>')
        write_log(run, started)
        return 1
    HOME_DIR.mkdir(parents=True, exist_ok=True)
    STATE.mkdir(parents=True, exist_ok=True)
    if not take_lock(SYNC_LOCK, 1800):
        run.result = 'skipped'
        run.note('another sync is running')
        write_log(run, started)
        return 0
    code = 0
    try:
        if miner_running():
            run.result = 'skipped'
            run.note('the weekly skill miner is running')
        else:
            code = sync_once(settings, run)
    except subprocess.TimeoutExpired as error:
        run.result = 'error'
        run.note(f"timed out: {' '.join(str(c) for c in error.cmd[:5])}")
        code = 1
    except Exception as error:  # noqa: BLE001 - the log line is the report
        run.result = 'error'
        run.note(f'{type(error).__name__}: {error}')
        code = 1
    finally:
        shutil.rmtree(SYNC_LOCK, ignore_errors=True)
        write_log(run, started)
    return code


# ---------------------------------------------------------------- setup and schedule

def helper_command(gh, user):
    """A credential helper for one URL: GitHub CLI's token for that account. It gives nothing to the
    weekly miner's agent (SKILL_MINER_RUNNER is set there), which must not be able to push."""
    quoted = "'" + gh.replace("'", "'\\''") + "'"
    return ('!f() { test "$1" = get || exit 0; test -z "$SKILL_MINER_RUNNER" || exit 0; echo username=x-access-token; '
            f'echo "password=$({quoted} auth token --hostname github.com --user {user})"; }}; f')


def cmd_setup(args):
    settings = load_settings()
    for key in ('private_url', 'private_user', 'public_url', 'public_user', 'host'):
        if getattr(args, key, None):
            settings[key] = getattr(args, key)
    settings.setdefault('public_url', DEFAULT_PUBLIC_URL)
    settings.setdefault('public_user', DEFAULT_PUBLIC_USER)
    settings.pop('interval_minutes', None)
    if not settings.get('private_url') or not settings.get('private_user'):
        print('setup needs --private-url and --private-user the first time')
        return 2
    problems = []

    def report(ok, text, fix=None):
        print(f"{'ok  ' if ok else 'FAIL'} {text}")
        if not ok and fix:
            problems.append(fix)

    on_github = settings['private_url'].startswith('https://github.com/')
    gh = shutil.which('gh')
    if on_github:
        if not gh:
            print('FAIL GitHub CLI (gh) is not installed')
            return 1
        gh = str(Path(gh).resolve())
        for user in (settings['private_user'], settings['public_user']):
            r = subprocess.run([gh, 'auth', 'token', '--hostname', 'github.com', '--user', user], capture_output=True, env=GIT_ENV)
            report(r.returncode == 0, f'GitHub CLI has a token for {user}', f'gh auth login --hostname github.com (as {user})')
        r = subprocess.run([gh, 'auth', 'setup-git', '--hostname', 'github.com'], capture_output=True, env=GIT_ENV)
        report(r.returncode == 0, 'gh auth setup-git (git asks GitHub CLI, never prompts)', 'gh auth setup-git')
        if 'publish_email' not in settings:
            r = subprocess.run([gh, 'api', f"users/{settings['public_user']}", '--jq', '[.id, .name] | @tsv'],
                               capture_output=True, text=True, env=GIT_ENV)
            uid, _, name = r.stdout.strip().partition('\t')
            if r.returncode == 0 and uid.isdigit():
                settings['publish_email'] = f"{uid}+{settings['public_user']}@users.noreply.github.com"
                settings['publish_name'] = name or settings['public_user']
    if not git('config', 'user.email') or not git('config', 'user.name'):
        g('config', 'user.name', settings.get('publish_name') or settings['public_user'])
        g('config', 'user.email', settings.get('publish_email') or f"{settings['public_user']}@users.noreply.github.com")
        print('ok   commit identity for this clone set to the public noreply address')

    remotes = (git('remote') or '').split()
    if 'origin' in remotes and not same_url(git('remote', 'get-url', 'origin'), settings['private_url']):
        if 'public' not in remotes and same_url(git('remote', 'get-url', 'origin'), settings['public_url']):
            g('remote', 'rename', 'origin', 'public')
        else:
            g('remote', 'remove', 'origin')
        remotes = (git('remote') or '').split()
    g('remote', 'set-url' if 'origin' in remotes else 'add', 'origin', settings['private_url'])
    if 'public' not in remotes:
        g('remote', 'add', 'public', settings['public_url'])
    elif not same_url(git('remote', 'get-url', 'public'), settings['public_url']):
        g('remote', 'set-url', 'public', settings['public_url'])
    g('config', 'branch.main.remote', 'origin')
    g('config', 'branch.main.merge', 'refs/heads/main')
    if on_github:
        key = f"credential.{settings['private_url']}.helper"
        g('config', '--local', '--unset-all', key)
        g('config', '--local', '--add', key, '')
        g('config', '--local', '--add', key, helper_command(gh, settings['private_user']))
        print(f"ok   origin uses {settings['private_user']}'s token from GitHub CLI; public uses the default account")
    for remote in ('origin', 'public'):
        rc, out, err = g('ls-remote', '--quiet', remote, 'refs/heads/main', timeout=90)
        report(rc == 0 and bool(out), f'git ls-remote {remote} without a prompt', f'check access to {remote}: {first_error(err)}')
    rc, _, err = g('fetch', '-q', 'origin', timeout=300)
    report(rc == 0, 'git fetch origin', f'git fetch origin: {first_error(err)}')
    g('fetch', '-q', 'public', timeout=300)
    save_settings(settings)
    print(f'settings saved to {tilde(SETTINGS)}')
    if problems:
        print('Fix these, then run setup again:\n  ' + '\n  '.join(problems))
        return 1
    print(f"Next: {Path(sys.executable).name} {tilde(REPO / 'tools' / 'sync-skills.py')} sync, then the same with schedule")
    return 0


def describe(schedule):
    kind, value = schedule.split()
    return f'daily at {value} and at logon' if kind == 'daily' else f'every {value} minutes and at logon'


def parse_schedule_value(kind, value):
    """A schedule as 'daily HH:MM' or 'every MINUTES', or None when it is not valid."""
    value = str(value or '')
    if kind == 'daily':
        m = re.fullmatch(r'(\d{1,2}):(\d{2})', value)
        if m and int(m.group(1)) < 24 and int(m.group(2)) < 60:
            return f'daily {int(m.group(1)):02d}:{m.group(2)}'
    elif kind == 'every' and value.isdigit() and 5 <= int(value) <= 1440:
        return f'every {int(value)}'
    return None


def read_schedule_rules(text):
    """private/sync-schedule.txt: one rule per line, '<host> daily HH:MM' or '<host> every MINUTES', optionally
    followed by 'until <ISO time>'. <host> is the name in "Sync from <host>" commits, in lowercase; * and ? match
    any characters; # starts a comment. Returns ([(pattern, schedule, until)], the numbers of lines not valid)."""
    rules, bad = [], []
    for n, line in enumerate(text.splitlines(), 1):
        words = line.split('#', 1)[0].split()
        if not words:
            continue
        until = None
        if len(words) == 5 and words[3] == 'until':
            try:
                until = dt.datetime.fromisoformat(words[4].replace('Z', '+00:00'))
            except ValueError:
                bad.append(n)
                continue
            if until.tzinfo is None:
                until = until.astimezone()
            words = words[:3]
        value = parse_schedule_value(words[1], words[2]) if len(words) == 3 else None
        if value is None:
            bad.append(n)
        else:
            rules.append((words[0].lower(), value, until))
    return rules, bad


def wanted_schedule(settings, now=None):
    """(schedule, None) from the first rule in the repo's private/sync-schedule.txt that matches this machine and has
    not expired, or (None, why not)."""
    try:
        text = (REPO / SCHEDULE_FILE).read_text(encoding='utf-8-sig')
    except OSError:
        return None, f'no {SCHEDULE_FILE}'
    rules, bad = read_schedule_rules(text)
    if bad:
        return None, f"{SCHEDULE_FILE} line {', '.join(map(str, bad))} is not valid"
    slug = host_slug(host_name(settings))
    now = now or dt.datetime.now().astimezone()
    for pattern, value, until in rules:
        if fnmatch.fnmatchcase(slug, pattern) and (until is None or now < until):
            return value, None
    return None, f'no rule in {SCHEDULE_FILE} matches {slug}'


def default_python():
    python = Path(sys.executable).resolve()
    if os.name == 'nt' and python.name.lower() == 'pythonw.exe':
        python = python.with_name('python.exe')
    return python


def next_daily(hhmm, now=None):
    """The next local HH:MM at least a minute away: a daily trigger that starts in the past may run at once."""
    now = now or dt.datetime.now()
    hour, minute = map(int, hhmm.split(':'))
    at = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    return at if at > now + dt.timedelta(minutes=1) else at + dt.timedelta(days=1)


def task_xml(schedule, python, script):
    from xml.sax.saxutils import escape
    user = subprocess.run(['whoami'], capture_output=True, text=True).stdout.strip()
    conhost = Path(os.environ.get('SystemRoot', r'C:\Windows')) / 'System32' / 'conhost.exe'
    arguments = f'--headless "{python}" "{script}" sync'
    kind, value = schedule.split()
    if kind == 'daily':
        trigger = f'''    <CalendarTrigger>
      <StartBoundary>{next_daily(value).isoformat()}</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay>
        <DaysInterval>1</DaysInterval>
      </ScheduleByDay>
    </CalendarTrigger>'''
    else:
        start = (dt.datetime.now() + dt.timedelta(minutes=2)).replace(second=0, microsecond=0).isoformat()
        trigger = f'''    <TimeTrigger>
      <Repetition>
        <Interval>PT{value}M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <StartBoundary>{start}</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>'''
    return f'''<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Syncs ~/.copilot/skills with the skills repo {describe(schedule)} ({escape(str(script))} sync). Log: ~/.copilot/skills-sync.log</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>{escape(user)}</UserId>
      <Delay>PT1M</Delay>
    </LogonTrigger>
{trigger}
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>{escape(user)}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT30M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>{escape(str(conhost))}</Command>
      <Arguments>{escape(arguments)}</Arguments>
      <WorkingDirectory>{escape(str(REPO))}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
'''


def launchd_paths():
    return Path.home() / 'Library' / 'LaunchAgents' / f'{LAUNCHD_LABEL}.plist', f'gui/{os.getuid()}'


def launchd_plist(schedule, python, script):
    logs = STATE / 'logs'
    logs.mkdir(parents=True, exist_ok=True)
    path = os.environ.get('PATH', '/usr/bin:/bin:/usr/sbin:/sbin').split(os.pathsep)
    for tool in ('git', 'gh'):
        found = shutil.which(tool)
        if found and str(Path(found).parent) not in path:
            path.insert(0, str(Path(found).parent))
    data = {
        'Label': LAUNCHD_LABEL,
        'ProgramArguments': [str(python), str(script), 'sync'],
        'RunAtLoad': True,
        'ProcessType': 'Background',
        'LowPriorityIO': True,
        'Nice': 10,
        'AbandonProcessGroup': True,
        'EnvironmentVariables': {'PATH': os.pathsep.join(path)},
        'StandardOutPath': '/dev/null',
        'StandardErrorPath': str(logs / 'skills-sync.launchd.log'),
    }
    kind, value = schedule.split()
    if kind == 'daily':
        hour, minute = map(int, value.split(':'))
        data['StartCalendarInterval'] = {'Hour': hour, 'Minute': minute}
    else:
        data['StartInterval'] = int(value) * 60
    return data


# launchd cannot reload a job from inside it (bootout stops the job, this sync included), so a detached helper waits
# for this process to exit, reloads the job (which runs it once, RunAtLoad), and leaves a marker that run confirms.
RELOAD_SCRIPT = '''pid=$1; domain=$2; label=$3; plist=$4; marker=$5; value=$6
n=0; while kill -0 "$pid" 2>/dev/null; do n=$((n+1)); [ "$n" -gt 900 ] && exit 1; sleep 1; done
launchctl bootout "$domain/$label" >/dev/null 2>&1
n=0; until launchctl bootstrap "$domain" "$plist" >/dev/null 2>&1; do n=$((n+1)); [ "$n" -gt 10 ] && exit 1; sleep 1; done
printf '%s\\n' "$value" > "$marker"
'''


def register_job(schedule, python, script, defer=False):
    """Register this machine's sync job for schedule. Returns (True, what) once it is in place, ('pending', what)
    when launchd reloads it after this process exits (defer, macOS), or (False, why not)."""
    if os.name == 'nt':
        folder = Path(tempfile.mkdtemp())
        try:
            (folder / 'task.xml').write_text(task_xml(schedule, python, script), encoding='utf-16')
            r = subprocess.run(['schtasks', '/Create', '/F', '/TN', TASK_NAME, '/XML', str(folder / 'task.xml')],
                               capture_output=True, text=True)
        finally:
            shutil.rmtree(folder, ignore_errors=True)
        if r.returncode:
            return False, f'schtasks failed: {(r.stderr or r.stdout).strip()}'
        return True, f'Scheduled "{TASK_NAME}": {describe(schedule)}, below-normal priority, no window.'
    if sys.platform == 'darwin':
        plist, domain = launchd_paths()
        what = f'Scheduled {LAUNCHD_LABEL}: {describe(schedule)}, background priority (Nice 10, low-priority I/O).'
        if not defer:
            subprocess.run(['launchctl', 'bootout', f'{domain}/{LAUNCHD_LABEL}'], capture_output=True)
        write_atomic(plist, plistlib.dumps(launchd_plist(schedule, python, script)))
        if defer:
            try:
                RELOAD_MARKER.unlink()
            except OSError:
                pass
            subprocess.Popen(['/bin/sh', '-c', RELOAD_SCRIPT, 'skills-sync-reload', str(os.getpid()), domain,
                              LAUNCHD_LABEL, str(plist), str(RELOAD_MARKER), schedule],
                             start_new_session=True, close_fds=True, stdin=subprocess.DEVNULL,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return 'pending', what
        r = subprocess.run(['launchctl', 'bootstrap', domain, str(plist)], capture_output=True, text=True)
        if r.returncode:
            return False, f'launchctl could not load {tilde(plist)}: {r.stderr.strip()}'
        return True, what
    kind, value = schedule.split()
    hour, minute = value.split(':') if kind == 'daily' else ('', '')
    when = f'{int(minute)} {int(hour)} * * *' if kind == 'daily' else f'*/{value} * * * *'
    return False, (f'Add these lines with crontab -e:\n{when} "{python}" "{script}" sync >/dev/null 2>&1\n'
                   f'@reboot "{python}" "{script}" sync >/dev/null 2>&1')


def registered_job():
    """This machine's sync job as registered: {'schedule', 'python', 'here' (it runs this clone's sync-skills.py)},
    or None when there is none (and on Linux, where the crontab is not read)."""
    script = os.path.normcase(os.path.realpath(REPO / 'tools' / 'sync-skills.py'))
    if os.name == 'nt':
        r = subprocess.run(['schtasks', '/Query', '/TN', TASK_NAME, '/XML'], capture_output=True, text=True,
                           errors='replace')
        if r.returncode:
            return None
        xml = r.stdout
        m = re.search(r'<Arguments>(.*?)</Arguments>', xml, re.S)
        found = re.search(r'"([^"]+)"\s+"([^"]+)"\s+sync\b', html.unescape(m.group(1))) if m else None
        schedule = None
        if '<ScheduleByDay>' in xml:
            t = re.search(r'<CalendarTrigger>.*?<StartBoundary>[^<]*?T(\d\d):(\d\d)', xml, re.S)
            schedule = parse_schedule_value('daily', f'{t.group(1)}:{t.group(2)}') if t else None
        else:
            t = re.search(r'<TimeTrigger>.*?<Interval>PT(?:(\d+)H)?(?:(\d+)M)?</Interval>', xml, re.S)
            if t:
                schedule = parse_schedule_value('every', int(t.group(1) or 0) * 60 + int(t.group(2) or 0))
        return {'schedule': schedule, 'python': found.group(1) if found else None,
                'here': bool(found) and os.path.normcase(os.path.realpath(found.group(2))) == script}
    if sys.platform == 'darwin':
        plist, _ = launchd_paths()
        try:
            data = plistlib.loads(plist.read_bytes())
        except (OSError, ValueError):
            return None
        args = data.get('ProgramArguments') or []
        calendar = data.get('StartCalendarInterval')
        schedule = None
        if isinstance(calendar, dict) and 'Hour' in calendar:
            schedule = parse_schedule_value('daily', f"{calendar['Hour']}:{int(calendar.get('Minute', 0)):02d}")
        elif data.get('StartInterval'):
            schedule = parse_schedule_value('every', int(data['StartInterval']) // 60)
        return {'schedule': schedule, 'python': args[0] if args else None,
                'here': len(args) >= 2 and os.path.normcase(os.path.realpath(args[1])) == script}
    return None


def machine_status_body(schedule, pending=False):
    if os.name == 'nt':
        job = f'Task Scheduler "{TASK_NAME}", below-normal priority, no window'
    elif sys.platform == 'darwin':
        job = f'launchd {LAUNCHD_LABEL}, background priority (Nice 10, low-priority I/O)'
    else:
        job = 'crontab'
    return (f'schedule: {describe(schedule)}'
            + (' (launchd reloads the job when the run that wrote this ends)' if pending else '') + f'\njob: {job}\n')


def write_machine_status(slug, schedule, pending=False):
    """private/machines/<host>.txt: this machine's schedule, so the repo shows every machine's. Rewritten only when
    it changes, so it is committed only then."""
    body = machine_status_body(schedule, pending)
    rel = f'private/machines/{slug}.txt'
    try:
        if (REPO / rel).read_text(encoding='utf-8').split('since:')[0] == body:
            return []
    except OSError:
        pass
    write_atomic(REPO / rel, (body + f'since: {now_iso()}\n').encode())
    return [rel]


def status_stale(slug, state):
    """This machine registered its own job, but private/machines/<host>.txt does not show it yet."""
    pending = state.get('schedule_pending')
    shown = pending['value'] if pending else state.get('schedule')
    if not (shown and state.get('schedule_managed')):
        return False
    try:
        current = (REPO / f'private/machines/{slug}.txt').read_text(encoding='utf-8').split('since:')[0]
    except OSError:
        current = ''
    return current != machine_status_body(shown, bool(pending))


def schedule_due(settings):
    """The repo's rule for this machine changed since this machine last acted on it, a launchd reload waits to be
    confirmed, or private/machines/<host>.txt is behind. Cheap: two small file reads."""
    state = load_state()
    if state.get('schedule_pending') or status_stale(host_slug(host_name(settings)), state):
        return True
    want, _ = wanted_schedule(settings)
    return want is not None and want != state.get('schedule_seen')


def apply_schedule(settings, run, slug):
    """Bring this machine's sync job in line with the repo's schedule for it, but only a job that runs this clone's
    sync-skills.py (a machine never scheduled with sync-skills.py schedule is left alone), and keep
    private/machines/<host>.txt current. Returns the repo paths written."""
    state = load_state()
    written = change_schedule(settings, run, slug, state)
    if not written and status_stale(slug, state):
        pending = state.get('schedule_pending')
        written = write_machine_status(slug, pending['value'] if pending else state['schedule'], bool(pending))
    return written


def change_schedule(settings, run, slug, state):
    want, _ = wanted_schedule(settings)
    force = False
    pending = state.get('schedule_pending')
    if pending:
        try:
            reloaded = RELOAD_MARKER.read_text(encoding='utf-8').strip()
        except OSError:
            reloaded = ''
        if reloaded and reloaded == pending.get('value'):
            try:
                RELOAD_MARKER.unlink()
            except OSError:
                pass
            del state['schedule_pending']
            state['schedule'] = reloaded
            save_state(state)
            run.note(f'schedule now {describe(reloaded)}')
            return write_machine_status(slug, reloaded)
        if pending.get('value') == want and time.time() - pending.get('at', 0) < 900:
            return []
        del state['schedule_pending']
        force = True
    if want is None or (want == state.get('schedule_seen') and not force):
        if force:
            save_state(state)
        return []
    job = registered_job()
    if not job or not job['here']:
        state['schedule_seen'] = want
        state['schedule_managed'] = False
        save_state(state)
        return []
    state['schedule_managed'] = True
    if job['schedule'] == want and not force:
        state['schedule'] = state['schedule_seen'] = want
        save_state(state)
        return write_machine_status(slug, want)
    ok, what = register_job(want, job['python'] or default_python(), REPO / 'tools' / 'sync-skills.py', defer=True)
    if ok == 'pending':
        state['schedule_seen'] = want
        state['schedule_pending'] = {'value': want, 'at': time.time()}
        save_state(state)
        run.note(f'schedule changes to {describe(want)} when this run ends')
        return write_machine_status(slug, want, pending=True)
    if ok:
        state['schedule'] = state['schedule_seen'] = want
        save_state(state)
        run.note(f'schedule now {describe(want)}')
        return write_machine_status(slug, want)
    save_state(state)
    run.note(f'schedule not changed ({first_error(what)})')
    return []


def cmd_schedule(args):
    settings = load_settings()
    state = load_state()
    script = REPO / 'tools' / 'sync-skills.py'
    if 'def cmd_sync(' not in script.read_text(encoding='utf-8', errors='replace'):
        print(f'{tilde(script)} is an older version without sync; run sync first, so the clone has the new tools')
        return 1
    if args.remove:
        for key in ('schedule', 'schedule_seen', 'schedule_pending', 'schedule_managed'):
            state.pop(key, None)
        save_state(state)
        if os.name == 'nt':
            r = subprocess.run(['schtasks', '/Delete', '/F', '/TN', TASK_NAME], capture_output=True, text=True)
            print(r.stdout.strip() or r.stderr.strip())
            return r.returncode
        if sys.platform == 'darwin':
            plist, domain = launchd_paths()
            subprocess.run(['launchctl', 'bootout', f'{domain}/{LAUNCHD_LABEL}'], capture_output=True)
            if plist.exists():
                plist.unlink()
            print('Removed the schedule. Nothing else was deleted.')
            return 0
        print('Remove the two lines with crontab -e.')
        return 0
    if args.daily and args.every:
        print('use --daily or --every, not both')
        return 2
    want, why = wanted_schedule(settings)
    if args.daily or args.every:
        chosen = parse_schedule_value('daily', args.daily) if args.daily else parse_schedule_value('every', args.every)
        if not chosen:
            print('--daily takes a 24-hour time (HH:MM); --every takes 5 to 1440 minutes')
            return 2
        if want and want != chosen:
            print(f'note: {SCHEDULE_FILE} sets {describe(want)} for this machine; the sync keeps this one until that '
                  'rule changes')
    else:
        chosen = want or DEFAULT_SCHEDULE
        if want is None and 'not valid' in (why or ''):
            print(f'note: {why}; using {describe(chosen)}')
    ok, what = register_job(chosen, default_python(), script)
    print(what)
    if ok is not True and (os.name == 'nt' or sys.platform == 'darwin'):
        return 1
    state['schedule'] = chosen
    state['schedule_seen'] = want
    state['schedule_managed'] = ok is True
    state.pop('schedule_pending', None)
    save_state(state)
    settings.pop('interval_minutes', None)
    if settings.get('private_url'):
        save_settings(settings)
    return 0


def schedule_state():
    if os.name == 'nt':
        lines = []
        for name in (TASK_NAME, OLD_TASK_NAME):
            script = (f"$t = Get-ScheduledTask -TaskName '{name}' -ErrorAction SilentlyContinue; if ($t) {{ "
                      f"$i = Get-ScheduledTaskInfo -TaskName '{name}'; '{{0}}|{{1}}|{{2}}|{{3}}' -f $t.State, $i.LastRunTime, "
                      f"$i.LastTaskResult, $i.NextRunTime }}")
            r = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script],
                               capture_output=True, text=True)
            fields = r.stdout.strip().split('|')
            if len(fields) != 4:
                lines.append(f'{name}: not scheduled')
                continue
            state, last, result, upcoming = fields
            lines.append(f"{name}: {state}; last run {last or 'never'} (result {result}); next {upcoming or '-'}")
        return lines
    if sys.platform == 'darwin':
        r = subprocess.run(['launchctl', 'print', f'gui/{os.getuid()}/{LAUNCHD_LABEL}'], capture_output=True, text=True)
        if r.returncode:
            return [f'{LAUNCHD_LABEL}: not scheduled']
        keep = [line.strip() for line in r.stdout.splitlines()
                if line.strip().startswith(('state =', 'runs =', 'last exit code', 'run interval', '"Hour"', '"Minute"'))]
        return [f"{LAUNCHD_LABEL}: {'; '.join(keep)}"]
    return ['schedule: see crontab -l']


def cmd_sync_status(args):
    settings = load_settings()
    state = load_state()
    print(f"settings {tilde(SETTINGS)}{'' if settings else ': missing (run setup)'}")
    for key in ('host', 'private_url', 'private_user', 'public_url', 'public_user', 'my_taste_source'):
        if key in settings:
            print(f'  {key}: {settings[key]}')
    print(f"clone {tilde(REPO)}: origin {git('remote', 'get-url', 'origin') or '-'}, public {git('remote', 'get-url', 'public') or '-'}")
    want, why = wanted_schedule(settings)
    job = registered_job()
    print(f"schedule: {describe(job['schedule']) if job and job['schedule'] else 'unknown'}"
          + ('' if not job or job['here'] else ' (the job runs another clone)')
          + f"; {SCHEDULE_FILE}: {describe(want) if want else why}"
          + ('; a launchd reload is waiting for its first run' if state.get('schedule_pending') else ''))
    for line in schedule_state():
        print(line)
    if SYNC_LOCK.exists():
        print(f'a sync is running (lock {tilde(SYNC_LOCK)})')
    conflicts = state.get('conflicts', {})
    if conflicts:
        print('conflict branches pushed from here: ' + ', '.join(list(conflicts.values())[-5:]))
    if SYNC_LOG.is_file():
        print(f'last runs ({tilde(SYNC_LOG)}):')
        for line in SYNC_LOG.read_text(encoding='utf-8', errors='replace').splitlines()[-8:]:
            print(f'  {line}')
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('command', choices=['status', 'harvest', 'resolve', 'install', 'sync', 'setup', 'schedule', 'sync-status',
                                                'backfill-inbox', 'cli-defaults'])
    parser.add_argument('paths', nargs='*', help='resolve: skill/path entries to mark as merged')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--json', action='store_true', help='status only')
    parser.add_argument('--include-new', action='store_true', help='harvest: also copy local-only skills into the repo')
    parser.add_argument('--force', action='store_true', help='install even if installed copies have unharvested edits')
    parser.add_argument('--private-url', help='setup: the private repo (origin), for example https://github.com/<owner>/<repo>.git')
    parser.add_argument('--private-user', help='setup: the GitHub account (signed in to GitHub CLI) that can push to it')
    parser.add_argument('--public-url', help=f'setup: the public repo (default {DEFAULT_PUBLIC_URL})')
    parser.add_argument('--public-user', help=f'setup: the account that publishes to it (default {DEFAULT_PUBLIC_USER})')
    parser.add_argument('--host', help='setup: the name used in commit messages and branch names (default: the host name)')
    parser.add_argument('--daily', help='schedule: run once a day at this local time, HH:MM (default: the rule in '
                        'private/sync-schedule.txt for this machine, else 10:30)')
    parser.add_argument('--every', type=int, help='schedule: run every this many minutes instead (5 to 1440)')
    parser.add_argument('--remove', action='store_true', help='schedule: remove the schedule')
    parser.add_argument('--repo', help='the clone to work on (default: the one this script is in); used to bootstrap a machine')
    parser.add_argument('--since', help='backfill-inbox: the start of the window, an ISO time (for example 2026-03-01T00:00:00Z)')
    parser.add_argument('--until', help='backfill-inbox: the end of the window (default: now)')
    parser.add_argument('--undo', action='store_true', help='cli-defaults: put back the values the sync replaced')
    args = parser.parse_args()
    if args.repo:
        global REPO
        REPO = Path(args.repo).expanduser().resolve()
    STATE.mkdir(parents=True, exist_ok=True)
    return {'status': cmd_status, 'harvest': cmd_harvest, 'resolve': cmd_resolve, 'install': cmd_install,
            'sync': cmd_sync, 'setup': cmd_setup, 'schedule': cmd_schedule, 'sync-status': cmd_sync_status,
            'backfill-inbox': cmd_backfill_inbox, 'cli-defaults': cmd_cli_defaults}[args.command](args)


if __name__ == '__main__':
    sys.exit(main())

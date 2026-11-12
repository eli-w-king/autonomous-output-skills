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

Attendee mode (one account; automations/ATTENDEES.md):
  setup-attendee    make or reuse a private copy of the shared repo (origin) with the shared repo as a fetch-only
                    remote (public), install the skills with backups, and schedule the daily sync
  review-pr         open or update the pull request that brings the review branch into main
  upstream-pr       merge the shared repo's main into the upstream branch and open or update its pull request
  review-reset      drop what waits on the review branch (it is kept on a branch first) and reinstall main
In attendee mode the clone stays on the review branch (skill-updates): sync harvests edits onto it and pushes it, never
main, and installs from it, so edits waiting for review stay installed. Nothing is ever published.

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
       sync-skills.py setup-attendee [--private-repo OWNER/NAME] [--create] [--json] [--dry-run]
                      [--weekly automation|os|both|none] [--daily HH:MM] [--no-schedule] [--model ID] [--public-url URL]
       sync-skills.py review-pr|upstream-pr|review-reset [--json] [--dry-run]
       sync-skills.py schedule [--daily HH:MM | --every MINUTES] [--remove]
       sync-skills.py sync-status
Environment: COPILOT_SKILLS_DIR (default ~/.copilot/skills), SKILL_MINER_DIR (default ~/.copilot/skill-miner)
Exit codes: 0 ok, 1 error, 2 usage error, 3 conflicts or unharvested edits (nothing overwritten), 4 install rolled back
"""
import argparse
import contextlib
import datetime as dt
import difflib
import fnmatch
import hashlib
import html
import io
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
TERMS_FILE = 'private/private-terms.txt'
PUBLIC_TERMS_FILE = 'private/public-terms.txt'
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
# Attendee mode: where message exports and the miner's sync copies live. None means private/ in the clone (the
# maintainer setup); attendee mode keeps them in STATE, on the machine (automations/ATTENDEES.md, "Privacy").
PRIVATE_DATA = None

GIT_ENV = {k: v for k, v in os.environ.items() if k not in ('GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN')}
GIT_ENV.update(GIT_TERMINAL_PROMPT='0', GCM_INTERACTIVE='never', GIT_EDITOR='true', GIT_MERGE_AUTOEDIT='no')


# ---------------------------------------------------------------- files and fingerprints

@contextlib.contextmanager
def scratch_dir():
    """A temporary folder, removed afterward. On Windows another process can hold a fresh folder for a moment (a
    virus scan of the files just written in it), and tempfile.TemporaryDirectory then raises: one daily sync lost
    its day to that. Removal is retried for up to 10 seconds, then left to the system's temp cleanup."""
    path = tempfile.mkdtemp(prefix='skills-sync-')
    try:
        yield path
    finally:
        for _ in range(20):
            shutil.rmtree(path, ignore_errors=True)
            if not os.path.exists(path):
                break
            time.sleep(0.5)


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
    with scratch_dir() as tmp:
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
        data = {'repo': str(REPO), 'skills_dir': str(SKILLS), 'manifest': MANIFEST.is_file(),
                'files': [{k: v for k, v in e.items() if k != 'inferred_base'} for e in entries],
                'other_skills': extra}
        data.update(setup_summary(entries))
        print(json.dumps(data, indent=1))
        return 0
    settings = load_settings()
    if is_attendee(settings):
        review = review_branch(settings)
        ahead = count(f'refs/remotes/origin/main..refs/heads/{review}')
        print(f"attendee mode: your private copy {settings.get('private_repo') or settings.get('private_url')}; "
              f"edits wait on {review} ({ahead} commit(s) not in main yet)")
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


def data_root():
    """Where the message exports live: private/ in the clone, or (attendee mode) the private state on this machine."""
    return PRIVATE_DATA if PRIVATE_DATA is not None else REPO / 'private'


def note_written(written, path):
    """Add a path to commit, as the repo path; a path outside the clone (attendee mode) has nothing to commit."""
    try:
        written.append(Path(path).relative_to(REPO).as_posix())
    except ValueError:
        pass


def collect_human(run, since, until, timeout=900):
    """My typed messages in this machine's sessions over [since, until), from tools/collect-messages.py:
    (rows, not_mine, sent, flagged, stats), or None after noting why. rows are kind "human" only, minus the
    lines the secret scan flags; not_mine holds the ids of everything else; sent holds (time, fingerprint)
    for every text this machine's agents sent to another session."""
    collector = Path(__file__).resolve().parent / 'collect-messages.py'
    name = (git('config', 'user.name') or '').split(' ')[0]
    sent_root = data_root() / 'inbox-sent'
    with scratch_dir() as tmp:
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
    for path in (data_root() / 'inbox-sent').glob('*/*.txt'):
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
    sent_folder = data_root() / 'inbox-sent' / slug
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
        note_written(written, path)
    known = known_fingerprints()
    folder = data_root() / 'inbox' / slug
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
            note_written(written, path)
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
                note_written(written, path)
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
    folder = data_root() / 'inbox-backfill' / slug
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
            note_written(written, path)
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
    note_written(written, folder / 'manifest.json')
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
    return pairs + [(TERMS_FILE, STATE / 'private-terms.txt')]


def public_terms():
    """The names in private/public-terms.txt, lowercased: public (a GA model, say), so never private terms."""
    try:
        text = (REPO / PUBLIC_TERMS_FILE).read_text(encoding='utf-8-sig')
    except OSError:
        return set()
    return {n.split('#', 1)[0].strip().lower() for n in text.splitlines() if n.split('#', 1)[0].strip()}


def without_public_terms(data, public):
    """A private terms file's bytes without the lines that name something public, or None when it has none."""
    if data is None or not public:
        return None
    lines = data.decode('utf-8', 'replace').splitlines()
    kept = [line for line in lines if line.strip().lower() not in public]
    return None if len(kept) == len(lines) else ('\n'.join(kept) + '\n').encode('utf-8')


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
    with scratch_dir() as tmp:
        t = Path(tmp)
        for name, data in (('ours', l), ('base', b or b''), ('theirs', r)):
            (t / name).write_bytes(data)
        u = subprocess.run(['git', 'merge-file', '-p', '--union', str(t / 'ours'), str(t / 'base'), str(t / 'theirs')],
                           capture_output=True, env=GIT_ENV)
    return u.stdout, 1


def looks_secret(data, rel):
    with scratch_dir() as tmp:
        scan = Path(tmp) / Path(rel).name
        scan.write_bytes(data)
        ok, _ = scan_files([scan])
    return not ok


def miner_settled():
    """Every state file is the same here, in the clone, and in the last agreed base (the sync's fast path), and
    no private terms file names something public."""
    for rel, local in miner_pairs():
        r, l = read_norm(REPO / rel), read_norm(local)
        if r != l or (r is not None and read_norm(miner_base(rel)) != r):
            return False
    public = public_terms()
    return not public or (without_public_terms(read_norm(REPO / TERMS_FILE), public) is None
                          and without_public_terms(read_norm(STATE / 'private-terms.txt'), public) is None)


def sync_miner_state(run):
    """The weekly miner's private state and the private terms, the same on every machine through the private
    repo (private/skill-miner/ and private/private-terms.txt; private/ is never published). Each file is
    merged 3-way against the version this machine and origin last agreed on (~/.copilot/skill-miner/sync-base/):
    JSON by key and by "id", the terms by line, the notes and voice samples with git merge-file (keeping both
    sides' lines where they overlap). Text that looks like a secret never goes to the repo. Deletions never
    spread: a machine without a file gets the repo's, and a file the repo stops carrying stays where it is.
    A name in private/public-terms.txt is taken out of both terms files first, on every machine, so a name that
    went public never comes back from one that still lists it.
    A local file is backed up before it is replaced. Returns the repo paths written (to commit)."""
    written, updated = [], []
    stamp = dt.datetime.now().strftime('%Y%m%d-%H%M%S')
    public = public_terms()
    for rel, local in miner_pairs():
        rp, bp = REPO / rel, miner_base(rel)
        r, l, b = read_norm(rp), read_norm(local), read_norm(bp)
        if rel == TERMS_FILE and public:
            clean_r, clean_l = without_public_terms(r, public), without_public_terms(l, public)
            if clean_r is not None:
                write_atomic(rp, clean_r)
                written.append(rel)
                r = clean_r
            if clean_l is not None:
                keep = STATE / 'backups' / stamp / local.relative_to(STATE)
                keep.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(local, keep)
                write_atomic(local, clean_l)
                updated.append(local.name)
                l = clean_l
            if clean_r is not None or clean_l is not None:
                run.note('names in private/public-terms.txt taken out of the private terms')
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
        run.note(f"miner state updated here: {', '.join(dict.fromkeys(updated))}")
    return list(dict.fromkeys(written))


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
    with scratch_dir() as tmp:
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
        elif is_attendee(settings):
            code = sync_once_attendee(settings, run)
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
    if is_attendee(settings):
        print(f'{tilde(SETTINGS)} is set up in attendee mode; run sync-skills.py setup-attendee instead')
        return 2
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


def daily_boundary(hhmm, now=None):
    """StartBoundary of a daily Task Scheduler trigger at local HH:MM, with this session's UTC offset. Without an
    offset Task Scheduler reads the time in the system's zone, and Cloud PCs keep that at UTC while the session takes
    the client's zone, so a daily 10:00 ran at 02:00 Pacific. A daylight saving change moves a fixed offset an hour;
    the next sync moves it back (job_drifted)."""
    return next_daily(hhmm, now).astimezone().isoformat()


def boundary_utc(boundary):
    """A StartBoundary as a UTC datetime, or None when it has no UTC offset (the system's zone applies)."""
    try:
        start = dt.datetime.fromisoformat(boundary.strip().replace('Z', '+00:00'))
    except ValueError:
        return None
    return start.astimezone(dt.timezone.utc) if start.tzinfo else None


def boundary_local_time(boundary, now=None):
    """'HH:MM': local time of the next run of a daily trigger with this StartBoundary, or None without a UTC offset."""
    start = boundary_utc(boundary)
    if start is None:
        return None
    now = (now or dt.datetime.now(dt.timezone.utc)).astimezone(dt.timezone.utc)
    upcoming = now.replace(hour=start.hour, minute=start.minute, second=0, microsecond=0)
    if start > now:
        upcoming = start
    elif upcoming <= now:
        upcoming += dt.timedelta(days=1)
    local = upcoming.astimezone()
    return f'{local.hour:02d}:{local.minute:02d}'


def task_xml(schedule, python, script):
    from xml.sax.saxutils import escape
    user = subprocess.run(['whoami'], capture_output=True, text=True).stdout.strip()
    conhost = Path(os.environ.get('SystemRoot', r'C:\Windows')) / 'System32' / 'conhost.exe'
    arguments = f'--headless "{python}" "{script}" sync'
    kind, value = schedule.split()
    if kind == 'daily':
        trigger = f'''    <CalendarTrigger>
      <StartBoundary>{daily_boundary(value)}</StartBoundary>
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
    if is_attendee():
        data['EnvironmentVariables'].update(job_environment())
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
        schedule, boundary, trigger = None, None, None
        if '<ScheduleByDay>' in xml:
            t = re.search(r'<CalendarTrigger>.*?<StartBoundary>([^<]+)</StartBoundary>', xml, re.S)
            boundary = t.group(1).strip() if t else None
            at = boundary_local_time(boundary) if boundary else None
            schedule = parse_schedule_value('daily', at) if at else None
            start = boundary_utc(boundary) if boundary else None
            trigger = f'daily at {start:%H:%M} UTC' if start else None
        else:
            t = re.search(r'<TimeTrigger>.*?<Interval>PT(?:(\d+)H)?(?:(\d+)M)?</Interval>', xml, re.S)
            if t:
                schedule = parse_schedule_value('every', int(t.group(1) or 0) * 60 + int(t.group(2) or 0))
        return {'schedule': schedule, 'python': found.group(1) if found else None,
                'here': bool(found) and os.path.normcase(os.path.realpath(found.group(2))) == script,
                'boundary': boundary, 'trigger': trigger}
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


def machine_status_body(schedule, pending=False, trigger=None):
    if os.name == 'nt':
        job = f'Task Scheduler "{TASK_NAME}", below-normal priority, no window'
    elif sys.platform == 'darwin':
        job = f'launchd {LAUNCHD_LABEL}, background priority (Nice 10, low-priority I/O)'
    else:
        job = 'crontab'
    return (f'schedule: {describe(schedule)}'
            + (' (launchd reloads the job when the run that wrote this ends)' if pending else '') + f'\njob: {job}\n'
            + (f'trigger: {trigger}\n' if trigger else ''))


def write_machine_status(slug, schedule, pending=False, trigger=None):
    """private/machines/<host>.txt: this machine's schedule, so the repo shows every machine's. Rewritten only when
    it changes, so it is committed only then."""
    body = machine_status_body(schedule, pending, trigger)
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
    return current != machine_status_body(shown, bool(pending), state.get('schedule_trigger'))


def check_due(state):
    """Windows: this machine's daily trigger has not been checked today (job_drifted)."""
    return (os.name == 'nt' and bool(state.get('schedule_managed'))
            and str(state.get('schedule') or '').startswith('daily ')
            and state.get('schedule_checked') != dt.date.today().isoformat())


def note_trigger(state, job):
    """Keep the registered trigger's UTC time for private/machines/<host>.txt."""
    if job and job.get('trigger'):
        state['schedule_trigger'] = job['trigger']
    else:
        state.pop('schedule_trigger', None)


def job_drifted(state, want):
    """Windows, once a day: the registered daily trigger no longer runs at the wanted local time (a daylight saving
    or time zone change moved it, or it was written without a UTC offset and runs in the system's zone)."""
    if not (check_due(state) and want.startswith('daily ')):
        return False
    state['schedule_checked'] = dt.date.today().isoformat()
    job = registered_job()
    if job and job['here']:
        note_trigger(state, job)
    save_state(state)
    return bool(job and job['here'] and job['schedule'] != want)


def schedule_due(settings):
    """The repo's rule for this machine changed since this machine last acted on it, a launchd reload waits to be
    confirmed, private/machines/<host>.txt is behind, or today's check of a Windows trigger is due. Cheap: small
    file reads."""
    state = load_state()
    if state.get('schedule_pending') or status_stale(host_slug(host_name(settings)), state) or check_due(state):
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
        written = write_machine_status(slug, pending['value'] if pending else state['schedule'], bool(pending),
                                       state.get('schedule_trigger'))
    return written


def change_schedule(settings, run, slug, state):
    want, _ = wanted_schedule(settings)
    force = drifted = False
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
    if want is None:
        if force:
            save_state(state)
        return []
    if want == state.get('schedule_seen') and not force:
        drifted = job_drifted(state, want)
        if not drifted:
            return []
        force = True
    job = registered_job()
    if not job or not job['here']:
        state['schedule_seen'] = want
        state['schedule_managed'] = False
        save_state(state)
        return []
    state['schedule_managed'] = True
    if job['schedule'] == want and not force:
        state['schedule'] = state['schedule_seen'] = want
        note_trigger(state, job)
        save_state(state)
        return write_machine_status(slug, want, trigger=state.get('schedule_trigger'))
    ok, what = register_job(want, job['python'] or default_python(), REPO / 'tools' / 'sync-skills.py', defer=True)
    if ok == 'pending':
        state['schedule_seen'] = want
        state['schedule_pending'] = {'value': want, 'at': time.time()}
        save_state(state)
        run.note(f'schedule changes to {describe(want)} when this run ends')
        return write_machine_status(slug, want, pending=True)
    if ok:
        state['schedule'] = state['schedule_seen'] = want
        if os.name == 'nt':
            note_trigger(state, registered_job())
            state['schedule_checked'] = dt.date.today().isoformat()
        save_state(state)
        if drifted:
            ran = f"ran at {job['schedule'].split()[1]}" if job['schedule'] else 'had no UTC offset'
            run.note(f'schedule fixed: the task {ran}, now {describe(want)}')
        else:
            run.note(f'schedule now {describe(want)}')
        return write_machine_status(slug, want, trigger=state.get('schedule_trigger'))
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
    if os.name == 'nt':
        note_trigger(state, registered_job())
        state['schedule_checked'] = dt.date.today().isoformat()
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
    if job and job['schedule']:
        shown = describe(job['schedule']) + (f" ({job['trigger']})" if job.get('trigger') else '')
    elif job and job.get('boundary'):
        shown = f"a daily trigger at {job['boundary']} with no UTC offset, in the system's time zone (the next sync fixes it)"
    else:
        shown = 'unknown'
    print(f"schedule: {shown}"
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


# ---------------------------------------------------------------- attendee mode: one account and a private copy

ATTENDEE_REPO_NAME = 'autonomous-output-skills'
REVIEW_BRANCH = 'skill-updates'
UPSTREAM_BRANCH = 'upstream-updates'
# Personal files: once you changed one, a merge from the shared repo keeps yours whole (your voice and taste are yours;
# tools/personal-skills.py makes them).
KEEP_MINE = ('my-voice/SKILL.md', 'my-taste/SKILL.md')
NO_PUSH = 'no_push'  # the shared repo's push URL in attendee mode, so git push public always fails
MINER_MARKER = '[weekly-skill-miner]'
AUTOMATION_MODEL = 'claude-opus-5.5'
MINER_TASK_NAME = os.environ.get('SKILL_MINER_TASK', 'Autonomous weekly skill miner')
MINER_LABEL = os.environ.get('SKILL_MINER_LABEL', 'com.autonomous-output-skills.weekly-skill-update')
JOB_ENV = ('COPILOT_HOME', 'COPILOT_SKILLS_DIR', 'SKILL_MINER_DIR', 'SKILLS_SYNC_SETTINGS', 'COPILOT_SESSION_STATE',
           'GH_CONFIG_DIR', 'XDG_CONFIG_HOME', 'SKILLS_SYNC_LABEL', 'SKILL_MINER_LABEL', 'SKILLS_SYNC_TASK', 'SKILL_MINER_TASK')
PUBLISHIGNORE_ATTENDEE = (
    '# This repo is a private copy of the autonomous output skills, and it is never published.\n'
    '# While this file exists, tools/validate-skills.py treats the repo as private: private/ and the paths\n'
    '# listed below get only the secret and script checks. One gitignore-style pattern per line.\n')
TERMS_HEADER = (
    '# Names that must never appear outside private/ in your skills repo: one per line, or a /regex/.\n'
    '# The weekly skill miner adds internal names it meets. This file stays on this machine.\n')
_gh_tokens = {}


def is_attendee(settings=None):
    return (settings if settings is not None else load_settings()).get('mode') == 'attendee'


def review_branch(settings=None):
    return (settings if settings is not None else load_settings()).get('review_branch') or REVIEW_BRANCH


def upstream_branch(settings=None):
    return (settings if settings is not None else load_settings()).get('upstream_branch') or UPSTREAM_BRANCH


def repo_slug(value):
    """'owner/name' from owner/name or a GitHub URL, or None."""
    m = re.fullmatch(r'(?:https://github\.com/|git@github\.com:)?([A-Za-z0-9][A-Za-z0-9_-]*)/([A-Za-z0-9._-]+?)(?:\.git)?/?',
                     (value or '').strip())
    return f'{m.group(1)}/{m.group(2)}' if m and m.group(2) not in ('.', '..') else None


def tree_of(ref):
    return rev(f'{ref}^{{tree}}') if ref else ''


def blob_of(ref, path):
    return rev(f'{ref}:{path}') if ref else ''


def job_environment():
    """Attendee mode: the variables that locate this setup (a HOME other than the account's, COPILOT_HOME, ...), so a
    scheduled job runs against the setup it was scheduled from."""
    env = {}
    home = os.environ.get('HOME')
    if home and os.name != 'nt':
        try:
            import pwd
            account_home = pwd.getpwuid(os.getuid()).pw_dir
        except (ImportError, KeyError):
            account_home = home
        if os.path.realpath(home) != os.path.realpath(account_home):
            env['HOME'] = home
    for key in JOB_ENV:
        if os.environ.get(key):
            env[key] = os.environ[key]
    return env


def gh_bin():
    found = shutil.which('gh')
    return str(Path(found).resolve()) if found else None


def gh_env(user=None):
    """GitHub CLI's environment, never prompting. An injected token is dropped (a stale GH_TOKEN broke a dev box) in
    favor of the stored token of the account that owns the private copy, whichever account is active."""
    env = {k: v for k, v in os.environ.items() if k not in ('GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN')}
    env.update(GH_PROMPT_DISABLED='1', GH_NO_UPDATE_NOTIFIER='1', GH_SPINNER_DISABLED='1', NO_COLOR='1',
               GIT_TERMINAL_PROMPT='0', GCM_INTERACTIVE='never')
    path = gh_bin()
    if user and path:
        if user not in _gh_tokens:
            try:
                r = subprocess.run([path, 'auth', 'token', '--hostname', 'github.com', '--user', user],
                                   capture_output=True, text=True, env=env, timeout=60)
                _gh_tokens[user] = r.stdout.strip() if r.returncode == 0 else ''
            except (OSError, subprocess.TimeoutExpired):
                _gh_tokens[user] = ''
        if _gh_tokens[user]:
            env['GH_TOKEN'] = _gh_tokens[user]
            return env
    for key in ('GH_TOKEN', 'GITHUB_TOKEN'):
        if os.environ.get(key):
            env['GH_TOKEN'] = os.environ[key]
            break
    return env


def gh(*args, user=None, timeout=120):
    """GitHub CLI: (exit code, stdout, stderr) as text."""
    path = gh_bin()
    if not path:
        return 127, '', 'GitHub CLI (gh) is not installed'
    try:
        r = subprocess.run([path, *args], capture_output=True, text=True, encoding='utf-8', errors='replace',
                           env=gh_env(user), timeout=timeout)
    except subprocess.TimeoutExpired:
        return 124, '', f'gh {args[0]} timed out'
    return r.returncode, r.stdout.strip(), r.stderr.strip()


def ls_remote_heads(*branches):
    """({branch: sha} on origin, '') or (None, error) when origin cannot be reached."""
    rc, out, err = g('ls-remote', '--quiet', 'origin', *[f'refs/heads/{b}' for b in branches], timeout=90)
    if rc:
        return None, err
    heads = {}
    for line in out.splitlines():
        sha, _, ref = line.partition('\t')
        if ref.startswith('refs/heads/'):
            heads[ref[len('refs/heads/'):]] = sha
    return heads, ''


def track_branch(branch):
    g('config', f'branch.{branch}.remote', 'origin')
    g('config', f'branch.{branch}.merge', f'refs/heads/{branch}')


def switch_to_review(settings, run):
    """Attendee mode works on the review branch: True when the clone is on it (switching back when it is clean)."""
    review = review_branch(settings)
    branch = git('symbolic-ref', '--short', '-q', 'HEAD')
    if branch == review:
        return True
    if dirty_paths():
        run.note(f"the clone is on {branch or 'a detached HEAD'} with uncommitted changes; commit them, then run "
                 f'git switch {review}')
        return False
    if rev(f'refs/heads/{review}'):
        rc, _, err = g('checkout', '-q', review)
    else:
        start = next((r for r in (f'refs/remotes/origin/{review}', 'refs/remotes/origin/main', 'refs/heads/main') if rev(r)),
                     None)
        if not start:
            run.note('there is no main to start the review branch from; run sync-skills.py setup-attendee')
            return False
        rc, _, err = g('checkout', '-q', '--no-track', '-b', review, start)
    if rc:
        run.note(f'could not switch the clone to {review} ({first_error(err)})')
        return False
    track_branch(review)
    run.note(f'switched the clone back to {review}')
    return True


def merge_in(ref, message):
    """Merge ref into the checked-out branch: ('ok', ''), or ('conflict' or 'failed', detail) with the merge aborted."""
    rc, _, err = g('merge', '-q', '-m', message, ref, timeout=300)
    if rc == 0:
        return 'ok', ''
    paths = (git('diff', '--name-only', '--diff-filter=U') or '').splitlines()
    if git_busy():
        g('merge', '--abort')
    return ('conflict', ', '.join(paths[:5])) if paths else ('failed', first_error(err))


def push_review(review, expected, run):
    """Push the review branch: a fast-forward, or (after its content landed in main) a reset guarded by a lease on what
    origin had. Returns True when origin has it."""
    head = rev('HEAD')
    if head == expected or (not expected and not count('refs/remotes/origin/main..HEAD')):
        return True
    command = ['push', '-q', 'origin', f'HEAD:refs/heads/{review}']
    if expected and not is_ancestor(expected, head):
        command.append(f'--force-with-lease=refs/heads/{review}:{expected}')
    rc, _, err = g(*command, timeout=300)
    if rc:
        run.note(f'could not push {review} ({first_error(err)}); the next run tries again')
        return False
    ahead = count('refs/remotes/origin/main..HEAD')
    run.note(f'pushed {review}' + (f' ({ahead} commit(s) waiting for your review)' if ahead else ''))
    return True


def review_declined(settings, review, track_review, track_main):
    """The newest pull request from the review branch was closed without merging, and the branch has not moved since:
    its number, else None. Any failure counts as not declined."""
    slug = repo_slug(settings.get('private_url'))
    if not (slug and track_review and track_main and gh_bin()) or tree_of(track_review) == tree_of(track_main):
        return None
    rc, out, _ = gh('pr', 'list', '--repo', slug, '--head', review, '--base', 'main', '--state', 'all', '--limit', '5',
                    '--json', 'number,state,headRefOid', user=settings.get('private_user'), timeout=60)
    try:
        prs = json.loads(out) if rc == 0 and out else []
    except ValueError:
        return None
    if not prs:
        return None
    newest = max(prs, key=lambda p: p.get('number') or 0)
    if newest.get('state') == 'CLOSED' and newest.get('headRefOid') == track_review:
        return newest.get('number')
    return None


def drop_review(settings, run, reason, keep_newer=True):
    """Save what waits on the review branch to declined/<branch>/<time> on origin, then put the branch back on main and
    push it; the install that follows takes the installed skills back to main (backed up first). With keep_newer,
    commits made here after the declined pull request stay, on top of main. True when done."""
    review = review_branch(settings)
    head, main = rev('HEAD'), rev('refs/remotes/origin/main')
    expected = rev(f'refs/remotes/origin/{review}')
    if dirty_paths():
        run.note(f'{reason}; putting {review} back on main waits for the edits in progress')
        return False
    newer = keep_newer and expected and head != expected
    if newer and not is_ancestor(expected, head):
        run.note(f'{reason}, but {review} also changed elsewhere; left as it is (sync-skills.py review-reset drops it all)')
        return False
    stamp = dt.datetime.now().strftime('%Y%m%d-%H%M%S')
    saved = f'declined/{review}/{stamp}'
    rc, _, err = g('push', '-q', 'origin', f'{expected if newer else head}:refs/heads/{saved}', timeout=300)
    if rc:
        run.note(f'{reason}; could not save it to {saved} ({first_error(err)}), so {review} stays as it is')
        return False
    if newer:
        rc, _, err = g('rebase', '-q', '--onto', main, expected, timeout=300)
        if rc:
            if git_busy():
                g('rebase', '--abort')
            run.note(f'{reason}; the newer commits on {review} do not apply on main ({first_error(err)}); left as it is')
            return False
    else:
        g('reset', '-q', '--hard', main)
    if expected and expected != rev('HEAD'):
        rc, _, err = g('push', '-q', 'origin', f'HEAD:refs/heads/{review}', f'--force-with-lease=refs/heads/{review}:{expected}',
                       timeout=300)
        if rc:
            run.note(f'{review} is back on main here, but the push failed ({first_error(err)}); the next run tries again')
    run.note(f'{reason}: {review} is back on main, and what it had is saved on {saved}')
    return True


def commit_clone_edits(run, applied, written):
    """Commit what harvest wrote and other edits in the clone that have been quiet for a while (as sync_once does).
    Returns False after a failed commit."""
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
            return False
        if committed:
            run.note(f'committed {summarize(committed)}')
    if waiting:
        run.note(f'{len(waiting)} file(s) in the clone changed in the last {QUIET_SECONDS} s; the next run commits them')
    if too_big:
        run.note(f"not committed, over 5 MB: {', '.join(too_big[:3])}")
    return True


def sync_once_attendee(settings, run):
    """The daily sync in attendee mode: one account, a private copy (origin), and the shared repo (public, fetch only).
    Edits sessions made to the installed skills are harvested onto the review branch, never main, and the review branch
    is what gets installed, so edits waiting for review stay installed. main changes only through pull requests the
    person merges. A closed, unmerged review pull request drops its changes (saved on a branch first). Message
    exports and the miner's state stay on this machine. Nothing is ever published."""
    global PRIVATE_DATA
    PRIVATE_DATA = STATE
    slug = host_slug(run.host)
    review = review_branch(settings)
    busy = git_busy()
    if busy:
        run.result = 'error'
        run.note(f'a git operation is in progress in {tilde(REPO)} ({busy}); finish or abort it')
        return 1
    if not same_url(git('config', '--get', 'remote.origin.url'), settings['private_url']):
        run.result = 'error'
        run.note('origin is not your private copy; run sync-skills.py setup-attendee')
        return 1
    if not switch_to_review(settings, run):
        run.result = 'error'
        return 1
    head = rev('HEAD')
    run.head = head
    heads, err = ls_remote_heads('main', review)
    online = heads is not None
    if online and 'main' not in heads:
        run.result = 'error'
        run.note('your private copy has no main branch; run sync-skills.py setup-attendee')
        return 1
    track_main, track_review = rev('refs/remotes/origin/main'), rev(f'refs/remotes/origin/{review}')
    own = count(f'{track_main}..HEAD') if track_main else 0  # commits waiting for review before this run
    state = load_state()
    today = dt.date.today().isoformat()
    check_due = online and bool(track_review) and state.get('review_checked') != today
    pushed = head == track_review if track_review else head == track_main
    if (online and heads['main'] == track_main and heads.get(review, '') == track_review and pushed and not check_due
            and is_ancestor(track_main, head) and not dirty_paths() and installed_matches(load_manifest(), head)
            and not inbox_due(settings) and not state.get('inbox_backfill')):
        return 0
    if not online:
        run.note(f'offline ({first_error(err)}): harvested and installed locally')
    elif heads['main'] != track_main or heads.get(review, '') != track_review:
        rc, _, err = g('fetch', '-q', '--prune', 'origin', timeout=300)
        if rc:
            run.note(f'fetch failed ({first_error(err)})')
            online = False
        track_main, track_review = rev('refs/remotes/origin/main'), rev(f'refs/remotes/origin/{review}')
    if track_main:
        local_main = rev('refs/heads/main')
        if local_main != track_main and (not local_main or is_ancestor(local_main, track_main)):
            g('update-ref', 'refs/heads/main', track_main)
    dirty = bool(dirty_paths())
    hold = False  # the review branch could not take in what origin has: it is not pushed this run

    # What changed on GitHub: the review branch (edits in the pull request, or another machine), then main.
    if online and track_review and track_review != head and not is_ancestor(track_review, head):
        if dirty:
            hold = True
            run.note(f'{review} changed on GitHub; taking it in waits for the edits in progress')
        elif is_ancestor(head, track_review):
            g('merge', '--ff-only', '-q', f'refs/remotes/origin/{review}', timeout=300)
            run.note(f'pulled {review}')
        else:
            status, detail = merge_in(f'refs/remotes/origin/{review}', f'Merge {review} from GitHub')
            if status != 'ok':
                hold = True
                run.result = 'conflict'
                run.note(f'{review} changed here and on GitHub ({detail}); merge origin/{review} into it by hand')
    if check_due and not hold:
        state['review_checked'] = today
        save_state(state)
        number = review_declined(settings, review, rev(f'refs/remotes/origin/{review}'), track_main)
        if number and drop_review(settings, run, f'pull request #{number} was closed without merging'):
            dirty = bool(dirty_paths())
    head = rev('HEAD')
    if track_main and not is_ancestor(track_main, head):
        if dirty:
            run.note('main has new commits; taking them in waits for the edits in progress')
        elif is_ancestor(head, track_main):
            g('merge', '--ff-only', '-q', 'refs/remotes/origin/main', timeout=300)
            run.note('took in main' + (' (your review was merged)' if own else ''))
        else:
            status, detail = merge_in('refs/remotes/origin/main', f'Merge main into {review}')
            if status != 'ok':
                hold = True
                run.result = 'conflict'
                run.note(f'main and {review} changed the same lines ({detail}); merge origin/main into {review} by hand')
            elif tree_of('HEAD') == tree_of(track_main):
                g('reset', '-q', '--hard', 'refs/remotes/origin/main')
                run.note(f'{review} follows main again (everything on it is in main)')
            else:
                run.note('took in what main gained')
    run.head = rev('HEAD')
    fixed = fix_line_endings()
    if fixed:
        run.note(f'line endings fixed in {fixed} file(s)')

    # Harvest onto the review branch, then commit with other quiet edits in the clone.
    applied, conflicts, written, _ = do_harvest(host=slug)
    if inbox_due(settings):
        export_inbox(settings, run, slug)  # to the private state on this machine, nothing to commit
    if load_state().get('inbox_backfill'):
        backfill_inbox(run, slug, load_state()['inbox_backfill'])
    if not commit_clone_edits(run, applied, written):
        return 1

    # Secret check, then push the review branch (never main).
    state = load_state()
    secrets_ok = True
    if online and not hold:
        track_review = rev(f'refs/remotes/origin/{review}')
        base = f'refs/remotes/origin/{review}' if track_review else 'refs/remotes/origin/main'
        if count(f'{base}..HEAD'):
            secrets_ok = secret_check(base, run)
        if secrets_ok:
            push_review(review, track_review, run)
    if not secrets_ok:
        run.result = 'blocked'
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


def commit_with_file(base, path, data, message):
    """A commit on top of base that adds or replaces one file, made without touching the working tree."""
    with scratch_dir() as tmp:
        env = dict(GIT_ENV, GIT_INDEX_FILE=str(Path(tmp) / 'index'))
        if g('read-tree', base, env=env)[0]:
            return ''
        rc, blob, _ = g('hash-object', '-w', '--stdin', input=data)
        if rc or g('update-index', '--add', '--cacheinfo', f'100644,{blob},{path}', env=env)[0]:
            return ''
        rc, tree_id, _ = g('write-tree', env=env)
    if rc:
        return ''
    rc, sha, _ = g('commit-tree', tree_id, '-p', base, '-F', '-', input=(message + '\n\n' + COAUTHOR + '\n').encode())
    return sha if rc == 0 else ''


def miner_runner():
    return REPO / 'automations' / 'run-weekly-skill-miner.py'


def runnable(python, script, *args):
    """A command line to paste into a terminal. PowerShell needs & to run a quoted path, and on Windows the
    interpreter is the full path to python.exe (python3 there is only a Store stub)."""
    text = f'"{python}" "{script}"' + ''.join(f' {a}' for a in args)
    return '& ' + text if os.name == 'nt' else text


def portable(script, *args):
    """A command as a person types it, for anything stored or shown: python3 (macOS, Linux) or python (Windows, where
    python3 is only a Store stub), and the path from the home folder when it is there. No interpreter path is baked
    in, so a Python update never breaks the weekly automation."""
    script = Path(script)
    try:
        rel = script.resolve().relative_to(Path.home().resolve())
    except ValueError:
        rel = None
    if os.name == 'nt':
        path = f'"$HOME\\{rel}"' if rel else f'"{script}"'
        return f'python {path}' + ''.join(f' {a}' for a in args)
    if rel and ' ' not in rel.as_posix():
        path = f'~/{rel.as_posix()}'
    else:
        path = f'"$HOME/{rel.as_posix()}"' if rel else f'"{script}"'
    return f'python3 {path}' + ''.join(f' {a}' for a in args)


def automation_prompt():
    """The weekly automation's prompt: it runs the runner, which prints the rest. Same command as the blueprint."""
    command = portable(miner_runner(), '--automation')
    return (f'{MINER_MARKER} Weekly skill update. In a terminal, run `{command}` and follow what it prints, start to '
            'finish. Never ask me anything; if something blocks you, put it in the report and finish.')


def automation_input(model=None):
    """The configureAutomation input for the weekly run on this machine (automations/ATTENDEES.md). thinkingLevel is
    the agent host's effort key (reasoningEffort is accepted as an alias), and contextTier long_context picks the
    model's largest context."""
    return {
        'name': 'Weekly skill update',
        'prompt': automation_prompt(),
        'schedule': {'interval': 'weekly', 'scheduleDay': 1, 'scheduleHour': 11, 'scheduleMinute': 0},
        'target': {'kind': 'workspace', 'folderUri': REPO.resolve().as_uri(), 'providerId': 'local-agent-host',
                   'sessionTypeId': 'copilotcli', 'isolation': 'folder'},
        'sessionTemplate': {
            'modelId': f'agent-host-copilotcli:{model or AUTOMATION_MODEL}',
            'modelConfiguration': {'thinkingLevel': 'max', 'contextTier': 'long_context'},
            'config': {'mode': 'autopilot', 'autoApprove': 'autoApprove'},
        },
        'enabled': True,
    }


def automation_steps():
    runner = miner_runner()
    blueprint = REPO / 'automations' / 'weekly-skill-update.automation.md'
    return [
        'In the Agents window, open Automations and choose Import Automation (or drag the file onto the list): '
        f'{tilde(blueprint)}. The New automation dialog opens with the name, prompt, and schedule (Monday at 11:00).',
        f'Set the folder to {tilde(REPO)}. Leave Worktree isolation and Run in the Cloud off.',
        'Leave the harness on Copilot. In Models, pick your best model (Claude Opus 5.5 if you have it) at the highest '
        'thinking effort and the largest context size.',
        'In the mode and permissions picker (it starts on Interactive and Manual permissions), choose Autopilot and '
        'Allow all, so the run never waits for a click. Create it, and turn it on if it shows as off (imported '
        'automations start off).',
        f'Prove it: Run now, then check the run with {portable(runner, "--check-run")}.',
        'An agent can do all of this instead: configureAutomation with schedule.weekly.automation.configureAutomation '
        'from setup-attendee --json, then listAutomations, runAutomation, and the same check.',
    ]


def miner_job_registered():
    """Whether the weekly runner's backup job (launchd or Task Scheduler) is registered on this machine."""
    if os.name == 'nt':
        return subprocess.run(['schtasks', '/Query', '/TN', MINER_TASK_NAME], capture_output=True).returncode == 0
    if sys.platform == 'darwin':
        return subprocess.run(['launchctl', 'print', f'gui/{os.getuid()}/{MINER_LABEL}'], capture_output=True).returncode == 0
    return False


def setup_summary(entries=None):
    """Mode, remotes, the last sync, and the schedule: the extra keys of status --json."""
    settings = load_settings()
    mode = 'attendee' if is_attendee(settings) else ('maintainer' if settings.get('private_url') else 'not set up')
    remotes = {}
    for name in (git('remote') or '').split():
        remotes[name] = {'fetch': git('config', '--get', f'remote.{name}.url') or '',
                         'push': git('config', '--get', f'remote.{name}.pushurl') or git('config', '--get', f'remote.{name}.url') or ''}
    last = None
    try:
        lines = [line for line in SYNC_LOG.read_text(encoding='utf-8', errors='replace').splitlines() if line.strip()]
    except OSError:
        lines = []
    if lines:
        parts = lines[-1].split(' ')
        last = {'time': parts[0], 'host': parts[1] if len(parts) > 1 else '', 'result': parts[2] if len(parts) > 2 else '',
                'line': lines[-1]}
    try:
        job = registered_job()
    except Exception:  # noqa: BLE001 - status never fails on a schedule query
        job = None
    state = load_state()
    try:
        runner = json.loads((STATE / 'runner.json').read_text(encoding='utf-8-sig'))
    except (OSError, ValueError):
        runner = {}
    try:
        backup = miner_job_registered()
    except OSError:
        backup = False
    summary = {
        'mode': mode,
        'branch': git('symbolic-ref', '--short', '-q', 'HEAD') or '',
        'remotes': remotes,
        'last_sync': last,
        'schedule': {
            'daily_sync': {'registered': bool(job), 'schedule': (job or {}).get('schedule') or state.get('schedule'),
                           'runs_this_clone': bool(job and job.get('here')),
                           'job': TASK_NAME if os.name == 'nt' else (LAUNCHD_LABEL if sys.platform == 'darwin' else 'crontab')},
            'weekly': {'backup_job_registered': backup,
                       'last_attempt': runner.get('last_attempt'), 'last_success': runner.get('last_success'),
                       'last_result': runner.get('last_result')},
        },
    }
    if mode == 'attendee':
        review = review_branch(settings)
        summary['private_repo'] = settings.get('private_repo') or repo_slug(settings.get('private_url'))
        summary['review'] = {
            'branch': review, 'upstream_branch': upstream_branch(settings),
            'ahead_of_main': count(f'refs/remotes/origin/main..refs/heads/{review}'),
            'pushed': bool(rev(f'refs/heads/{review}')) and rev(f'refs/heads/{review}') == rev(f'refs/remotes/origin/{review}'),
        }
    if entries is not None:
        summary['pending'] = {
            'installed_edits': sum(1 for e in entries if e['state'] in PENDING),
            'repo_changes': sum(1 for e in entries if e['state'] in ('repo-newer', 'repo-deleted', 'mode-changed', 'line-endings')),
        }
    return summary


BACKGROUND_NOTICE = ('macOS shows a "Background Items Added" notice for python3 when the job is added: that is this '
                     'job, and it is safe to allow.')


def setup_plan(args, slug, user, login, creating, review):
    """Every change setup-attendee makes, in order and in plain words: --dry-run shows this list before anything
    changes (the setup interview shows it before asking for a yes), and a real run reports it. [(step name, text)]."""
    plan = []
    if creating:
        plan.append(('create-repo', f'Create {slug} on GitHub, private.'))
    plan.append(('remotes', f'In {tilde(REPO)}, point origin at {slug} and add the shared repo as public, fetch only '
                            f'(pushes to it always fail). Git asks GitHub CLI for {slug} through a setting in this clone '
                            'only.'))
    helpers = git('config', '--global', '--get-all', 'credential.https://github.com.helper') or ''
    plan.append(('git-credentials', 'Run gh auth setup-git, so git uses your GitHub CLI sign-in for github.com. This adds '
                                    'a credential helper to your global git config (~/.gitconfig)'
                 + ('; it is already there, so nothing changes.' if 'auth git-credential' in helpers else '.')))
    if not git('config', 'user.email') or not git('config', 'user.name'):
        plan.append(('identity', f"Set this clone's commit name and email to your GitHub noreply address ({login})."))
    if creating or gh('api', f'repos/{slug}/git/ref/heads/main', user=user)[0] != 0:
        plan.append(('seed', f"Start {slug}'s main from the shared skills, with one commit that adds .publishignore "
                             '("Keep this copy private").'))
    plan.append(('review-branch', f'Switch the clone to {review}: your edits wait there for review, and main changes '
                                  'only through pull requests you merge.'))
    plan.append(('settings', f'Save the settings in {tilde(SETTINGS)}, and keep your messages, notes, and voice samples '
                             f'in {tilde(STATE)}, which only you can read.'))
    _, entries, _ = classify()
    _, changed, going, _ = do_install(dry_run=True)
    pending = sorted({e['skill'] for e in entries if e['state'] in PENDING})
    text = (f"Install {len(changed)} skill{'' if len(changed) == 1 else 's'} into {tilde(SKILLS)}: "
            f"{', '.join(changed) or 'none'}. Any copies already there are backed up to {tilde(BACKUPS)} first")
    if pending:
        text += f", and edits you made to {', '.join(pending)} are saved to {review} first"
    if going:
        text += f". Retired skills are removed (backed up): {', '.join(going)}"
    plan.append(('install', text + '. Other skills in that folder are left alone.'))
    when = parse_schedule_value('daily', args.daily) if args.daily else DEFAULT_SCHEDULE
    if not args.no_schedule and when:
        at = when.split()[1] if when.startswith('daily') else when
        if os.name == 'nt':
            plan.append(('daily-sync-schedule', f'Schedule the daily sync at {at} and at logon with Task Scheduler '
                                                f'("{TASK_NAME}", below-normal priority, no window).'))
        elif sys.platform == 'darwin':
            plan.append(('daily-sync-schedule', f'Schedule the daily sync at {at} and at login with launchd '
                                                f'({LAUNCHD_LABEL}). It also runs once right away. {BACKGROUND_NOTICE}'))
        else:
            plan.append(('daily-sync-schedule', 'Print two crontab lines for the daily sync, for you to add (nothing is '
                                                'scheduled).'))
    if args.weekly in ('os', 'both'):
        if os.name == 'nt':
            plan.append(('weekly-backup-schedule', f'Schedule the weekly backup run with Task Scheduler ("{MINER_TASK_NAME}": '
                                                   'Mondays at 11:00, and checks at 14:00, 17:00, 20:00 and at logon).'))
        elif sys.platform == 'darwin':
            plan.append(('weekly-backup-schedule', f'Schedule the weekly backup run with launchd ({MINER_LABEL}: Mondays at '
                                                   f'11:00, and checks at 14:00, 17:00, 20:00 and at login). {BACKGROUND_NOTICE}'))
    return plan


def cmd_setup_attendee(args):
    """One account: a private copy of the shared repo as origin, the shared repo as public (fetch only), the skills
    installed from the review branch with backups, and the daily sync scheduled. --json prints one JSON object."""
    report = {'ok': False, 'dry_run': bool(args.dry_run), 'mode': 'attendee', 'account': None, 'private_repo': None,
              'private_url': None, 'private_repo_created': False, 'public_url': None, 'clone': tilde(REPO),
              'branches': {}, 'installed': [], 'backup': None, 'plan': [], 'steps': [], 'problems': [], 'schedule': {},
              'next': []}
    dry = bool(args.dry_run)

    def step(name, ok, detail='', fix='', show=True):
        report['steps'].append({'step': name, 'ok': bool(ok), 'detail': detail})
        if not ok:
            report['problems'].append({'step': name, 'detail': detail, 'fix': fix})
        if show and not args.json:
            print(f"{'ok  ' if ok else 'FAIL'} {name}: {detail}" + (f'\n     fix: {fix}' if not ok and fix else ''))
        return bool(ok)

    def done(code):
        report['ok'] = code == 0 and not report['problems']
        if args.json:
            print(json.dumps(report, indent=1))
        else:
            if dry and report['plan']:
                print('\nThis will:\n' + '\n'.join(f'{n}. {text}' for n, text in enumerate(report['plan'], 1)))
            if report['next']:
                print('\nNext:\n' + '\n'.join(f'- {n}' for n in report['next']))
        return code

    settings = load_settings()
    if settings.get('private_url') and not is_attendee(settings):
        step('mode', False, f"{tilde(SETTINGS)} already syncs these skills in the maintainer setup ({settings['private_url']})",
             'attendee mode would replace that setup; try it under another user account or with a scratch HOME')
        return done(2)
    public_url = args.public_url or settings.get('public_url') or DEFAULT_PUBLIC_URL
    report['public_url'] = public_url
    version = ''
    if shutil.which('git'):
        version = subprocess.run(['git', '--version'], capture_output=True, text=True).stdout.strip()
    if not step('git', bool(version), version or 'git is not installed',
                'install git (macOS: xcode-select --install or brew install git; Windows: winget install Git.Git)'):
        return done(1)
    step('python', sys.version_info >= (3, 8), f'Python {sys.version.split()[0]} ({tilde(sys.executable)})',
         'install Python 3.8 or newer')
    if not step('github-cli', bool(gh_bin()), tilde(gh_bin() or 'GitHub CLI (gh) is not installed'),
                'install GitHub CLI (macOS: brew install gh; Windows: winget install GitHub.cli)'):
        return done(1)
    rc, login, err = gh('api', 'user', '--jq', '.login')
    if not step('github-sign-in', rc == 0 and bool(login), f'signed in as {login}' if rc == 0 else first_error(err),
                'run gh auth login --hostname github.com --git-protocol https --web in your own terminal (it opens the '
                'browser; an agent never handles your password), then run this again'):
        return done(1)
    report['account'] = login
    slug = repo_slug(args.private_repo) if args.private_repo else f'{login}/{ATTENDEE_REPO_NAME}'
    if not slug:
        step('private-repo', False, f'not OWNER/NAME: {args.private_repo}', 'pass --private-repo <owner>/<name>')
        return done(2)
    private_url = f'https://github.com/{slug}.git'
    report['private_repo'], report['private_url'] = slug, private_url
    if same_url(private_url, public_url):
        step('private-repo', False, f'{slug} is the shared repo itself', 'pick your own name with --private-repo <owner>/<name>')
        return done(2)
    owner = slug.split('/')[0]
    user = login
    if owner.lower() != login.lower() and gh('auth', 'token', '--hostname', 'github.com', '--user', owner)[0] == 0:
        user = owner  # signed in to GitHub CLI as the owner too: use that account for this repo
    rc, out, err = gh('repo', 'view', slug, '--json', 'isPrivate,visibility,url,isFork', user=user)
    creating = False
    if rc == 0:
        try:
            info = json.loads(out)
        except ValueError:
            info = {}
        if not info.get('isPrivate'):
            fork = info.get('isFork')
            step('private-repo', False, f"{slug} exists and is {str(info.get('visibility') or 'public').lower()}"
                 + (' (a fork, which GitHub keeps public)' if fork else ''),
                 f'pick another name with --private-repo {owner}/<new name>'
                 + ('' if fork else ', or make this one private on GitHub (Settings, General, Danger Zone)')
                 + '. Your copy holds your own skill edits, so it has to be private.')
            return done(2)
        step('private-repo', True, f'{slug} exists and is private')
    elif re.search(r'(?i)could not resolve|not found|404', err):
        creating = True
        if not args.create:
            step('private-repo', False, f'{slug} does not exist yet', 'run this again with --create to make it (private)')
            return done(1)
        if dry:
            step('private-repo', True, f'would create {slug} (private)')
        else:
            rc, out, err = gh('repo', 'create', slug, '--private', '--description',
                              'My copy of the autonomous output skills (private)', user=user, timeout=180)
            if not step('private-repo', rc == 0, f'created {slug} (private)' if rc == 0 else first_error(err),
                        'check that your account can create private repos there (a Microsoft-managed account can in its '
                        'own namespace), or pick another --private-repo'):
                return done(1)
            report['private_repo_created'] = True
    else:
        step('private-repo', False, f'could not check {slug}: {first_error(err)}', 'check gh auth status and the network')
        return done(1)

    if not (REPO / '.git').exists():
        if dry:
            step('clone', True, f'would clone {public_url} into {tilde(REPO)}')
            return done(0)
        r = subprocess.run(['git', 'clone', '-q', public_url, str(REPO)], capture_output=True, text=True, env=GIT_ENV)
        if not step('clone', r.returncode == 0, f'cloned the shared repo into {tilde(REPO)}', first_error(r.stderr)):
            return done(1)
    busy = git_busy()
    if busy:
        step('clone', False, f'a git operation is in progress in {tilde(REPO)} ({busy})', 'finish or abort it, then run this again')
        return done(1)
    dirty = [p for _, p in dirty_paths()]
    if dirty:
        step('clone', False, f'{len(dirty)} uncommitted change(s) in {tilde(REPO)}, for example {dirty[0]}',
             'commit or remove them, then run this again')
        return done(1)
    step('clone', True, tilde(REPO))

    review, upstream = review_branch(settings), upstream_branch(settings)
    report['branches'] = {'main': 'main', 'review': review, 'upstream': upstream}
    for name, text in setup_plan(args, slug, user, login, creating, review):
        report['plan'].append(text)
        if dry:
            step(name, True, text, show=False)  # printed once, as "This will:"
    if dry:
        report['next'].append('Run it again without --dry-run to make these changes.')
        return done(0)
    remotes = (git('remote') or '').split()
    origin_url = git('config', '--get', 'remote.origin.url') if 'origin' in remotes else ''
    if 'origin' in remotes and not same_url(origin_url, private_url):
        if same_url(origin_url, public_url) and 'public' not in remotes:
            g('remote', 'rename', 'origin', 'public')
        else:
            g('remote', 'remove', 'origin')
        remotes = (git('remote') or '').split()
    g('remote', 'set-url' if 'origin' in remotes else 'add', 'origin', private_url)
    g('remote', 'set-url' if 'public' in remotes else 'add', 'public', public_url)
    g('remote', 'set-url', '--push', 'public', NO_PUSH)
    key = f'credential.{private_url}.helper'
    g('config', '--local', '--unset-all', key)
    g('config', '--local', '--add', key, '')
    g('config', '--local', '--add', key, helper_command(gh_bin(), user))
    r = subprocess.run([gh_bin(), 'auth', 'setup-git', '--hostname', 'github.com'], capture_output=True, env=gh_env())
    step('git-credentials', r.returncode == 0, 'gh auth setup-git: git uses your GitHub CLI sign-in for github.com '
         '(your global git config)', 'run gh auth setup-git yourself, then run this again')
    if not git('config', 'user.email') or not git('config', 'user.name'):
        rc, out, _ = gh('api', 'user', '--jq', '[.id, .name] | @tsv', user=user)
        uid, _, name = out.partition('\t')
        g('config', 'user.name', name or login)
        g('config', 'user.email', f'{uid}+{login}@users.noreply.github.com' if uid.isdigit() else f'{login}@users.noreply.github.com')
    step('remotes', True, f'origin is {slug} (as {user}); public is the shared repo, fetch only (pushes to it fail)')

    rc, _, err = g('fetch', '-q', '--prune', 'origin', timeout=300)
    if not step('fetch-origin', rc == 0, f'git fetch origin ({slug})', f'check your access to {slug}: {first_error(err)}'):
        return done(1)
    rc, _, err = g('fetch', '-q', 'public', timeout=300)
    step('fetch-public', rc == 0, 'git fetch public (the shared repo)', f'check the network: {first_error(err)}')
    if rev('refs/remotes/origin/main') and rev('refs/remotes/public/main') and not git(
            'merge-base', 'refs/remotes/origin/main', 'refs/remotes/public/main'):
        step('private-repo', False, f"{slug} already has a main that isn't a copy of the shared skills",
             f'pick another name with --private-repo {owner}/<new name>')
        return done(2)
    if not rev('refs/remotes/origin/main'):
        base = rev('refs/heads/main') or rev('refs/remotes/public/main')
        commit = commit_with_file(base, '.publishignore', PUBLISHIGNORE_ATTENDEE.encode(), 'Keep this copy private') if base else ''
        rc, _, err = g('push', '-q', 'origin', f'{commit}:refs/heads/main', timeout=300) if commit else (1, '', 'nothing to start from')
        if not step('seed', rc == 0, f'main of {slug} starts from the shared skills', first_error(err)):
            return done(1)
        g('fetch', '-q', 'origin', timeout=300)
    run = Run(host_name(settings))
    if not switch_to_review({'review_branch': review}, run):
        step('review-branch', False, '; '.join(run.notes), 'switch the clone to it by hand, then run this again')
        return done(1)
    track_branch('main')
    local_main, origin_main = rev('refs/heads/main'), rev('refs/remotes/origin/main')
    if local_main != origin_main and (not local_main or is_ancestor(local_main, origin_main)):
        g('update-ref', 'refs/heads/main', origin_main)
    if not (REPO / '.publishignore').is_file():
        (REPO / '.publishignore').write_bytes(PUBLISHIGNORE_ATTENDEE.encode())
        g('add', '--', '.publishignore')
        g('commit', '-q', '-m', 'Keep this copy private', '-m', COAUTHOR)
    step('review-branch', True, f'the clone is on {review}; your edits wait there for review, and main changes only '
                                f'through pull requests you merge')

    settings.update(mode='attendee', private_url=private_url, private_user=user, private_repo=slug, public_url=public_url,
                    review_branch=review, upstream_branch=upstream,
                    keep_mine=settings.get('keep_mine') or list(KEEP_MINE), inbox=settings.get('inbox', False),
                    cli_defaults=False)
    settings.pop('public_user', None)
    settings.pop('interval_minutes', None)
    if args.host:
        settings['host'] = args.host
    if args.model:
        settings['miner_model'] = args.model  # the weekly runner's model when it runs without the automation
    save_settings(settings)
    for folder in (STATE, STATE / 'private'):
        folder.mkdir(parents=True, exist_ok=True)
        if os.name != 'nt':
            os.chmod(folder, 0o700)
    terms = STATE / 'private-terms.txt'
    if not terms.exists():
        terms.write_text(TERMS_HEADER, encoding='utf-8')
        if os.name != 'nt':
            os.chmod(terms, 0o600)
    step('settings', True, f'{tilde(SETTINGS)}; your messages, notes, and voice samples stay in {tilde(STATE)}')

    before = set(BACKUPS.iterdir()) if BACKUPS.is_dir() else set()
    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer):
        code = cmd_sync(args)
    line = (buffer.getvalue().strip().splitlines() or [''])[-1]
    report['installed'] = sorted(load_manifest().get('skills', {}))
    new_backups = sorted(set(BACKUPS.iterdir()) - before) if BACKUPS.is_dir() else []
    report['backup'] = tilde(new_backups[-1]) if new_backups else None
    step('first-sync', code in (0, 3), line or 'no output', f'see {tilde(SYNC_LOG)}, then run sync-skills.py sync')

    if args.no_schedule:
        report['schedule']['daily_sync'] = {'registered': False, 'how': 'none', 'detail': 'not scheduled (--no-schedule)'}
    else:
        chosen = parse_schedule_value('daily', args.daily) if args.daily else DEFAULT_SCHEDULE
        if not chosen:
            step('daily-sync-schedule', False, f'--daily {args.daily} is not HH:MM', 'pass --daily HH:MM')
        else:
            ok, what = register_job(chosen, default_python(), REPO / 'tools' / 'sync-skills.py')
            state = load_state()
            state.update(schedule=chosen, schedule_seen=None, schedule_managed=ok is True)
            state.pop('schedule_pending', None)
            if os.name == 'nt':
                note_trigger(state, registered_job())
                state['schedule_checked'] = dt.date.today().isoformat()
            save_state(state)
            how = 'task-scheduler' if os.name == 'nt' else ('launchd' if sys.platform == 'darwin' else 'crontab')
            step('daily-sync-schedule', ok is True or how == 'crontab', what.splitlines()[0]
                 + (f' {BACKGROUND_NOTICE}' if ok is True and how == 'launchd' else ''),
                 'run sync-skills.py schedule again, or add the crontab lines it prints')
            report['schedule']['daily_sync'] = {'registered': ok is True, 'how': how, 'when': describe(chosen),
                                                'job': TASK_NAME if how == 'task-scheduler' else LAUNCHD_LABEL, 'detail': what}
    weekly = {'how': args.weekly}
    if args.weekly in ('automation', 'both'):
        weekly['automation'] = {'configureAutomation': automation_input(args.model),
                                'blueprint': tilde(REPO / 'automations' / 'weekly-skill-update.automation.md'),
                                'steps': automation_steps(),
                                'check': portable(miner_runner(), '--check-run')}
    if args.weekly in ('os', 'both'):
        r = subprocess.run([sys.executable, str(miner_runner()), '--install'], capture_output=True, text=True,
                           encoding='utf-8', errors='replace', timeout=300)
        detail = (r.stdout.strip() or r.stderr.strip()).splitlines()
        weekly['os'] = {'registered': r.returncode == 0, 'detail': '\n'.join(detail)}
        step('weekly-backup-schedule', r.returncode == 0, detail[0] if detail else 'no output',
             'install Copilot CLI and sign in to it, or use the Automations route (--weekly automation)')
    report['schedule']['weekly'] = weekly
    if args.weekly in ('automation', 'both'):
        report['next'].append('Create the weekly automation: ' + ' '.join(automation_steps()))
    report['next'].append(f'Your skill edits collect on {review} in {slug}. The weekly run opens one pull request for you '
                          f'to review, and another when the shared skills have updates ({upstream}).')
    return done(0 if not report['problems'] else 1)


def review_pr_body(settings, base, head, summary=''):
    review = review_branch(settings)
    files = [f for f in (git('diff', '--name-only', f'{base}...{head}') or '').splitlines() if f]
    subjects = [s for s in (git('log', '--no-merges', '--format=%s', f'{base}..{head}') or '').splitlines() if s]
    by_skill = {}
    for path in files:
        top, _, rest = path.partition('/')
        by_skill.setdefault(top if rest else '(top level)', []).append(rest or top)
    lines = [summary.strip(), ''] if summary.strip() else []
    lines += ['Changes waiting for your review, by skill:', '']
    for skill, paths in sorted(by_skill.items()):
        lines.append(f"- {skill}: {', '.join(paths[:8])}" + (f' and {len(paths) - 8} more' if len(paths) > 8 else ''))
    lines += ['', 'Where they came from:', ''] + [f'- {s}' for s in subjects[:20]]
    if len(subjects) > 20:
        lines.append(f'- and {len(subjects) - 20} more')
    lines += ['', 'How to review:', '',
              '- Read Files changed. To drop part of it, edit or revert it on this branch, or ask an agent to.',
              '- Merge it to keep the changes. Your next daily sync installs main on each machine.',
              f'- Close it without merging to drop all of it. Your next daily sync puts {review} and your installed '
              'skills back on main, and keeps a copy on a declined/ branch.']
    return '\n'.join(lines) + '\n'


def open_or_update_pr(slug, user, head_branch, title, body, dry_run=False):
    """(action, url, number, error) for the one open pull request from head_branch into main."""
    rc, out, err = gh('pr', 'list', '--repo', slug, '--head', head_branch, '--base', 'main', '--state', 'open',
                      '--json', 'number,url', user=user)
    if rc:
        return 'failed', None, None, first_error(err)
    try:
        prs = json.loads(out or '[]')
    except ValueError:
        prs = []
    if dry_run:
        return ('would update' if prs else 'would open'), (prs[0]['url'] if prs else None), (prs[0]['number'] if prs else None), ''
    with scratch_dir() as tmp:
        body_file = Path(tmp) / 'body.md'
        body_file.write_text(body, encoding='utf-8')
        if prs:
            number, url = prs[0]['number'], prs[0]['url']
            rc, _, err = gh('pr', 'edit', str(number), '--repo', slug, '--title', title, '--body-file', str(body_file), user=user)
            return ('updated', url, number, '') if rc == 0 else ('failed', url, number, first_error(err))
        rc, out, err = gh('pr', 'create', '--repo', slug, '--base', 'main', '--head', head_branch, '--title', title,
                          '--body-file', str(body_file), user=user, timeout=180)
    if rc:
        return 'failed', None, None, first_error(err)
    url = out.strip().splitlines()[-1] if out.strip() else None
    number = int(url.rstrip('/').rsplit('/', 1)[-1]) if url and url.rstrip('/').rsplit('/', 1)[-1].isdigit() else None
    return 'opened', url, number, ''


def attendee_only(settings, command):
    if is_attendee(settings):
        return True
    print(f'{command} is for attendee mode; run sync-skills.py setup-attendee first')
    return False


def print_result(args, result, text):
    print(json.dumps(result, indent=1) if args.json else text)


def cmd_review_pr(args):
    """Open or update the one pull request that brings the review branch into main."""
    settings = load_settings()
    if not attendee_only(settings, 'review-pr'):
        return 2
    review, slug, user = review_branch(settings), repo_slug(settings['private_url']), settings.get('private_user')
    result = {'repo': slug, 'branch': review, 'action': None, 'url': None, 'number': None, 'files': 0}
    rc, _, err = g('fetch', '-q', '--prune', 'origin', timeout=300)
    if rc:
        result.update(action='failed', error=first_error(err))
        print_result(args, result, f'could not fetch origin: {first_error(err)}')
        return 1
    base, head = 'refs/remotes/origin/main', f'refs/remotes/origin/{review}'
    if not rev(head) or tree_of(head) == tree_of(base):
        result['action'] = 'nothing to review'
        print_result(args, result, f'nothing waits on {review}: no pull request needed')
        return 0
    result['files'] = len([f for f in (git('diff', '--name-only', f'{base}...{head}') or '').splitlines() if f])
    today = dt.date.today()
    title = args.title or f'Skill updates to review, {today:%B} {today.day}, {today.year}'
    summary = ''
    if args.summary_file:
        try:
            summary = Path(args.summary_file).read_text(encoding='utf-8')
        except OSError:
            summary = ''
    action, url, number, error = open_or_update_pr(slug, user, review, title, review_pr_body(settings, base, head, summary),
                                                   args.dry_run)
    result.update(action=action, url=url, number=number)
    if error:
        result['error'] = error
    print_result(args, result, f'{action}: {url or slug}' + (f' ({error})' if error else ''))
    return 1 if action == 'failed' else 0


def build_upstream_merge(settings, main, pub):
    """Merge the shared repo's main into your main in a scratch worktree, keeping your version of each KEEP_MINE file you
    changed (in main, or on the review branch, waiting for your review). Returns {'commit', 'conflicts', 'kept',
    'error'}; on conflicts there is no commit."""
    keep = settings.get('keep_mine') or list(KEEP_MINE)
    base = git('merge-base', main, pub) or ''
    pending = rev(f'refs/remotes/origin/{review_branch(settings)}')
    out = {'commit': '', 'conflicts': [], 'kept': [], 'error': ''}
    with scratch_dir() as tmp:
        tree_dir = Path(tmp) / 'upstream'
        rc, _, err = g('worktree', 'add', '-q', '--detach', str(tree_dir), main, timeout=300)
        if rc:
            out['error'] = first_error(err)
            return out
        try:
            def w(*args):
                r = subprocess.run(['git', '-C', str(tree_dir), *args], capture_output=True, env=GIT_ENV, timeout=300)
                return r.returncode, r.stdout.decode('utf-8', 'replace').strip(), r.stderr.decode('utf-8', 'replace').strip()
            rc, _, err = w('merge', '--no-ff', '--no-commit', '-q', pub)
            for path in keep:
                mine, was, theirs = blob_of(main, path), blob_of(base, path), blob_of(pub, path)
                yours = mine != was or (pending and blob_of(pending, path) not in (was, ''))
                if mine and yours and theirs != was and theirs != mine:
                    w('checkout', main, '--', path)
                    w('add', '--', path)
                    out['kept'].append(path)
            out['conflicts'] = [p for p in w('diff', '--name-only', '--diff-filter=U')[1].splitlines() if p]
            gitdir = w('rev-parse', '--absolute-git-dir')[1]
            if out['conflicts']:
                w('merge', '--abort')
            elif not (gitdir and (Path(gitdir) / 'MERGE_HEAD').exists()):
                out['error'] = first_error(err) if rc else 'the merge did not start'
            else:
                today = dt.date.today()
                message = f'Merge updates from the shared skills, {today:%B} {today.day}, {today.year}'
                if out['kept']:
                    message += f"\n\nKept yours: {', '.join(out['kept'])}"
                rc, _, err = w('commit', '-q', '-m', message, '-m', COAUTHOR)
                out['commit'] = w('rev-parse', 'HEAD')[1] if rc == 0 else ''
                if rc:
                    out['error'] = first_error(err)
        finally:
            g('worktree', 'remove', '--force', str(tree_dir), timeout=300)
            for _ in range(20):  # on Windows, remove --force can exit 0 and leave the folder: delete it, then prune
                shutil.rmtree(tree_dir, ignore_errors=True)
                if not tree_dir.exists():
                    break
                time.sleep(0.5)
            g('worktree', 'prune')
    return out


def upstream_pr_body(public_slug, subjects, kept, conflicts, upstream):
    lines = [f'Updates from the shared skills ({public_slug}) that your copy does not have yet.', '', 'New commits:', '']
    lines += [f'- {s}' for s in subjects[:30]] + ([f'- and {len(subjects) - 30} more'] if len(subjects) > 30 else [])
    if kept:
        lines += ['', f"Kept yours: {', '.join(kept)}. You changed it, so the shared version of that file was not "
                      'merged in. Compare them on GitHub if you want to take something from it.']
    if conflicts:
        lines += ['', f"These files changed in your copy and in the shared skills, so this can't merge on its own: "
                      f"{', '.join(conflicts)}.",
                  f'To fix it, ask an agent: "In my skills repo, merge origin/main into {upstream} in a separate '
                  'worktree, keep my edits where they conflict, push it, and show me the diff."']
    lines += ['', 'Merge it to take these updates. Close it to skip them for now: next week brings them again, with '
                  'anything newer.']
    return '\n'.join(lines) + '\n'


def cmd_upstream_pr(args):
    """Merge the shared repo's main into the upstream branch and open or update its pull request into main. Conflicts
    stay on the branch: then it holds the shared main as it is, and the pull request says what conflicts."""
    settings = load_settings()
    if not attendee_only(settings, 'upstream-pr'):
        return 2
    upstream, slug, user = upstream_branch(settings), repo_slug(settings['private_url']), settings.get('private_user')
    public_slug = repo_slug(settings.get('public_url')) or settings.get('public_url')
    result = {'repo': slug, 'branch': upstream, 'action': None, 'url': None, 'number': None, 'new_commits': 0,
              'kept': [], 'conflicts': []}
    for remote in ('origin', 'public'):
        rc, _, err = g('fetch', '-q', '--prune', remote, timeout=300)
        if rc:
            result.update(action='failed', error=f'git fetch {remote}: {first_error(err)}')
            print_result(args, result, result['error'])
            return 1
    pub, main = rev('refs/remotes/public/main'), rev('refs/remotes/origin/main')
    if not (pub and main):
        result.update(action='failed', error='origin/main or public/main is missing')
        print_result(args, result, result['error'])
        return 1
    if is_ancestor(pub, main):
        result['action'] = 'up to date'
        print_result(args, result, f'your copy has everything from {public_slug}')
        return 0
    subjects = [s for s in (git('log', '--no-merges', '--format=%s', f'{main}..{pub}') or '').splitlines() if s]
    result['new_commits'] = len(subjects)
    state = load_state()
    remote_branch = rev(f'refs/remotes/origin/{upstream}')
    if remote_branch and remote_branch != state.get('upstream_pushed') and not is_ancestor(remote_branch, main):
        # Someone committed to the upstream branch (fixing conflicts, say): it is theirs now, so leave it alone.
        rc, out, _ = gh('pr', 'list', '--repo', slug, '--head', upstream, '--base', 'main', '--state', 'open',
                        '--json', 'number,url', user=user)
        try:
            prs = json.loads(out or '[]') if rc == 0 else []
        except ValueError:
            prs = []
        result.update(action='waiting for you', url=prs[0]['url'] if prs else None, number=prs[0]['number'] if prs else None)
        print_result(args, result, f'{upstream} has commits of yours; left as it is' + (f": {prs[0]['url']}" if prs else ''))
        return 0
    if args.dry_run:
        result['action'] = 'would merge and open or update the pull request'
        print_result(args, result, f"{len(subjects)} new commit(s) from {public_slug}; {result['action']}")
        return 0
    built = build_upstream_merge(settings, main, pub)
    if built['error']:
        result.update(action='failed', error=built['error'])
        print_result(args, result, f"could not merge the shared skills: {built['error']}")
        return 1
    commit = built['commit'] or pub
    result.update(kept=built['kept'], conflicts=built['conflicts'])
    lease = f'--force-with-lease=refs/heads/{upstream}:{remote_branch}' if remote_branch else f'--force-with-lease=refs/heads/{upstream}:'
    rc, _, err = g('push', '-q', 'origin', f'{commit}:refs/heads/{upstream}', lease, timeout=300)
    if rc:
        result.update(action='failed', error=f'git push: {first_error(err)}')
        print_result(args, result, result['error'])
        return 1
    state['upstream_pushed'] = commit
    save_state(state)
    today = dt.date.today()
    title = f'Updates from the shared skills, {today:%B} {today.day}, {today.year}'
    action, url, number, error = open_or_update_pr(slug, user, upstream, title, upstream_pr_body(
        public_slug, subjects, built['kept'], built['conflicts'], upstream))
    result.update(action=action, url=url, number=number)
    if error:
        result['error'] = error
    print_result(args, result, f'{action}: {url or slug}' + (f" (conflicts: {', '.join(built['conflicts'])})" if built['conflicts'] else '')
                 + (f' ({error})' if error else ''))
    return 1 if action == 'failed' else 0


def cmd_review_reset(args):
    """Drop everything that waits on the review branch (saved to declined/<branch>/<time> first), then reinstall main."""
    settings = load_settings()
    if not attendee_only(settings, 'review-reset'):
        return 2
    global PRIVATE_DATA
    PRIVATE_DATA = STATE
    started = time.monotonic()
    run = Run(host_name(settings))
    review = review_branch(settings)
    if not take_lock(SYNC_LOCK, 1800):
        print('a sync is running; try again in a minute')
        return 1
    try:
        rc, _, err = g('fetch', '-q', '--prune', 'origin', timeout=300)
        if rc or not switch_to_review(settings, run):
            run.result = 'error'
            run.note(f'could not fetch origin ({first_error(err)})' if rc else 'not on the review branch')
            return 1
        if tree_of('HEAD') == tree_of('refs/remotes/origin/main'):
            run.note(f'nothing waits on {review}')
            return 0
        if args.dry_run:
            run.note(f"would save {review} to declined/{review}/<time> and put it back on main "
                     f"({count('refs/remotes/origin/main..HEAD')} commit(s))")
            return 0
        if not drop_review(settings, run, 'review reset by hand', keep_newer=False):
            run.result = 'error'
            return 1
        code, changed, _, notes = do_install()
        run.notes.extend(n for n in notes if not n.startswith('previous copies'))
        if changed:
            run.note(f"installed {', '.join(changed)}")
        return 0 if code in (0, 3) else 1
    finally:
        shutil.rmtree(SYNC_LOCK, ignore_errors=True)
        run.head = rev('HEAD')
        write_log(run, started)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('command', choices=['status', 'harvest', 'resolve', 'install', 'sync', 'setup', 'schedule', 'sync-status',
                                                'backfill-inbox', 'cli-defaults', 'setup-attendee', 'review-pr',
                                                'upstream-pr', 'review-reset'])
    parser.add_argument('paths', nargs='*', help='resolve: skill/path entries to mark as merged')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--json', action='store_true', help='status, setup-attendee, review-pr, upstream-pr: print JSON')
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
    parser.add_argument('--private-repo', help=f'setup-attendee: your private copy, OWNER/NAME (default: <your GitHub '
                        f'login>/{ATTENDEE_REPO_NAME})')
    parser.add_argument('--create', action='store_true', help='setup-attendee: create the private copy when it does not exist')
    parser.add_argument('--weekly', choices=['automation', 'os', 'both', 'none'], default='automation',
                        help='setup-attendee: schedule the weekly skill update as an Agents window automation (default; '
                        'prints its configureAutomation input), with launchd or Task Scheduler (os, needs Copilot CLI), '
                        'both, or none')
    parser.add_argument('--no-schedule', action='store_true', help='setup-attendee: do not schedule the daily sync')
    parser.add_argument('--model', help=f'setup-attendee: the model for the weekly run, in the automation and the backup '
                        f'runner (default {AUTOMATION_MODEL})')
    parser.add_argument('--title', help='review-pr: the pull request title')
    parser.add_argument('--summary-file', help='review-pr: text to put at the top of the pull request description')
    args = parser.parse_args()
    if args.repo:
        global REPO
        REPO = Path(args.repo).expanduser().resolve()
    STATE.mkdir(parents=True, exist_ok=True)
    return {'status': cmd_status, 'harvest': cmd_harvest, 'resolve': cmd_resolve, 'install': cmd_install,
            'sync': cmd_sync, 'setup': cmd_setup, 'schedule': cmd_schedule, 'sync-status': cmd_sync_status,
            'backfill-inbox': cmd_backfill_inbox, 'cli-defaults': cmd_cli_defaults, 'setup-attendee': cmd_setup_attendee,
            'review-pr': cmd_review_pr, 'upstream-pr': cmd_upstream_pr, 'review-reset': cmd_review_reset}[args.command](args)


if __name__ == '__main__':
    sys.exit(main())

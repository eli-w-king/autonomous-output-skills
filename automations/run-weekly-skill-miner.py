#!/usr/bin/env python3
"""Run the weekly skill miner unattended with Copilot CLI (Windows Task Scheduler; the same flow as
run-weekly-skill-miner.sh, which does this with launchd on macOS).

  run-weekly-skill-miner.py --install     schedule it: it runs on Mondays at 11:00 and checks again at 14:00,
                                          17:00, 20:00, and at logon, to catch up after a missed Monday and to
                                          retry the next day after a failed run
  run-weekly-skill-miner.py --uninstall   remove the schedule
  run-weekly-skill-miner.py --status      the schedule, the last run, and the latest report
  run-weekly-skill-miner.py --check       test the setup without running (add --llm to also get a one-word
                                          reply from the model with the run's exact settings)
  run-weekly-skill-miner.py --now         run now, even if a file changed in the last hour
  run-weekly-skill-miner.py --rehearse [--since ISO-TIME]
                                          a full run on copies of the repo, the installed skills, and the
                                          private state that publishes nothing (to test changes)
  run-weekly-skill-miner.py               what the schedule runs: start a run only when one is due

Attendee mode (automations/ATTENDEES.md; the settings in ~/.copilot/skills-sync.json say "mode": "attendee"):
  run-weekly-skill-miner.py --automation  the start of an Agents window automation run: prepares the run and prints
                                          the prompt and paths for the automation's own session
  run-weekly-skill-miner.py --finish DIR  the end of that run: checks it, pushes the review branch, and opens or
                                          updates the review pull request and the one for the shared skills' updates
  run-weekly-skill-miner.py --dry-run     every step except the model: pushes the review branch and opens or
                                          updates the pull requests with what is already on it
  run-weekly-skill-miner.py --check-run [SESSION] [--json]
                                          the proof for a weekly run: model, effort, context, and approvals
In attendee mode a run never publishes: it pushes the review branch of the private copy and opens pull requests there,
and --install uses launchd on macOS too.

The runner does the deterministic parts and the agent does the judgment. Before the agent starts, the
runner takes the lock, waits for a running skills sync, waits if anything in the repo or the installed
skills changed in the last hour, fetches origin (the private repo), merges origin/main when that is
clean, freezes the window, and collects my messages from every machine: each machine's sync exports
them daily to private/inbox/<host>/ (tools/collect-messages.py --from-inbox). The agent (Copilot CLI,
at the top model, max effort, and the largest context) then follows weekly-skill-miner.md with no
GitHub credentials and with network, publishing, and history-rewriting commands blocked. Afterward the
runner checks the result (clean tree, tools/ and automations/ unchanged, the validator), squashes
everything since origin/main into one commit, pushes it to the private repo, and publishes it to the
public repo with tools/publish-public.py. Reports go to ~/.copilot/skill-miner/reports.
"""
import argparse
import datetime as dt
import html
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

SCRIPT = Path(__file__).resolve()
spec = importlib.util.spec_from_file_location('sync_skills', SCRIPT.parents[1] / 'tools' / 'sync-skills.py')
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)

SESSIONS = Path(os.environ.get('COPILOT_SESSION_STATE', '~/.copilot/session-state')).expanduser()
TASK_NAME = os.environ.get('SKILL_MINER_TASK', 'Autonomous weekly skill miner')
# Attendee mode (automations/ATTENDEES.md): a private copy with a review branch. Runs push that branch and open pull
# requests in the private copy instead of publishing, and an Agents window automation can do the agent's part.
SETTINGS = sync.load_settings()
ATTENDEE = SETTINGS.get('mode') == 'attendee'
LABEL = os.environ.get('SKILL_MINER_LABEL', 'com.autonomous-output-skills.weekly-skill-update')


def approved_models():
    """The models the miner may run on, best first, from private/models.txt (a name there may not be public)."""
    try:
        lines = (SCRIPT.parents[1] / 'private' / 'models.txt').read_text(encoding='utf-8').splitlines()
    except OSError:
        lines = []
    return [name for name in (line.split('#', 1)[0].strip() for line in lines) if name]


MODEL = (os.environ.get('SKILL_MINER_MODEL') or sync.load_settings().get('miner_model')
         or (approved_models() or ['claude-opus-5.5'])[0])  # miner_model: attendee mode, from setup-attendee --model
FALLBACK_MODEL = next((m for m in approved_models() if m != MODEL), None)  # never a smaller one or "auto"
EFFORT, CONTEXT = 'max', 'long_context'
TIME_LIMIT = int(os.environ.get('SKILL_MINER_TIME_LIMIT', '14400'))
RUN_WEEKDAY, RUN_HOUR, CHECK_HOURS = 0, 11, (11, 14, 17, 20)
SCHEDULE_TEXT = 'runs on Mondays at 11:00; checks again at 14:00, 17:00, 20:00, and at logon'
MARKER = '[weekly-skill-miner]'
COAUTHOR = sync.COAUTHOR
PROTECTED = ('tools', 'automations')
DENY = ['git push', 'git fetch', 'git pull', 'git remote', 'git credential', 'git reset', 'git clean', 'git stash',
        'git rebase', 'git update-ref', 'git filter-branch', 'git commit-tree', 'gh:*', 'gh.exe:*', 'curl:*', 'curl.exe:*',
        'wget:*', 'ssh:*', 'scp:*', 'rsync:*', 'nc:*', 'open:*', 'osascript:*', 'security:*', 'launchctl:*', 'crontab:*',
        'Invoke-WebRequest:*', 'Invoke-RestMethod:*', 'iwr:*', 'irm:*', 'Start-Process:*', 'start:*', 'explorer:*',
        'explorer.exe:*', 'schtasks:*', 'schtasks.exe:*', 'Register-ScheduledTask:*', 'Set-ScheduledTask:*',
        'Unregister-ScheduledTask:*', 'cmdkey:*', 'git-credential-manager:*']


class Paths:
    def __init__(self, repo, skills, miner):
        self.repo, self.skills, self.miner = Path(repo), Path(skills), Path(miner)
        self.backups = self.skills.parent / 'skills-backup'
        self.reports, self.logs = self.miner / 'reports', self.miner / 'logs'
        self.lock = self.miner / 'lock'
        self.procedure = self.repo / 'automations' / 'weekly-skill-miner.md'
        for d in (self.logs, self.reports):
            d.mkdir(parents=True, exist_ok=True)


P = Paths(SCRIPT.parents[1], sync.SKILLS, sync.STATE)
REAL_MINER = P.miner
REHEARSAL = False
FORCE = False
AUTOMATION = False


def note(message):
    with open(P.logs / 'scheduler.log', 'a', encoding='utf-8') as f:
        f.write(f"{dt.datetime.now().strftime('%Y-%m-%d %H:%M:%S')} {message}\n")


def tilde(path):
    return sync.tilde(path)


def utc_now():
    return dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def json_get(path, key):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8-sig')).get(key)
    except (OSError, ValueError, AttributeError):
        return None


def json_set(path, **values):
    path = Path(path)
    try:
        data = json.loads(path.read_text(encoding='utf-8-sig'))
    except FileNotFoundError:
        data = {}
    except ValueError:
        os.replace(path, str(path) + '.corrupt')
        data = {}
    data.update(values)
    sync.write_atomic(path, (json.dumps(data, indent=2) + '\n').encode())


def git(*args, timeout=300, env=None):
    r = subprocess.run(['git', '-C', str(P.repo), *args], capture_output=True, timeout=timeout,
                       env=env or sync.GIT_ENV)
    return r.returncode, r.stdout.decode('utf-8', 'replace').strip(), r.stderr.decode('utf-8', 'replace').strip()


def git_out(*args):
    rc, out, _ = git(*args)
    return out if rc == 0 else ''


# ---------------------------------------------------------------- lock

def acquire_lock(automation=False):
    """Take the run lock. An automation run's agent is a separate process, so its lock carries no pid: the sync and
    other runs treat it as held until --finish releases it, or for up to six hours."""
    try:
        P.lock.mkdir()
    except FileExistsError:
        age = time.time() - P.lock.stat().st_mtime
        alive = sync.lock_owner_alive(P.lock, 'pid')
        if age < 600 or (alive is not False and age < TIME_LIMIT + 3600):
            return False
        note(f'removing a stale lock ({int(age // 60)} minutes old)')
        shutil.rmtree(P.lock, ignore_errors=True)
        try:
            P.lock.mkdir()
        except FileExistsError:
            return False
    if automation:
        (P.lock / 'owner').write_text(f'automation {utc_now()}\n', encoding='utf-8')
    else:
        (P.lock / 'pid').write_text(f'{os.getpid()}\n', encoding='utf-8')
    waited = 0
    sync_lock = P.skills.parent / 'skills-sync.lock'
    while sync_lock.is_dir() and waited < 600:
        time.sleep(10)
        waited += 10
    if waited:
        note(f'waited {waited}s for a skills sync to finish')
    return True


def release_lock():
    shutil.rmtree(P.lock, ignore_errors=True)


# ---------------------------------------------------------------- copilot

def find_copilot():
    candidates = [os.environ.get('COPILOT_BIN'), shutil.which('copilot')]
    if os.name == 'nt':
        candidates += [r'C:\Program Files\WinGet\Links\copilot.exe',
                       str(Path(os.environ.get('LOCALAPPDATA', '')) / 'Microsoft' / 'WinGet' / 'Links' / 'copilot.exe'),
                       str(Path(os.environ.get('APPDATA', '')) / 'npm' / 'copilot.cmd')]
    else:
        candidates += ['/opt/homebrew/bin/copilot', '/usr/local/bin/copilot']
    for c in candidates:
        if c and Path(c).is_file():
            return c
    return None


def copilot_version(copilot):
    r = subprocess.run([copilot, '--version'], capture_output=True, text=True, timeout=60)
    m = re.search(r'\d+(\.\d+)+', r.stdout or '')
    return m.group(0) if m else '?'


def prompt_text():
    try:
        text = P.procedure.read_text(encoding='utf-8')
    except OSError:
        return ''
    m = re.search(r'^```text\n(.*?)^```$', text, re.M | re.S)
    return m.group(1).strip() if m else ''


def mcp_servers(copilot):
    """Every MCP server the CLI would load, so all can be turned off. Fails closed (None) if unreadable."""
    try:
        r = subprocess.run([copilot, 'mcp', 'list'], capture_output=True, text=True, timeout=120, cwd=str(P.repo),
                           encoding='utf-8', errors='replace')
    except (OSError, subprocess.TimeoutExpired):
        return None
    if r.returncode:
        return None
    names = []
    for line in (r.stdout + r.stderr).splitlines():
        m = re.match(r'^\s{2,}(\S.*?) \(([A-Za-z]+)\)\s*$', line)
        if m and m.group(1) not in names:
            names.append(m.group(1))
    config = Path.home() / '.copilot' / 'mcp-config.json'
    if config.is_file():
        try:
            servers = json.loads(config.read_text(encoding='utf-8-sig')).get('mcpServers', {})
        except ValueError:
            return None
        if not isinstance(servers, dict):
            return None
        names += [n for n in servers if n not in names]
    if not names:
        return None
    if 'computer-use' not in names:
        names.append('computer-use')
    return names


def agent_gitconfig():
    name = git_out('config', '--global', 'user.name')
    email = git_out('config', '--global', 'user.email')
    path = P.miner / 'agent.gitconfig'
    path.write_text(f'[user]\n\tname = {name}\n\temail = {email}\n[credential]\n\thelper =\n', encoding='utf-8')
    return path


def agent_env():
    """No GitHub credentials: no tokens, no credential helpers, an empty GitHub CLI config, and the private
    repo's own helper answers nothing while SKILL_MINER_RUNNER is set."""
    env = {k: v for k, v in os.environ.items()
           if k not in ('GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GIT_CONFIG_PARAMETERS', 'GIT_ASKPASS',
                        'SSH_ASKPASS') and not k.startswith('GIT_CONFIG_')}
    empty_gh = P.miner / 'agent-gh-config'
    empty_gh.mkdir(exist_ok=True)
    env.update(GIT_CONFIG_GLOBAL=str(agent_gitconfig()), GIT_CONFIG_NOSYSTEM='1', GIT_TERMINAL_PROMPT='0',
               GCM_INTERACTIVE='never', GH_CONFIG_DIR=str(empty_gh), COPILOT_SKILLS_DIR=str(P.skills),
               SKILL_MINER_DIR=str(P.miner), SKILL_MINER_REPO=str(P.repo), SKILL_MINER_RUNNER='1')
    return env


def bounded(command, seconds, out_path=None, env=None, cwd=None):
    """Run with a time limit at low priority; kill the whole tree on timeout. Returns the exit code (124 on timeout)."""
    kwargs = {}
    if os.name == 'nt':
        kwargs['creationflags'] = 0x00004000 | 0x00000200  # BELOW_NORMAL_PRIORITY_CLASS | CREATE_NEW_PROCESS_GROUP
    else:
        kwargs['start_new_session'] = True
        kwargs['preexec_fn'] = lambda: os.nice(10)
    out = open(out_path, 'w', encoding='utf-8') if out_path else subprocess.DEVNULL
    try:
        child = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=out, stderr=subprocess.STDOUT, env=env,
                                 cwd=cwd, **kwargs)
        try:
            return child.wait(timeout=seconds)
        except subprocess.TimeoutExpired:
            if os.name == 'nt':
                subprocess.run(['taskkill', '/PID', str(child.pid), '/T', '/F'], capture_output=True)
            else:
                import signal
                os.killpg(child.pid, signal.SIGTERM)
            child.wait(timeout=60)
            return 124
    finally:
        if out_path:
            out.close()


def run_agent(copilot, prompt, model, usage_file, out_file, seconds):
    servers = mcp_servers(copilot)
    if servers is None:
        return 3
    (P.logs / 'cli').mkdir(parents=True, exist_ok=True)
    args = [copilot, '-p', prompt, '--model', model, '--reasoning-effort', EFFORT, '--context', CONTEXT, '--no-ask-user',
            '--autopilot', '--max-autopilot-continues', '10', '--stream', 'off', '--allow-all-tools',
            '--add-dir', str(P.skills), '--add-dir', str(P.backups), '--add-dir', str(P.miner), '--add-dir', str(SESSIONS),
            '--disable-builtin-mcps', '--log-dir', str(P.logs / 'cli'), '--usage-output-file', str(usage_file)]
    args += [f'--deny-tool=shell({d})' for d in DENY] + ['--deny-tool=url', '--deny-tool=computer-use']
    if os.environ.get('SKILL_MINER_MAX_AI_CREDITS'):
        args += ['--max-ai-credits', os.environ['SKILL_MINER_MAX_AI_CREDITS']]
    for name in servers:
        args += ['--disable-mcp-server', name]
    if ATTENDEE and sys.platform == 'darwin' and shutil.which('caffeinate'):
        args = ['caffeinate', '-i'] + args  # keep the Mac awake for the run (the macOS runner does the same)
    P.skills.mkdir(parents=True, exist_ok=True)
    P.backups.mkdir(parents=True, exist_ok=True)
    return bounded(args, seconds, out_file, agent_env(), str(P.repo))


# ---------------------------------------------------------------- the run

def managed_skills():
    return [d.name for d in sorted(P.repo.iterdir()) if (d / 'SKILL.md').is_file()]


def recent_change():
    """Something a session may still be editing, changed in the last hour: an uncommitted file in the repo
    (private/ holds data the sync writes, so it does not count) or an installed skill file that differs from
    what the sync installed. Commits pulled from other machines and the sync's own installs do not count; on a
    machine where other chats push every few minutes they would postpone every run."""
    cutoff = time.time() - 3600
    sync.REPO = P.repo
    for _, path in sync.dirty_paths():
        if path.startswith('private/'):
            continue
        try:
            if (P.repo / path).stat().st_mtime > cutoff:
                return path
        except OSError:
            pass
    installed = sync.load_manifest().get('skills', {})
    for s in managed_skills():
        root = P.skills / s
        known = installed.get(s) or {}
        for rel, fp in sync.tree(root).items():
            if known.get(rel) == fp:
                continue
            try:
                if (root / rel).stat().st_mtime > cutoff:
                    return tilde(root / rel)
            except OSError:
                pass
    return None


def protected_listing(tree=None):
    """mode, blob, path for every file in tools/ and automations/: of a tree, or of the working tree."""
    entries = {}
    if tree:
        for line in git_out('ls-tree', '-r', tree, '--', *PROTECTED).splitlines():
            meta, _, name = line.partition('\t')
            mode, _, blob = meta.split(' ')
            entries[name] = f'{mode} {blob}'
        return entries
    for name in git_out('ls-files', '--cached', '--others', '--exclude-standard', '--', *PROTECTED).splitlines():
        f = P.repo / name
        if f.is_file():
            entries[name] = ('100755' if os.access(f, os.X_OK) and os.name != 'nt' else '100644') + ' ' + \
                git_out('hash-object', '--', name)
    return entries


def protected_changes(before):
    after, origin = protected_listing('HEAD'), protected_listing('origin/main')
    changed = []
    for name in sorted(set(before) | set(after) | set(origin)):
        a = after.get(name)
        # Compare blobs only: Windows checkouts do not carry the executable bit.
        if (a or '').split(' ')[-1] not in ((before.get(name) or '').split(' ')[-1], (origin.get(name) or '').split(' ')[-1]):
            changed.append(name)
    return changed


class Run:
    def __init__(self):
        self.dir = None
        self.report = None
        self.window_start = self.window_end = None
        self.publish_result = ''


def prepare(run):
    """Returns (0 ready | 1 failed | 2 postponed, reason)."""
    if not P.repo.is_dir():
        return 1, f'the repo folder is missing: {tilde(P.repo)}'
    for tool in ('collect-messages.py', 'sync-skills.py', 'validate-skills.py', 'publish-public.py'):
        if not (P.repo / 'tools' / tool).is_file():
            return 1, f'tools/{tool} is missing from the repo'
    if not prompt_text().startswith(MARKER):
        return 1, 'the prompt block in automations/weekly-skill-miner.md is missing'
    sync.REPO = P.repo
    if ATTENDEE:
        review = sync.review_branch(SETTINGS)
        switched = sync.Run('runner')
        if not sync.switch_to_review(SETTINGS, switched):
            return 1, f"the repo is not on its review branch {review} ({'; '.join(switched.notes)})"
    elif git_out('symbolic-ref', '--short', '-q', 'HEAD') != 'main':
        return 1, 'the repo is not on its main branch'
    busy = sync.git_busy()
    if busy:
        return 1, f'a git operation is in progress in the repo ({busy}). Finish or abort it in {tilde(P.repo)}.'
    if not REHEARSAL and not FORCE:
        recent = recent_change()
        if recent:
            return 2, f'a file changed in the last hour ({recent})'
    rc, _, err = git('fetch', '--quiet', 'origin', timeout=300)
    if rc:
        (P.logs / 'fetch.log').write_text(err, encoding='utf-8')
        return 1, f"git fetch origin failed (see {tilde(P.logs / 'fetch.log')})"
    if git('merge-base', '--is-ancestor', 'origin/main', 'HEAD')[0] and not git_out('status', '--porcelain'):
        if git('merge', '--no-edit', '--quiet', 'origin/main')[0] == 0:
            note('merged origin/main')
        else:
            if sync.git_busy():
                git('merge', '--abort')
            note('origin/main does not merge cleanly; the agent will merge it')
    run.window_end = utc_now()
    run.window_start = json_get(P.miner / 'state.json', 'last_mined_through') or \
        (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=8)).strftime('%Y-%m-%dT%H:%M:%SZ')
    base = P.miner / 'runs' / dt.date.today().isoformat()
    run.dir, n = base, 2
    while run.dir.exists():
        run.dir = Path(f'{base}-{n}')
        n += 1
    run.dir.mkdir(parents=True)
    run.report = P.reports / f'{run.dir.name} weekly skill update.txt'
    (run.dir / 'protected-before.json').write_text(json.dumps(protected_listing()), encoding='utf-8')
    (run.dir / 'run.json').write_text(json.dumps({'window_start': run.window_start, 'window_end': run.window_end,
                                                  'start_head': git_out('rev-parse', 'HEAD'), 'attendee': ATTENDEE}),
                                      encoding='utf-8')
    name = (git_out('config', 'user.name') or '').split(' ')[0]
    command = [sys.executable, str(P.repo / 'tools' / 'collect-messages.py'), '--since', run.window_start, '--until',
               run.window_end, '--out', str(run.dir / 'collect'), '--state-dir', str(SESSIONS)]
    if not ATTENDEE:  # attendee mode mines this machine's sessions directly; its messages never leave it
        command += ['--from-inbox', str(P.repo / 'private' / 'inbox')]
    if name:
        command += ['--name', name]
    if bounded(command, 900, run.dir / 'collect.log') != 0:
        return 1, f"collecting messages failed (see {tilde(run.dir / 'collect.log')})"
    return 0, ''


def compose_prompt(run):
    lines = [
        f'- Repo: {tilde(P.repo)}',
        f'- Installed skills: {tilde(P.skills)}',
        f'- Private state: {tilde(P.miner)}',
        f'- Run folder: {tilde(run.dir)}',
        f"- Collected messages: {tilde(run.dir / 'collect')} (stats.json, digest-part-NN.md, checkpoints.txt, messages.jsonl)",
        f'- Window: {run.window_start} to {run.window_end}',
        f'- Report file: {tilde(run.report)}',
        f"- Commit message file: {tilde(run.dir / 'commit-message.txt')}",
        f'- Python: {sys.executable} (use it for every tools/ script; on Windows python3 is only a Store stub)',
    ]
    if ATTENDEE:
        lines.append(f'- Mode: attendee. Also follow "The weekly run in attendee mode" in automations/ATTENDEES.md: the repo '
                     f'is on the review branch {sync.review_branch(SETTINGS)}, not main, and nothing is published.')
    if AUTOMATION:
        finish = sync.runnable(sys.executable, SCRIPT, '--finish', f'"{run.dir}"')
        lines.append(f'- Finish: after step 9, run {finish} in a terminal. It pushes the review branch and opens or '
                     'updates the pull requests. Add what it prints to the report and to your final message.')
    return prompt_text() + '\n\nThis run (set by the runner):\n' + '\n'.join(lines) + '\n'


def publish(run):
    """Check the agent's work, squash everything since origin/main into one commit, push it, then publish it."""
    if ATTENDEE:
        return attendee_publish(run)
    if git_out('symbolic-ref', '--short', '-q', 'HEAD') != 'main':
        return 'Not published: the repo is not on main.', False
    if sync.git_busy():
        return 'Not published: a git operation is still in progress.', False
    if git_out('status', '--porcelain'):
        return ('Not published: the repo has uncommitted changes after the run (a session may be editing it). '
                'The next run publishes them.'), False
    before = json.loads((run.dir / 'protected-before.json').read_text(encoding='utf-8'))
    try:
        lines = (run.dir / 'commit-message.txt').read_text(encoding='utf-8').splitlines()
    except OSError:
        lines = []
    lines = [l.rstrip() for l in lines if not re.match(r'(?i)^(co-authored-by|copilot-session|signed-off-by):', l.strip())]
    while lines and not lines[-1]:
        lines.pop()
    while lines and not lines[0]:
        lines.pop(0)
    if not lines:
        lines = [f'Weekly skill update, week of {run.dir.name[:10]}']
    message = run.dir / 'final-commit-message.txt'
    message.write_text('\n'.join(lines) + '\n\n' + COAUTHOR + '\n', encoding='utf-8')
    terms = [P.miner / 'private-terms.txt'] if (P.miner / 'private-terms.txt').is_file() else []
    # Other machines and the research loop push while the agent works: merge what landed, squash the run into one
    # commit on top of the current origin/main, and go around again if someone pushes before ours gets there.
    for attempt in (1, 2, 3):
        rc, _, err = git('fetch', '--quiet', 'origin', timeout=300)
        if rc:
            (run.dir / 'fetch.log').write_text(err, encoding='utf-8')
            return f"Not published: git fetch failed (see {tilde(run.dir / 'fetch.log')}). The next run tries again.", False
        if git('merge-base', '--is-ancestor', 'origin/main', 'HEAD')[0]:
            if git('merge', '--no-edit', '--quiet', 'origin/main')[0]:
                if sync.git_busy():
                    git('merge', '--abort')
                return ('Not published: origin/main changed during the run and does not merge cleanly. '
                        'The next run merges it.'), False
            note('merged what origin/main gained during the run')
        old, tree, base = git_out('rev-parse', 'HEAD'), git_out('rev-parse', 'HEAD^{tree}'), git_out('rev-parse', 'origin/main')
        if tree == git_out('rev-parse', 'origin/main^{tree}'):
            return 'Nothing to publish this week.', True
        changed = protected_changes(before)
        if changed:
            return f"Not published: the run changed files it must not change ({' '.join(changed)}).", False
        rc, new, err = git('commit-tree', tree, '-p', base, '-F', str(message))
        if rc:
            return 'Not published: could not create the commit.', False
        if git('update-ref', '-m', 'weekly skill update: one commit on top of origin/main', 'refs/heads/main', new, old)[0]:
            return 'Not published: main moved during the check.', False
        command = [sys.executable, str(P.repo / 'tools' / 'validate-skills.py'), '--base', 'origin/main', '--commits', 'origin/main', '--quiet']
        for t in terms:
            command += ['--private-terms', str(t)]
        if bounded(command, 1800, run.dir / 'validate-before-push.txt') != 0:
            git('update-ref', 'refs/heads/main', old, new)
            return f"Not published: the validator found problems (see {tilde(run.dir / 'validate-before-push.txt')}).", False
        publish_cmd = [sys.executable, str(P.repo / 'tools' / 'publish-public.py'), '--message-file', str(message)]
        if REHEARSAL:
            result = f'Rehearsal: would push {new[:7]} to the private repo and publish it; nothing was pushed.'
            if bounded(publish_cmd + ['--dry-run'], 1800, run.dir / 'publish-public.log') == 0:
                return result + f" The publish dry run is clean (see {tilde(run.dir / 'publish-public.log')}).", True
            return result + f" The publish dry run failed (see {tilde(run.dir / 'publish-public.log')}).", False
        rc, _, err = git('push', '--quiet', 'origin', 'refs/heads/main:refs/heads/main', timeout=300)
        if rc == 0:
            break
        (run.dir / 'push.log').write_text(err, encoding='utf-8')
        if attempt == 3:
            return (f"Not published: git push failed (see {tilde(run.dir / 'push.log')}). The skills on this machine are "
                    'updated; the next run tries again.'), False
        note(f'push attempt {attempt} was rejected (origin moved); merging and trying again')
    url = re.sub(r'\.git$', '', git_out('remote', 'get-url', 'origin'))
    result = f'Pushed to the private repo: {url}/commit/{new}'
    json_set(P.miner / 'runner.json', last_published=new)
    if bounded(publish_cmd, 1800, run.dir / 'publish-public.log') == 0:
        tail = [l for l in (run.dir / 'publish-public.log').read_text(encoding='utf-8').splitlines()
                if l.startswith(('Published', 'Nothing to publish'))]
        return result + (' ' + tail[-1] if tail else ''), True
    tail = [l for l in (run.dir / 'publish-public.log').read_text(encoding='utf-8').splitlines() if l.startswith('Not published')]
    return result + f" Not published to the public repo yet: {tail[-1] if tail else 'see publish-public.log'}. The next run tries again.", True


# ---------------------------------------------------------------- attendee mode

def final_message(run):
    """The agent's commit message without trailers, plus the Copilot trailer: (file, lines without the trailer)."""
    try:
        lines = (run.dir / 'commit-message.txt').read_text(encoding='utf-8').splitlines()
    except OSError:
        lines = []
    lines = [l.rstrip() for l in lines if not re.match(r'(?i)^(co-authored-by|copilot-session|signed-off-by):', l.strip())]
    while lines and not lines[-1]:
        lines.pop()
    while lines and not lines[0]:
        lines.pop(0)
    if not lines:
        lines = [f'Weekly skill update, week of {run.dir.name[:10]}']
    path = run.dir / 'final-commit-message.txt'
    path.write_text('\n'.join(lines) + '\n\n' + COAUTHOR + '\n', encoding='utf-8')
    return path, lines


def sync_tool(*args):
    """tools/sync-skills.py with --json in this run's repo: (exit code, its JSON output, or {'error': ...})."""
    env = dict(os.environ, COPILOT_SKILLS_DIR=str(P.skills), SKILL_MINER_DIR=str(P.miner), SKILLS_SYNC_SETTINGS=str(sync.SETTINGS))
    try:
        r = subprocess.run([sys.executable, str(P.repo / 'tools' / 'sync-skills.py'), *args, '--json', '--repo', str(P.repo)],
                           capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=1800, env=env)
    except subprocess.TimeoutExpired:
        return 124, {'error': f'sync-skills.py {args[0]} timed out'}
    try:
        return r.returncode, json.loads(r.stdout)
    except ValueError:
        return r.returncode, {'error': ((r.stderr or r.stdout).strip().splitlines() or ['no output'])[-1][:300]}


def pr_words(what, out):
    if out.get('url'):
        return f"{what}: {out.get('action')} {out['url']}"
    return f"{what}: {out.get('action') or 'failed'}" + (f" ({out['error']})" if out.get('error') else '')


def attendee_publish(run, dry=False):
    """Attendee mode: check the run, make it one commit on the review branch, push the branch, and open or update the
    review pull request and the one for the shared skills' updates. Nothing is published. Returns (result, ok)."""
    review = sync.review_branch(SETTINGS)
    slug = sync.repo_slug(SETTINGS.get('private_url')) or 'your private copy'
    if git_out('symbolic-ref', '--short', '-q', 'HEAD') != review:
        return f'Not pushed: the repo is not on {review}.', False
    if sync.git_busy():
        return 'Not pushed: a git operation is still in progress.', False
    if git_out('status', '--porcelain'):
        return ('Not pushed: the repo has uncommitted changes after the run (a session may be editing it). '
                'The next run pushes them.'), False
    try:
        info = json.loads((run.dir / 'run.json').read_text(encoding='utf-8'))
        before = json.loads((run.dir / 'protected-before.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return f'Not pushed: {tilde(run.dir)} is not a complete run folder.', False
    changed = protected_changes(before)
    if changed:
        return f"Not pushed: the run changed files it must not change ({' '.join(changed)}).", False
    start, old = info.get('start_head') or '', git_out('rev-parse', 'HEAD')
    message, lines = final_message(run)
    squashed = ''
    # This run's commits become one commit with the agent's summary, unless the run merged something in (then the
    # commits stay as they are, so the pull request never shows main's changes as the run's).
    if (not dry and start and old != start and git('merge-base', '--is-ancestor', start, 'HEAD')[0] == 0
            and not git_out('rev-list', '--merges', f'{start}..HEAD')):
        rc, new, _ = git('commit-tree', git_out('rev-parse', 'HEAD^{tree}'), '-p', start, '-F', str(message))
        if rc == 0 and git('update-ref', '-m', 'weekly skill update: one commit for the run', f'refs/heads/{review}', new,
                           old)[0] == 0:
            squashed = new
    command = [sys.executable, str(P.repo / 'tools' / 'validate-skills.py'), '--base', 'origin/main', '--commits',
               'origin/main', '--quiet']
    if (P.miner / 'private-terms.txt').is_file():
        command += ['--private-terms', str(P.miner / 'private-terms.txt')]
    if bounded(command, 1800, run.dir / 'validate-before-push.txt') != 0:
        if squashed:
            git('update-ref', f'refs/heads/{review}', old, squashed)
        return f"Not pushed: the validator found problems (see {tilde(run.dir / 'validate-before-push.txt')}).", False
    if REHEARSAL:
        return f'Rehearsal: would push {review} to {slug} and open or update the pull requests; nothing was pushed.', True
    rc, _, err = git('fetch', '--quiet', 'origin', timeout=300)
    if rc:
        return f'Not pushed: git fetch failed ({sync.first_error(err)}). The next run tries again.', False
    remote = git_out('rev-parse', '-q', '--verify', f'refs/remotes/origin/{review}')
    if remote and git('merge-base', '--is-ancestor', remote, 'HEAD')[0]:
        if git('merge', '--no-edit', '--quiet', f'refs/remotes/origin/{review}')[0]:
            if sync.git_busy():
                git('merge', '--abort')
            return (f'Not pushed: {review} changed on GitHub during the run and does not merge cleanly. '
                    'The next run merges it.'), False
    head = git_out('rev-parse', 'HEAD')
    pushed = f'{review} on {slug} is up to date.'
    if head != remote and (remote or git_out('rev-list', '--count', 'origin/main..HEAD') not in ('', '0')):
        rc, _, err = git('push', '--quiet', 'origin', f'HEAD:refs/heads/{review}', timeout=300)
        if rc:
            (run.dir / 'push.log').write_text(err, encoding='utf-8')
            return f"Not pushed: git push failed (see {tilde(run.dir / 'push.log')}). The next run tries again.", False
        json_set(P.miner / 'runner.json', last_pushed=head)
        pushed = f'Pushed {review} to {slug}.'
    args = ['review-pr']
    if not dry and squashed:
        summary = run.dir / 'pr-summary.txt'
        summary.write_text('\n'.join(lines[1:]).strip() + '\n', encoding='utf-8')
        args += ['--title', lines[0], '--summary-file', str(summary)]
    code, review_out = sync_tool(*args)
    up_code, upstream_out = sync_tool('upstream-pr')
    result = (f'{pushed} ' + pr_words('Your review', review_out) + '. '
              + pr_words('Updates from the shared skills', upstream_out) + '.')
    return result, code == 0 and up_code == 0


def run_folder(path):
    """A Run for an existing run folder (the --finish step of an automation run), or None."""
    run = Run()
    run.dir = Path(path).expanduser().resolve()
    try:
        info = json.loads((run.dir / 'run.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None
    run.window_start, run.window_end = info.get('window_start'), info.get('window_end')
    run.report = P.reports / f'{run.dir.name} weekly skill update.txt'
    return run


def attendee_only(flag):
    if ATTENDEE:
        return True
    print(f'{flag} is for attendee mode (automations/ATTENDEES.md); this machine runs the maintainer setup.')
    return False


def dry_run_flow():
    """Attendee mode: every step except the model. Collects the messages, then pushes the review branch and opens or
    updates the pull requests with what is already there. The mining window does not move."""
    global FORCE
    if not attendee_only('--dry-run'):
        return 2
    FORCE = True
    run = Run()
    if not acquire_lock():
        print('Another weekly run is active; try again later.')
        return 1
    try:
        code, reason = prepare(run)
        if code:
            print(f'The dry run did not finish: {reason}')
            return 1
        report_line(run, 'Dry run: the model step was skipped, so this run changed no skills.')
        result, ok = attendee_publish(run, dry=True)
        report_line(run, result)
        note(f'dry run: {result}')
        print(result)
        print(f'Report: {tilde(run.report)}')
        return 0 if ok else 1
    finally:
        release_lock()


def automation_flow():
    """Attendee mode, the start of an Agents window automation run: take the lock, prepare the run, and print the
    prompt and paths for the automation's session, which does the agent's part and then runs --finish."""
    global FORCE, AUTOMATION
    if not attendee_only('--automation'):
        return 2
    FORCE = AUTOMATION = True
    run = Run()
    if not acquire_lock(automation=True):
        print('Another weekly run is active. Stop here: there is nothing to do in this run.')
        return 0
    code, reason = prepare(run)
    json_set(P.miner / 'runner.json', last_attempt=utc_now())
    if code:
        fail(run, reason)
        release_lock()
        print(f'Stop here: the weekly skill update could not start ({reason}). The report is {tilde(run.report)}.')
        return 1
    note(f'automation run {run.dir.name} prepared (window {run.window_start} to {run.window_end})')
    print(compose_prompt(run))
    return 0


def finish_flow(path):
    """Attendee mode, the end of an automation run: check the agent finished, then push and open the pull requests."""
    if not attendee_only('--finish'):
        return 2
    run = run_folder(path)
    if run is None:
        print(f'Not a run folder: {path}')
        return 2
    try:
        if json_get(P.miner / 'state.json', 'last_run') != run.window_end:
            fail(run, 'the agent did not finish the procedure (state.json last_run is not the end of the window)')
            print(f'Not pushed: the run did not finish its steps. See {tilde(run.report)}.')
            return 1
        models = subagent_check(run, run.dir.stat().st_mtime - 60, any_model=True)
        result, ok = attendee_publish(run)
        note(result)
        report_line(run, result + '\n' + models)
        if ok:
            json_set(P.miner / 'runner.json', last_success=utc_now(), failures=0, last_result=result)
        else:
            failures = int(json_get(P.miner / 'runner.json', 'failures') or 0)
            json_set(P.miner / 'runner.json', last_result=f'failed: {result}', failures=failures + 1)
        prune()
        print(result)
        print(models)
        print(f'Report: {tilde(run.report)}')
        return 0 if ok else 1
    finally:
        release_lock()


def find_run_session(target=None):
    """events.jsonl of a weekly run: the given session id, folder, or file, else the newest session whose first message
    is the weekly prompt (an automation run or a Copilot CLI run of this runner)."""
    if target:
        path = Path(target).expanduser()
        for candidate in (path, path / 'events.jsonl', SESSIONS / target / 'events.jsonl'):
            if candidate.is_file():
                return candidate
        return None
    prefix, best = f'{MARKER} Weekly skill update', None
    for events in SESSIONS.glob('*/events.jsonl'):
        try:
            mtime = events.stat().st_mtime
            if best and mtime <= best[0]:
                continue
            with open(events, encoding='utf-8', errors='ignore') as f:
                for line in f:
                    if '"user.message"' not in line:
                        continue
                    event = json.loads(line)
                    if event.get('type') == 'user.message':
                        if str((event.get('data') or {}).get('content') or '').lstrip().startswith(prefix):
                            best = (mtime, events)
                        break
        except (OSError, ValueError):
            continue
    return best[1] if best else None


def check_run(target=None, as_json=False):
    """The proof that a weekly run used max effort and the long context and never waited for an approval."""
    out = {'ok': False, 'session': None, 'events': None, 'model': None, 'effort': None, 'context': None,
           'subagents': [], 'permissions': {'requested': 0, 'completed': 0, 'waiting': 0, 'not_approved': 0,
                                            'decided_by': {}}, 'problems': []}
    events = find_run_session(target)
    if not events:
        out['problems'].append(f'no weekly run found in {tilde(SESSIONS)}')
    else:
        out['session'], out['events'] = events.parent.name, tilde(events)
        requested, completed, turn = set(), {}, None
        kinds = ('"session.start"', '"session.resume"', '"session.model_change"', '"user.message"', '"permission.',
                 '"subagent.configured"')
        with open(events, encoding='utf-8', errors='ignore') as f:
            for line in f:
                if not any(k in line for k in kinds):
                    continue
                try:
                    event = json.loads(line)
                except ValueError:
                    continue
                kind, data = event.get('type'), event.get('data') or {}
                if kind in ('session.start', 'session.resume', 'session.model_change'):
                    out['model'] = data.get('newModel') or data.get('selectedModel') or out['model']
                    out['effort'] = data.get('reasoningEffort') or out['effort']
                    out['context'] = data.get('contextTier') or out['context']
                elif kind == 'user.message' and isinstance(data.get('responsesReasoning'), dict):
                    turn = data['responsesReasoning']
                elif kind == 'subagent.configured':
                    out['subagents'].append({'model': data.get('model'), 'effort': data.get('reasoningEffort'),
                                             'context': data.get('contextTier')})
                elif kind == 'permission.requested':
                    requested.add(data.get('requestId'))
                elif kind == 'permission.completed':
                    completed[data.get('requestId')] = data
        if turn:  # what the last turn really ran at; session.start can leave the effort out
            out['model'] = turn.get('model') or out['model']
            out['effort'] = turn.get('effort') or out['effort']
        perms = out['permissions']
        perms['requested'], perms['completed'] = len(requested), len(completed)
        perms['waiting'] = len(requested - set(completed))
        perms['not_approved'] = sum(1 for c in completed.values() if (c.get('result') or {}).get('kind') != 'approved')
        for c in completed.values():
            source = c.get('decisionSource') or 'unknown'
            perms['decided_by'][source] = perms['decided_by'].get(source, 0) + 1
        if out['effort'] != EFFORT:
            out['problems'].append(f"effort is {out['effort'] or 'not recorded'}, not {EFFORT}")
        if out['context'] != CONTEXT:
            out['problems'].append(f"context is {out['context'] or 'not recorded'}, not {CONTEXT}")
        if perms['waiting']:
            out['problems'].append(f"{perms['waiting']} approval(s) never answered: set the automation to Autopilot "
                                   'and Allow all (autoApprove), and stop that run')
        if perms['not_approved']:
            out['problems'].append(f"{perms['not_approved']} tool call(s) were not approved")
        below = [s for s in out['subagents'] if s['effort'] != EFFORT or s['context'] != CONTEXT]
        if below:
            out['problems'].append(f'{len(below)} sub-agent(s) ran below max effort or the long context')
    out['ok'] = not out['problems']
    if as_json:
        print(json.dumps(out, indent=1))
    else:
        print(f"{'ok  ' if out['ok'] else 'FAIL'}  weekly run {out['session'] or '-'}: {out['model'] or '?'} at "
              f"{out['effort'] or '?'} effort, {out['context'] or '?'} context; {out['permissions']['completed']} of "
              f"{out['permissions']['requested']} approval(s) answered {out['permissions']['decided_by'] or ''}")
        for problem in out['problems']:
            print(f'      {problem}')
        if out['events']:
            print(f"      {out['events']}")
    return 0 if out['ok'] else 1


def launchd_plist_path():
    return Path.home() / 'Library' / 'LaunchAgents' / f'{LABEL}.plist'


def launchd_install():
    """Attendee mode on macOS: schedule this runner with launchd (the maintainer's Mac uses the .sh runner)."""
    import plistlib
    copilot = find_copilot()
    if not copilot:
        print('Copilot CLI was not found. Install it (or use the Agents window automation), then run --install again.')
        return 1
    path = os.environ.get('PATH', '/usr/bin:/bin:/usr/sbin:/sbin').split(os.pathsep)
    for tool in (copilot, shutil.which('git'), shutil.which('gh')):
        if tool and str(Path(tool).parent) not in path:
            path.insert(0, str(Path(tool).parent))
    data = {
        'Label': LABEL,
        'ProgramArguments': [str(sync.default_python()), str(SCRIPT)],
        'StartCalendarInterval': [{'Hour': hour, 'Minute': 0} for hour in CHECK_HOURS],
        'RunAtLoad': True,
        'ProcessType': 'Background',
        'LowPriorityIO': True,
        'Nice': 10,
        'EnvironmentVariables': {'PATH': os.pathsep.join(path), **sync.job_environment()},
        'StandardOutPath': str(P.logs / 'launchd.log'),
        'StandardErrorPath': str(P.logs / 'launchd.log'),
    }
    plist, domain = launchd_plist_path(), f'gui/{os.getuid()}'
    plist.parent.mkdir(parents=True, exist_ok=True)
    sync.write_atomic(plist, plistlib.dumps(data))
    subprocess.run(['launchctl', 'bootout', f'{domain}/{LABEL}'], capture_output=True)
    r = subprocess.run(['launchctl', 'bootstrap', domain, str(plist)], capture_output=True, text=True)
    if r.returncode:
        print(f'launchctl could not load {tilde(plist)}: {r.stderr.strip()}')
        return 1
    print(f'Scheduled {LABEL}. It {SCHEDULE_TEXT}.')
    print(f'Reports: {tilde(P.reports)}')
    return 0


def launchd_uninstall():
    subprocess.run(['launchctl', 'bootout', f'gui/{os.getuid()}/{LABEL}'], capture_output=True)
    plist = launchd_plist_path()
    if plist.exists():
        plist.unlink()
    print('Removed the schedule. Nothing else was deleted.')
    return 0


def launchd_state():
    """[state, last run, last exit code, next] like scheduled(), or None when the job is not loaded."""
    r = subprocess.run(['launchctl', 'print', f'gui/{os.getuid()}/{LABEL}'], capture_output=True, text=True)
    if r.returncode:
        return None
    fields = {}
    for line in r.stdout.splitlines():
        key, _, value = line.strip().partition(' = ')
        if key in ('state', 'last exit code', 'runs'):
            fields[key] = value
    return [fields.get('state', 'loaded'), f"{fields.get('runs', '?')} run(s)", fields.get('last exit code', '-'), '-']


def report_line(run, text):
    if run.report is None:
        run.report = P.reports / f'{dt.date.today().isoformat()} weekly skill update.txt'
    if not run.report.is_file():
        run.report.write_text(f'Weekly skill update, {dt.date.today().isoformat()}\n', encoding='utf-8')
    with open(run.report, 'a', encoding='utf-8') as f:
        f.write(f'\n{text}\n')


def fail(run, reason):
    note(f'failed: {reason}')
    if not REHEARSAL:
        failures = int(json_get(P.miner / 'runner.json', 'failures') or 0)
        json_set(P.miner / 'runner.json', last_result=f'failed: {reason}', failures=failures + 1)
    report_line(run, f"The weekly skill update did not finish: {reason}\nNothing was published. Logs: "
                     f"{tilde(run.dir or P.logs)}\nIt tries again at the next scheduled check. To run it now: "
                     f"{sys.executable} {tilde(SCRIPT)} --now")


def prune():
    now = time.time()
    for root, days in ((P.miner / 'runs', 56), (REAL_MINER / 'rehearsals', 30)):
        if root.is_dir():
            for d in root.iterdir():
                if d.is_dir() and now - d.stat().st_mtime > days * 86400:
                    shutil.rmtree(d, ignore_errors=True)
    log = P.logs / 'scheduler.log'
    if log.is_file():
        lines = log.read_text(encoding='utf-8', errors='replace').splitlines()
        if len(lines) > 3000:
            log.write_text('\n'.join(lines[-2000:]) + '\n', encoding='utf-8')


def subagent_check(run, started, any_model=False):
    """Read the run's own session logs: did every sub-agent start at the top settings? Returns a report line."""
    marker, count, below = f'Run folder: {tilde(run.dir)}', 0, []
    escaped = json.dumps(marker)[1:-1]
    for events in SESSIONS.glob('*/events.jsonl'):
        try:
            if events.stat().st_mtime < started:
                continue
            text = events.read_text(encoding='utf-8', errors='ignore')
        except OSError:
            continue
        if marker not in text and escaped not in text:
            continue
        for line in text.splitlines():
            if '"subagent.configured"' not in line:
                continue
            try:
                data = json.loads(line).get('data') or {}
            except ValueError:
                continue
            count += 1
            settings = (data.get('model'), data.get('reasoningEffort'), data.get('contextTier'))
            if (not any_model and settings[0] not in (MODEL, FALLBACK_MODEL)) or settings[1] != EFFORT or settings[2] != CONTEXT:
                below.append('/'.join(str(s) for s in settings))
    if not count:
        return 'Sub-agents: none.'
    if not below:
        return f'Sub-agents: {count}, all at the top model, max effort and the long context.'
    kinds = ', '.join(f'{n} x {k}' for k, n in sorted({k: below.count(k) for k in below}.items()))
    return (f'Sub-agents: {count}, of which {len(below)} ran below the top settings ({kinds}). Their part of '
            'this run was not redone; check its changes.')


def run_flow():
    run = Run()
    if not acquire_lock():
        note('another run is active; not starting')
        return 0
    try:
        code, reason = prepare(run)
        if code == 2:
            note(f'postponed: {reason}')
            return 0
        if not REHEARSAL:
            json_set(P.miner / 'runner.json', last_attempt=utc_now())
        if code:
            fail(run, reason)
            return 1
        copilot = find_copilot()
        if not copilot:
            fail(run, 'Copilot CLI was not found on this machine.')
            return 1
        note(f'starting {run.dir.name} with {MODEL} at {EFFORT} effort and {CONTEXT} (window {run.window_start} to {run.window_end})')
        started = time.time()
        code = run_agent(copilot, compose_prompt(run), MODEL, run.dir / 'usage.json', run.dir / 'agent.log', TIME_LIMIT)
        if code == 3:
            fail(run, 'the list of MCP servers to turn off could not be read')
            return 1
        if FALLBACK_MODEL and code not in (0, 124) and time.time() - started < 180:
            note(f'agent exited {code} within 3 minutes; retrying with {FALLBACK_MODEL} at the same settings')
            code = run_agent(copilot, compose_prompt(run), FALLBACK_MODEL, run.dir / 'usage.json', run.dir / 'agent.log.retry', TIME_LIMIT)
        note(f'agent finished with exit {code}')
        if code == 124:
            fail(run, f'the run took longer than {TIME_LIMIT // 60} minutes and was stopped.')
            return 1
        if code != 0 or json_get(P.miner / 'state.json', 'last_run') != run.window_end:
            fail(run, f"the agent stopped before finishing (exit {code}; see {tilde(run.dir / 'agent.log')}).")
            return 1
        models = subagent_check(run, started)
        note(models)
        result, ok = publish(run)
        run.publish_result = result
        note(result)
        report_line(run, result + '\n' + models)
        if not REHEARSAL:
            json_set(P.miner / 'runner.json', last_success=utc_now(), failures=0, last_result=result)
        prune()
        return 0
    finally:
        release_lock()
        globals()['LAST_RUN'] = run


def due():
    """(due, reason) from runner.json, like the macOS runner."""
    path = P.miner / 'runner.json'
    try:
        data = json.loads(path.read_text(encoding='utf-8-sig'))
    except FileNotFoundError:
        data = {}
    except ValueError:
        return None, 'runner.json is not valid JSON (it is reset after this report)'

    def parse(value):
        try:
            moment = dt.datetime.fromisoformat(str(value).replace('Z', '+00:00'))
            return moment if moment.tzinfo else moment.replace(tzinfo=dt.timezone.utc)
        except (TypeError, ValueError):
            return None
    now = dt.datetime.now(dt.timezone.utc)
    attempt, success = parse(data.get('last_attempt')), parse(data.get('last_success'))
    failures = int(data.get('failures') or 0)
    local = dt.datetime.now()
    scheduled = local.weekday() == RUN_WEEKDAY and local.hour >= RUN_HOUR
    if attempt and now - attempt < dt.timedelta(hours=20):
        return False, 'already attempted in the last 20 hours'
    if failures:
        if failures < 3:
            return True, f'retrying after {failures} failed run(s)'
        return scheduled, 'scheduled retry after repeated failures' if scheduled else 'waiting for the scheduled time after repeated failures'
    if scheduled and (success is None or now - success >= dt.timedelta(days=5)):
        return True, 'weekly run'
    if success and now - success >= dt.timedelta(days=8):
        return True, 'catching up on a missed week'
    return False, 'not due'


def rehearse(since=None):
    global REHEARSAL, P
    root = REAL_MINER / 'rehearsals' / dt.datetime.now().strftime('%Y%m%d-%H%M%S')
    (root / 'miner').mkdir(parents=True)
    print(f'Rehearsal folder: {tilde(root)}')
    repo = root / 'repo'
    subprocess.run(['git', 'clone', '--quiet', '--no-local', str(P.repo), str(repo)], check=True, env=sync.GIT_ENV)
    head = git_out('rev-parse', 'HEAD')
    subprocess.run(['git', '-C', str(repo), 'checkout', '--quiet', '-B', 'main', head], check=True, env=sync.GIT_ENV)
    for dirpath, dirnames, filenames in os.walk(P.repo):
        dirnames[:] = [d for d in dirnames if d != '.git']
        for name in filenames:
            src = Path(dirpath) / name
            dst = repo / src.relative_to(P.repo)
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
    for args in (['remote', 'set-url', 'origin', git_out('remote', 'get-url', 'origin')],
                 ['remote', 'add', 'public', git_out('remote', 'get-url', 'public')]):
        subprocess.run(['git', '-C', str(repo), *args], capture_output=True, env=sync.GIT_ENV)
    for line in git_out('config', '--local', '--get-regexp', r'^credential\.').splitlines():
        key, _, value = line.partition(' ')
        subprocess.run(['git', '-C', str(repo), 'config', '--local', '--add', key, value], env=sync.GIT_ENV)
    for line in git_out('config', '--local', '--get-regexp', r'^user\.').splitlines():
        key, _, value = line.partition(' ')
        subprocess.run(['git', '-C', str(repo), 'config', '--local', key, value], env=sync.GIT_ENV)
    shutil.copytree(P.skills, root / 'skills', ignore=shutil.ignore_patterns('__pycache__'))
    for item in ('private', 'private-terms.txt', 'state.json', 'ledger.json', 'installed-manifest.json', 'installed-snapshot'):
        src = P.miner / item
        if src.is_dir():
            shutil.copytree(src, root / 'miner' / item)
        elif src.is_file():
            shutil.copy2(src, root / 'miner' / item)
    if since:
        json_set(root / 'miner' / 'state.json', last_mined_through=since)
    REHEARSAL = True
    P = Paths(repo, root / 'skills', root / 'miner')
    sync.SKILLS, sync.STATE = P.skills, P.miner
    sync.MANIFEST, sync.SNAPSHOT = P.miner / 'installed-manifest.json', P.miner / 'installed-snapshot'
    code = run_flow()
    run = globals().get('LAST_RUN')
    print(run.publish_result if run and run.publish_result else 'The run did not finish.')
    print(f"Report: {tilde(run.report) if run and run.report else tilde(P.reports)}")
    print(f'Changes: git -C {tilde(repo)} diff origin/main')
    return code


# ---------------------------------------------------------------- schedule, status, check

def task_xml():
    from xml.sax.saxutils import escape
    user = subprocess.run(['whoami'], capture_output=True, text=True).stdout.strip()
    conhost = Path(os.environ.get('SystemRoot', r'C:\Windows')) / 'System32' / 'conhost.exe'
    python = Path(sys.executable).resolve()
    if python.name.lower() == 'pythonw.exe':
        python = python.with_name('python.exe')
    # With a UTC offset, or Task Scheduler reads the hours in the system's zone (UTC on a Cloud PC).
    boundaries = [sync.daily_boundary('%02d:00' % hour) for hour in CHECK_HOURS]
    calendar = ''.join(f'''    <CalendarTrigger>
      <StartBoundary>{boundary}</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>
    </CalendarTrigger>
''' for boundary in boundaries)
    return f'''<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>The weekly skill miner ({escape(str(SCRIPT))}): {SCHEDULE_TEXT}. Reports: ~/.copilot/skill-miner/reports</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>{escape(user)}</UserId>
      <Delay>PT5M</Delay>
    </LogonTrigger>
{calendar}  </Triggers>
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
    <ExecutionTimeLimit>PT5H</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>{escape(str(conhost))}</Command>
      <Arguments>{escape(f'--headless "{python}" "{SCRIPT}"')}</Arguments>
      <WorkingDirectory>{escape(str(P.repo))}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
'''


def register():
    folder = Path(tempfile.mkdtemp())
    try:
        (folder / 'task.xml').write_text(task_xml(), encoding='utf-16')
        return subprocess.run(['schtasks', '/Create', '/F', '/TN', TASK_NAME, '/XML', str(folder / 'task.xml')],
                              capture_output=True, text=True)
    finally:
        shutil.rmtree(folder, ignore_errors=True)


def install_job():
    if ATTENDEE and sys.platform == 'darwin':
        return launchd_install()
    if os.name != 'nt':
        print('On macOS, schedule it with run-weekly-skill-miner.sh --install.')
        return 1
    if not find_copilot():
        print('Copilot CLI was not found. Install it, then run --install again.')
        return 1
    r = register()
    if r.returncode:
        print(f'schtasks failed: {(r.stderr or r.stdout).strip()}')
        return 1
    print(f'Scheduled "{TASK_NAME}". It {SCHEDULE_TEXT}.')
    print(f'Reports: {tilde(P.reports)}')
    return 0


def job_hours():
    """(the local hours of the task's daily triggers, whether it runs this script), or None when there is no task.
    A trigger without a UTC offset counts as hour -1: it runs in the system's zone."""
    r = subprocess.run(['schtasks', '/Query', '/TN', TASK_NAME, '/XML'], capture_output=True, text=True, errors='replace')
    if r.returncode:
        return None
    hours = []
    for boundary in re.findall(r'<CalendarTrigger>.*?<StartBoundary>([^<]+)</StartBoundary>', r.stdout, re.S):
        at = sync.boundary_local_time(boundary)
        hours.append(int(at[:2]) if at and at.endswith(':00') else -1)
    m = re.search(r'"[^"]+"\s+"([^"]+)"', html.unescape(''.join(re.findall(r'<Arguments>(.*?)</Arguments>', r.stdout, re.S))))
    here = bool(m) and os.path.normcase(os.path.realpath(m.group(1))) == os.path.normcase(str(SCRIPT))
    return sorted(hours), here


def fix_schedule():
    """Windows: move the daily checks back to the local CHECK_HOURS when they drifted (a daylight saving or time
    zone change, or triggers written without a UTC offset)."""
    if os.name != 'nt':
        return
    found = job_hours()
    if not found or not found[1] or found[0] == sorted(CHECK_HOURS):
        return
    r = register()
    hours = found[0]
    ran = ('had no UTC offset' if all(h < 0 for h in hours)
           else 'ran at ' + ', '.join('a time without a UTC offset' if h < 0 else f'{h:02d}:00' for h in hours))
    note(f"schedule {'fixed' if r.returncode == 0 else 'not fixed'}: the checks {ran}; "
         + ('now it ' + SCHEDULE_TEXT if r.returncode == 0 else (r.stderr or r.stdout).strip()[:200]))


def uninstall_job():
    if ATTENDEE and sys.platform == 'darwin':
        return launchd_uninstall()
    r = subprocess.run(['schtasks', '/Delete', '/F', '/TN', TASK_NAME], capture_output=True, text=True)
    print('Removed the schedule. Nothing else was deleted.' if r.returncode == 0 else (r.stderr or r.stdout).strip())
    return 0


def scheduled():
    if ATTENDEE and sys.platform == 'darwin':
        return launchd_state()
    if os.name != 'nt':
        return None
    script = (f"$t = Get-ScheduledTask -TaskName '{TASK_NAME}' -ErrorAction SilentlyContinue; if ($t) {{ $i = Get-ScheduledTaskInfo "
              f"-TaskName '{TASK_NAME}'; '{{0}}|{{1}}|{{2}}|{{3}}' -f $t.State, $i.LastRunTime, $i.LastTaskResult, $i.NextRunTime }}")
    r = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script], capture_output=True, text=True)
    fields = r.stdout.strip().split('|')
    return fields if len(fields) == 4 else None


def status():
    task = scheduled()
    if task and task[0] != 'Disabled':
        print(f'Schedule: on ({SCHEDULE_TEXT}); task {task[0]}, last run {task[1] or "never"} (result {task[2]}), next {task[3]}')
    else:
        print(f'Schedule: off (run --install){"; the task is disabled" if task else ""}')
    for path, keys in ((P.miner / 'runner.json', ('last_attempt', 'last_success', 'failures', 'last_result')),
                       (P.miner / 'state.json', ('last_mined_through',))):
        for key in keys:
            value = json_get(path, key)
            if value is not None:
                print(f'{key}: {value}')
    reports = sorted(P.reports.glob('*.txt'), key=lambda p: p.stat().st_mtime)
    if reports:
        print(f'Latest report: {tilde(reports[-1])}')
        for line in reports[-1].read_text(encoding='utf-8', errors='replace').splitlines()[:15]:
            print(f'  {line}')
    log = P.logs / 'scheduler.log'
    if log.is_file():
        print('Scheduler log:')
        for line in log.read_text(encoding='utf-8', errors='replace').splitlines()[-5:]:
            print(f'  {line}')
    return 0


def check(llm=False):
    failed = 0

    def say(ok, text):
        nonlocal failed
        print(f"{'ok  ' if ok else 'FAIL'}  {text}")
        if not ok:
            failed = 1
    copilot = find_copilot()
    say(bool(copilot), f'Copilot CLI {copilot_version(copilot)}: {tilde(copilot)}' if copilot else 'Copilot CLI not found')
    if copilot:
        help_text = subprocess.run([copilot, '--help'], capture_output=True, text=True, encoding='utf-8', errors='replace').stdout
        say('--reasoning-effort' in help_text and '--context' in help_text,
            f'the CLI takes --model {MODEL} --reasoning-effort {EFFORT} --context {CONTEXT}')
    say(prompt_text().startswith(MARKER), 'prompt block found')
    for tool in ('collect-messages.py', 'sync-skills.py', 'validate-skills.py', 'publish-public.py'):
        if not (P.repo / 'tools' / tool).is_file():
            say(False, f'missing tools/{tool}')
    say(sys.version_info >= (3, 8), f'Python {sys.version.split()[0]}: {tilde(sys.executable)}')
    terms = [p for p in (P.repo / 'private' / 'private-terms.txt', P.miner / 'private-terms.txt') if p.is_file()]
    say(bool(terms), 'private terms file: ' + (', '.join(tilde(t) for t in terms) or 'none'))
    for d in (P.miner, P.skills, P.reports):
        try:
            d.mkdir(parents=True, exist_ok=True)
            (d / '.write-test').write_text('x')
            (d / '.write-test').unlink()
            say(True, f'can write {tilde(d)}')
        except OSError:
            say(False, f'cannot write {tilde(d)}')
    if ATTENDEE:
        print(f'note  attendee mode: the run reads this machine\'s sessions in {tilde(SESSIONS)} directly')
    else:
        inbox = P.repo / 'private' / 'inbox'
        hosts = sorted(p.name for p in inbox.iterdir() if p.is_dir()) if inbox.is_dir() else []
        say(bool(hosts), f"message exports from: {', '.join(hosts) or 'no machine yet (each sync exports daily)'}")
    say(git('fetch', '--quiet', 'origin', timeout=120)[0] == 0, 'git fetch origin')
    target = f'refs/remotes/origin/main:refs/heads/{sync.review_branch(SETTINGS)}-push-check' if ATTENDEE else \
        'refs/remotes/origin/main:refs/heads/main'
    say(git('push', '--dry-run', '--quiet', 'origin', target, timeout=120)[0] == 0,
        'the runner can push (dry run, nothing sent)')
    env = agent_env()
    r = subprocess.run(['git', '-C', str(P.repo), 'push', '--dry-run', '--quiet', 'origin', target],
                       capture_output=True, env=env, timeout=120)
    say(r.returncode != 0, "the agent's git has no push credentials (private repo)")
    r = subprocess.run(['git', '-C', str(P.repo), 'push', '--dry-run', '--quiet', 'public', 'refs/remotes/origin/main:refs/heads/check-only'],
                       capture_output=True, env=env, timeout=120)
    say(r.returncode != 0, "the agent's git has no push credentials (public repo)")
    if shutil.which('gh'):
        print("note  GitHub CLI can still read stored tokens from the OS keyring, so the agent's shell blocks gh "
              "and only the runner pushes")
    servers = mcp_servers(copilot) if copilot else None
    say(servers is not None, f"MCP servers turned off for the run: {' '.join(servers or [])}" if servers else 'could not list MCP servers')
    if llm and copilot:
        out = P.logs / 'check-agent.log'
        code = run_agent(copilot, f'{MARKER} Connectivity check. Do not use any tools. Reply with exactly the word READY.',
                         MODEL, P.logs / 'usage-check.json', out, 600)
        text = out.read_text(encoding='utf-8', errors='replace') if out.is_file() else ''
        say(code == 0 and re.search(r'\bREADY\b', text) is not None, f'{MODEL} at {EFFORT} effort and {CONTEXT} replied with the run settings')
    task = scheduled()
    print(f"{'ok  ' if task and task[0] != 'Disabled' else 'note'}  {'scheduled' if task and task[0] != 'Disabled' else 'not scheduled (run --install)'}")
    return failed


def main():
    global FORCE
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    group = parser.add_mutually_exclusive_group()
    for flag in ('--install', '--uninstall', '--status', '--check', '--now', '--rehearse', '--automation', '--dry-run'):
        group.add_argument(flag, action='store_true')
    group.add_argument('--finish', metavar='RUN_FOLDER', help='attendee mode: finish an automation run')
    group.add_argument('--check-run', nargs='?', const='', metavar='SESSION', help='check a weekly run (default: the newest)')
    parser.add_argument('--llm', action='store_true', help='with --check: also ask the model for a one-word reply')
    parser.add_argument('--since', help='with --rehearse: mine from this ISO time')
    parser.add_argument('--json', action='store_true', help='with --check-run: print JSON')
    args = parser.parse_args()
    if args.automation:
        return automation_flow()
    if args.finish:
        return finish_flow(args.finish)
    if args.dry_run:
        return dry_run_flow()
    if args.check_run is not None:
        return check_run(args.check_run or None, args.json)
    if args.install:
        return install_job()
    if args.uninstall:
        return uninstall_job()
    if args.status:
        return status()
    if args.check:
        return check(args.llm)
    if args.now:
        FORCE = True
        return run_flow()
    if args.rehearse:
        return rehearse(args.since)
    try:
        fix_schedule()
    except Exception as error:  # noqa: BLE001 - a schedule check never blocks the run
        note(f'schedule check failed: {type(error).__name__}: {error}')
    is_due, reason = due()
    if is_due is None:
        fail(Run(), f'the schedule check could not run: {reason}')
        return 1
    note(f"{'due' if is_due else 'skipped'}: {reason}")
    return run_flow() if is_due else 0


if __name__ == '__main__':
    sys.exit(main())

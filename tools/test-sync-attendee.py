#!/usr/bin/env python3
"""Test attendee mode end to end on this machine, offline: local bare repos stand in for the private copy and the shared
repo, and a fake GitHub CLI records pull requests. Nothing outside the test folder is read or changed: HOME,
COPILOT_HOME, the git config, and the temp folder all point into it, and nothing is scheduled.

  test-sync-attendee.py [--root DIR] [--keep]
  test-sync-attendee.py --github OWNER/NAME [--schedule] [--root DIR] [--keep]

It checks: setup-attendee (a private copy made from the shared repo, origin and a fetch-only public, the clone on the
review branch, the skills installed); a session's edit harvested onto the review branch and pushed, never main, and
never overwritten by an install; the review pull request; the shared repo's update merged into the upstream branch with
your my-voice kept; merged pull requests (a merge and a squash) taken back in; a closed pull request dropping its changes
(saved on a declined/ branch); the weekly runner's --dry-run, --automation and --finish (one commit for the run); and
--check-run. Exit 0 when every check passes. Works on macOS, Linux, and Windows.

--github OWNER/NAME runs a shorter check against GitHub instead: setup-attendee creates that repo (private; it must not
exist yet), a session's edit reaches skill-updates there, and the weekly runner's --dry-run opens both pull requests for
real. With --schedule, the daily sync and the weekly backup are registered under test names (launchd labels
com.autonomous-output-skills.test.*, Task Scheduler "WS test ...") and removed at the end. It needs GitHub CLI signed in
to an account that can create the repo; on macOS and Linux the scratch HOME gets a copy of that login, deleted at the
end. The repo stays (delete it with gh repo delete OWNER/NAME --yes, which needs the delete_repo scope).
"""
import argparse
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent
SLUG = 'tester/skills-copy'
FAILED = []

FAKE_GH = r'''
import json, os, subprocess, sys
from pathlib import Path
ROOT = Path(os.environ['FAKE_GH_ROOT'])
STATE = ROOT / 'gh-state.json'

def load():
    return json.loads(STATE.read_text()) if STATE.exists() else {'repos': {}, 'prs': []}

def save(state):
    STATE.write_text(json.dumps(state, indent=1))

def opt(args, name, default=None):
    return args[args.index(name) + 1] if name in args else default

def bare(slug):
    return ROOT / 'remotes' / (slug.split('/')[1] + '.git')

def tip(slug, branch):
    r = subprocess.run(['git', '--git-dir', str(bare(slug)), 'rev-parse', '-q', '--verify', f'refs/heads/{branch}'],
                       capture_output=True, text=True)
    return r.stdout.strip()

args = sys.argv[1:]
state = load()
if args[:2] == ['api', 'user']:
    print('1234\tTest Person' if '@tsv' in ' '.join(args) else 'tester')
elif args[:2] == ['auth', 'token']:
    sys.exit(0 if print('fake-token') is None and opt(args, '--user', 'tester') == 'tester' else 1)
elif args[:2] == ['auth', 'setup-git']:
    pass
elif args[:2] == ['repo', 'view']:
    if args[2] not in state['repos']:
        print(f"GraphQL: Could not resolve to a Repository with the name '{args[2]}'. (repository)", file=sys.stderr)
        sys.exit(1)
    print(json.dumps({'isPrivate': True, 'visibility': 'PRIVATE', 'url': f'https://github.com/{args[2]}'}))
elif args[:2] == ['repo', 'create']:
    bare(args[2]).parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(['git', 'init', '-q', '--bare', '-b', 'main', str(bare(args[2]))], check=True)
    state['repos'][args[2]] = {'private': '--private' in args}
    save(state)
elif args[:2] == ['pr', 'list']:
    slug, head, base, want = opt(args, '--repo'), opt(args, '--head'), opt(args, '--base'), opt(args, '--state', 'open')
    fields = opt(args, '--json', 'number,url').split(',')
    out = []
    for pr in state['prs']:
        if pr['repo'] != slug or pr['head'] != head or pr['base'] != base:
            continue
        if want != 'all' and pr['state'] != want.upper():
            continue
        if pr['state'] == 'OPEN':
            pr['headRefOid'] = tip(slug, head)
        out.append({f: pr.get(f) for f in fields})
    print(json.dumps(out))
elif args[:2] == ['pr', 'create']:
    slug, head = opt(args, '--repo'), opt(args, '--head')
    if not tip(slug, head):
        print(f'head branch {head} not found', file=sys.stderr)
        sys.exit(1)
    number = len(state['prs']) + 1
    url = f'https://github.com/{slug}/pull/{number}'
    state['prs'].append({'number': number, 'repo': slug, 'head': head, 'base': opt(args, '--base'), 'state': 'OPEN',
                         'title': opt(args, '--title'), 'body': Path(opt(args, '--body-file')).read_text(),
                         'url': url, 'headRefOid': tip(slug, head)})
    save(state)
    print(url)
elif args[:2] == ['pr', 'edit']:
    pr = next(p for p in state['prs'] if p['number'] == int(args[2]) and p['repo'] == opt(args, '--repo'))
    pr['title'], pr['body'] = opt(args, '--title'), Path(opt(args, '--body-file')).read_text()
    save(state)
else:
    print(f'fake gh: unsupported {args}', file=sys.stderr)
    sys.exit(2)
'''


def remove_tree(path, attempts=5):
    """Delete a folder for good. Git for Windows writes object files read-only, and shutil.rmtree can't delete those,
    so make each one writable and try again."""
    def writable(func, target, _error):
        try:
            os.chmod(target, stat.S_IWRITE)
            func(target)
        except OSError:
            pass
    handler = {'onexc' if sys.version_info >= (3, 12) else 'onerror': writable}
    for attempt in range(attempts):
        if not Path(path).exists():
            return True
        shutil.rmtree(str(path), **handler)
        if not Path(path).exists():
            return True
        time.sleep(0.5 * (attempt + 1))
    return not Path(path).exists()


def check(ok, text):
    print(f"{'ok  ' if ok else 'FAIL'} {text}")
    if not ok:
        FAILED.append(text)
    return ok


class Env:
    def __init__(self, root, fake_gh=True):
        self.root = root
        self.home = root / 'home'
        self.copilot = self.home / '.copilot'
        self.clone = self.copilot / 'autonomous-output-skills'
        self.skills = self.copilot / 'skills'
        self.state = self.copilot / 'skill-miner'
        self.remotes = root / 'remotes'
        self.public = self.remotes / 'public.git'
        self.private = self.remotes / 'skills-copy.git'
        tmp = root / 'tmp'
        bin_dir = root / 'bin'
        for d in (self.home, tmp, bin_dir, self.remotes):
            d.mkdir(parents=True, exist_ok=True)
        (bin_dir / 'fake_gh.py').write_text(FAKE_GH, encoding='utf-8')
        if os.name == 'nt':
            (bin_dir / 'gh.cmd').write_text(f'@"{sys.executable}" "{bin_dir / "fake_gh.py"}" %*\r\n', encoding='utf-8')
        else:
            (bin_dir / 'gh').write_text(f'#!/bin/sh\nexec "{sys.executable}" "{bin_dir / "fake_gh.py"}" "$@"\n', encoding='utf-8')
            os.chmod(bin_dir / 'gh', 0o755)
        gitconfig = self.home / '.gitconfig'
        gitconfig.write_text('[user]\n\tname = Test Person\n\temail = 1234+tester@users.noreply.github.com\n'
                             f'[url "{self.remotes.as_uri()}/"]\n\tinsteadOf = https://github.com/tester/\n'
                             '[init]\n\tdefaultBranch = main\n', encoding='utf-8')
        drop = ('GH_TOKEN', 'GITHUB_TOKEN', 'COPILOT_SKILLS_DIR', 'SKILL_MINER_DIR', 'SKILLS_SYNC_SETTINGS', 'GIT_DIR',
                'GIT_WORK_TREE', 'COPILOT_SESSION_STATE', 'GH_CONFIG_DIR')
        self.env = {k: v for k, v in os.environ.items() if k not in drop}
        path = (str(bin_dir) + os.pathsep if fake_gh else '') + os.environ.get('PATH', '')
        self.env.update(HOME=str(self.home), USERPROFILE=str(self.home), COPILOT_HOME=str(self.copilot),
                        GIT_CONFIG_GLOBAL=str(gitconfig), GIT_CONFIG_NOSYSTEM='1', TMPDIR=str(tmp), TEMP=str(tmp),
                        TMP=str(tmp), FAKE_GH_ROOT=str(root), PATH=path,
                        SKILLS_SYNC_LABEL='com.autonomous-output-skills.test.skills-sync',
                        SKILL_MINER_LABEL='com.autonomous-output-skills.test.weekly-skill-update',
                        SKILLS_SYNC_TASK='WS test skills sync', SKILL_MINER_TASK='WS test weekly skill miner',
                        GIT_TERMINAL_PROMPT='0', PYTHONIOENCODING='utf-8', GH_PROMPT_DISABLED='1')

    def run(self, *command, cwd=None, check_rc=None, input=None):
        r = subprocess.run([str(c) for c in command], capture_output=True, text=True, encoding='utf-8', errors='replace',
                           env=self.env, cwd=str(cwd) if cwd else None, timeout=1800, input=input)
        if check_rc is not None and r.returncode != check_rc:
            print(f'---- {" ".join(str(c) for c in command)} exited {r.returncode}\n{r.stdout[-3000:]}\n{r.stderr[-3000:]}')
        return r

    def git(self, *args, cwd=None):
        return self.run('git', *args, cwd=cwd).stdout.strip()

    def bare_git(self, repo, *args):
        return self.run('git', '--git-dir', repo, *args).stdout.strip()

    def sync(self, *args):
        return self.run(sys.executable, self.clone / 'tools' / 'sync-skills.py', *args)

    def runner(self, *args):
        return self.run(sys.executable, self.clone / 'automations' / 'run-weekly-skill-miner.py', *args)

    def gh_state(self):
        return json.loads((self.root / 'gh-state.json').read_text())

    def set_pr(self, number, **values):
        state = self.gh_state()
        for pr in state['prs']:
            if pr['number'] == number:
                pr.update(values)
        (self.root / 'gh-state.json').write_text(json.dumps(state, indent=1))

    def on_github(self, *steps):
        """Change the private copy as GitHub would (a merge button): in a scratch clone, then push."""
        work = self.root / 'github-work'
        remove_tree(work)
        self.run('git', 'clone', '-q', self.private, work, check_rc=0)
        for step in steps:
            self.run('git', *step, cwd=work, check_rc=0)
        self.run('git', 'push', '-q', 'origin', 'main', cwd=work, check_rc=0)
        remove_tree(work)


def unpublished(source):
    """The paths .publishignore lists in this working tree (tracked or not), as tools/publish-public.py leaves them out."""
    rules = source / '.publishignore'
    out = set()
    if rules.is_file():
        for which in ('-c', '-o'):
            r = subprocess.run(['git', '-C', str(source), 'ls-files', '-z', '-i', which, f'--exclude-from={rules}'],
                               capture_output=True)
            out |= set(filter(None, r.stdout.decode('utf-8').split('\0')))
    return out


def shared_snapshot(env):
    """The shared repo as attendees get it: this working tree without private/, .publishignore, and what it lists
    (my-taste/ except the template and the taste procedure every copy starts from)."""
    work = env.root / 'public-work'
    listed = subprocess.run(['git', '-C', str(SOURCE), 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
                            capture_output=True).stdout.decode('utf-8').split('\0')
    skip = unpublished(SOURCE)
    for rel in filter(None, listed):
        if rel.startswith('private/') or rel == '.publishignore' or rel in skip or not (SOURCE / rel).is_file():
            continue
        target = work / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(SOURCE / rel, target)
    env.run('git', 'init', '-q', '-b', 'main', cwd=work, check_rc=0)
    env.run('git', 'add', '-A', cwd=work, check_rc=0)
    env.run('git', 'commit', '-q', '-m', 'The shared skills', cwd=work, check_rc=0)
    env.run('git', 'init', '-q', '--bare', '-b', 'main', env.public, check_rc=0)
    env.run('git', 'push', '-q', env.public, 'main', cwd=work, check_rc=0)
    return work


def append(path, line):
    path.write_text(path.read_text(encoding='utf-8') + f'\n{line}\n', encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--root', help='the test folder (default: a new temporary folder)')
    parser.add_argument('--keep', action='store_true', help='keep the test folder afterwards')
    parser.add_argument('--github', metavar='OWNER/NAME', help='check against GitHub with this new private repo')
    parser.add_argument('--schedule', action='store_true', help='with --github: also register the jobs (test names), then remove them')
    args = parser.parse_args()
    root = Path(args.root).resolve() if args.root else Path(tempfile.mkdtemp(prefix='attendee-test-'))
    if root.exists() and any(root.iterdir()):
        print(f'{root} is not empty')
        return 2
    root.mkdir(parents=True, exist_ok=True)
    env = Env(root, fake_gh=not args.github)
    try:
        return run_github(env, args.github, args.schedule) if args.github else run_checks(env)
    finally:
        if not args.keep:
            remove_tree(root)
        else:
            print(f'kept {root}')


def job_registered(kind):
    """Whether the test job ('sync' or 'miner') is registered with launchd or Task Scheduler."""
    if os.name == 'nt':
        name = 'WS test skills sync' if kind == 'sync' else 'WS test weekly skill miner'
        return subprocess.run(['schtasks', '/Query', '/TN', name], capture_output=True).returncode == 0
    if sys.platform == 'darwin':
        label = f"com.autonomous-output-skills.test.{'skills-sync' if kind == 'sync' else 'weekly-skill-update'}"
        return subprocess.run(['launchctl', 'print', f'gui/{os.getuid()}/{label}'], capture_output=True).returncode == 0
    return False


def run_github(env, slug, schedule):
    gh = shutil.which('gh')
    if not check(bool(gh), 'GitHub CLI is installed'):
        return 1
    token_copy = None
    if os.name != 'nt':  # GitHub CLI keeps its login under HOME here: give the scratch HOME a copy, deleted at the end
        token = subprocess.run([gh, 'auth', 'token', '--hostname', 'github.com'], capture_output=True, text=True).stdout.strip()
        env.run(gh, 'auth', 'login', '--hostname', 'github.com', '--with-token', '--insecure-storage', input=token + '\n')
        token_copy = env.home / '.config' / 'gh' / 'hosts.yml'
        if token_copy.exists():
            os.chmod(token_copy, 0o600)
    try:
        login = env.run(gh, 'api', 'user', '--jq', '.login').stdout.strip()
        if not check(bool(login), f'GitHub CLI is signed in ({login or "no"})'):
            return 1
        if not check(env.run(gh, 'repo', 'view', slug).returncode != 0, f'{slug} does not exist yet (the test creates it)'):
            return 1
        public_work = shared_snapshot(env)
        env.run('git', 'clone', '-q', env.public, env.clone, check_rc=0)
        args = ['setup-attendee', '--private-repo', slug, '--create', '--json', '--public-url', env.public.as_uri()]
        args += ['--weekly', 'both'] if schedule else ['--no-schedule']
        r = env.sync(*args)
        (env.root / 'setup-report.json').write_text(r.stdout or '', encoding='utf-8')  # to read with --keep
        try:
            report = json.loads(r.stdout)
        except ValueError:
            report = {}
            print(r.stdout[-2000:], r.stderr[-2000:])
        check(r.returncode == 0 and report.get('ok'), f"setup-attendee succeeds ({[p['step'] for p in report.get('problems', [])]})")
        view = json.loads(env.run(gh, 'repo', 'view', slug, '--json', 'isPrivate').stdout or '{}')
        check(view.get('isPrivate') is True, f'{slug} exists and is private')
        if schedule:
            check(job_registered('sync') and job_registered('miner'), 'the daily sync and the weekly backup are registered (test names)')
            if sys.platform == 'darwin':  # launchd runs the sync once when it loads; let it finish before the next sync
                end = time.time() + 120
                while time.time() < end and (len(((env.copilot / 'skills-sync.log').read_text(encoding='utf-8')
                                                   if (env.copilot / 'skills-sync.log').exists() else '').splitlines()) < 2
                                             or (env.copilot / 'skills-sync.lock').exists()):
                    time.sleep(3)
        append(env.skills / 'my-voice' / 'SKILL.md', '- Test rule from a session: keep replies under three sentences.')
        r = env.sync('sync')
        remote = env.run('git', 'ls-remote', 'origin', 'refs/heads/skill-updates', cwd=env.clone).stdout.split()
        check(r.returncode == 0 and bool(remote), f'the session edit reached skill-updates on GitHub: {r.stdout.strip()[-160:]}')
        append(public_work / 'my-voice' / 'SKILL.md', '- Shared update: a new channel pattern.')
        append(public_work / 'autonomous-demos' / 'SKILL.md', '- Shared update: a new demo rule.')
        env.run('git', 'commit', '-q', '-am', 'Shared update', cwd=public_work, check_rc=0)
        env.run('git', 'push', '-q', env.public, 'main', cwd=public_work, check_rc=0)
        r = env.runner('--dry-run')
        check(r.returncode == 0 and 'Your review: opened' in r.stdout and 'Updates from the shared skills: opened' in r.stdout,
              f'runner --dry-run opened both pull requests: {r.stdout.strip()[:300]}')
        prs = json.loads(env.run(gh, 'pr', 'list', '--repo', slug, '--json', 'number,headRefName,url').stdout or '[]')
        check({p['headRefName'] for p in prs} >= {'skill-updates', 'upstream-updates'},
              'open on GitHub: ' + ', '.join(f"{p['headRefName']} {p['url']}" for p in prs))
    finally:
        if schedule:
            env.sync('schedule', '--remove')
            env.runner('--uninstall')
            check(not job_registered('sync') and not job_registered('miner'), 'the test jobs are removed')
        if token_copy and token_copy.exists():
            token_copy.unlink()
    print(f"\n{'all checks passed' if not FAILED else f'{len(FAILED)} check(s) failed'}")
    return 1 if FAILED else 0


def run_checks(env):
    public_work = shared_snapshot(env)
    env.run('git', 'clone', '-q', env.public, env.clone, check_rc=0)

    # The dry run lists every change and makes none
    origin_before = env.git('-C', env.clone, 'config', '--get', 'remote.origin.url')
    r = env.sync('setup-attendee', '--private-repo', SLUG, '--create', '--json', '--dry-run', '--public-url',
                 env.public.as_uri())
    plan = ' '.join(json.loads(r.stdout or '{}').get('plan', []))
    check(r.returncode == 0 and all(t in plan for t in ('Create tester/skills-copy', 'gh auth setup-git', 'Schedule the daily sync'))
          and re.search(r'Install \d+ skill', plan) is not None
          and ('Background Items Added' in plan or sys.platform != 'darwin'),
          'setup-attendee --dry-run lists the new repo, gh auth setup-git, the install, and the daily job')
    check(not env.private.exists() and not (env.copilot / 'skills-sync.json').exists() and not env.skills.exists()
          and env.git('-C', env.clone, 'config', '--get', 'remote.origin.url') == origin_before
          and not env.git('-C', env.clone, 'config', '--get', 'remote.public.url'),
          'and changes nothing')

    # Setup
    r = env.sync('setup-attendee', '--private-repo', SLUG, '--create', '--json', '--no-schedule', '--public-url',
                 env.public.as_uri())
    try:
        report = json.loads(r.stdout)
    except ValueError:
        report = {}
        print(r.stdout[-2000:], r.stderr[-2000:])
    check(r.returncode == 0 and report.get('ok'), f"setup-attendee succeeds ({[p['step'] for p in report.get('problems', [])]})")
    check(report.get('private_repo_created') and env.private.is_dir(), 'the private copy was created')
    check(env.git('-C', env.clone, 'symbolic-ref', '--short', 'HEAD') == 'skill-updates', 'the clone is on skill-updates')
    check(env.git('-C', env.clone, 'config', '--get', 'remote.public.pushurl') == 'no_push', 'pushes to the shared repo are off')
    check(env.bare_git(env.private, 'show', 'main:.publishignore').startswith('# This repo is a private copy'),
          'main of the private copy marks it private (.publishignore)')
    check((env.skills / 'my-voice' / 'SKILL.md').is_file() and 'my-voice' in report.get('installed', []), 'the skills are installed')
    template = report.get('schedule', {}).get('weekly', {}).get('automation', {}).get('configureAutomation', {})
    check(template.get('sessionTemplate', {}).get('config') == {'mode': 'autopilot', 'autoApprove': 'autoApprove'}
          and template.get('target', {}).get('folderUri', '').startswith('file:'), 'the weekly automation input is complete')
    status = json.loads(env.sync('status', '--json').stdout or '{}')
    check(status.get('mode') == 'attendee' and status.get('branch') == 'skill-updates', 'status --json shows attendee mode')
    main_before = env.bare_git(env.private, 'rev-parse', 'main')

    # A session edits two installed skills; the sync harvests them onto skill-updates
    append(env.skills / 'my-voice' / 'SKILL.md', '- Test rule from a session: keep replies under three sentences.')
    append(env.skills / 'autonomous-runs' / 'SKILL.md', '- Test rule from a session: name the status file after the project.')
    r = env.sync('sync')
    check(r.returncode == 0, f'sync after a session edit: {r.stdout.strip()[-200:]}')
    review_tip = env.bare_git(env.private, 'rev-parse', 'skill-updates')
    check(bool(review_tip) and 'keep replies under three sentences' in env.bare_git(env.private, 'show', 'skill-updates:my-voice/SKILL.md'),
          'the edit is on skill-updates in the private copy')
    check(env.bare_git(env.private, 'rev-parse', 'main') == main_before, 'main did not change')
    env.sync('install')
    check('keep replies under three sentences' in (env.skills / 'my-voice' / 'SKILL.md').read_text(encoding='utf-8'),
          'an install keeps the edit that waits for review')

    # The review pull request
    r = env.sync('review-pr', '--json')
    out = json.loads(r.stdout or '{}')
    check(out.get('action') == 'opened' and out.get('number') == 1, f'review-pr opens the pull request ({out})')
    check('my-voice' in env.gh_state()['prs'][0]['body'], 'the description lists the changed skills')

    # The shared repo updates my-voice and autonomous-demos; the upstream pull request keeps your my-voice
    append(public_work / 'my-voice' / 'SKILL.md', '- Shared update: a new channel pattern.')
    append(public_work / 'autonomous-demos' / 'SKILL.md', '- Shared update: a new demo rule.')
    env.run('git', 'commit', '-q', '-am', 'Shared update', cwd=public_work, check_rc=0)
    env.run('git', 'push', '-q', env.public, 'main', cwd=public_work, check_rc=0)
    r = env.sync('upstream-pr', '--json')
    out = json.loads(r.stdout or '{}')
    check(out.get('action') == 'opened' and out.get('kept') == ['my-voice/SKILL.md'] and not out.get('conflicts'),
          f'upstream-pr opens the pull request and keeps your my-voice ({out.get("action")}, kept {out.get("kept")})')
    check('Shared update: a new demo rule' in env.bare_git(env.private, 'show', 'upstream-updates:autonomous-demos/SKILL.md')
          and 'Shared update' not in env.bare_git(env.private, 'show', 'upstream-updates:my-voice/SKILL.md'),
          'upstream-updates has the shared demo rule, not the shared my-voice change')

    # You merge the upstream pull request (a merge commit), then the review pull request (a squash)
    env.on_github(('merge', '--no-ff', '-q', '-m', 'Merge pull request #2', 'origin/upstream-updates'))
    env.set_pr(2, state='MERGED')
    r = env.sync('sync')
    check(r.returncode == 0 and 'Shared update: a new demo rule' in (env.skills / 'autonomous-demos' / 'SKILL.md').read_text(encoding='utf-8'),
          'after the upstream merge, the sync installs the shared update')
    check('keep replies under three sentences' in (env.skills / 'my-voice' / 'SKILL.md').read_text(encoding='utf-8'),
          'and the edit waiting for review stays installed')
    env.on_github(('merge', '--squash', '-q', 'origin/skill-updates'), ('commit', '-q', '-m', 'Skill updates (#1)'))
    env.set_pr(1, state='MERGED')
    r = env.sync('sync')
    check(env.bare_git(env.private, 'rev-parse', 'skill-updates') == env.bare_git(env.private, 'rev-parse', 'main'),
          f'after the squash merge, skill-updates follows main again ({r.stdout.strip()[-160:]})')

    # A closed pull request drops its changes, saved on a declined/ branch first
    append(env.skills / 'autonomous-variations' / 'SKILL.md', '- Test rule I will decline.')
    env.sync('sync')
    out = json.loads(env.sync('review-pr', '--json').stdout or '{}')
    check(out.get('action') == 'opened', f'a second review pull request ({out.get("action")})')
    env.set_pr(out.get('number'), state='CLOSED', headRefOid=env.bare_git(env.private, 'rev-parse', 'skill-updates'))
    sync_state = env.state / 'sync-state.json'
    data = json.loads(sync_state.read_text(encoding='utf-8'))
    data['review_checked'] = '2000-01-01'
    sync_state.write_text(json.dumps(data), encoding='utf-8')
    r = env.sync('sync')
    declined = env.bare_git(env.private, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/declined/')
    check(bool(declined) and env.bare_git(env.private, 'rev-parse', 'skill-updates') == env.bare_git(env.private, 'rev-parse', 'main'),
          f'closing it put skill-updates back on main and saved it on {declined or "nothing"}')
    check('Test rule I will decline' not in (env.skills / 'autonomous-variations' / 'SKILL.md').read_text(encoding='utf-8'),
          'and the declined edit is no longer installed')

    # The weekly runner without the model: pushes and opens the pull requests
    append(env.skills / 'autonomous-demos' / 'SKILL.md', '- Test rule for the dry run.')
    env.sync('sync')
    r = env.runner('--dry-run')
    check(r.returncode == 0 and 'Your review: opened' in r.stdout, f'runner --dry-run opens the review pull request ({r.stdout.strip()[-300:]})')

    # An automation run: --automation, the agent's part, --finish
    r = env.runner('--automation')
    folder = next((line.split(': ', 1)[1] for line in r.stdout.splitlines() if line.startswith('- Run folder: ')), '')
    check(r.returncode == 0 and folder and '--finish' in r.stdout and 'Mode: attendee' in r.stdout,
          'runner --automation prints the prompt, the paths, and the finish step')
    run_dir = Path(folder.replace('~', str(env.home), 1)) if folder.startswith('~') else Path(folder)
    info = json.loads((run_dir / 'run.json').read_text(encoding='utf-8'))
    for n in (1, 2):
        append(env.clone / 'autonomous-runs' / 'SKILL.md', f'- Weekly test rule {n}.')
        env.run('git', 'commit', '-q', '-am', f'Miner commit {n}', cwd=env.clone, check_rc=0)
    (run_dir / 'commit-message.txt').write_text('Weekly skill update, week of the test\n\n- autonomous-runs: two test rules\n',
                                                encoding='utf-8')
    state_file = env.state / 'state.json'
    state = json.loads(state_file.read_text(encoding='utf-8')) if state_file.exists() else {}
    state.update(last_run=info['window_end'], last_mined_through=info['window_end'])
    state_file.write_text(json.dumps(state), encoding='utf-8')
    r = env.runner('--finish', run_dir)
    tip = env.bare_git(env.private, 'rev-parse', 'skill-updates')
    check(r.returncode == 0 and env.bare_git(env.private, 'log', '-1', '--format=%s', 'skill-updates') == 'Weekly skill update, week of the test'
          and env.bare_git(env.private, 'rev-parse', f'{tip}^') == info['start_head'],
          f'runner --finish pushes the run as one commit ({r.stdout.strip()[-300:]})')
    check(any(pr['title'] == 'Weekly skill update, week of the test' and pr['state'] == 'OPEN' for pr in env.gh_state()['prs']),
          'and the review pull request carries the run summary')
    check(not (env.state / 'lock').exists(), 'the run lock is released')

    # --check-run reads a run's log
    sessions = env.copilot / 'session-state'
    good, bad = sessions / 'good-run', sessions / 'bad-run'
    for folder_path, completed in ((good, True), (bad, False)):
        folder_path.mkdir(parents=True, exist_ok=True)
        events = [{'type': 'session.start', 'data': {'selectedModel': 'claude-opus-5.5', 'contextTier': 'long_context'}},
                  {'type': 'user.message', 'data': {'content': '[weekly-skill-miner] Weekly skill update. Run it.',
                                                    'responsesReasoning': {'model': 'claude-opus-5.5', 'effort': 'max'}}},
                  {'type': 'permission.requested', 'data': {'requestId': 'r1'}}]
        if completed:
            events.append({'type': 'permission.completed', 'data': {'requestId': 'r1', 'result': {'kind': 'approved'},
                                                                    'decisionSource': 'host_policy'}})
        (folder_path / 'events.jsonl').write_text(''.join(json.dumps(e) + '\n' for e in events), encoding='utf-8')
        time.sleep(0.05)
    check(env.runner('--check-run', 'good-run').returncode == 0, '--check-run passes a run at max effort with every approval answered')
    r = env.runner('--check-run', 'bad-run', '--json')
    check(r.returncode == 1 and json.loads(r.stdout)['permissions']['waiting'] == 1, '--check-run fails a run waiting for an approval')

    # The maintainer setup is never replaced
    settings = env.copilot / 'skills-sync.json'
    saved = settings.read_text(encoding='utf-8')
    settings.write_text(json.dumps({'private_url': 'https://github.com/someone/private.git', 'private_user': 'someone'}),
                        encoding='utf-8')
    check(env.sync('setup-attendee', '--json').returncode == 2, 'setup-attendee refuses on a machine with the maintainer setup')
    settings.write_text(saved, encoding='utf-8')

    print(f"\n{'all checks passed' if not FAILED else f'{len(FAILED)} check(s) failed'}")
    return 1 if FAILED else 0


if __name__ == '__main__':
    sys.exit(main())

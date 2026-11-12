#!/usr/bin/env python3
"""Make, install, start and stop the person's private copy of the workshop practice repo.

  practice-repo.py copy    [--name NAME] [--owner LOGIN] [--account LOGIN] [--dir DIR] [--template OWNER/REPO]
                           [--method auto|template|push] [--dry-run] [--json]
  practice-repo.py install [--dir DIR] [--json]
  practice-repo.py start   [--dir DIR] [--port N|LOW-HIGH] [--timeout SECONDS] [--json]
  practice-repo.py stop    [--dir DIR] [--json]
  practice-repo.py status  [--dir DIR] [--json]

copy makes <owner>/<name> on GitHub as a PRIVATE repo from the template in references/workshop.json, with every
branch, and clones it to --dir (default ~/Code/<name>). GitHub builds a template copy one branch at a time, so copy
waits until the copy has every branch the template has and the same default branch, then clones on that branch,
sets origin/HEAD, fetches once more and checks the clone before it reports ok. --method template uses GitHub's
template copy (gh repo create --template --include-all-branches). push makes an empty private repo and pushes one
commit per template branch: the branch's files, as in a template copy, minus .github/workflows, because pushing
workflow files needs a token with the workflow scope, which GitHub CLI doesn't ask for by default. That route also
works for Microsoft-managed (EMU) accounts, which cannot fork from outside their enterprise. auto (the default) tries
template, then push. An existing private repo with commits is reused; a public one is never touched. --account picks
the GitHub CLI account when more than one is signed in, without switching the active one; the clone then always
pushes as that account (a credential helper for that one URL). The clone also gets a fetch-only remote, "workshop",
for the template, so checkpoint branches can be fetched again later.

install, start and stop run the repo's own commands with Yarn 1 (the one on PATH, or npx yarn@1.22.22, which the
repo's .npmrc fetches through Microsoft's package feed): yarn install; yarn workshop:start --detach, which picks a
free port (3001 to 3099 unless --port says otherwise) and starts it in the background without opening a browser,
after which this waits until the page serves; and yarn workshop:stop. status says whether it still serves. Output
goes to log files under ~/.copilot/workshop-setup/logs, never to a pipe a background server could hold open.

Nothing prompts (git and gh run with prompts off) and the GitHub token stays in memory, never printed.
Exit codes: 0 ok, 1 error, 2 usage error.
"""
import argparse
import json
import os
import re
import signal
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import setuplib as L  # noqa: E402

WS = L.load_workshop()
P = WS['practice']
SERVER = L.STATE_DIR / 'practice-server.json'
LOGS = L.STATE_DIR / 'logs'


class Fail(Exception):
    pass


def need(name):
    path = L.which(name)
    if not path:
        raise Fail('%s is not installed (run the machine step first)' % name)
    return path


def emit(result, as_json):
    text = json.dumps(result, indent=1, default=str)
    if as_json:
        print(L.redact(text))
    else:
        for key, value in result.items():
            print('%s: %s' % (key, L.redact(json.dumps(value, default=str) if isinstance(value, (list, dict)) else str(value))))


def helper_command(gh, user):
    """A git credential helper that answers with GitHub CLI's token for one account (the skills sync uses the same)."""
    quoted = "'" + gh.replace("'", "'\\''") + "'"
    return ('!f() { test "$1" = get || exit 0; echo username=x-access-token; '
            'echo "password=$(%s auth token --hostname github.com --user %s)"; }; f' % (quoted, user))


def account_env(gh, account):
    """gh and git as one account, without changing which account is active. The token never leaves this process."""
    env = dict(L.ENV)
    if account:
        for key in ('GH_TOKEN', 'GITHUB_TOKEN'):
            env.pop(key, None)
        code, token, err = L.run([gh, 'auth', 'token', '--hostname', 'github.com', '--user', account], env=env)
        if code != 0 or not token.strip():
            raise Fail('GitHub CLI has no sign-in for %s (gh auth login, in their own terminal)' % account)
        env['GH_TOKEN'] = token.strip()
    return env


def git_auth(gh, account):
    helper = helper_command(gh, account) if account else "!'%s' auth git-credential" % gh.replace("'", "'\\''")
    return ['-c', 'credential.helper=', '-c', 'credential.helper=' + helper]


def error_line(text):
    """The line that says what went wrong: a rejected ref, then an error: or fatal: line, then the first line."""
    lines = [line.strip() for line in (text or '').splitlines() if line.strip()]
    for wanted in (lambda line: '[remote rejected]' in line or '[rejected]' in line,
                   lambda line: line.startswith(('error:', 'fatal:'))):
        hit = next((line for line in lines if wanted(line)), None)
        if hit:
            return hit
    return lines[0] if lines else ''


def check(cmd, env=None, timeout=300, cwd=None, what=None):
    code, out, err = L.run(cmd, timeout=timeout, env=env, cwd=cwd)
    if code != 0:
        raise Fail('%s failed: %s' % (what or ' '.join(str(c) for c in cmd[:3]), L.redact(error_line(err + '\n' + out))))
    return out


def git_input(git, args, data, env=None, timeout=120):
    """git with bytes on stdin (mktree); returns stdout as text. Raises Fail with git's own error line."""
    try:
        r = subprocess.run([git, *[str(a) for a in args]], input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                           env=env or L.ENV, timeout=timeout, **L.NOWINDOW)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise Fail('git %s failed: %s' % (args[0], error))
    if r.returncode != 0:
        raise Fail('git %s failed: %s' % (' '.join(str(a) for a in args[:3]),
                                           error_line(r.stderr.decode('utf-8', 'replace'))))
    return r.stdout.decode('utf-8', 'replace').strip()


def tree_entries(git, bare, tree):
    """[(mode, type, sha, name)] of one tree, read NUL-separated so any file name survives."""
    r = subprocess.run([git, '--git-dir', str(bare), 'ls-tree', '-z', tree], stdin=subprocess.DEVNULL,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=L.ENV, timeout=120, **L.NOWINDOW)
    if r.returncode != 0:
        raise Fail('git ls-tree failed: %s' % error_line(r.stderr.decode('utf-8', 'replace')))
    out = []
    for record in r.stdout.split(b'\0'):
        if record:
            meta, name = record.split(b'\t', 1)
            mode, kind, sha = meta.split(b' ')
            out.append((mode, kind, sha, name))
    return out


def make_tree(git, bare, entries):
    data = b''.join(b'%s %s %s\t%s\0' % entry for entry in entries)
    return git_input(git, ['--git-dir', bare, 'mktree', '-z'], data)


def without_workflows(git, bare, tree):
    """The same tree without .github/workflows. Pushing workflow files needs a token with the workflow scope, which
    GitHub CLI doesn't ask for by default, and the copy doesn't need Excalidraw's CI anyway."""
    top = tree_entries(git, bare, tree)
    dot_github = next((e for e in top if e[3] == b'.github' and e[1] == b'tree'), None)
    if not dot_github:
        return tree
    inside = tree_entries(git, bare, dot_github[2].decode())
    keep = [e for e in inside if e[3] != b'workflows']
    if len(keep) == len(inside):
        return tree
    rest = [e for e in top if e is not dot_github]
    if keep:
        rest.append((dot_github[0], b'tree', make_tree(git, bare, keep).encode(), b'.github'))
    return make_tree(git, bare, rest)


def snapshot_commits(git, bare, author):
    """One commit per branch of the bare clone: the branch's files without .github/workflows, "Initial commit" like a
    template copy, by the person, dated like the branch's tip so a rerun makes the very same commits."""
    names = check([git, '--git-dir', bare, 'for-each-ref', '--format=%(refname:short)', 'refs/heads'], timeout=60)
    commits = {}
    for branch in [n.strip() for n in names.splitlines() if n.strip()]:
        tree = without_workflows(git, bare, check([git, '--git-dir', bare, 'rev-parse', branch + '^{tree}'], timeout=60))
        date = check([git, '--git-dir', bare, 'log', '-1', '--format=%cI', branch], timeout=60).strip()
        env = dict(L.ENV, GIT_AUTHOR_NAME=author[0], GIT_AUTHOR_EMAIL=author[1], GIT_COMMITTER_NAME=author[0],
                   GIT_COMMITTER_EMAIL=author[1], GIT_AUTHOR_DATE=date, GIT_COMMITTER_DATE=date)
        commits[branch] = check([git, '--git-dir', bare, 'commit-tree', tree, '-m', 'Initial commit'], env=env,
                                timeout=60).strip()
    return commits


def repo_view(gh, full, env):
    code, out, err = L.run([gh, 'repo', 'view', full, '--json', 'visibility,isEmpty,defaultBranchRef'], env=env, timeout=60)
    if code != 0:
        if re.search(r'Could not resolve|not found|404', err, re.I):
            return None
        raise Fail('gh repo view %s failed: %s' % (full, L.first_line(err)))
    return json.loads(out)


def branch_names(gh, full, env):
    """The branch names of a GitHub repo, or None when it can't be read (a private template without access)."""
    code, out, _ = L.run([gh, 'api', '--paginate', 'repos/%s/branches?per_page=100' % full, '--jq', '.[].name'], env=env,
                         timeout=120)
    return sorted({line.strip() for line in out.splitlines() if line.strip()}) if code == 0 else None


def wait_for_copy(gh, full, template, env, timeout=300):
    """GitHub fills a copy made from a template one branch at a time, and until it's done the copy's default branch
    can point at one of the others. Wait until it has every branch the template has and the template's default
    branch. Returns (default branch, branch names)."""
    want = branch_names(gh, template, env) or []
    want_default = ((repo_view(gh, template, env) or {}).get('defaultBranchRef') or {}).get('name') or 'main'
    started = time.time()
    deadline = started + timeout
    while True:
        have = branch_names(gh, full, env) or []
        default = ((repo_view(gh, full, env) or {}).get('defaultBranchRef') or {}).get('name')
        missing = [b for b in want if b not in have]
        if have and not missing and default == want_default:
            return want_default, have, round(time.time() - started)
        if time.time() > deadline:
            raise Fail('GitHub is still building %s after %d s (missing %s; default branch %s). Run copy again in a '
                       'minute; it picks up where it stopped.' % (full, timeout, ', '.join(missing) or 'none',
                                                                    default or 'not set'))
        time.sleep(3)


def push_snapshots(gh, git, auth, bare, full, commits, env):
    """Push the snapshot commits: main first, then, once GitHub shows main as the default branch, the rest in one
    push. A brand-new repo can refuse a push for a moment ("[remote rejected] ... (failed)"), so retry that a few
    times. The commits are the same on every run and nothing is forced, so a retry or a rerun only adds what's missing
    and never overwrites anyone's work."""
    url = 'https://github.com/%s.git' % full
    order = sorted(commits, key=lambda b: (b != 'main', b))
    for number, batch in enumerate((order[:1], order[1:])):
        if not batch:
            continue
        if number == 1:
            for _ in range(20):
                if ((repo_view(gh, full, env) or {}).get('defaultBranchRef') or {}).get('name') == order[0]:
                    break
                time.sleep(3)
        for attempt in range(4):
            code, out, err = L.run([git, *auth, '--git-dir', bare, 'push', '--quiet', url] +
                                   ['%s:refs/heads/%s' % (commits[b], b) for b in batch], env=env, timeout=900)
            if code == 0:
                break
            line = error_line(err + '\n' + out)
            transient = code == 124 or any(t in line for t in ('(failed)', 'hung up', 'RPC failed', 'unexpected disconnect'))
            if not transient or attempt == 3:
                raise Fail('pushing to %s failed: %s. Run copy again with --method push to finish it; it pushes the same '
                           'commits and only adds what is missing.' % (full, L.redact(line)))
            time.sleep(5 * (attempt + 1))


def parse_github(url):
    m = re.search(r'github\.com[:/]+([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:\.git)?/?$', url or '')
    return '%s/%s' % (m.group(1), m.group(2)) if m else None


def cmd_copy(args):
    gh, git = need('gh'), need('git')
    env = account_env(gh, args.account)
    who = check([gh, 'api', 'user', '--jq', '[.login, (.id | tostring), (.name // "")] | @tsv'], env=env, timeout=60,
                what='gh api user').strip().split('\t')
    login = who[0]
    author = ((who[2] if len(who) > 2 and who[2] else login), '%s+%s@users.noreply.github.com' % (who[1], login))
    name = args.name or P['repo_name']
    owner = args.owner or login
    full = '%s/%s' % (owner, name)
    template = args.template or P['template']
    dest = (L.expand(args.dir) if args.dir else L.expand(P['dir']).parent / name).resolve()
    result = {'repo': full, 'url': 'https://github.com/%s' % full, 'dir': L.tilde(dest), 'account': login,
              'template': template}
    if full.lower() == template.lower():
        raise Fail('%s is the template itself; pick another --name (or --owner) for the copy' % full)
    if 'onedrive' in str(dest).lower():
        raise Fail('%s is in a OneDrive folder, which would sync tens of thousands of files from node_modules. Use a '
                   'folder outside OneDrive, like ~/Code/%s' % (L.tilde(dest), name))

    existing = repo_view(gh, full, env)
    if existing and existing.get('visibility') != 'PRIVATE':
        raise Fail('%s already exists and is %s. Pick another name; this never touches a repo that is not private.'
                   % (full, str(existing.get('visibility')).lower()))
    if dest.exists() and any(dest.iterdir()):
        origin = L.run([git, '-C', dest, 'remote', 'get-url', 'origin'], timeout=10)[1]
        if parse_github(origin) and parse_github(origin).lower() != full.lower():
            raise Fail('%s already holds %s. Pick another folder with --dir.' % (L.tilde(dest), parse_github(origin)))
        if not (dest / '.git').exists():
            raise Fail('%s exists and is not empty. Pick another folder with --dir.' % L.tilde(dest))
    plan = 'reuse' if existing and not existing.get('isEmpty') else ('push' if existing else args.method)
    if plan == 'reuse' and args.method == 'push':
        plan = 'push'  # finish a push copy that stopped partway: same commits, only what's missing is added
    result['plan'] = plan
    if args.dry_run:
        result.update({'ok': True, 'dry_run': True, 'exists_on_github': bool(existing), 'clone_exists': (dest / '.git').exists()})
        return result

    method = plan
    if plan in ('auto', 'template'):
        code, out, err = L.run([gh, 'repo', 'create', full, '--private', '--template', template, '--include-all-branches'],
                               env=env, timeout=180)
        if code == 0:
            method = 'template'
        elif plan == 'template':
            raise Fail('copying the template failed: %s' % L.first_line(err or out))
        else:
            result['template_error'] = L.redact(L.first_line(err or out))
            method = 'push'
    if method == 'push':
        if not repo_view(gh, full, env):
            check([gh, 'repo', 'create', full, '--private'], env=env, timeout=120, what='gh repo create --private')
        scratch = L.STATE_DIR / 'tmp' / ('template-%s.git' % L.stamp())
        scratch.parent.mkdir(parents=True, exist_ok=True)
        try:
            auth = git_auth(gh, args.account)
            check([git, *auth, 'clone', '--bare', '--quiet', 'https://github.com/%s.git' % template, scratch], env=env,
                  timeout=900, what='cloning the template (it has to be public, or shared with this account)')
            # One snapshot commit per branch (--git-dir names the bare clone explicitly, which
            # safe.bareRepository=explicit, a common hardening, allows).
            push_snapshots(gh, git, auth, scratch, full, snapshot_commits(git, scratch, author), env)
        finally:
            L.rmtree(scratch)
    result['method'] = method

    view = repo_view(gh, full, env)
    if not view or view.get('visibility') != 'PRIVATE':
        raise Fail('%s is not private after the copy; stop and check it on GitHub' % full)
    if method == 'push':
        want_default = ((repo_view(gh, template, env) or {}).get('defaultBranchRef') or {}).get('name') or 'main'
        if (view.get('defaultBranchRef') or {}).get('name') != want_default:
            check([gh, 'repo', 'edit', full, '--default-branch', want_default], env=env, timeout=60,
                  what='setting the default branch')
    if method in ('template', 'push'):
        default, remote_branches, result['waited_for_github'] = wait_for_copy(gh, full, template, env)
    else:  # an existing copy: it may have branches of its own, so only its default branch matters
        default = (view.get('defaultBranchRef') or {}).get('name') or 'main'
        remote_branches = branch_names(gh, full, env) or []
    url = 'https://github.com/%s.git' % full
    auth = git_auth(gh, args.account)
    fresh = not (dest / '.git').exists()
    if fresh:
        dest.parent.mkdir(parents=True, exist_ok=True)
        check([git, *auth, 'clone', '--quiet', '--branch', default, url, dest], env=env, timeout=1800, what='git clone')
    check([git, *auth, '-C', dest, 'fetch', '--quiet', 'origin'], env=env, timeout=600, what='git fetch')
    check([git, *auth, '-C', dest, 'remote', 'set-head', 'origin', '--auto'], env=env, timeout=120,
          what='git remote set-head')
    current = L.run([git, '-C', dest, 'rev-parse', '--abbrev-ref', 'HEAD'], timeout=10)[1]
    if fresh and current != default:
        raise Fail('the new clone is on %s, not %s; check %s' % (current, default, L.tilde(dest)))
    if args.account:
        key = 'credential.%s.helper' % url
        L.run([git, '-C', dest, 'config', '--local', '--unset-all', key], timeout=10)
        check([git, '-C', dest, 'config', '--local', '--add', key, ''], timeout=10)
        check([git, '-C', dest, 'config', '--local', '--add', key, helper_command(gh, args.account)], timeout=10)
    remotes = L.run([git, '-C', dest, 'remote'], timeout=10)[1].split()
    if 'workshop' not in remotes:
        check([git, '-C', dest, 'remote', 'add', 'workshop', 'https://github.com/%s.git' % template], timeout=10)
    check([git, '-C', dest, 'remote', 'set-url', '--push', 'workshop', 'DISABLED'], timeout=10)
    if L.IS_WIN:
        L.run([git, '-C', dest, 'config', '--local', 'core.longpaths', 'true'], timeout=10)
    branches = sorted(b.strip().replace('origin/', '', 1) for b in L.run([git, '-C', dest, 'branch', '-r'], timeout=10)[1]
                      .splitlines() if b.strip().startswith('origin/') and '->' not in b)
    missing = [b for b in remote_branches if b not in branches]
    if missing:
        raise Fail('the clone is missing %s from GitHub; run copy again to fetch them' % ', '.join(missing))
    origin_head = L.run([git, '-C', dest, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], timeout=10)[1]
    L.set_answers(practice_repo=full, practice_dir=str(dest), practice_account=login, practice_method=method)
    result.update({'ok': True, 'private': True, 'default_branch': default, 'checked_out': current,
                   'origin_head': origin_head, 'branches': branches,
                   'head': L.run([git, '-C', dest, 'log', '-1', '--format=%h %s'], timeout=10)[1]})
    return result


def practice_dir(args):
    state = L.load_state()
    d = L.expand(getattr(args, 'dir', None) or state['answers'].get('practice_dir') or P['dir']).resolve()
    if not (d / 'package.json').is_file():
        raise Fail('no practice repo at %s (run copy first, or pass --dir)' % L.tilde(d))
    return d


def yarn_cmd():
    """Yarn 1: the one on PATH, or npx yarn@<version>, which the repo's .npmrc fetches through the package feed."""
    yarn = L.which('yarn')
    if yarn:
        code, out, _ = L.run([yarn, '--version'], timeout=120, cwd=L.HOME)
        if code == 0 and out.strip().startswith('1.'):
            return [yarn]
    npx = L.which('npx')
    if not npx:
        raise Fail('neither Yarn 1 nor npx is installed (run the machine step first)')
    return [npx, '--yes', 'yarn@%s' % P.get('yarn', '1.22.22')]


def display(cmd):
    return ' '.join([Path(cmd[0]).stem] + [str(c) for c in cmd[1:]])


def log_tail(path, lines=15):
    try:
        text = Path(path).read_text(encoding='utf-8', errors='replace')
    except OSError:
        return ''
    return L.redact('\n'.join(text.strip().splitlines()[-lines:]))


def run_logged(cmd, cwd, name, timeout):
    """Run a command with its output in a log file, never a pipe: a server it leaves running in the background could
    otherwise hold the pipe open and keep this command from returning."""
    LOGS.mkdir(parents=True, exist_ok=True)
    log = LOGS / ('%s-%s.log' % (name, L.stamp()))
    started = time.time()
    with open(log, 'wb') as handle:
        try:
            proc = subprocess.Popen(cmd, cwd=str(cwd), stdin=subprocess.DEVNULL, stdout=handle, stderr=subprocess.STDOUT,
                                    env=dict(L.ENV, BROWSER='none'), **L.spawn_kwargs())
        except OSError as error:
            raise Fail('could not run %s: %s' % (cmd[0], error))
        try:
            code = proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            L.kill_tree(proc.pid)  # stop yarn and everything it started, not just the shim
            code = 124
    return code, log, round(time.time() - started)


def cmd_install(args):
    d = practice_dir(args)
    need('node')
    cmd = yarn_cmd() + list(P.get('install') or ['install'])
    code, log, seconds = run_logged(cmd, d, 'install', 1800)
    if code != 0:
        raise Fail('%s failed after %ds (log %s):\n%s' % (display(cmd), seconds, L.tilde(log), log_tail(log)))
    return {'ok': True, 'dir': L.tilde(d), 'command': display(cmd), 'seconds': seconds, 'log': L.tilde(log)}


def listening(port):
    if not port:
        return False
    for host in ('127.0.0.1', '::1'):
        try:
            with socket.create_connection((host, int(port)), timeout=0.3):
                return True
        except (OSError, ValueError):
            pass
    return False


def serving(url, marker):
    try:
        with urllib.request.urlopen(url, timeout=3) as response:
            body = response.read(400000).decode('utf-8', 'replace').lower()
            return response.status == 200 and (not marker or marker.lower() in body)
    except Exception:  # noqa: BLE001 - not up yet
        return False


def pid_alive(pid):
    if not pid:
        return False
    if L.IS_WIN:
        code, out, _ = L.run(['tasklist', '/FI', 'PID eq %d' % int(pid), '/FO', 'CSV', '/NH'], timeout=20)
        return code == 0 and '"%d"' % int(pid) in out
    try:
        os.kill(int(pid), 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def helper_state(d):
    """What the repo's start helper recorded about the copy it started from this folder (url, port, pid)."""
    return L.read_json(d / P.get('server_file', '.workshop/server.json'))


def cmd_start(args):
    d = practice_dir(args)
    scripts = (L.read_json(d / 'package.json', {}) or {}).get('scripts') or {}
    if P['start'][0] not in scripts:
        raise Fail('%s has no "%s" script; is this the workshop repo?' % (L.tilde(d), P['start'][0]))
    cmd = yarn_cmd() + list(P['start']) + (['--port', str(args.port)] if args.port else [])
    code, log, seconds = run_logged(cmd, d, 'start', 300)
    text = log.read_text(encoding='utf-8', errors='replace')
    state = helper_state(d) or {}
    urls = re.findall(r'https?://(?:localhost|127\.0\.0\.1):\d+/?', text)
    url = state.get('url') or (urls[-1] if urls else None)
    if code != 0 or not url:
        raise Fail('%s failed (exit %s, log %s):\n%s' % (display(cmd), code, L.tilde(log), log_tail(log)))
    waited, timeout = time.time(), args.timeout or int(P.get('start_timeout', 180))
    while not serving(url, P.get('ready_marker')):
        if time.time() - waited > timeout:
            raise Fail('%s did not serve within %ds. Stop it with: %s %s stop (log %s)'
                       % (url, timeout, L.PY, Path(__file__).name, L.tilde(log)))
        time.sleep(1)
    port = state.get('port') or int(re.search(r':(\d+)', url).group(1))
    record = {'url': url, 'port': port, 'pid': state.get('pid'), 'dir': L.tilde(d), 'command': display(cmd),
              'log': L.tilde(log), 'started': L.now()}
    L.write_atomic(SERVER, json.dumps(record, indent=1) + '\n')
    return dict(record, ok=True, seconds=seconds + round(time.time() - waited))


def recorded_dir(args):
    record = L.read_json(SERVER) or {}
    for candidate in (getattr(args, 'dir', None), record.get('dir'), L.load_state()['answers'].get('practice_dir')):
        if candidate and (L.expand(candidate) / 'package.json').is_file():
            return L.expand(candidate).resolve(), record
    return None, record


def cmd_stop(args):
    d, record = recorded_dir(args)
    state = helper_state(d) if d else None
    if not d or not (state or record):
        return {'ok': True, 'stopped': False, 'detail': 'nothing recorded as running'}
    port = (state or {}).get('port') or record.get('port')
    pid = (state or {}).get('pid') or record.get('pid')
    cmd = yarn_cmd() + list(P['stop'])
    code, log, _ = run_logged(cmd, d, 'stop', 120)
    for _ in range(20):
        if not listening(port):
            break
        time.sleep(0.5)
    fallback = False
    if listening(port) and pid_alive(pid):
        # The helper didn't stop it: stop that one process tree, and only if it is still a Node process.
        if L.IS_WIN:
            image = L.run(['tasklist', '/FI', 'PID eq %d' % int(pid), '/FO', 'CSV', '/NH'], timeout=20)[1].lower()
            if 'node' in image:
                L.run(['taskkill', '/PID', str(pid), '/T', '/F'], timeout=60)
                fallback = True
        elif 'node' in L.run(['ps', '-o', 'command=', '-p', str(pid)], timeout=10)[1].lower():
            try:
                os.kill(int(pid), signal.SIGTERM)
                fallback = True
            except OSError:
                pass
        for _ in range(20):
            if not listening(port):
                break
            time.sleep(0.5)
    if SERVER.exists():
        SERVER.unlink()
    closed = not listening(port)
    return {'ok': closed, 'stopped': True, 'port': port, 'port_closed': closed, 'helper_exit': code,
            'fallback_kill': fallback, 'log': L.tilde(log)}


def cmd_status(args):
    d, record = recorded_dir(args)
    state = (helper_state(d) if d else None) or record
    if not state or not state.get('url'):
        return {'ok': True, 'running': False}
    return {'ok': True, 'running': serving(state['url'], P.get('ready_marker')), 'url': state['url'],
            'port': state.get('port'), 'pid': state.get('pid'), 'dir': L.tilde(d) if d else record.get('dir')}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('command', choices=('copy', 'install', 'start', 'stop', 'status'))
    parser.add_argument('--name', help='repo name (default %s)' % P.get('repo_name'))
    parser.add_argument('--owner', help='GitHub owner (default: the account)')
    parser.add_argument('--account', help='GitHub CLI account to use when more than one is signed in')
    parser.add_argument('--dir', help='local folder (default ~/Code/<name>)')
    parser.add_argument('--template', help='template repo (default %s)' % P.get('template'))
    parser.add_argument('--method', choices=('auto', 'template', 'push'), default='auto')
    parser.add_argument('--port', help='start: a port, or a range like 3101-3119 (default: the helper picks 3001 to 3099)')
    parser.add_argument('--timeout', type=int, help='start: seconds to wait for the page')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args()
    commands = {'copy': cmd_copy, 'install': cmd_install, 'start': cmd_start, 'stop': cmd_stop, 'status': cmd_status}
    try:
        result = commands[args.command](args)
    except Fail as error:
        emit({'ok': False, 'error': str(error)}, args.json)
        return 1
    emit(result, args.json)
    return 0 if result.get('ok') else 1


if __name__ == '__main__':
    sys.exit(main())

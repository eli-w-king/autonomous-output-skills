#!/usr/bin/env python3
"""Check a machine for the autonomous skills and the workshop, without changing anything.

  check-setup.py [check] [--practice-dir DIR] [--format json|text] [--quick]
  check-setup.py mark STEP STATUS [--note TEXT] [--set KEY=VALUE]...
  check-setup.py tested ITEM [--note TEXT]
  check-setup.py remember --set KEY=VALUE...
  check-setup.py readiness [--out FILE] [--practice-dir DIR]
  check-setup.py state

check prints JSON (or a short list with --format text): the operating system; each tool with its version; the
GitHub CLI accounts; the VS Code Insiders settings against the workshop snippet; cloud dictation; the skills (clone,
installed copies, sync and schedules) and the weekly update; the Work IQ plugins; the Playwright MCP server; Computer
Use; Azure; a dev box that stays on; the research keys; the practice repo (later, at the workshop); the progress the
interview recorded; and a summary of what is left. Every item has a group, a "Try it" prompt where the person can
test it themselves (try_it), and tested: true once the agent recorded that test.
mark records a step the agent verified with a tool, or an answer the person gave.
  Steps: settings machine skills weekly workiq playwright computer-use dictation azure devbox research practice. Statuses: ok skipped blocked failed pending.
tested records that the person's Try-it prompt for an item worked (an item id from the check, like workiq).
remember saves answers without a step, like the values the setup prompt passes in (title, subtitle, presenter,
checkInChat, research_requested, devbox_requested). setup_mode=devbox (the prompt said "on my dev box") switches the
check to dev box mode: Google Chrome is required, the Work IQ Try-it reads instead of posting (the laptop posted the
check-in), and dictation, the weekly update, Azure and creating a dev box are not part of it. The machine never
changes the mode; os.devbox_hint only says whether this looks like a dev box.
readiness writes the checklist (Workshop readiness.md on the Desktop by default) from a fresh check plus the
recorded steps, and prints where it wrote it. state prints the recorded progress.

It never prompts, signs in, installs or changes a setting, and never prints a secret: research keys are reported by
name only, remote URLs lose any user info, GitHub CLI tokens are never requested, and the output is scanned for
anything that looks like a token before it is printed. Every command runs without stdin and with a timeout. On a Mac
without the Command Line Tools it never runs the /usr/bin git or python3 stubs, which would open an install dialog.
--quick skips the slow checks (Azure sign-in, the skills sync status, GitHub repo visibility).

Environment: COPILOT_HOME (default ~/.copilot), COPILOT_SKILLS_DIR (default $COPILOT_HOME/skills),
WORKSHOP_SETUP_DESKTOP (where readiness writes by default).
Exit codes: 0 ok, 1 error, 2 usage error.
"""
import argparse
import json
import os
import platform
import plistlib
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import setuplib as L  # noqa: E402

WS = L.load_workshop()
STEP_IDS = [s[0] for s in L.STEPS]
TITLES = {s[0]: s[1] for s in L.STEPS}
REQUIRED_STEPS = [s[0] for s in L.STEPS if s[2]]


def hint(mac='', win='', linux=''):
    return mac if L.IS_MAC else win if L.IS_WIN else linux


def item(ok, detail='', fix='', required=True, **extra):
    out = {'ok': ok, 'required': required, 'detail': detail}
    if fix and ok is not True:
        out['fix'] = fix
    out.update(extra)
    return out


def tool_version(path, args=('--version',), timeout=20):
    code, out, err = L.run([path, *args], timeout=timeout)
    return code, L.first_line(out or err)


# ---------------------------------------------------------------- machine

def check_os():
    if L.IS_MAC:
        name, version = 'macOS', platform.mac_ver()[0]
    elif L.IS_WIN:
        build = L.version_tuple(platform.version())
        name = 'Windows 11' if build and build[2] >= 22000 else 'Windows %s' % platform.release()
        version = platform.version()
    else:
        name, version = platform.system(), platform.release()
    host = platform.node() or ''
    return {'name': name, 'version': version, 'arch': platform.machine(),
            'python': '%s (%s)' % (platform.python_version(), L.tilde(sys.executable)),
            # Dev boxes are Cloud PCs named CPC-<user>-<id>. A hint for the agent only: the prompt decides the mode.
            'devbox_hint': L.IS_WIN and host.upper().startswith('CPC-')}


def devbox_mode(answers):
    """Dev box mode: the setup prompt said "on my dev box" (saved as setup_mode=devbox)."""
    return L.devbox_mode(answers or {})


def check_package_manager():
    if L.IS_MAC:
        brew = L.which('brew') or next((p for p in ('/opt/homebrew/bin/brew', '/usr/local/bin/brew') if Path(p).exists()), None)
        if not brew:
            arm = platform.machine() == 'arm64'
            return item(False, 'Homebrew is not installed', required=False, arch=platform.machine(),
                        fix='The agent downloads the signed Homebrew-<version>.pkg from the latest release at '
                            'https://github.com/Homebrew/brew/releases and opens it; the macOS Installer asks for '
                            'their password in its own window. Then the brew shellenv line goes in ~/.zprofile.'
                        if arm else
                        'Intel Mac: they run the install script in Terminal (it asks for their Mac password): '
                        '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"')
        code, line = tool_version(brew)
        return item(code == 0, line or 'Homebrew', required=False, tool='brew', path=L.tilde(brew))
    if L.IS_WIN:
        winget = L.which('winget')
        if not winget:
            return item(False, 'winget is not available', required=False,
                        fix='Install or update "App Installer" from the Microsoft Store, or use the Company Portal')
        code, line = tool_version(winget)
        return item(code == 0, 'winget %s' % line, required=False, tool='winget')
    return item(None, 'use your distribution\'s package manager', required=False)


def check_clt():
    ok = L.clt_installed()
    return item(ok, 'Command Line Tools installed' if ok else 'Command Line Tools are not installed',
                fix='xcode-select --install (macOS asks you to confirm in a dialog)')


def check_insiders():
    for app in L.insiders_app_dirs():
        pkg = L.read_json(app / 'package.json')
        if pkg and pkg.get('version'):
            product = L.read_json(app / 'product.json', {}) or {}
            cli = L.which('code-insiders')
            return item(True, 'VS Code Insiders %s' % pkg['version'], version=pkg['version'],
                        commit=(product.get('commit') or '')[:10], date=product.get('date'), path=L.tilde(app),
                        cli=L.tilde(cli) if cli else None)
    return item(False, 'VS Code Insiders is not installed',
                fix=hint(mac='brew install --cask visual-studio-code@insiders',
                         win='winget install --id Microsoft.VisualStudioCode.Insiders -e',
                         linux='https://code.visualstudio.com/insiders/'))


def check_copilot_signin(state):
    answer = str(state['answers'].get('copilot_signed_in', '')).lower()
    if answer in ('yes', 'true', 'ok'):
        return item(True, 'signed in to GitHub with Copilot in VS Code Insiders')
    if answer in ('no', 'false'):
        return item(False, 'not signed in to GitHub with Copilot in VS Code Insiders',
                    fix='Accounts menu (bottom left of VS Code Insiders) > Sign in with GitHub to use GitHub Copilot')
    return item(None, 'ask: signed in to GitHub with Copilot in VS Code Insiders?')


def check_gh():
    gh = L.which('gh')
    if not gh:
        return item(False, 'GitHub CLI is not installed',
                    fix=hint(mac='brew install gh', win='winget install --id GitHub.cli -e', linux='https://cli.github.com'))
    _, line = tool_version(gh)
    version = L.version_tuple(line)
    accounts = []
    code, out, err = L.run([gh, 'auth', 'status', '--json', 'hosts'], timeout=60)
    if code == 0 and out.startswith('{'):
        try:
            hosts = json.loads(out).get('hosts') or {}
        except ValueError:
            hosts = {}
        for host, rows in hosts.items():
            for row in rows or []:
                login = row.get('login') or ''
                accounts.append({'host': host, 'login': login, 'active': bool(row.get('active')),
                                 'state': row.get('state'), 'managed': '_' in login,
                                 'scopes': [s.strip() for s in (row.get('scopes') or '').split(',') if s.strip()]})
    else:
        # Older GitHub CLI without --json: read the text it prints (it never shows a token without --show-token).
        code, out, err = L.run([gh, 'auth', 'status', '--hostname', 'github.com'], timeout=60)
        text = '%s\n%s' % (out, err)
        for m in re.finditer(r'Logged in to (\S+) (?:account|as) ([A-Za-z0-9_-]+)', text):
            accounts.append({'host': m.group(1), 'login': m.group(2), 'active': None, 'state': 'success',
                             'managed': '_' in m.group(2), 'scopes': []})
    good = [a for a in accounts if a['state'] == 'success' and a['host'] == 'github.com']
    active = next((a['login'] for a in good if a['active']), good[0]['login'] if good else None)
    if not accounts:
        detail = 'GitHub CLI is not signed in'
    elif not good:
        detail = 'GitHub CLI needs a fresh sign-in (%s)' % ', '.join(a['login'] for a in accounts)
    else:
        detail = 'signed in as ' + ', '.join('%s%s%s' % (a['login'], ' (active)' if a['active'] else '',
                                                         '' if a['state'] == 'success' else ' (needs sign-in again)')
                                             for a in accounts)
    return item(bool(good), detail, version='.'.join(map(str, version)) if version else line, accounts=accounts,
                active=active, path=L.tilde(gh),
                fix='The agent runs gh auth login --hostname github.com --web --git-protocol https in the background, '
                    'shows the one-time code it prints and opens https://github.com/login/device; they enter the code '
                    'and approve there. Then gh auth setup-git')


def check_git():
    git = L.which('git')
    if not git:
        if L.IS_MAC and not L.clt_installed():
            return item(False, 'git needs the Command Line Tools', fix='xcode-select --install (a macOS dialog asks to confirm)')
        return item(False, 'git is not installed', fix=hint(mac='brew install git', win='winget install --id Git.Git -e'))
    _, line = tool_version(git)
    name = L.run([git, 'config', '--global', 'user.name'], timeout=10)[1]
    email = L.run([git, 'config', '--global', 'user.email'], timeout=10)[1]
    helpers = '%s\n%s' % (L.run([git, 'config', '--get-all', 'credential.https://github.com.helper'], timeout=10)[1],
                          L.run([git, 'config', '--get-all', 'credential.helper'], timeout=10)[1])
    extra = {'version': (re.search(r'\d+\.\d+\.\d+', line) or re.search(r'.*', line)).group(0),
             'identity': {'name': bool(name), 'email': bool(email)},
             'gh_credentials': 'gh auth git-credential' in helpers or 'gh.exe auth git-credential' in helpers}
    if L.IS_WIN:
        extra['longpaths'] = L.run([git, 'config', '--global', 'core.longpaths'], timeout=10)[1] == 'true'
    missing = [k for k in ('name', 'email') if not extra['identity'][k]]
    detail = 'git %s' % extra['version'] + ('; commit identity missing: %s' % ', '.join(missing) if missing else '')
    return item(not missing, detail, path=L.tilde(git),
                fix='git config --global user.name "<their name>" and git config --global user.email '
                    '"<id>+<login>@users.noreply.github.com" (gh api user --jq .id gives the id)', **extra)


def check_node():
    node = L.which('node')
    if not node:
        return item(False, 'Node.js is not installed',
                    fix=hint(mac='brew install node (the current LTS; or nvm install --lts if they use nvm)',
                             win='winget install --id OpenJS.NodeJS.LTS -e', linux='https://nodejs.org'))
    _, line = tool_version(node)
    v = L.version_tuple(line)
    ok = bool(v and v[0] >= int(WS['node_min']))
    return item(ok, 'Node %s' % line.lstrip('v'), version=line.lstrip('v'), minimum=WS['node_min'],
                toolkit_ok=bool(v and v[0] >= 22), path=L.tilde(node),
                fix='Node %s or newer is needed; install the current LTS' % WS['node_min'])


def check_npm(quick):
    npm = L.which('npm')
    feed = WS.get('npm_feed') or ''
    if not npm:
        return item(False, 'npm is not installed (it comes with Node.js)', fix='install Node.js first')
    _, version = tool_version(npm, timeout=60)
    registry = L.run([npm, 'config', 'get', 'registry'], timeout=60, cwd=L.HOME)[1].strip()
    on_feed = bool(feed) and registry.rstrip('/') == feed.rstrip('/')
    extra = {'version': version, 'registry': registry, 'uses_feed': on_feed, 'feed': feed}
    if not quick:
        # Through Node, like npm: curl (schannel on Windows) and some Pythons get a different answer.
        extra['public_npm_reachable'] = L.node_reachable('https://registry.npmjs.org/yarn')
        extra['feed_reachable'] = L.node_reachable(feed + 'yarn') if feed else None
    blocked = extra.get('public_npm_reachable') is False
    detail = 'npm %s, registry %s' % (version, registry or 'default')
    if blocked:
        detail += '; public npm is blocked here'
    if extra.get('feed_reachable') is False:
        detail += "; the package feed (%s) isn't reachable either" % feed if blocked else \
            "; the package feed (%s) isn't reachable" % feed
    if not on_feed:
        detail += '; not on the package feed yet'
    # npm is there either way; it fails only when no registry answers, since then nothing can be installed.
    return item(not (blocked and extra.get('feed_reachable') is False), detail, blocked=blocked, **extra)


def check_yarn(npm_item):
    yarn = L.which('yarn')
    feed = WS.get('npm_feed') or ''  # from the config: check_npm returns early when npm is missing
    npm = 'npm.cmd' if L.IS_WIN else 'npm'
    first = '' if npm_item.get('uses_feed') else '%s config set registry %s (with their okay), then ' % (npm, feed)
    fix = ('%s%s install -g yarn (Yarn 1.22.22; npm may warn about install scripts, which is fine). A global install '
           'ignores the practice repo\'s .npmrc, so the registry matters. Not Corepack: it can\'t get Yarn through the '
           'feed.' % (first, npm))
    if not yarn:
        return item(False, 'Yarn is not installed', fix=fix)
    code, out, err = L.run([yarn, '--version'], timeout=120, cwd=L.HOME)
    v = L.version_tuple(out)
    ok = bool(v and v[0] == 1)
    detail = 'Yarn %s' % out if out and v else 'yarn did not answer: %s' % L.first_line(err or out)
    if v and v[0] != 1:
        detail += ' (the practice repo needs Yarn 1)'
    return item(ok, detail, version=out if v else None, path=L.tilde(yarn), fix=fix)


def check_powershell():
    """Windows only: PowerShell runs npm.ps1 and yarn.ps1 (not the .cmd shims) when people type npm or yarn, and the
    client default policy, Restricted, refuses them ("running scripts is disabled on this system"). Windows
    PowerShell 5.1 and PowerShell 7 keep separate policies, and the Agents window's terminal is PowerShell 7 when it's
    installed, so both are reported."""
    # A child started from PowerShell 7 inherits its PSModulePath, and Windows PowerShell 5.1 then fails to load 7's
    # Security module ("Get-ExecutionPolicy ... the module could not be loaded"). Python keeps env keys uppercase here.
    env = {k: v for k, v in L.ENV.items() if k.upper() != 'PSMODULEPATH'}
    allowed = ('RemoteSigned', 'Unrestricted', 'Bypass')
    policies = {}
    for name, label in (('powershell', 'Windows PowerShell'), ('pwsh', 'PowerShell 7')):
        shell = L.which(name)
        if not shell:
            continue
        code, out, _ = L.run([shell, '-NoProfile', '-NonInteractive', '-Command', 'Get-ExecutionPolicy'], env=env,
                             timeout=60)
        policies[label] = out.strip().splitlines()[-1].strip() if code == 0 and out.strip() else None
    if not policies:
        return item(None, 'PowerShell not found')
    known = [v for v in policies.values() if v]
    ok = all(v in allowed for v in known) if known else None
    detail = 'execution policy: ' + ', '.join('%s %s' % (k, v or 'unknown') for k, v in policies.items())
    blocked = [k for k, v in policies.items() if v and v not in allowed]
    return item(ok, detail, policy=policies.get('Windows PowerShell'), pwsh_policy=policies.get('PowerShell 7'),
                fix='Set-ExecutionPolicy -Scope CurrentUser RemoteSigned (with their okay), run in %s, since each '
                    'PowerShell keeps its own policy; until then, npm.cmd and yarn.cmd work'
                    % (' and in '.join(blocked) or 'the PowerShell they use'))


def check_python():
    names = ['python', 'py'] if L.IS_WIN else ['python3']
    path = next(filter(None, (L.which(n) for n in names)), None)
    running = {'version': platform.python_version(), 'path': L.tilde(sys.executable)}
    try:
        import PIL  # noqa: F401
        running['pillow'] = getattr(PIL, '__version__', 'installed')
    except Exception:  # noqa: BLE001 - any import failure means it is not usable
        running['pillow'] = None
    try:
        import ssl
        # python.org's Python on macOS has no root certificates until "Install Certificates.command" runs, so its
        # HTTPS calls fail with CERTIFICATE_VERIFY_FAILED. Information only: the setup scripts don't need it.
        paths = ssl.get_default_verify_paths()
        running['https_certificates'] = bool(
            ssl.create_default_context().cert_store_stats().get('x509_ca', 0) or
            (paths.cafile and os.path.isfile(paths.cafile)) or (paths.capath and os.path.isdir(paths.capath) and
                                                                 any(os.scandir(paths.capath))))
    except Exception:  # noqa: BLE001
        running['https_certificates'] = None
    on_path = None
    if path and os.path.realpath(path) != os.path.realpath(sys.executable):
        args = [path, '-3'] if Path(path).stem.lower() == 'py' else [path]
        code, out, _ = L.run(args + ['-c', 'import sys\ntry:\n import PIL; p = PIL.__version__\nexcept Exception:\n p = ""\n'
                                     'print(sys.version.split()[0], p)'], timeout=30)
        parts = out.split() if code == 0 else []
        on_path = {'version': parts[0] if parts else None, 'pillow': parts[1] if len(parts) > 1 else None,
                   'path': L.tilde(path)}
    use = on_path or running
    v = L.version_tuple(use.get('version'))
    ok = bool(v and v >= (3, 8) and use.get('pillow'))
    if L.IS_MAC and str(path or '').startswith(('/opt/homebrew', '/usr/local/Cellar', '/usr/local/opt')):
        fix = 'brew install pillow'
    else:
        fix = '%s -m pip install --user Pillow' % ('python' if L.IS_WIN else 'python3')
    if not path:
        fix = hint(mac='python3 comes with the Command Line Tools (xcode-select --install)',
                   win='winget install --id Python.Python.3.13 -e', linux='install python3 and python3-pil')
    detail = 'Python %s%s' % (use.get('version'), ' with Pillow %s' % use['pillow'] if use.get('pillow') else ', no Pillow')
    if L.IS_WIN and on_path and not on_path.get('version') and '\\windowsapps\\' in str(path).lower():
        detail = 'python on PATH is the Microsoft Store alias, not a real Python'
        fix = ('install Python (winget install --id Python.Python.3.13 -e), then turn the alias off in Settings > Apps > '
               'Advanced app settings > App execution aliases')
    return item(ok, detail, running=running, on_path=on_path, fix=fix)


def check_media(name):
    path = L.which(name)
    if not path:
        return item(False, '%s is not installed' % name,
                    fix=hint(mac='brew install ffmpeg', win='winget install --id Gyan.FFmpeg -e', linux='install ffmpeg'))
    code, line = tool_version(path, ('-version',))
    m = re.search(r'version\s+(\S+)', line)
    return item(code == 0, '%s %s' % (name, m.group(1) if m else ''), path=L.tilde(path))


def _windows_version_dir(folder):
    try:
        names = [p.name for p in Path(folder).iterdir() if re.fullmatch(r'\d+\.\d+\.\d+\.\d+', p.name)]
    except OSError:
        return None
    return max(names, key=lambda n: tuple(map(int, n.split('.'))), default=None)


def check_browser(devbox=False):
    found = {}
    if L.IS_MAC:
        for key, app in (('chrome', 'Google Chrome.app'), ('edge', 'Microsoft Edge.app')):
            for base in (Path('/Applications'), L.HOME / 'Applications'):
                plist = base / app / 'Contents' / 'Info.plist'
                if plist.is_file():
                    try:
                        with open(plist, 'rb') as handle:
                            found[key] = plistlib.load(handle).get('CFBundleShortVersionString') or 'installed'
                    except Exception:  # noqa: BLE001 - presence is enough
                        found[key] = 'installed'
                    break
    elif L.IS_WIN:
        pf = Path(os.environ.get('ProgramFiles') or r'C:\Program Files')
        pf86 = Path(os.environ.get('ProgramFiles(x86)') or r'C:\Program Files (x86)')
        local = Path(os.environ.get('LOCALAPPDATA') or (L.HOME / 'AppData' / 'Local'))
        places = {'chrome': [d / 'Google' / 'Chrome' / 'Application' for d in (pf, pf86, local)],
                  'edge': [d / 'Microsoft' / 'Edge' / 'Application' for d in (pf86, pf)]}
        exes = {'chrome': 'chrome.exe', 'edge': 'msedge.exe'}
        for key, folders in places.items():
            for folder in folders:
                if (folder / exes[key]).is_file():
                    found[key] = _windows_version_dir(folder) or 'installed'
                    break
    else:
        for key, names in (('chrome', ('google-chrome', 'google-chrome-stable')), ('edge', ('microsoft-edge',))):
            path = next(filter(None, (L.which(n) for n in names)), None)
            if path:
                found[key] = (re.search(r'[\d.]+', tool_version(path)[1] or '') or re.search('', '')).group(0) or 'installed'
    detail = ', '.join('%s %s' % ({'chrome': 'Chrome', 'edge': 'Edge'}[k], v) for k, v in found.items()) or 'no Chrome or Edge'
    if devbox:
        # Playwright and Computer Use on the box use Chrome, so Edge alone isn't enough there.
        if 'chrome' not in found:
            detail += '; a dev box needs Google Chrome'
        return item('chrome' in found, detail, browsers=found, chrome_required=True,
                    fix=hint(mac='brew install --cask google-chrome',
                             win='winget install --id Google.Chrome -e --accept-source-agreements '
                                 '--accept-package-agreements --silent',
                             linux='install Google Chrome'))
    return item(bool(found), detail, browsers=found,
                fix=hint(mac='brew install --cask google-chrome (or Microsoft Edge from the Company Portal)',
                         win='Microsoft Edge comes with Windows; reinstall it from https://www.microsoft.com/edge',
                         linux='install Google Chrome'))


# ---------------------------------------------------------------- VS Code settings

def read_settings():
    path = L.insiders_settings_path()
    if not path.is_file():
        return path, {}, None
    try:
        return path, L.parse_jsonc(path.read_text(encoding='utf-8-sig')), None
    except (OSError, L.JSONCError) as error:
        return path, {}, str(error)


def check_settings(current, path, error):
    snippet = L.REFS / WS['settings_snippet']
    try:
        entries = L.snippet_entries(snippet.read_text(encoding='utf-8'))
    except (OSError, L.JSONCError) as e:
        return item(None, 'the workshop settings snippet %s could not be read (%s)' % (L.tilde(snippet), type(e).__name__))
    matching = [k for k, v, _ in entries if k in current and current[k] == v]
    different = [{'key': k, 'now': current[k], 'workshop': v} for k, v, _ in entries if k in current and current[k] != v]
    missing = [{'key': k, 'workshop': v} for k, v, _ in entries if k not in current]
    ok = not error and not different and not missing
    detail = 'settings.json has a syntax problem: %s' % error if error else \
        '%d of %d workshop settings are set' % (len(matching), len(entries))
    return item(ok, detail, file=L.tilde(path), exists=path.is_file(), matching=matching, different=different,
                missing=missing, total=len(entries),
                fix='%s scripts/workshop-settings.py diff, list what is missing, then apply --json (the setup prompt is '
                    'the okay)' % L.PY)


# ---------------------------------------------------------------- practice repo

def parse_github(url):
    m = re.search(r'github\.com[:/]+([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:\.git)?/?$', url or '')
    return '%s/%s' % (m.group(1), m.group(2)) if m else None


def server_record():
    record = L.read_json(L.STATE_DIR / 'practice-server.json')
    if not record:
        return None
    import socket
    alive = False
    try:
        with socket.create_connection(('127.0.0.1', int(record.get('port') or 0)), timeout=1):
            alive = True
    except (OSError, ValueError):
        pass
    return {'url': record.get('url'), 'pid': record.get('pid'), 'port_open': alive, 'started': record.get('started')}


def check_practice(practice_dir, quick):
    d = L.expand(practice_dir)
    base = {'dir': L.tilde(d)}
    if not (d / '.git').exists():
        return item(False, 'no practice repo at %s' % L.tilde(d), fix='%s scripts/practice-repo.py copy' % L.PY, **base)
    git = L.which('git')
    origin = L.redact(L.run([git, '-C', d, 'remote', 'get-url', 'origin'], timeout=10)[1]) if git else ''
    branch = L.run([git, '-C', d, 'rev-parse', '--abbrev-ref', 'HEAD'], timeout=10)[1] if git else ''
    pkg = L.read_json(d / 'package.json', {}) or {}
    playwright = ((L.read_json(d / 'node_modules' / 'playwright' / 'package.json', {}) or {}).get('version') or
                  (L.read_json(d / 'node_modules' / 'playwright-core' / 'package.json', {}) or {}).get('version'))
    repo = parse_github(origin)
    visibility = None
    gh = L.which('gh')
    if repo and gh and not quick:
        code, out, _ = L.run([gh, 'repo', 'view', repo, '--json', 'visibility', '--jq', '.visibility'], timeout=30)
        visibility = out if code == 0 else None
    installed = (d / 'node_modules').is_dir()
    start = WS.get('practice', {}).get('start') or []
    script = start[0] if start else None
    helper = L.read_json(d / WS['practice'].get('server_file', '.workshop/server.json'))
    extra = dict(base, origin=origin, repo=repo, visibility=visibility, branch=branch, installed=installed,
                 playwright=playwright, start_script=(script in (pkg.get('scripts') or {})) if script else None,
                 server=server_record(), helper_server={k: helper.get(k) for k in ('url', 'port', 'pid')} if helper else None)
    problems = []
    if not repo:
        problems.append('origin is not a GitHub repo')
    if visibility and visibility != 'PRIVATE':
        problems.append('the GitHub repo is %s, not private' % visibility.lower())
    if not installed:
        problems.append('dependencies not installed')
    detail = '%s at %s' % (repo or 'a repo', L.tilde(d)) + ('; ' + '; '.join(problems) if problems else '')
    return item(not problems, detail, fix='%s scripts/practice-repo.py install, then start' % L.PY, **extra)


# ---------------------------------------------------------------- skills

def remotes(repo):
    git = L.which('git')
    out = {}
    if not git:
        return out
    for line in L.run([git, '-C', repo, 'remote', '-v'], timeout=10)[1].splitlines():
        parts = line.split()
        if len(parts) >= 3:
            out.setdefault(parts[0], {})[parts[2].strip('()')] = L.redact(parts[1])
    return out


def schedules():
    found = []
    if L.IS_MAC:
        agents = L.HOME / 'Library' / 'LaunchAgents'
        for plist in sorted(agents.glob('*.plist')) if agents.is_dir() else []:
            if re.search(r'autonomous|skill', plist.name, re.I):
                found.append(plist.stem)
    elif L.IS_WIN:
        code, out, _ = L.run(['schtasks', '/Query', '/FO', 'CSV', '/NH'], timeout=60)
        for line in out.splitlines():
            name = line.split('","')[0].strip('"').lstrip('\\')
            if re.search(r'autonomous|skill', name, re.I) and name not in found:
                found.append(name)
    else:
        code, out, _ = L.run(['crontab', '-l'], timeout=10)
        found = [line for line in out.splitlines() if 'sync-skills.py' in line or 'skill-miner' in line]
    return found


def check_skills(quick, answers):
    clone = L.COPILOT / 'autonomous-output-skills'
    skills_dir = L.expand(os.environ.get('COPILOT_SKILLS_DIR') or (L.COPILOT / 'skills'))
    installed = sorted(p.parent.name for p in skills_dir.glob('*/SKILL.md')) if skills_dir.is_dir() else []
    if not (clone / '.git').exists():
        return item(False, 'the skills repo is not cloned yet', clone=L.tilde(clone), installed=installed,
                    fix='git clone https://github.com/%s.git %s' % (WS['skills']['public_repo'], L.tilde(clone)))
    in_repo = sorted(p.parent.name for p in clone.glob('*/SKILL.md'))
    missing = [s for s in in_repo if s not in installed]
    rem = remotes(clone)
    public = rem.get('public', {})
    sync_settings = L.read_json(L.COPILOT / 'skills-sync.json', {}) or {}
    mode = sync_settings.get('mode') or ('maintainer' if sync_settings.get('private_url') else None)
    status = None
    tool = clone / 'tools' / 'sync-skills.py'
    if tool.is_file() and not quick:
        code, out, err = L.run([sys.executable, tool, 'status', '--json'], timeout=180)
        try:
            status = json.loads(out)
        except ValueError:
            status = {'error': L.first_line(err or out) or 'no JSON from sync-skills.py status --json'}
        if isinstance(status, dict):
            # Keep it short: the files that differ, counted by state, plus whatever else the tool reports.
            files = status.pop('files', None)
            if isinstance(files, list):
                counts = {}
                for entry in files:
                    counts[entry.get('state', '?')] = counts.get(entry.get('state', '?'), 0) + 1
                status['differences'] = counts
            for key in ('repo', 'skills_dir'):
                if isinstance(status.get(key), str):
                    status[key] = L.tilde(status[key])
    if isinstance(status, dict) and status.get('mode'):
        mode = status['mode']  # the sync tool knows best: attendee, maintainer, or not set up
    origin_repo = parse_github(rem.get('origin', {}).get('fetch'))
    own_copy = bool(origin_repo) and origin_repo.lower() != WS['skills']['public_repo'].lower()
    problems = []
    if missing:
        problems.append('not installed yet: %s' % ', '.join(missing))
    skipped_copy = str(answers.get('skills_private_copy', '')).lower() in ('no', 'skip', 'skipped')
    if not own_copy and not skipped_copy:
        origin_url = rem.get('origin', {}).get('fetch')
        problems.append('no private copy yet (origin is %s)' % (origin_repo or ('not on GitHub' if origin_url else 'not set')))
    daily = ((status or {}).get('schedule') or {}).get('daily_sync') if isinstance(status, dict) else None
    declined = str(answers.get('skills_schedule', '')).lower() in ('none', 'no', 'skipped')
    if mode == 'attendee' and isinstance(daily, dict) and daily.get('registered') is False and not declined:
        problems.append('the daily sync is not scheduled yet')
    jobs = schedules()
    detail = '%d skills installed' % len(installed) + ('; ' + '; '.join(problems) if problems else
                                                         '; private copy %s' % origin_repo if own_copy else
                                                         '; no private copy (their choice)')
    return item(not problems, detail, clone=L.tilde(clone), installed=installed, missing=missing, remotes=rem,
                private_copy=origin_repo if own_copy else None,
                public_push_disabled=bool(public) and not str(public.get('push', '')).startswith(('https://', 'git@')),
                mode=mode, schedules=jobs, sync_status=status,
                fix='%s tools/sync-skills.py setup-attendee (see SKILL.md, "4. Skills")' % L.PY)


# ---------------------------------------------------------------- connections

def cli_config():
    path = L.COPILOT / 'config.json'
    try:
        text = path.read_text(encoding='utf-8')
    except OSError:
        return {}
    try:
        return L.parse_jsonc(text) or {}
    except L.JSONCError:
        return {}


def check_workiq():
    found = []
    for plugin in cli_config().get('installedPlugins') or []:
        source = plugin.get('source') or {}
        repo = source.get('repo') if isinstance(source, dict) else None
        if str(plugin.get('name', '')).startswith('workiq') or repo == 'microsoft/work-iq':
            found.append({'name': plugin.get('name'), 'where': 'copilot', 'enabled': plugin.get('enabled', True)})
    installed = L.read_json(L.HOME / '.vscode-insiders' / 'agent-plugins' / 'installed.json', {}) or {}
    for plugin in installed.get('installed') or []:
        if 'work-iq' in str(plugin.get('relativePath', '')) or str(plugin.get('name', '')).startswith('workiq'):
            found.append({'name': plugin.get('name'), 'where': 'vscode', 'enabled': True})
    names = {f['name'] for f in found if f.get('enabled') is not False}
    ok = 'workiq' in names
    detail = 'plugins: %s' % ', '.join(sorted(n for n in names if n)) if names else 'no Work IQ plugin installed'
    cli = L.which('copilot')
    # VS Code puts a copilot shim on PATH that can only install Copilot CLI from an interactive terminal.
    shim = bool(cli) and 'copilot-shim' in os.path.realpath(cli)
    return item(ok, detail, plugins=found, copilot_cli=L.tilde(cli) if cli else None, copilot_cli_is_vscode_shim=shim,
                fix='The agent runs copilot plugin marketplace add microsoft/work-iq, copilot plugin install '
                    'workiq@work-iq and copilot plugin install workiq-productivity@work-iq (when copilot is missing or '
                    'only VS Code\'s shim, npm install -g @github/copilot first); the tools load in the next chat, '
                    'which the agent starts with create_session')


def mentions_playwright(data):
    return 'playwright' in json.dumps(data or {}).lower()


def check_playwright(settings, browser):
    """The Playwright MCP server in Copilot's MCP config (or VS Code's), on an installed Chrome or Edge."""
    cli_mcp = L.read_json(L.COPILOT / 'mcp-config.json', {}) or {}
    vscode_mcp = {}
    mcp = L.insiders_user_dir() / 'mcp.json'
    if mcp.is_file():
        try:
            vscode_mcp = L.parse_jsonc(mcp.read_text(encoding='utf-8'))
        except (OSError, L.JSONCError):
            vscode_mcp = {}
    copilot = [n for n, e in (cli_mcp.get('mcpServers') or {}).items() if mentions_playwright({n: e})]
    vscode = [n for n, e in (vscode_mcp.get('servers') or {}).items() if mentions_playwright({n: e})]
    args = ' '.join(' '.join(map(str, (e or {}).get('args') or [])) for n, e in (cli_mcp.get('mcpServers') or {}).items()
                    if n in copilot)
    pinned = re.search(r'@playwright/mcp@(\d+\.\d+\.\d+)', args)
    channel = re.search(r'--browser[ =](\S+)', args)
    channel = channel.group(1) if channel else None
    has_browser = bool(browser.get('ok'))
    chrome_required = bool(browser.get('chrome_required'))
    # On a dev box Playwright must drive Chrome; an entry added while only Edge was there still says msedge.
    wrong_channel = chrome_required and bool(copilot) and channel not in (None, 'chrome')
    ok = bool(copilot or vscode) and has_browser and not wrong_channel
    if copilot or vscode:
        detail = 'Playwright MCP server set up (%s)' % ', '.join(['Copilot: %s' % n for n in copilot] +
                                                                  ['VS Code: %s' % n for n in vscode])
        if copilot and not pinned and '@latest' in args:
            detail += '; it uses @latest, which some registries point at an old build'
    else:
        detail = 'no Playwright MCP server yet'
    if not has_browser:
        detail += '; needs Google Chrome' if chrome_required else '; needs Chrome or Edge'
    if wrong_channel:
        detail += '; it runs on %s, and a dev box needs it on Chrome' % channel
    return item(ok, detail, copilot_mcp=copilot, vscode_mcp=vscode, pinned=pinned.group(1) if pinned else None,
                browser=channel, browser_tools_setting=settings.get('workbench.browser.enableChatTools'),
                fix=('%s scripts/mcp-servers.py remove playwright, then add playwright --browser chrome' % L.PY)
                if wrong_channel else '%s scripts/mcp-servers.py add playwright; chats that start after it pick it up'
                % L.PY)


def check_dictation(settings, devbox=False):
    model = settings.get('dictation.model')
    enabled = settings.get('dictation.enabled', True) is not False
    if devbox:
        return item(None, 'not part of the dev box setup: you talk to its chats from your laptop', required=False,
                    model=model, enabled=enabled, devbox_skip=True)
    ok = model == 'mai' and enabled
    if not enabled:
        detail = 'dictation is turned off (dictation.enabled)'
    elif model == 'mai':
        detail = 'cloud dictation (MAI)'
    else:
        detail = 'dictation uses %s' % ('the on-device model, which downloads first' if not model else model)
    return item(ok, detail, model=model, enabled=enabled,
                fix='"dictation.model": "mai" in settings (part of the workshop settings)')


def check_weekly(state, devbox=False):
    if devbox:
        return item(None, 'runs from your laptop: one weekly update per person', required=False, devbox_skip=True)
    test = (state.get('tests') or {}).get('weekly')
    return item(True if test else None, 'the proof run passed' if test else
                'set up in the Agents window\'s Automations; its proof run (--check-run) shows it works',
                fix='see SKILL.md, "Skills": configureAutomation, runAutomation, then the --check-run command')


def check_computer_use(settings):
    setting = settings.get('chat.agentHost.computerUse.enabled')
    folder = L.COPILOT / 'computer-use'
    helper = folder.is_dir() and any(not p.name.startswith('.') and p.suffix != '.json' for p in folder.iterdir())
    detail = 'setting %s; plugin %s' % ('on' if setting is True else 'off', 'downloaded' if helper else 'not downloaded yet')
    return item(setting is True, detail, setting=setting, plugin_downloaded=bool(helper),
                fix='"chat.agentHost.computerUse.enabled": true (restart Insiders), then /computer on in a Copilot chat')


def check_azure(quick, devbox=False):
    if devbox:
        return item(None, 'not part of the dev box setup', required=False, devbox_skip=True)
    az = L.which('az')
    if not az:
        return item(None, 'Azure CLI is not installed', required=False,
                    fix=hint(mac='brew install azure-cli', win='winget install --id Microsoft.AzureCLI -e'))
    if quick:
        return item(None, 'Azure CLI installed; sign-in not checked (--quick)', required=False)
    code, out, _ = L.run([az, 'account', 'show', '--output', 'json'], timeout=60)
    try:
        account = json.loads(out) if code == 0 else None
    except ValueError:
        account = None
    return item(bool(account), 'signed in, a subscription is selected' if account else 'not signed in', required=False,
                fix='the agent runs az login: it opens their browser and returns once they sign in (never '
                    '--use-device-code, which Conditional Access often blocks)')


def check_devbox(quick, devbox=False):
    """Optional: a dev box that stays on (can't hibernate, no auto-stop schedule) and is running. Read only."""
    if devbox:
        return item(None, 'this is the dev box: the setup never creates one from a box', required=False, devbox_skip=True)
    if quick:
        return item(None, 'not checked (--quick)', required=False)
    try:
        import devbox as D
        report = D.status()
    except Exception as error:  # noqa: BLE001 - the dev box check must never break the whole check
        return item(None, "couldn't check dev boxes: %s" % L.first_line(str(error)), required=False)
    base = {'signed_in': report.get('signed_in'), 'az_installed': report.get('az_installed'),
            'projects': report.get('projects') or [], 'pools': (report.get('pools') or [])[:6],
            'boxes': report.get('boxes') or [], 'stays_on_box': report.get('stays_on_box'), 'portal': report.get('portal')}
    if not report.get('signed_in'):
        return item(None, "can't check: %s" % report.get('detail'), required=False,
                    fix='az login, which the agent starts and they finish in the browser (references/optional.md, '
                        '"Azure")', **base)
    if report.get('ok') is False:
        return item(None, "couldn't check: %s" % report.get('detail'), required=False, **base)
    box = next((b for b in base['boxes'] if b['name'] == base['stays_on_box']), None)
    if box and box['running']:
        return item(True, '%s is on and stays on (%s, %s vCPU, %s GB)' % (box['name'], box['pool'], box['vcpus'],
                                                                         box['memory_gb']), required=False, **base)
    if box:
        return item(False, '%s stays on once it\'s started; it is %s now' % (box['name'], box['power']),
                    required=False, fix='devbox.py link, then open it once to start it', **base)
    stay = [p for p in base['pools'] if p.get('stays_on')]
    if stay:
        detail = 'no box that stays on yet; pool %s (%s) can make one' % (stay[0]['name'], stay[0]['project'])
        fix = 'devbox.py create --project %s --pool %s --name <name> (with their okay)' % (stay[0]['project'], stay[0]['name'])
    elif base['projects']:
        detail = 'no pool that stays on in your projects'
        fix = 'devbox.py ask-admin: a message for a Dev Box admin with the pool settings and the image definition'
    else:
        detail = 'no Dev Box project yet'
        fix = 'request one at https://devbox.microsoft.com (your team\'s Dev Box admin adds you to a project)'
    return item(False, detail, required=False, fix=fix, **base)


def owner_only(path):
    if not L.IS_WIN:
        try:
            return (path.stat().st_mode & 0o077) == 0
        except OSError:
            return None
    code, out, _ = L.run(['icacls', str(path)], timeout=20)
    if code != 0:
        return None
    user = (os.environ.get('USERNAME') or '').lower()
    # Files in the profile get SYSTEM and Administrators, and icacls /inheritance:r keeps them as explicit entries.
    # Both can read any file on Windows anyway, so like OpenSSH's key check they don't count as someone else. OWNER
    # RIGHTS (some folders, such as Python's temp folders, pass it down) is the file's owner, the person themselves.
    system = ('nt authority\\system', 'builtin\\administrators', 'owner rights')
    principals = []
    for line in out.splitlines():
        line = line.replace(str(path), '', 1).strip()
        m = re.match(r'(.+?):\((.*)\)$', line)
        if m:
            principals.append(m.group(1).strip().lower())
    mine = [p == user or p.endswith('\\' + user) for p in principals]
    return any(mine) and all(m or p in system for m, p in zip(mine, principals))


RESEARCH_FIX = ('the person pastes OUTSET_API_KEY into research.env themselves; the agent runs outset-auth.mjs (they '
                'approve in the browser), then opens https://www.userinterviews.com with Playwright, they sign in once '
                'there, and the agent confirms it read only and remembers userinterviews_signed_in=yes; drafting a '
                'study needs none of this')


def check_research(answers):
    """Optional: what running studies needs. research.env (owner only) with OUTSET_API_KEY and the Outset sign-in
    (OUTSET_OAUTH_CLIENT_ID and OUTSET_REFRESH_TOKEN, written by outset-auth.mjs), and User Interviews signed in once in
    the browser Playwright uses, which the agent saw read only and saved as userinterviews_signed_in. A User Interviews
    API key is optional: probe.mjs checks it when it's there."""
    env = L.HOME / '.copilot' / 'research.env'
    ui_signed_in = str(answers.get('userinterviews_signed_in', '')).lower() in ('yes', 'true')
    if not env.is_file():
        return item(None, 'no research.env yet', required=False, file=L.tilde(env), userinterviews_signed_in=ui_signed_in,
                    fix=RESEARCH_FIX)
    keys = []
    try:
        for line in env.read_text(encoding='utf-8', errors='replace').splitlines():
            m = re.match(r'\s*([A-Z][A-Z0-9_]*)\s*=\s*(\S.*)?$', line)
            if m and (m.group(2) or '').strip():
                keys.append(m.group(1))  # the name only, never the value
    except OSError:
        return item(False, 'cannot read research.env; check its permissions', required=False, file=L.tilde(env))
    private = owner_only(env)
    outset_key = 'OUTSET_API_KEY' in keys
    outset_signed_in = 'OUTSET_REFRESH_TOKEN' in keys and 'OUTSET_OAUTH_CLIENT_ID' in keys
    ui_key = 'USERINTERVIEWS_API_KEY' in keys
    ready = outset_key and outset_signed_in and ui_signed_in
    missing = [name for name, ok in (('OUTSET_API_KEY', outset_key), ('the Outset sign-in', outset_signed_in),
                                     ('a User Interviews sign-in in the Playwright browser', ui_signed_in)) if not ok]
    permission_note = ('; readable by others' if private is False else
                       '; could not verify owner-only permissions' if private is None else '')
    detail = 'research.env has %d keys set%s; %s' % (len(keys), permission_note,
                                                     'ready to run studies' if ready else 'needs ' + ' and '.join(missing))
    if ui_key:
        detail += '; User Interviews API key set (optional)'
    return item(private is True and ready, detail, required=False, file=L.tilde(env), keys_set=keys, owner_only=private,
                outset_api_key_set=outset_key, outset_signed_in=outset_signed_in, userinterviews_signed_in=ui_signed_in,
                userinterviews_api_key_set=ui_key, ready=ready,
                fix=hint(mac='chmod 600 ~/.copilot/research.env', linux='chmod 600 ~/.copilot/research.env',
                         win='icacls $HOME\\.copilot\\research.env /inheritance:r /grant:r "${env:USERNAME}:F"')
                if private is False else RESEARCH_FIX)


# ---------------------------------------------------------------- report

GROUPS = {'basics': ('command_line_tools', 'package_manager', 'vscode_insiders', 'copilot_signin', 'gh', 'git',
                      'powershell', 'node', 'npm', 'yarn', 'python', 'ffmpeg', 'ffprobe', 'browser'),
          'workshop': ('settings', 'dictation', 'skills', 'weekly', 'playwright'),
          'connections': ('workiq', 'computer_use'),
          'yours': ('voice', 'taste'),
          'optional': ('azure', 'devbox', 'research'),
          'later': ('practice',)}


def try_its(answers):
    """The prompts the person copies into chat to test an item themselves (the canvas shows the same ones). Sending
    one is their okay for what it does."""
    # On a dev box the laptop already posted the check-in, so the box's Try-it reads instead of posting again.
    chat = '' if devbox_mode(answers) else str(answers.get('checkInChat') or '').strip()
    workiq = ('Use Work IQ to post "Work IQ is set up" in the %s chat.' % chat if chat else
              'Use Work IQ to tell me the subject of my next meeting.')
    computer = ('Use Computer Use to open Notepad and type "Computer Use works". Don\'t save it.' if L.IS_WIN else
                'Use Computer Use to write "Computer Use works" in a new note in Notes.')
    return {'workiq': workiq,
            'playwright': 'Use Playwright to open https://code.visualstudio.com, take a screenshot and show it to me.',
            'computer_use': computer,
            'dictation': 'Click the mic in the chat input, say "Dictation works", and send it.',
            'skills': 'List the skills from my copy.',
            'weekly': 'Run my weekly skill update once now and check the run.',
            'voice': 'Draft a two sentence reply in my voice.',
            'taste': 'Give me three rules from my taste and their sources.',
            'devbox': 'Start a session on my dev box and have it say hello.',
            'azure': 'Run az account show and tell me which subscription is selected.',
            'research': 'Check my Outset connection with a read-only request, and open User Interviews with Playwright '
                        'to confirm I\'m signed in. Do not show credentials, create a study or recruit anyone.'}


def build(practice_dir=None, quick=False):
    state = L.load_state()
    state.setdefault('tests', {})
    practice_dir = practice_dir or state['answers'].get('practice_dir') or WS['practice']['dir']
    settings_path, settings, settings_error = read_settings()
    items = {}
    if L.IS_MAC:
        items['command_line_tools'] = check_clt()
    items['package_manager'] = check_package_manager()
    items['vscode_insiders'] = check_insiders()
    items['copilot_signin'] = check_copilot_signin(state)
    items['gh'] = check_gh()
    items['git'] = check_git()
    if L.IS_WIN:
        items['powershell'] = check_powershell()
    items['node'] = check_node()
    items['npm'] = check_npm(quick)
    items['yarn'] = check_yarn(items['npm'])
    items['python'] = check_python()
    items['ffmpeg'] = check_media('ffmpeg')
    items['ffprobe'] = check_media('ffprobe')
    devbox = devbox_mode(state['answers'])
    items['browser'] = check_browser(devbox)
    items['settings'] = check_settings(settings, settings_path, settings_error)
    items['dictation'] = check_dictation(settings, devbox)
    items['skills'] = check_skills(quick, state['answers'])
    items['weekly'] = check_weekly(state, devbox)
    items['workiq'] = check_workiq()
    items['playwright'] = check_playwright(settings, items['browser'])
    items['computer_use'] = check_computer_use(settings)
    items['azure'] = check_azure(quick, devbox)
    items['devbox'] = check_devbox(quick, devbox)
    items['research'] = check_research(state['answers'])
    for key in ('research', 'devbox'):
        # The prompt asked for it ("including research and a dev box"); a dev box never creates another one.
        asked = str(state['answers'].get(key + '_requested', '')).lower() in ('yes', 'true')
        if asked and not (devbox and key == 'devbox'):
            items[key]['requested'] = True
    practice = check_practice(practice_dir, True)
    practice.update(required=False, later=True, ok=practice.get('ok') or None,
                    detail='later, at the workshop' + (': ' + practice['detail'] if practice.get('ok') else ''))
    practice.pop('fix', None)
    items['practice'] = practice
    prompts = try_its(state['answers'])
    for key, value in items.items():
        value['group'] = next((g for g, keys in GROUPS.items() if key in keys), 'other')
        value['try_it'] = None if value.get('devbox_skip') else prompts.get(key)
        test = state['tests'].get(key)
        value['tested'] = bool(test)
        if test:
            value['tested_at'] = test.get('at')
    steps = {sid: dict(state['steps'].get(sid) or {'status': 'pending'}, title=TITLES[sid]) for sid in STEP_IDS}
    counted = {k: v for k, v in items.items() if not v.get('later')}
    todo = ['%s: %s%s' % (key, value['detail'], ' (fix: %s)' % value['fix'] if value.get('fix') else '')
            for key, value in counted.items() if value.get('required') and value.get('ok') is False]
    todo += ['step %s: %s' % (sid, steps[sid]['status']) for sid in REQUIRED_STEPS if steps[sid]['status'] != 'ok']
    required = [k for k, v in counted.items() if v.get('required')]
    return {'tool': 'autonomous-setup check-setup.py', 'time': L.now(), 'os': check_os(),
            'mode': 'devbox' if devbox else 'laptop',
            'copilot_home': L.tilde(L.COPILOT), 'state_file': L.tilde(L.STATE_FILE), 'items': items,
            'steps': steps, 'answers': state['answers'],
            'summary': {'ok': [k for k, v in counted.items() if v.get('ok') is True],
                        'missing': [k for k, v in counted.items() if v.get('required') and v.get('ok') is False],
                        'ask': [k for k, v in counted.items() if v.get('required') and v.get('ok') is None],
                        'tested': [k for k, v in counted.items() if v.get('tested')],
                        'later': [k for k, v in items.items() if v.get('later')],
                        'done': len([k for k in required if counted[k].get('ok') is True]),
                        'total': len(required),
                        'todo': todo}}


def safe_json(data):
    return L.redact(json.dumps(data, indent=1, ensure_ascii=False, default=str))


def render_text(report):
    mark = {True: '[x]', False: '[ ]', None: '[?]'}
    lines = ['%s %s, checked %s' % (report['os']['name'], report['os']['version'], report['time'])]
    for key, value in report['items'].items():
        lines.append('%s %s: %s%s%s' % (mark[value.get('ok')], key, value.get('detail', ''),
                                        '' if value.get('required', True) or value.get('later') else ' (optional)',
                                        ' (tested)' if value.get('tested') else ''))
        if value.get('fix') and value.get('ok') is False:
            lines.append('      fix: %s' % value['fix'])
    lines.append('Steps:')
    for sid, step in report['steps'].items():
        lines.append('  %-12s %-8s %s' % (sid, step['status'], step.get('note', '')))
    return L.redact('\n'.join(lines))


# ---------------------------------------------------------------- readiness

MACHINE_KEYS = ('vscode_insiders', 'copilot_signin', 'gh', 'git', 'powershell', 'node', 'npm', 'yarn', 'python',
                'ffmpeg', 'ffprobe', 'browser')
STEP_ITEMS = {'machine': MACHINE_KEYS, 'settings': ('settings',), 'skills': ('skills',), 'weekly': ('weekly',),
              'workiq': ('workiq',), 'playwright': ('playwright',), 'computer-use': ('computer_use',),
              'dictation': ('dictation',), 'azure': ('azure',),
              'devbox': ('devbox',), 'research': ('research',), 'practice': ('practice',)}
# Steps a fresh check can prove on its own; the others also need the agent's recorded tool check.
LIVE = ('machine', 'settings', 'skills', 'dictation')


def machine_summary(items):
    """One short line for the machine step: the tools and their versions."""
    get = lambda key, field='version': (items.get(key) or {}).get(field)  # noqa: E731
    gh = items.get('gh') or {}
    python = (items.get('python') or {}).get('on_path') or (items.get('python') or {}).get('running') or {}
    browsers = ', '.join(sorted(((items.get('browser') or {}).get('browsers') or {}).keys()))
    parts = ['VS Code Insiders %s' % get('vscode_insiders') if get('vscode_insiders') else None,
             'GitHub CLI as %s' % gh.get('active') if gh.get('active') else None,
             'git %s' % get('git') if get('git') else None,
             'Node %s' % get('node') if get('node') else None,
             'Yarn %s' % get('yarn') if get('yarn') else None,
             'Python %s with Pillow' % python.get('version') if python.get('pillow') else None,
             'ffmpeg' if (items.get('ffmpeg') or {}).get('ok') else None,
             browsers.replace('chrome', 'Chrome').replace('edge', 'Edge') or None]
    return ', '.join(p for p in parts if p)


def readiness_text(report):
    ready, skipped, left, later = [], [], [], []
    for sid, title, required in L.STEPS:
        step = report['steps'][sid]
        if sid == 'practice':
            later.append('Practice repo: you get the example at the workshop (or bring your own project)')
            continue
        status, note = step.get('status', 'pending'), step.get('note', '')
        checks = [report['items'][k] for k in STEP_ITEMS[sid] if k in report['items']]
        failing = [c['detail'] for c in checks if c.get('required') and c.get('ok') is False]
        if sid in LIVE and not failing and all(c.get('ok') is not None or not c.get('required') for c in checks):
            live_ok = True
        else:
            live_ok = False
        line = title + (': ' + note if note else '')
        tested = [c for c in checks if c.get('tested')]
        if tested and len(tested) == len(checks):
            line += ' (tested)'
        if status == 'skipped':
            skipped.append(line)
        elif status == 'ok' and not failing:
            ready.append(title + ': ' + (note or machine_summary(report['items'])) if sid == 'machine' else line)
        elif sid in LIVE and live_ok and status in ('ok', 'pending'):
            ready.append(title + ': ' + (machine_summary(report['items']) if sid == 'machine' else
                                         '; '.join(c['detail'] for c in checks if c.get('ok'))))
        elif required or status in ('blocked', 'failed') or (status == 'pending' and note):
            reasons = ([note] if note and status in ('blocked', 'failed', 'pending') else []) + failing
            reason = '; '.join(dict.fromkeys(reasons)) or ('not done yet' if status == 'pending' else status)
            left.append('%s: %s' % (title, reason))
        else:
            skipped.append(title + ': not set up')
    out = ['# %s' % WS.get('readiness_title', 'Workshop readiness'), '',
           'Checked %s on %s %s.' % (report['time'][:16].replace('T', ' at '), report['os']['name'],
                                     report['os']['version']), '']
    out += ['## Ready', ''] + ['- [x] %s' % r for r in ready] + ['']
    if left:
        out += ['## Still to do', ''] + ['- [ ] %s' % r for r in left] + ['']
    if skipped:
        out += ['## Skipped', ''] + ['- %s' % r for r in skipped] + ['']
    if later:
        out += ['## At the workshop', ''] + ['- %s' % r for r in later] + ['']
    if 'autonomous-setup' in ((report['items'].get('skills') or {}).get('installed') or []):
        out += ['To check again, start a new session and say "check my setup".', '']
    else:
        out += ['To check again or pick up where you stopped, start a new session and paste the setup prompt again. '
                '(Once the skills are installed, "check my setup" is enough.)', '']
    return L.redact('\n'.join(out)), ready, left, skipped


# ---------------------------------------------------------------- commands

def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command')
    p_check = sub.add_parser('check', help='print the checks (default)')
    for p in (parser, p_check):
        p.add_argument('--practice-dir', help='the practice repo folder (default: from the progress file or workshop.json)')
        p.add_argument('--format', choices=('json', 'text'), default='json')
        p.add_argument('--quick', action='store_true', help='skip the slow checks')
    p_mark = sub.add_parser('mark', help='record a step')
    p_mark.add_argument('step', choices=STEP_IDS)
    p_mark.add_argument('status', choices=L.STATUSES)
    p_mark.add_argument('--note', help='one short line, shown in the readiness checklist')
    p_mark.add_argument('--set', action='append', default=[], metavar='KEY=VALUE', help='also save an answer')
    p_ready = sub.add_parser('readiness', help='write the readiness checklist')
    p_ready.add_argument('--out', help='file to write (default: %s on the Desktop)' % WS['readiness_file'])
    p_ready.add_argument('--practice-dir')
    p_ready.add_argument('--quick', action='store_true')
    p_tested = sub.add_parser('tested', help='record that the person tested an item themselves')
    p_tested.add_argument('item')
    p_tested.add_argument('--note', help='one short line')
    p_remember = sub.add_parser('remember', help='save answers, like the values the setup prompt passes in')
    p_remember.add_argument('--set', action='append', default=[], metavar='KEY=VALUE', required=True)
    sub.add_parser('state', help='print the recorded progress')
    args = parser.parse_args()

    if args.command == 'mark':
        data = L.load_state()
        entry = {'status': args.status, 'at': L.now()}
        if args.note:
            entry['note'] = L.redact(' '.join(args.note.split()))[:300]
        data['steps'][args.step] = entry
        for pair in args.set:
            key, sep, value = pair.partition('=')
            if not sep or not key.strip():
                parser.error('--set takes KEY=VALUE')
            data['answers'][key.strip()] = L.redact(value.strip())
        L.save_state(data)
        print(json.dumps({'ok': True, 'step': args.step, 'status': args.status, 'state_file': L.tilde(L.STATE_FILE)}))
        return 0
    if args.command in ('tested', 'remember'):
        data = L.load_state()
        if args.command == 'tested':
            entry = {'at': L.now()}
            if args.note:
                entry['note'] = L.redact(' '.join(args.note.split()))[:300]
            data.setdefault('tests', {})[args.item] = entry
        for pair in args.set if args.command == 'remember' else []:
            key, sep, value = pair.partition('=')
            if not sep or not key.strip():
                parser.error('--set takes KEY=VALUE')
            data['answers'][key.strip()] = L.redact(value.strip())
        L.save_state(data)
        print(json.dumps({'ok': True, 'command': args.command, 'state_file': L.tilde(L.STATE_FILE)}))
        return 0
    if args.command == 'state':
        print(safe_json(L.load_state()))
        return 0
    if args.command == 'readiness':
        report = build(args.practice_dir, args.quick)
        text, ready, left, skipped = readiness_text(report)
        out = L.expand(args.out) if args.out else L.desktop_dir() / WS['readiness_file']
        L.write_atomic(out, text.replace('\n', '\r\n') if L.IS_WIN else text)
        print(safe_json({'ok': True, 'file': L.tilde(out), 'ready': len(ready), 'left': left, 'skipped': skipped}))
        return 0
    report = build(args.practice_dir, args.quick)
    print(render_text(report) if args.format == 'text' else safe_json(report))
    return 0


if __name__ == '__main__':
    sys.exit(main())

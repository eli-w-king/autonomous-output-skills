"""Shared helpers for the autonomous-setup scripts.

Non-interactive commands with timeouts, paths on macOS, Windows and Linux, a JSONC reader and a small editor that
changes only the keys it sets in a VS Code settings.json, the progress file, and redaction. Standard library only,
Python 3.8 or newer. The scripts next to this file import it; it does nothing on its own.
"""
import datetime as dt
import json
import os
import re
import shutil
import signal
import stat
import subprocess
import sys
import time
from pathlib import Path

IS_WIN = os.name == 'nt'
IS_MAC = sys.platform == 'darwin'
HERE = Path(__file__).resolve().parent
SKILL_DIR = HERE.parent
REFS = SKILL_DIR / 'references'
HOME = Path.home()
COPILOT = Path(os.environ.get('COPILOT_HOME') or (HOME / '.copilot')).expanduser()
STATE_DIR = COPILOT / 'workshop-setup'
STATE_FILE = STATE_DIR / 'state.json'
PY = 'python' if IS_WIN else 'python3'

# Every command runs without a terminal to prompt in, and these keep the usual tools from asking anyway.
ENV = dict(os.environ)
ENV.update({
    'GIT_TERMINAL_PROMPT': '0', 'GCM_INTERACTIVE': 'never', 'GH_PROMPT_DISABLED': '1', 'GH_NO_UPDATE_NOTIFIER': '1',
    'COREPACK_ENABLE_DOWNLOAD_PROMPT': '0', 'HOMEBREW_NO_AUTO_UPDATE': '1', 'HOMEBREW_NO_ENV_HINTS': '1',
    'NO_COLOR': '1', 'npm_config_update_notifier': 'false', 'npm_config_fund': 'false', 'npm_config_audit': 'false',
    'AZURE_CORE_ONLY_SHOW_ERRORS': 'true', 'AZURE_CORE_COLLECT_TELEMETRY': 'false',
})
NOWINDOW = {'creationflags': subprocess.CREATE_NO_WINDOW} if IS_WIN else {}

# Steps of the interview, in order: (id, title, required). Part 1 (in chat) is the settings; part 2 is the rest.
STEPS = (
    ('settings', 'VS Code settings', True),
    ('machine', 'Machine', True),
    ('skills', 'Skills', True),
    ('weekly', 'Weekly skill update', True),
    ('workiq', 'Work IQ', True),
    ('playwright', 'Playwright', True),
    ('computer-use', 'Computer Use', True),
    ('dictation', 'Dictation', True),
    ('azure', 'Azure (optional)', False),
    ('devbox', 'Dev box (optional)', False),
    ('research', 'Research tools (optional)', False),
    ('practice', 'Practice repo (at the workshop)', False),
)
STATUSES = ('ok', 'skipped', 'blocked', 'failed', 'pending')

# On a Mac without the Command Line Tools, these /usr/bin stubs open an install dialog when they run.
CLT_STUBS = {'git', 'python3', 'pip3', 'make', 'clang', 'gcc', 'cc', 'xcrun'}

SECRET_PATTERNS = [
    r'gh[pousr]_[A-Za-z0-9]{30,}',
    r'github_pat_[A-Za-z0-9_]{30,}',
    r'AKIA[0-9A-Z]{16}',
    r'\bsk-[A-Za-z0-9_-]{24,}',
    r'sk-mrv_[A-Za-z0-9]{8,}',
    r'-----BEGIN [A-Z ]*PRIVATE KEY',
    r'xox[baprs]-[A-Za-z0-9-]{10,}',
    r'\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}',
    r'[?&]sig=[A-Za-z0-9%]{20,}',
    r'AccountKey=[A-Za-z0-9+/=]{20,}',
]
URL_USERINFO = re.compile(r'(https?://)[^/\s@]+@')


def now():
    return dt.datetime.now().astimezone().isoformat(timespec='seconds')


def stamp():
    return dt.datetime.now().strftime('%Y%m%d-%H%M%S')


def tilde(path):
    """A path for display, with the home folder as ~."""
    text, home = str(path), str(HOME)
    return '~' + text[len(home):] if text == home or text.startswith(home + os.sep) else text


def expand(path):
    return Path(os.path.expandvars(str(path))).expanduser()


def redact(text):
    """Remove user info from URLs and anything that looks like a token or key."""
    text = URL_USERINFO.sub(r'\1', text)
    for pattern in SECRET_PATTERNS:
        text = re.sub(pattern, '<redacted>', text)
    return text


def kill_tree(pid):
    """Stop a process and everything it started. On Windows a .cmd shim's real work runs in a grandchild that
    killing the shim leaves behind; on POSIX the commands here run in their own process group."""
    try:
        if IS_WIN:
            subprocess.run(['taskkill', '/PID', str(pid), '/T', '/F'], stdin=subprocess.DEVNULL,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30, **NOWINDOW)
        else:
            os.killpg(pid, signal.SIGKILL)
    except (OSError, subprocess.SubprocessError):
        pass


def spawn_kwargs():
    """Popen options: no window on Windows, a process group of its own elsewhere (so a timeout can stop all of it)."""
    return dict(NOWINDOW) if IS_WIN else {'start_new_session': True}


def run(cmd, timeout=30, cwd=None, env=None):
    """Run a command with no stdin and a timeout that stops the whole process tree. Never raises; returns
    (exit code, stdout, stderr)."""
    cmd = [str(c) for c in cmd]
    try:
        proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                cwd=str(cwd) if cwd else None, env=env or ENV, **spawn_kwargs())
    except FileNotFoundError:
        return 127, '', 'not found'
    except OSError as error:
        return 126, '', str(error)
    try:
        out, err = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        kill_tree(proc.pid)
        try:
            proc.communicate(timeout=5)
        except (subprocess.TimeoutExpired, OSError, ValueError):
            pass
        return 124, '', 'timed out after %ds' % timeout
    return proc.returncode, out.decode('utf-8', 'replace').strip(), err.decode('utf-8', 'replace').strip()


def rmtree(path, attempts=5):
    """Delete a folder. Git for Windows writes pack files read-only, so make them writable and retry."""
    def writable(func, target, _info):
        try:
            os.chmod(target, stat.S_IWRITE)
            func(target)
        except OSError:
            pass
    for attempt in range(attempts):
        if not Path(path).exists():
            return True
        shutil.rmtree(str(path), onerror=writable)
        if not Path(path).exists():
            return True
        time.sleep(0.5 * (attempt + 1))
    return not Path(path).exists()


def node_reachable(url, timeout=6):
    """True when the host answers HTTPS at all (any status) through Node's TLS, which is what npm uses; False when
    the connection fails; None without Node. curl and Python can disagree with npm here (schannel on Windows, and
    python.org's Python on macOS without root certificates)."""
    node = which('node')
    if not node:
        return None
    script = ("const u=process.argv[1];const r=require('https').request(u,{method:'HEAD',timeout:%d},"
              "x=>{console.log(x.statusCode);process.exit(0)});r.on('timeout',()=>r.destroy(new Error('timeout')));"
              "r.on('error',()=>{console.log('000');process.exit(0)});r.end()" % (timeout * 1000))
    code, out, _ = run([node, '-e', script, url], timeout=timeout + 10)
    status = out.strip()[-3:]
    return status.isdigit() and status != '000'


_CLT = []


def clt_installed():
    """macOS Command Line Tools (git and python3 come from them). True elsewhere."""
    if not IS_MAC:
        return True
    if not _CLT:
        code, out, _ = run(['/usr/bin/xcode-select', '-p'], timeout=10)
        _CLT.append(code == 0 and bool(out) and Path(out).exists())
    return _CLT[0]


def which(name):
    """The command's path, or None. A macOS /usr/bin stub counts as missing while the Command Line Tools are."""
    path = shutil.which(name, path=ENV.get('PATH'))
    if not path:
        return None
    if IS_MAC and name in CLT_STUBS and os.path.dirname(os.path.realpath(path)) == '/usr/bin' and not clt_installed():
        return None
    return path


def first_line(text):
    return (text or '').strip().splitlines()[0].strip() if (text or '').strip() else ''


def version_tuple(text):
    m = re.search(r'(\d+)\.(\d+)(?:\.(\d+))?', text or '')
    return tuple(int(x or 0) for x in m.groups()) if m else None


def read_json(path, default=None):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8-sig'))
    except (OSError, ValueError):
        return default


def write_atomic(path, text, mode_from=None):
    """Write text exactly as given (no newline translation) through a temporary file and an atomic replace."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name('.%s.%d.tmp' % (path.name, os.getpid()))
    with open(tmp, 'w', encoding='utf-8', newline='') as handle:
        handle.write(text)
    if mode_from and Path(mode_from).exists():
        shutil.copymode(str(mode_from), str(tmp))
    for attempt in range(6):
        try:
            os.replace(str(tmp), str(path))
            return
        except OSError as error:
            # Windows: a scanner or reader can hold the file for a moment (errors 5, 32, 33).
            if not IS_WIN or getattr(error, 'winerror', None) not in (5, 32, 33) or attempt == 5:
                try:
                    tmp.unlink()
                except OSError:
                    pass
                raise
            time.sleep(0.25 * (attempt + 1))


# ---------------------------------------------------------------- places

def desktop_dir():
    """The Desktop folder (on Windows the real one, which OneDrive may have moved). WORKSHOP_SETUP_DESKTOP overrides."""
    override = os.environ.get('WORKSHOP_SETUP_DESKTOP')
    if override:
        return expand(override)
    if IS_WIN:
        try:
            import ctypes
            from ctypes import wintypes

            class GUID(ctypes.Structure):
                _fields_ = [('Data1', wintypes.DWORD), ('Data2', wintypes.WORD), ('Data3', wintypes.WORD),
                            ('Data4', ctypes.c_ubyte * 8)]

            desktop = GUID(0xB4BFCC3A, 0xDB2C, 0x424C, (ctypes.c_ubyte * 8)(0xB0, 0x29, 0x7F, 0xE9, 0x9A, 0x87, 0xC6, 0x41))
            out = ctypes.c_wchar_p()
            if ctypes.windll.shell32.SHGetKnownFolderPath(ctypes.byref(desktop), 0, None, ctypes.byref(out)) == 0:
                try:
                    return Path(out.value)
                finally:
                    ctypes.windll.ole32.CoTaskMemFree(out)
        except Exception:  # noqa: BLE001 - fall back to the usual place
            pass
    return HOME / 'Desktop'


def insiders_user_dir():
    """VS Code Insiders' user folder (the default profile's settings.json and mcp.json are in it)."""
    if IS_MAC:
        return HOME / 'Library' / 'Application Support' / 'Code - Insiders' / 'User'
    if IS_WIN:
        return Path(os.environ.get('APPDATA') or (HOME / 'AppData' / 'Roaming')) / 'Code - Insiders' / 'User'
    return Path(os.environ.get('XDG_CONFIG_HOME') or (HOME / '.config')) / 'Code - Insiders' / 'User'


def insiders_settings_path():
    return insiders_user_dir() / 'settings.json'


def insiders_app_dirs():
    """Folders that may hold Insiders' resources/app (package.json and product.json), most likely first."""
    out = []
    if IS_MAC:
        for base in (Path('/Applications'), HOME / 'Applications'):
            out.append(base / 'Visual Studio Code - Insiders.app' / 'Contents' / 'Resources' / 'app')
    elif IS_WIN:
        roots = [os.environ.get('LOCALAPPDATA') and Path(os.environ['LOCALAPPDATA']) / 'Programs',
                 Path(os.environ.get('ProgramFiles') or r'C:\Program Files'),
                 Path(os.environ.get('ProgramFiles(x86)') or r'C:\Program Files (x86)')]
        for root in filter(None, roots):
            install = root / 'Microsoft VS Code Insiders'
            out.append(install / 'resources' / 'app')
            if install.is_dir():
                # Newer builds can keep the app in a folder per version next to the launcher.
                out += sorted(install.glob('*/resources/app'), key=lambda p: p.stat().st_mtime, reverse=True)
    else:
        for root in ('/usr/share/code-insiders', '/opt/visual-studio-code-insiders',
                     '/snap/code-insiders/current/usr/share/code-insiders'):
            out.append(Path(root) / 'resources' / 'app')
    return out


def load_workshop():
    data = read_json(REFS / 'workshop.json', {}) or {}
    practice = data.setdefault('practice', {})
    practice.setdefault('dir', '~/Code/excalidraw-workshop')
    data.setdefault('node_min', 18)
    data.setdefault('readiness_file', 'Workshop readiness.md')
    data.setdefault('settings_snippet', 'workshop-settings.jsonc')
    return data


# ---------------------------------------------------------------- progress file

def load_state():
    data = read_json(STATE_FILE, {}) or {}
    data.setdefault('version', 1)
    data.setdefault('steps', {})
    data.setdefault('answers', {})
    return data


def save_state(data):
    data.setdefault('started', now())
    data['updated'] = now()
    write_atomic(STATE_FILE, json.dumps(data, indent=1, sort_keys=True) + '\n')


def devbox_mode(answers=None):
    """Dev box mode: the setup prompt said "on my dev box" (saved as setup_mode=devbox). The machine never decides it."""
    if answers is None:
        answers = load_state().get('answers') or {}
    return str((answers or {}).get('setup_mode', '')).strip().lower() == 'devbox'


def set_answers(**answers):
    data = load_state()
    data['answers'].update({k: v for k, v in answers.items() if v is not None})
    save_state(data)
    return data


# ---------------------------------------------------------------- JSONC

class JSONCError(ValueError):
    pass


_SCALAR = re.compile(r'-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null')


def _skip(text, i):
    """Index of the next character that is not whitespace or part of a comment."""
    n = len(text)
    while i < n:
        c = text[i]
        if c in ' \t\r\n\ufeff':
            i += 1
        elif text.startswith('//', i):
            j = text.find('\n', i)
            i = n if j < 0 else j + 1
        elif text.startswith('/*', i):
            j = text.find('*/', i + 2)
            if j < 0:
                raise JSONCError('a comment is never closed')
            i = j + 2
        else:
            break
    return i


def _string_end(text, i):
    j, n = i + 1, len(text)
    while j < n:
        c = text[j]
        if c == '\\':
            j += 2
        elif c == '"':
            return j + 1
        elif c == '\n':
            break
        else:
            j += 1
    raise JSONCError('a string is never closed (character %d)' % i)


def _value_end(text, i):
    n = len(text)
    if i >= n:
        raise JSONCError('a value is missing')
    c = text[i]
    if c == '"':
        return _string_end(text, i)
    if c in '{[':
        depth, j = 0, i
        while j < n:
            ch = text[j]
            if ch == '"':
                j = _string_end(text, j)
                continue
            if ch == '/' and text.startswith(('//', '/*'), j):
                j = _skip(text, j)
                continue
            if ch in '{[':
                depth += 1
            elif ch in '}]':
                depth -= 1
                if depth == 0:
                    return j + 1
            j += 1
        raise JSONCError('a value is never closed (character %d)' % i)
    m = _SCALAR.match(text, i)
    if not m:
        raise JSONCError('unexpected %r at character %d' % (c, i))
    return m.end()


def strict_json(text):
    """JSONC (comments and trailing commas) as plain JSON text."""
    out, i, n = [], 0, len(text)
    while i < n:
        c = text[i]
        if c == '"':
            j = _string_end(text, i)
            out.append(text[i:j])
            i = j
        elif c == '/' and text.startswith(('//', '/*'), i):
            i = _skip(text, i)
            out.append(' ')
        elif c == ',':
            j = _skip(text, i + 1)
            if not (j < n and text[j] in '}]'):
                out.append(c)
            i += 1
        else:
            out.append(c)
            i += 1
    return ''.join(out)


def parse_jsonc(text):
    text = text.lstrip('\ufeff')
    plain = strict_json(text)
    if not plain.strip():
        return {}
    try:
        return json.loads(plain)
    except ValueError as error:
        raise JSONCError(str(error))


def members(text):
    """The top-level object of a JSONC text: {'open', 'close', 'items': [{'key', 'start', 'value_start', 'value_end',
    'comma'}]}, with character indexes; None for an empty text."""
    n = len(text)
    i = _skip(text, 0)
    if i >= n:
        return None
    if text[i] != '{':
        raise JSONCError('the file is not a JSON object')
    info = {'open': i, 'close': None, 'items': []}
    i = _skip(text, i + 1)
    while True:
        if i >= n:
            raise JSONCError('the object is never closed')
        if text[i] == '}':
            info['close'] = i
            break
        if text[i] != '"':
            raise JSONCError('expected a setting name at character %d' % i)
        key_end = _string_end(text, i)
        key = json.loads(text[i:key_end])
        j = _skip(text, key_end)
        if j >= n or text[j] != ':':
            raise JSONCError('expected ":" after "%s"' % key)
        value_start = _skip(text, j + 1)
        value_end = _value_end(text, value_start)
        item = {'key': key, 'start': i, 'value_start': value_start, 'value_end': value_end, 'comma': None}
        k = _skip(text, value_end)
        if k < n and text[k] == ',':
            item['comma'] = k
            k = _skip(text, k + 1)
        elif k < n and text[k] != '}':
            raise JSONCError('expected "," or "}" after "%s"' % key)
        info['items'].append(item)
        i = k
    if _skip(text, info['close'] + 1) < n:
        raise JSONCError('there is text after the settings object')
    return info


def snippet_entries(text):
    """[(key, value, [comment lines])] from a JSONC snippet, in order. A key's comments are the // lines between the
    previous member's line and the key; a comment on the previous member's own line stays with that member."""
    info = members(text)
    out = []
    if not info:
        return out
    prev = info['open'] + 1
    for item in info['items']:
        newline = text.find('\n', prev, item['start'])
        between = text[newline + 1:item['start']] if newline >= 0 else ''
        comments = [line.strip()[2:].strip() for line in between.splitlines() if line.strip().startswith('//')]
        out.append((item['key'], parse_jsonc(text[item['value_start']:item['value_end']]), comments))
        prev = item['comma'] + 1 if item['comma'] is not None else item['value_end']
    return out


def _line_indent(text, pos):
    start = text.rfind('\n', 0, pos) + 1
    lead = text[start:pos]
    return lead if lead.strip() == '' else None


def _format(value, indent, unit, nl='\n'):
    if isinstance(value, (dict, list)) and value:
        return json.dumps(value, indent=unit, ensure_ascii=False).replace('\n', nl + indent)
    return json.dumps(value, ensure_ascii=False)


def merge_settings(text, entries):
    """Set each (key, value, comments) in a settings.json text and keep everything else exactly as it is (comments,
    order, formatting, line endings). Returns (new text, changed keys, added keys)."""
    nl = '\r\n' if '\r\n' in text else '\n'
    info = members(text)
    if info is None:
        lines = []
        for key, value, comments in entries:
            lines += ['\t// ' + c for c in comments]
            lines.append('\t%s: %s,' % (json.dumps(key), _format(value, '\t', '\t', nl)))
        if lines:
            lines[-1] = lines[-1][:-1]
        return '{' + nl + nl.join(lines) + nl + '}' + nl, [], [k for k, _, _ in entries]
    items = info['items']
    indent = (_line_indent(text, items[0]['start']) if items else None) or '\t'
    unit = indent
    by_key = {}
    for item in items:
        by_key.setdefault(item['key'], []).append(item)
    edits, changed, added = [], [], []
    for key, value, comments in entries:
        if key not in by_key:
            added.append((key, value, comments))
            continue
        for item in by_key[key]:  # VS Code reads the last duplicate; set them all
            if parse_jsonc(text[item['value_start']:item['value_end']]) != value:
                own = _line_indent(text, item['start']) or indent
                edits.append((item['value_start'], item['value_end'], _format(value, own, unit, nl)))
                if key not in changed:
                    changed.append(key)
    if added:
        lines = []
        for key, value, comments in added:
            lines += [indent + '// ' + c for c in comments]
            lines.append('%s%s: %s,' % (indent, json.dumps(key), _format(value, indent, unit, nl)))
        lines[-1] = lines[-1][:-1]
        block = nl.join(lines)
        close = info['close']
        line_start = text.rfind('\n', 0, close) + 1
        if line_start > info['open'] and text[line_start:close].strip() == '':
            at, insert = line_start, block + nl  # the closing brace has its own line: add the members above it
        else:
            at, insert = close, nl + block + nl
        if items and items[-1]['comma'] is None:
            if items[-1]['value_end'] == at:
                insert = ',' + insert
            else:
                edits.append((items[-1]['value_end'], items[-1]['value_end'], ','))
        edits.append((at, at, insert))
    new = text
    for start, end, replacement in sorted(edits, key=lambda e: (e[0], e[1]), reverse=True):
        new = new[:start] + replacement + new[end:]
    return new, changed, [k for k, _, _ in added]


def remove_settings(text, entries):
    """Remove the keys of (key, value, comments) entries from a settings.json text: every copy of each key, the comment
    lines right above it that match the entry's comments (the ones merge_settings added), and the comma that would be
    left dangling. Everything else stays as it was. Returns (new text, removed keys, members left)."""
    comments = {key: ['// ' + c for c in cs] for key, _, cs in entries}
    removed = []
    while True:
        info = members(text)
        items = info['items'] if info else []
        hits = [i for i, item in enumerate(items) if item['key'] in comments]
        if not hits:
            return text, removed, len(items)
        index = hits[-1]
        item = items[index]
        start = item['start']
        line_start = text.rfind('\n', 0, start) + 1
        own_line = text[line_start:start].strip() == ''
        if own_line:
            start = line_start
            wanted = list(comments[item['key']])
            while wanted and start > 0:
                prev_start = text.rfind('\n', 0, start - 1) + 1
                if text[prev_start:start].strip() != wanted[-1]:
                    break
                wanted.pop()
                start = prev_start
        end = item['comma'] + 1 if item['comma'] is not None else item['value_end']
        line_end = text.find('\n', end)
        if own_line and text[end:line_end if line_end >= 0 else len(text)].strip() == '':
            end = line_end + 1 if line_end >= 0 else len(text)
        edits = [(start, end)]
        if item['comma'] is None and index > 0 and items[index - 1]['comma'] is not None:
            # It was the last member: the one before it must not keep a trailing comma.
            edits.append((items[index - 1]['comma'], items[index - 1]['comma'] + 1))
        for a, b in sorted(edits, reverse=True):
            text = text[:a] + text[b:]
        if item['key'] not in removed:
            removed.append(item['key'])

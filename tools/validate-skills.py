#!/usr/bin/env python3
"""Validate this skills repo before anything is committed, pushed, or published.

The skills live in two repos: a private one that has everything, and the public one, which gets the
same tree without private/ and without the paths .publishignore lists (tools/publish-public.py builds
it and runs this script on it). Unpublished paths get only the secret checks and the script parse
checks; everything else gets all of the checks below.

Errors (exit 1):
  - a skill folder without valid frontmatter, a name that differs from its folder, a duplicate
    name, or a description over 1024 characters (the skill registry silently skips those)
  - a relative markdown link that does not resolve
  - an em or en dash in skill text or scripts (documenting the characters inside backticks is fine)
  - DEMO-RULES.md rules (from "## Truth" to the end) that differ from the rules section of
    autonomous-demos/SKILL.md (from "**Truth**" to the next "## " heading)
  - a script that does not parse (node --check, Python compile, bash -n; Git Bash on Windows)
  - in any text file, whatever its extension: something that looks like a secret, an absolute
    personal path (/Users/<name>/), an email address, or a term from a private terms file
    (--private-terms, repeatable; private/private-terms.txt is always read when it exists; one
    literal or /regex/ per line, # for comments). Private terms are reported by number only, so this
    output is safe to paste anywhere. --private-terms-warn reports them as warnings instead. A literal
    term that a public names list also has (a name that went public, like a GA model) is not checked:
    private/public-terms.txt in the tree, next to each --private-terms file and next to this script,
    and --public-terms FILE.
  - a file whose name suggests secrets or raw session data (.env, *.pem, *.key, research.env,
    messages.jsonl, voice-samples.md, state.json, ...), a symlink, or a missing --private-terms file.
    In the private repo, private/private-terms.txt and the weekly miner's state in private/skill-miner/
    (voice-samples.md, notes.md, state.json, ledger.json, runner.json) are allowed.
  - in a published tree (--published, or a tree without .publishignore such as the public repo):
    anything under private/ or my-taste/ (a private-only skill), .publishignore itself, and an HTML
    comment that starts with "propagation test" (the sync's own test edit, never published)
  - with --base REF: a binary file added since REF (the publish step publishes text only)
  - with --commits REF: the same secret, path, email, and private term checks on every commit
    message and every added line in REF..HEAD, and any binary file in those commits.
Warnings:
  - a description over 1000 characters, a SKILL.md over 35 KB, a script with a shebang that is not
    executable, a skill that README.md does not mention, a binary file (without --base)

--secrets-only (needs --commits REF) is the quick check the sync runs before every push to the
private repo: secret-looking text in REF..HEAD and secret-looking file names it adds are errors;
private terms, personal paths, email addresses, and binary files are warnings. Nothing else runs.
--scan-files FILE... only looks for secrets in the given files and prints FILE:LINE for each hit
(the sync uses it for conflict branches and the message export).

Usage: validate-skills.py [--private-terms FILE]... [--private-terms-warn] [--base origin/main]
                          [--commits origin/main] [--secrets-only] [--quiet]
       validate-skills.py --scan-files FILE...
"""
import argparse
import difflib
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
TEXT_SUFFIXES = {'.md', '.mjs', '.cjs', '.js', '.ts', '.py', '.sh', '.txt', '.template', '.json', '.yml', '.yaml', '.html', '.css'}
SECRET_PATTERNS = [
    (r'gh[pousr]_[A-Za-z0-9]{30,}', 'GitHub token'),
    (r'github_pat_[A-Za-z0-9_]{30,}', 'GitHub token'),
    (r'AKIA[0-9A-Z]{16}', 'AWS key'),
    (r'\bsk-[A-Za-z0-9_-]{24,}', 'API key'),
    (r'sk-mrv_[A-Za-z0-9]{8,}', 'Marvin secret'),
    (r'-----BEGIN [A-Z ]*PRIVATE KEY', 'private key'),
    (r'xox[baprs]-[A-Za-z0-9-]{10,}', 'Slack token'),
    (r'\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}', 'JWT'),
    (r'[?&]sig=[A-Za-z0-9%]{20,}', 'signed URL (SAS)'),
    (r'AccountKey=[A-Za-z0-9+/=]{20,}', 'storage account key'),
    (r'(?i)\b(password|passwd|api[_-]?key|client[_-]?secret)\s*[:=]\s*["\'][^"\'\s]{8,}["\']', 'credential assignment'),
]
PERSONAL_PATH = re.compile(r'(/Users|/home)/(?!<|\$|\{|USER\b|you\b|name\b|me\b|Shared/)[A-Za-z0-9._-]+/')
EMAIL = re.compile(r'(?<![\w.+-])[\w.+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b')
EMAIL_OK = re.compile(r'(?i)(@users\.noreply\.github\.com|@example\.(com|org|net)|^git@github\.com)$')
SENSITIVE_NAME = re.compile(
    r'(?i)^(\.env(\.(?!example$|template$|sample$)[^/]+)?|.*\.(pem|key|p12|pfx|keychain|keychain-db|sqlite|db)'
    r'|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|\.netrc|\.npmrc|credentials(\.json)?|research\.env'
    r'|messages\.jsonl|events\.jsonl|digest-part-\d+\.md|voice-samples\.md|private-terms\.txt|state\.json)$')
REPO_TERMS = 'private/private-terms.txt'
REPO_PUBLIC = 'private/public-terms.txt'
# Files with sensitive names that belong in the private repo, never in a published one.
PRIVATE_ALLOWED = {REPO_TERMS} | {f'private/skill-miner/{name}' for name in
                                  ('voice-samples.md', 'notes.md', 'state.json', 'ledger.json', 'runner.json')}

parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument('--private-terms', action='append', default=[], metavar='FILE',
                    help='file of terms that must never be published (repeatable)')
parser.add_argument('--private-terms-warn', action='store_true', help='report private terms as warnings, not errors')
parser.add_argument('--public-terms', action='append', default=[], metavar='FILE',
                    help='names that are public, one per line: never treated as private terms (repeatable)')
parser.add_argument('--base', help='git ref the changes will be published on top of (for example origin/main)')
parser.add_argument('--commits', help='also scan commit messages and added lines in REF..HEAD')
parser.add_argument('--secrets-only', action='store_true',
                    help='with --commits: only the secret checks on REF..HEAD (the sync runs this before pushing)')
parser.add_argument('--scan-files', nargs='+', metavar='FILE',
                    help='only look for secrets in these files, line by line (prints FILE:LINE for each hit)')
parser.add_argument('--repo', help='the repo to check (default: the one this script is in)')
parser.add_argument('--published', action='store_true',
                    help='check a tree that is (or will be) published: private/ must not exist and every check applies '
                         '(also the default for a tree without .publishignore, like the public repo)')
parser.add_argument('--quiet', action='store_true')
args = parser.parse_args()
if args.repo:
    REPO = Path(args.repo).expanduser().resolve()
if args.secrets_only and not args.commits:
    parser.error('--secrets-only needs --commits REF')
if args.scan_files:
    hits = 0
    for name in args.scan_files:
        try:
            text = Path(name).read_text(encoding='utf-8', errors='replace')
        except OSError as error:
            print(f'error: {name}: {error}')
            hits += 1
            continue
        for number, line in enumerate(text.splitlines(), 1):
            label = next((label for pattern, label in SECRET_PATTERNS if re.search(pattern, line)), None)
            if label:
                print(f'error: {name}:{number}: looks like a {label}')
                hits += 1
    sys.exit(1 if hits else 0)

errors, warnings = [], []


def git_paths(*cmd):
    r = subprocess.run(['git', '-C', str(REPO), *cmd, '-z'], capture_output=True)
    if r.returncode:
        return None
    return [x for x in r.stdout.decode('utf-8', 'surrogateescape').split('\0') if x]


def git_out(*cmd):
    r = subprocess.run(['git', '-C', str(REPO), *cmd], capture_output=True)
    return r.stdout.decode('utf-8', 'replace') if r.returncode == 0 else None


def files():
    paths = git_paths('ls-files', '--cached', '--others', '--exclude-standard')
    if paths is None:
        paths = [p.relative_to(REPO).as_posix() for p in REPO.rglob('*') if '.git' not in p.relative_to(REPO).parts]
    out = []
    for rel in sorted(set(paths)):
        full = REPO / rel
        if full.is_symlink():
            errors.append(f'{rel}: symlink (publish regular files only; a link can expose a local path)')
        elif full.is_file():
            out.append(full)
    return out


def is_text(p):
    try:
        data = p.read_bytes()
    except OSError:
        return False
    if not data:
        return True
    if b'\0' in data[:65536]:
        return False
    try:
        data.decode('utf-8')
        return True
    except UnicodeDecodeError:
        return False


def relpath(p):
    return p.relative_to(REPO).as_posix()


ALL = files()
TEXT = [p for p in ALL if is_text(p)]
BINARY = [p for p in ALL if p not in TEXT]
CODE = [p for p in TEXT if p.suffix in TEXT_SUFFIXES or p.name == '.gitignore']


def unpublished_paths():
    out = {r for r in map(relpath, ALL) if r == '.publishignore' or r.startswith('private/')}
    rules = REPO / '.publishignore'
    if rules.is_file():
        for which in ('-c', '-o'):
            out |= set(git_paths('ls-files', '-i', which, f'--exclude-from={rules}') or [])
    return out


# A published tree (the publish step's, or the public repo, which has no .publishignore) must never contain
# private/ or the private-only my-taste skill: everything in it gets every check, and anything under them is an error.
PRIVATE_ONLY = ('private/', 'my-taste/')
PUBLISHED_TREE = args.published or (not args.secrets_only and not (REPO / '.publishignore').is_file())
UNPUBLISHED = set() if PUBLISHED_TREE else unpublished_paths()


def published(rel):
    if PUBLISHED_TREE:
        return True
    return not (rel == '.publishignore' or rel.startswith('private/') or rel in UNPUBLISHED)


def read(p):
    try:
        return p.read_text(encoding='utf-8')
    except (UnicodeDecodeError, OSError):
        return ''


TOUCHED = None
if args.secrets_only:
    TOUCHED = set(git_paths('diff', '--name-only', '--diff-filter=AMCR', f'{args.commits}...HEAD') or [])

# 0. File names and binaries
for p in ALL:
    rel = relpath(p)
    if PUBLISHED_TREE and (rel.startswith(PRIVATE_ONLY) or rel == '.publishignore'):
        errors.append(f'{rel}: private/, my-taste/ and .publishignore must never be in a published tree')
        continue
    allowed = rel in PRIVATE_ALLOWED and not PUBLISHED_TREE
    if SENSITIVE_NAME.match(p.name) and not allowed and (TOUCHED is None or rel in TOUCHED):
        errors.append(f'{rel}: file name suggests secrets or raw session data; keep it out of the repo')
new_since_base = None
if args.base and not args.secrets_only:
    added = git_paths('diff', '--name-only', '--diff-filter=A', args.base)
    untracked = git_paths('ls-files', '--others', '--exclude-standard')
    if added is None or untracked is None:
        errors.append(f'--base {args.base}: not a git ref here')
    else:
        new_since_base = set(added) | set(untracked)
if not args.secrets_only:
    for p in BINARY:
        rel = relpath(p)
        if not published(rel):
            continue
        if new_since_base is not None and rel in new_since_base:
            errors.append(f'{rel}: binary file added since {args.base} (publish text only)')
        elif new_since_base is None:
            warnings.append(f'{rel}: binary file; check it by eye, scanners cannot read it')


def normalized(lines):
    out = []
    for line in (l.rstrip() for l in lines):
        if line or (out and out[-1]):
            out.append(line)
    while out and not out[-1]:
        out.pop()
    return out


def find_bash():
    if os.name != 'nt':
        return shutil.which('bash')
    # The bash.exe on PATH is usually WSL's, which cannot read Windows paths: use Git Bash.
    candidates = []
    git_exe = shutil.which('git')
    if git_exe:
        root = Path(git_exe).resolve().parent.parent
        candidates += [root / 'bin' / 'bash.exe', root / 'usr' / 'bin' / 'bash.exe']
    candidates.append(Path(os.environ.get('ProgramFiles', r'C:\Program Files')) / 'Git' / 'bin' / 'bash.exe')
    return next((str(c) for c in candidates if c.is_file()), None)


skills = []
if not args.secrets_only:
    # 1. Skills and frontmatter
    names = {}
    for d in sorted(p for p in REPO.iterdir() if p.is_dir() and (p / 'SKILL.md').is_file()):
        skills.append(d.name)
        text = read(d / 'SKILL.md')
        m = re.match(r'^---\n(.*?)\n---\n', text, re.S)
        if not m:
            errors.append(f'{d.name}/SKILL.md: missing frontmatter')
            continue
        fm = m.group(1)
        name = re.search(r'^name:\s*(.+)$', fm, re.M)
        desc = re.search(r'^description:\s*(.+)$', fm, re.M)
        if not name or not desc:
            errors.append(f'{d.name}/SKILL.md: frontmatter needs name and description')
            continue
        name = name.group(1).strip().strip('"\'')
        desc = desc.group(1).strip()
        if desc.startswith('"') and desc.endswith('"'):
            desc = desc[1:-1].replace('\\"', '"')
        if name != d.name:
            errors.append(f'{d.name}/SKILL.md: name "{name}" differs from its folder')
        if name in names:
            errors.append(f'{d.name}/SKILL.md: duplicate skill name "{name}" (also {names[name]})')
        names[name] = d.name
        if len(desc) > 1024:
            errors.append(f'{d.name}: description is {len(desc)} characters (limit 1024)')
        elif len(desc) > 1000:
            warnings.append(f'{d.name}: description is {len(desc)} characters (close to the 1024 limit)')
        size = (d / 'SKILL.md').stat().st_size
        if size > 35000:
            warnings.append(f'{d.name}/SKILL.md is {size // 1000} KB; move detail into references/')

    readme = read(REPO / 'README.md')
    for s in skills:
        if readme and s not in readme and published(f'{s}/SKILL.md'):
            warnings.append(f'README.md does not mention {s}')

    # 2. Relative links (published markdown only)
    for p in CODE:
        rel = relpath(p)
        if p.suffix != '.md' or 'docs' in rel.split('/') or not published(rel):
            continue
        for link in re.findall(r'\]\(([^)\s#]+)(?:#[^)]*)?\)', read(p)):
            if re.match(r'^[a-z]+:', link):
                continue
            if not (p.parent / link).resolve().exists():
                errors.append(f'{rel}: broken link {link}')

    # 3. Dashes (outside backticks, published text only)
    for p in TEXT:
        rel = relpath(p)
        if 'docs' in rel.split('/') or not published(rel):
            continue
        for n, line in enumerate(read(p).splitlines(), 1):
            stripped = re.sub(r'`[^`]*`', '', line)
            if '\u2014' in stripped or '\u2013' in stripped:
                errors.append(f'{rel}:{n}: em or en dash')

    # 4. DEMO-RULES.md mirrored in autonomous-demos
    rules, demos = REPO / 'DEMO-RULES.md', REPO / 'autonomous-demos' / 'SKILL.md'
    if rules.is_file() and demos.is_file():
        doc_lines, skill_lines = read(rules).splitlines(), read(demos).splitlines()
        doc_start = next((i for i, l in enumerate(doc_lines) if l.strip() == '## Truth'), None)
        skill_start = next((i for i, l in enumerate(skill_lines) if l.strip() == '**Truth**'), None)
        if doc_start is None or skill_start is None:
            errors.append('DEMO-RULES.md needs a "## Truth" heading and autonomous-demos/SKILL.md a "**Truth**" line')
        else:
            skill_end = next((i for i in range(skill_start + 1, len(skill_lines)) if skill_lines[i].startswith('## ')),
                             len(skill_lines))
            doc = normalized(re.sub(r'^## (.+)$', r'**\1**', l) for l in doc_lines[doc_start:])
            skill = normalized(skill_lines[skill_start:skill_end])
            if doc != skill:
                diff = [l for l in difflib.unified_diff(doc, skill, 'DEMO-RULES.md', 'autonomous-demos/SKILL.md', n=0, lineterm='')
                        if l[:1] in '+-' and not l.startswith(('+++', '---'))]
                first = diff[0] if diff else ''
                errors.append(f'DEMO-RULES.md and the autonomous-demos rules differ ({len(diff)} line(s)); '
                              f'first: {first[:90]!r}. Make the same edit in both files.')

    # 5. Scripts parse (unpublished ones too)
    node, bash = shutil.which('node'), find_bash()
    for p in CODE:
        rel = relpath(p)
        if p.suffix in ('.mjs', '.cjs', '.js') and 'docs' not in rel.split('/') and node:
            r = subprocess.run([node, '--check', str(p)], capture_output=True, text=True)
            if r.returncode:
                errors.append(f'{rel}: node --check failed: {r.stderr.strip().splitlines()[0] if r.stderr.strip() else ""}')
        elif p.suffix == '.py':
            try:
                compile(read(p), str(p), 'exec')
            except SyntaxError as e:
                errors.append(f'{rel}: Python syntax error line {e.lineno}: {e.msg}')
        elif p.suffix == '.sh' and bash:
            r = subprocess.run([bash, '-n', str(p)], capture_output=True, text=True)
            if r.returncode:
                errors.append(f'{rel}: bash -n failed: {r.stderr.strip()[:160]}')
        if (p.suffix in ('.mjs', '.cjs', '.js', '.py', '.sh') and read(p).startswith('#!') and os.name != 'nt'
                and not os.access(p, os.X_OK)):
            warnings.append(f'{rel}: has a shebang but is not executable (chmod +x)')

# 6. Secrets, personal paths, private terms
private = []
terms_files = [Path(t).expanduser() for t in args.private_terms]
if (REPO / REPO_TERMS).is_file() and all(t.resolve() != (REPO / REPO_TERMS).resolve() for t in terms_files):
    terms_files.append(REPO / REPO_TERMS)
# A name that went public (a GA model, say) must never block a publish, even while some machine's list still has it.
public_names = set()
explicit_public = [Path(p).expanduser() for p in args.public_terms]
for pf in explicit_public + [REPO / REPO_PUBLIC, Path(__file__).resolve().parents[1] / REPO_PUBLIC] + [
        t.with_name('public-terms.txt') for t in terms_files]:
    try:
        text = pf.read_text(encoding='utf-8-sig')
    except OSError:
        if pf in explicit_public:
            errors.append(f'public terms file not found: {pf}')
        continue
    public_names |= {n.split('#', 1)[0].strip().lower() for n in text.splitlines() if n.split('#', 1)[0].strip()}
for index, pt in enumerate(terms_files, 1):
    label = REPO_TERMS if pt.resolve() == (REPO / REPO_TERMS).resolve() else f'private terms file {index}'
    if not pt.is_file():
        errors.append(f'private terms file not found: {pt}')
        continue
    for number, line in enumerate(pt.read_text(encoding='utf-8').splitlines(), 1):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        try:
            if len(line) > 2 and line.startswith('/') and line.endswith('/'):
                private.append((re.compile(line[1:-1], re.I), f'line {number} of {label}'))
            elif line.lower() not in public_names:
                private.append((re.compile(r'(?<![A-Za-z0-9])' + re.escape(line) + r'(?![A-Za-z0-9])', re.I),
                                f'line {number} of {label}'))
        except re.error:
            errors.append(f'{label} line {number}: invalid regex')

soft = warnings if args.secrets_only else errors
term_sink = warnings if (args.secrets_only or args.private_terms_warn) else errors


def scan(where, line, privacy=True):
    for pattern, label in SECRET_PATTERNS:
        if re.search(pattern, line):
            errors.append(f'{where}: looks like a {label}')
    if not privacy:
        return
    if PERSONAL_PATH.search(line):
        soft.append(f'{where}: absolute personal path (use ~ or $HOME)')
    for m in EMAIL.finditer(line):
        if not EMAIL_OK.search(m.group(0)):
            soft.append(f'{where}: email address')
    for pattern, label in private:
        if pattern.search(line):
            term_sink.append(f'{where}: private term ({label})')


PROPAGATION_TEST = re.compile(r'<!--\s*propagation test', re.I)
if not args.secrets_only:
    for p in TEXT:
        rel = relpath(p)
        for n, line in enumerate(read(p).splitlines(), 1):
            scan(f'{rel}:{n}', line, privacy=published(rel))
            if PUBLISHED_TREE and PROPAGATION_TEST.search(line):
                errors.append(f'{rel}:{n}: a sync propagation test line; wait for its revert before publishing')

# 7. Commits about to be pushed or published
if args.commits:
    revs = git_out('rev-list', '--reverse', f'{args.commits}..HEAD')
    if revs is None:
        errors.append(f'--commits {args.commits}: not a git ref here')
    for rev in (revs or '').split():
        short = rev[:7]
        for n, line in enumerate((git_out('log', '-1', '--format=%B', rev) or '').splitlines(), 1):
            scan(f'commit {short} message line {n}', line)
        for row in (git_out('show', '--format=', '--numstat', '--diff-filter=AMCR', '-m', '--first-parent', rev) or '').splitlines():
            parts = row.split('\t')
            if len(parts) == 3 and parts[0] == '-' and parts[1] == '-':
                (warnings if args.secrets_only or not published(parts[2]) else errors).append(
                    f'commit {short}: binary file {parts[2]}')
        current = '?'
        for line in (git_out('show', '--format=', '--no-color', '--no-ext-diff', '-p', '-m', '--first-parent', rev) or '').splitlines():
            if line.startswith('+++ '):
                current = line[6:] if line.startswith('+++ b/') else line[4:]
            elif line.startswith('+') and not line.startswith('+++'):
                scan(f'commit {short} {current} (added line)', line[1:], privacy=published(current))

for w in warnings:
    print(f'warning: {w}')
for e in errors:
    print(f'error: {e}')
if not args.quiet:
    if args.secrets_only:
        print(f'secret check of {args.commits}..HEAD: {len(errors)} error(s), {len(warnings)} warning(s)')
    else:
        print(f'{len(skills)} skills, {len(TEXT)} text files checked: {len(errors)} error(s), {len(warnings)} warning(s)')
sys.exit(1 if errors else 0)

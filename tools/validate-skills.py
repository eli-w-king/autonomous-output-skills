#!/usr/bin/env python3
"""Validate this skills repo before anything is committed or published.

Errors (exit 1):
  - a skill folder without valid frontmatter, a name that differs from its folder, a duplicate
    name, or a description over 1024 characters (the skill registry silently skips those)
  - a relative markdown link that does not resolve
  - an em or en dash in skill text or scripts (documenting the characters inside backticks is fine)
  - DEMO-RULES.md rules (from "## Truth" to the end) that differ from the rules section of
    autonomous-demos/SKILL.md (from "**Truth**" to the next "## " heading)
  - a script that does not parse (node --check, Python compile, bash -n)
  - in any text file, whatever its extension: something that looks like a secret, an absolute
    personal path (/Users/<name>/), an email address, or a term from the private terms file
    (--private-terms; one literal or /regex/ per line, # for comments). Private terms are reported
    by number only, so this output is safe to paste anywhere.
  - a file whose name suggests secrets or raw session data (.env, *.pem, *.key, research.env,
    messages.jsonl, voice-samples.md, ...), a symlink, or a missing --private-terms file
  - with --base REF: a binary file added since REF (the miner publishes text only)
  - with --commits REF: the same secret, path, email, and private term checks on every commit
    message and every added line in REF..HEAD, and any binary file in those commits. Run it right
    before pushing: intermediate commits are published too.
These matter because the repository is public.
Warnings:
  - a description over 1000 characters, a SKILL.md over 35 KB, a script with a shebang that is not
    executable, a skill that README.md does not mention, a binary file (without --base)

Usage: validate-skills.py [--private-terms ~/.copilot/skill-miner/private-terms.txt] [--base origin/main]
                          [--commits origin/main] [--quiet]
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

parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument('--private-terms', help='local file of terms that must never be published')
parser.add_argument('--base', help='git ref the changes will be published on top of (for example origin/main)')
parser.add_argument('--commits', help='also scan commit messages and added lines in REF..HEAD')
parser.add_argument('--quiet', action='store_true')
args = parser.parse_args()

errors, warnings = [], []


def git_paths(*cmd):
    r = subprocess.run(['git', '-C', str(REPO), *cmd, '-z'], capture_output=True)
    if r.returncode:
        return None
    return [x for x in r.stdout.decode('utf-8', 'surrogateescape').split('\0') if x]


def files():
    paths = git_paths('ls-files', '--cached', '--others', '--exclude-standard')
    if paths is None:
        paths = [str(p.relative_to(REPO)) for p in REPO.rglob('*') if '.git' not in p.relative_to(REPO).parts]
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


ALL = files()
TEXT = [p for p in ALL if is_text(p)]
BINARY = [p for p in ALL if p not in TEXT]
CODE = [p for p in TEXT if p.suffix in TEXT_SUFFIXES or p.name == '.gitignore']


def read(p):
    try:
        return p.read_text(encoding='utf-8')
    except (UnicodeDecodeError, OSError):
        return ''


# 0. File names and binaries
for p in ALL:
    rel = p.relative_to(REPO)
    if SENSITIVE_NAME.match(p.name):
        errors.append(f'{rel}: file name suggests secrets or raw session data; keep it out of the repo')
new_since_base = None
if args.base:
    added = git_paths('diff', '--name-only', '--diff-filter=A', args.base)
    untracked = git_paths('ls-files', '--others', '--exclude-standard')
    if added is None or untracked is None:
        errors.append(f'--base {args.base}: not a git ref here')
    else:
        new_since_base = set(added) | set(untracked)
for p in BINARY:
    rel = str(p.relative_to(REPO))
    if new_since_base is not None and rel in new_since_base:
        errors.append(f'{rel}: binary file added since {args.base} (publish text only)')
    elif new_since_base is None:
        warnings.append(f'{rel}: binary file; check it by eye, scanners cannot read it')


# 1. Skills and frontmatter
skills, names = [], {}
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
    if readme and s not in readme:
        warnings.append(f'README.md does not mention {s}')

# 2. Relative links
for p in CODE:
    if p.suffix != '.md' or 'docs' in p.relative_to(REPO).parts:
        continue
    for link in re.findall(r'\]\(([^)\s#]+)(?:#[^)]*)?\)', read(p)):
        if re.match(r'^[a-z]+:', link):
            continue
        if not (p.parent / link).resolve().exists():
            errors.append(f'{p.relative_to(REPO)}: broken link {link}')

# 3. Dashes (outside backticks)
for p in TEXT:
    if 'docs' in p.relative_to(REPO).parts:
        continue
    for n, line in enumerate(read(p).splitlines(), 1):
        stripped = re.sub(r'`[^`]*`', '', line)
        if '\u2014' in stripped or '\u2013' in stripped:
            errors.append(f'{p.relative_to(REPO)}:{n}: em or en dash')

# 4. DEMO-RULES.md mirrored in autonomous-demos
def normalized(lines):
    out = []
    for line in (l.rstrip() for l in lines):
        if line or (out and out[-1]):
            out.append(line)
    while out and not out[-1]:
        out.pop()
    return out


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

# 5. Scripts parse
node, bash = shutil.which('node'), shutil.which('bash')
for p in CODE:
    rel = p.relative_to(REPO)
    if p.suffix in ('.mjs', '.cjs', '.js') and 'docs' not in rel.parts and node:
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
    if p.suffix in ('.mjs', '.cjs', '.js', '.py', '.sh') and read(p).startswith('#!') and not os.access(p, os.X_OK):
        warnings.append(f'{rel}: has a shebang but is not executable (chmod +x)')

# 6. Secrets, personal paths, private terms (whole repo, including docs: it is public)
private = []
if args.private_terms:
    pt = Path(args.private_terms).expanduser()
    if pt.is_file():
        for number, line in enumerate(pt.read_text().splitlines(), 1):
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            try:
                if len(line) > 2 and line.startswith('/') and line.endswith('/'):
                    private.append((re.compile(line[1:-1], re.I), number))
                else:
                    private.append((re.compile(r'(?<![A-Za-z0-9])' + re.escape(line) + r'(?![A-Za-z0-9])', re.I), number))
            except re.error:
                errors.append(f'private terms file line {number}: invalid regex')
    else:
        errors.append(f'private terms file not found: {pt}')


def scan(where, line):
    for pattern, label in SECRET_PATTERNS:
        if re.search(pattern, line):
            errors.append(f'{where}: looks like a {label}')
    if PERSONAL_PATH.search(line):
        errors.append(f'{where}: absolute personal path (use ~ or $HOME)')
    for m in EMAIL.finditer(line):
        if not EMAIL_OK.search(m.group(0)):
            errors.append(f'{where}: email address')
    for pattern, number in private:
        if pattern.search(line):
            errors.append(f'{where}: private term (line {number} of the private terms file)')


for p in TEXT:
    rel = p.relative_to(REPO)
    for n, line in enumerate(read(p).splitlines(), 1):
        scan(f'{rel}:{n}', line)

# 7. Commits about to be published
if args.commits:
    def git_out(*cmd):
        r = subprocess.run(['git', '-C', str(REPO), *cmd], capture_output=True)
        return r.stdout.decode('utf-8', 'replace') if r.returncode == 0 else None
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
                errors.append(f'commit {short}: binary file {parts[2]}')
        current = '?'
        for line in (git_out('show', '--format=', '--no-color', '--no-ext-diff', '-p', '-m', '--first-parent', rev) or '').splitlines():
            if line.startswith('+++ '):
                current = line[6:] if line.startswith('+++ b/') else line[4:]
            elif line.startswith('+') and not line.startswith('+++'):
                scan(f'commit {short} {current} (added line)', line[1:])

for w in warnings:
    print(f'warning: {w}')
for e in errors:
    print(f'error: {e}')
if not args.quiet:
    print(f'{len(skills)} skills, {len(TEXT)} text files checked: {len(errors)} error(s), {len(warnings)} warning(s)')
sys.exit(1 if errors else 0)

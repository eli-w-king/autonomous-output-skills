#!/usr/bin/env python3
"""Make my-voice and my-taste your own, from your own work (attendee mode, automations/ATTENDEES.md).

Everyone starts from the shared skills. Two of them are personal: my-voice (how you write) and my-taste (your design
taste). This tool makes them yours in your private copy, keeps the evidence on this machine, and tells the setup
interview and its canvas where things stand. An agent does the judgment (reading what you sent and the design feedback
you gave and got, then writing rules), following my-voice/references/voice-from-workiq.md and
my-taste/references/taste-from-workiq.md.

  status    where my-voice and my-taste stand (the shared one, started, or built from your own work, with the rules
            counted), the private folder, and the setup items "voice" and "taste" in check-setup.py's shape
  collect   copy what you typed to agents in this machine's sessions (the last --days, 90 by default) into the private
            folder, which only you can read. Only your own messages; no model calls
  start     make your copy of my-voice and my-taste your own starting point: SKILL.template.md in each, the same
            structure and shared parts with nobody's personal rules. The old copy is saved in the private folder first.
            Commits on the review branch and installs
  check     check the rules in your my-voice and my-taste: each one has its sources, count, and date (and an area for
            taste), and none has a quote, a link, an email address, a mention, a dash, or a name from your private terms
  save      bring in edits made to the installed copies, check, validate, then commit your my-voice and my-taste on the
            review branch and install them

The private folder is ~/.copilot/skill-miner/private/ (voice-samples.md, taste-evidence.md, agent-chats/, and earlier
copies in previous/), next to the weekly update's ledger.json and private-terms.txt. None of it is ever committed;
only the rules go into the skills, and the daily sync takes them to your private copy. This tool never pushes,
publishes, sends anything, or reads Microsoft 365. On the maintainer setup it only reports (status and check).

Usage: personal-skills.py status [--json]
       personal-skills.py collect [--days N] [--json]
       personal-skills.py start [--skill voice|taste|both] [--dry-run] [--json]
       personal-skills.py check [--skill voice|taste|both] [--json]
       personal-skills.py save [--skill voice|taste|both] [--message TEXT] [--dry-run] [--json]
Every command takes --repo CLONE (default: the clone this script is in).
Environment: as sync-skills.py (COPILOT_SKILLS_DIR, SKILL_MINER_DIR, SKILLS_SYNC_SETTINGS), and COPILOT_SESSION_STATE.
Exit codes: 0 ok, 1 error (or check found problems), 2 usage error or a setup that can't do this
"""
import argparse
import datetime as dt
import difflib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('sync_skills', HERE / 'sync-skills.py')
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)

FORMAT, VERSION = 'personal-skills', 1
SKILLS = {'voice': 'my-voice', 'taste': 'my-taste'}
ITEMS = {'my-voice': 'voice', 'my-taste': 'taste'}
SECTIONS = {'my-voice': ('Core voice', 'Patterns by channel'),
            'my-taste': ('Design', 'Product feel', 'Taste', 'How I review')}
KINDS = {'my-voice': ('sent Teams messages', 'sent email', 'agent chats'),
         'my-taste': ('Teams feedback', 'email feedback', 'Figma comments', 'PR reviews', 'agent chats')}
TASTE_IDS = {'Design': 'D', 'Product feel': 'P', 'Taste': 'T', 'How I review': 'R'}
MARKER = '<!-- personal skill:'
TEMPLATE = 'SKILL.template.md'
PRIVATE = sync.STATE / 'private'
RECORD = sync.STATE / 'personal-skills.json'
TERMS = sync.STATE / 'private-terms.txt'
LEDGER = sync.STATE / 'ledger.json'
SESSIONS = Path(os.environ.get('COPILOT_SESSION_STATE', '~/.copilot/session-state')).expanduser()
BUILD_ASK = ('In a chat, say "build my voice and taste": it reads what you sent and the design feedback you gave and '
             'got (read only, about 10 to 15 minutes) and keeps only rules in your skills.')
MIN_QUOTE_WORDS = 5  # a quoted phrase this long is a quote from a message, not a stock phrase

ITEM_START = re.compile(r'^(?:\d+\.\s+|-\s+)?\*\*')
CITATION = re.compile(r'\(from: (?P<kinds>[^;()]+); (?P<n>\d+) sightings?; latest (?P<date>\d{4}-\d{2}-\d{2})'
                      r'(?:; (?P<whose>own|received|mixed))?\)\s*$')
AREA = re.compile(r'\[`(?P<area>[^`]+)`\]\s*\(from:')
TASTE_ID = re.compile(r'^-\s+\*\*(?P<id>[A-Z])(?P<num>\d{2})\.\*\*')
URL = re.compile(r'(?i)\bhttps?://|\bwww\.[a-z0-9-]+\.')
EMAIL = re.compile(r'(?<![\w.+-])[\w.+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b')
MENTION = re.compile(r'(?<![\w.@`])@[A-Za-z][\w.-]*')
QUOTED = re.compile(r'"([^"\n]+)"|\u201c([^\u201d\n]+)\u201d')
DASHES = re.compile('[\u2013\u2014]')


# ---------------------------------------------------------------- small helpers

def now_iso():
    return dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def read_text(path):
    try:
        return Path(path).read_text(encoding='utf-8-sig')
    except (OSError, UnicodeDecodeError):
        return None


def write_lf(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    sync.write_atomic(path, text.replace('\r\n', '\n').encode('utf-8'))


def short_date(iso):
    try:
        day = dt.date.fromisoformat(str(iso)[:10])
    except ValueError:
        return str(iso)
    return f'{day:%b} {day.day}'


def words(items):
    items = list(items)
    if len(items) < 2:
        return ''.join(items)
    return ', '.join(items[:-1]) + ' and ' + items[-1]


def mode_of(settings):
    if settings.get('mode') == 'attendee':
        return 'attendee'
    return 'maintainer' if settings.get('private_url') else 'not set up'


def owner_only(path):
    """True when only the owner can read the folder (POSIX); None where that can't be told this way (Windows)."""
    if os.name == 'nt' or not path.exists():
        return None
    try:
        return (path.stat().st_mode & 0o077) == 0
    except OSError:
        return None


def make_private(path):
    """A folder only you can read: mode 700 on macOS and Linux; on Windows an ACL for you alone (best effort)."""
    path.mkdir(parents=True, exist_ok=True)
    if os.name != 'nt':
        os.chmod(path, 0o700)
        return
    user = os.environ.get('USERNAME')
    if user and shutil.which('icacls'):
        subprocess.run(['icacls', str(path), '/inheritance:r', '/grant:r', f'{user}:(OI)(CI)F'], capture_output=True,
                       timeout=60)


def private_files(path):
    """Files under the private folder readable only by you (POSIX)."""
    if os.name == 'nt':
        return
    for p in path.rglob('*'):
        try:
            os.chmod(p, 0o700 if p.is_dir() else 0o600)
        except OSError:
            pass


def load_record():
    """The record of what this tool did ({'format', 'version', 'skills': {...}}). A corrupt one is set aside, never
    overwritten in place."""
    empty = {'format': FORMAT, 'version': VERSION, 'skills': {}}
    text = read_text(RECORD)
    if text is None:
        return empty, None
    try:
        data = json.loads(text)
        if data.get('format') != FORMAT or not isinstance(data.get('skills'), dict):
            raise ValueError('not a personal-skills record')
        return data, None
    except (ValueError, AttributeError) as error:
        return empty, f'{sync.tilde(RECORD)} is unreadable ({error}); a new one replaces it on the next change'


def save_record(record):
    bad = read_text(RECORD)
    if bad is not None:
        try:
            ok = json.loads(bad).get('format') == FORMAT
        except (ValueError, AttributeError):
            ok = False
        if not ok:
            os.replace(RECORD, RECORD.with_name(RECORD.name + '.bad'))
    record.update(format=FORMAT, version=VERSION)
    write_lf(RECORD, json.dumps(record, indent=1) + '\n')


def private_terms():
    """[(compiled pattern, label)] from ~/.copilot/skill-miner/private-terms.txt, matched as the validator does."""
    out = []
    text = read_text(TERMS) or ''
    for number, line in enumerate(text.splitlines(), 1):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        try:
            if len(line) > 2 and line.startswith('/') and line.endswith('/'):
                out.append((re.compile(line[1:-1], re.I), f'line {number} of your private terms'))
            else:
                out.append((re.compile(r'(?<![A-Za-z0-9])' + re.escape(line) + r'(?![A-Za-z0-9])', re.I),
                            f'line {number} of your private terms'))
        except re.error:
            continue
    return out


# ---------------------------------------------------------------- reading a personal skill

def template_text(skill):
    """The skill's starting template without its leading maintainer comment, or None."""
    text = read_text(sync.REPO / skill / TEMPLATE)
    if text is None:
        return None
    text = text.replace('\r\n', '\n')
    if text.startswith('<!--'):
        end = text.find('-->')
        text = text[end + 3:].lstrip('\n') if end >= 0 else text
    return text if text.startswith('---\n') else None


def parse(text, skill, terms=None):
    """The rules in a personal skill's sections: {'personal', 'rules': [...], 'sections': {name: count}, 'errors',
    'warnings'}. Each rule: section, line, text, kinds, sightings, latest, whose, area, id."""
    out = {'personal': MARKER in (text or ''), 'rules': [], 'sections': {}, 'errors': [], 'warnings': []}
    if not text:
        return out
    lines = text.replace('\r\n', '\n').split('\n')
    start = 0
    if lines and lines[0].strip() == '---':
        start = next((i + 1 for i in range(1, len(lines)) if lines[i].strip() == '---'), 0)
    wanted = SECTIONS[skill]
    section, items, current = None, [], None
    for number, line in enumerate(lines[start:], start + 1):
        if line.startswith('## '):
            section = line[3:].strip()
            current = None
            if section in wanted:
                out['sections'].setdefault(section, 0)
            continue
        if line.startswith('#'):
            section, current = None, None
            continue
        if section not in wanted:
            continue
        if not line.strip():
            current = None
            continue
        if ITEM_START.match(line):
            current = {'section': section, 'line': number, 'raw': [line]}
            items.append(current)
        elif current is not None:
            current['raw'].append(line)
    today = dt.date.today()
    seen_ids = set()
    for item in items:
        text_ = ' '.join(part.strip() for part in item['raw'])
        where = f"{skill}/SKILL.md:{item['line']}"
        rule = {'section': item['section'], 'line': item['line'], 'text': text_}
        out['rules'].append(rule)
        out['sections'][item['section']] = out['sections'].get(item['section'], 0) + 1
        m = CITATION.search(text_)
        if not m:
            out['errors'].append(f'{where}: no "(from: <kinds>; <n> sightings; latest YYYY-MM-DD)" at the end')
            body = text_
        else:
            body = text_[:m.start()]
            kinds = [k.strip() for k in m.group('kinds').split(',') if k.strip()]
            unknown = [k for k in kinds if k not in KINDS[skill]]
            if unknown:
                out['errors'].append(f"{where}: unknown source kind {', '.join(unknown)} (use {', '.join(KINDS[skill])})")
            rule.update(kinds=kinds, sightings=int(m.group('n')), latest=m.group('date'), whose=m.group('whose'))
            if int(m.group('n')) < 1:
                out['errors'].append(f'{where}: a rule needs at least 1 sighting')
            try:
                day = dt.date.fromisoformat(m.group('date'))
                if day > today + dt.timedelta(days=1):
                    out['errors'].append(f"{where}: latest {m.group('date')} is in the future")
            except ValueError:
                out['errors'].append(f"{where}: latest {m.group('date')} is not a date")
            if skill == 'my-taste' and not m.group('whose'):
                out['errors'].append(f'{where}: say whose it was at the end of the citation (own, received, or mixed)')
        if skill == 'my-taste':
            area = AREA.search(text_)
            if not area:
                out['errors'].append(f'{where}: no area before the citation, like [`everywhere`]')
            else:
                rule['area'] = area.group('area')
                body = text_[:area.start()]
            ident = TASTE_ID.match(item['raw'][0])
            if not ident:
                out['errors'].append(f'{where}: start with an id like - **D01.**')
            else:
                rule['id'] = ident.group('id') + ident.group('num')
                if ident.group('id') != TASTE_IDS.get(item['section']):
                    out['warnings'].append(f"{where}: {rule['id']} is under {item['section']}, whose ids start with "
                                           f"{TASTE_IDS.get(item['section'])}")
                if rule['id'] in seen_ids:
                    out['errors'].append(f"{where}: {rule['id']} is used twice")
                seen_ids.add(rule['id'])
        for problem in privacy_problems(body, terms or []):
            out['errors'].append(f'{where}: {problem}')
        if len(body) > 420:
            out['warnings'].append(f'{where}: long for a rule ({len(body)} characters); one or two sentences')
    if skill == 'my-voice' and out['personal']:
        core = out['sections'].get('Core voice', 0)
        if core and not 5 <= core <= 12:
            out['warnings'].append(f'my-voice/SKILL.md: {core} core voice rules (5 to 12 reads best)')
    return out


def privacy_problems(body, terms):
    problems = []
    if URL.search(body):
        problems.append('a link (rules keep no links)')
    for m in EMAIL.finditer(body):
        problems.append('an email address')
        break
    if MENTION.search(body):
        problems.append('an @mention (use a role, not a name)')
    for m in QUOTED.finditer(body):
        quoted = m.group(1) or m.group(2)
        if len(quoted.split()) >= MIN_QUOTE_WORDS:
            problems.append(f'a quote of {len(quoted.split())} words (rules keep no quotes; a stock phrase of up to '
                            f'{MIN_QUOTE_WORDS - 1} words is fine)')
    if DASHES.search(body):
        problems.append('an em or en dash')
    for pattern, label in terms:
        if pattern.search(body):
            problems.append(f'a private term ({label})')
    return problems


def skill_state(skill, settings, terms=None):
    """What this skill is right now, from the installed copy (what sessions use) and the clone."""
    mode = mode_of(settings)
    installed = read_text(sync.SKILLS / skill / 'SKILL.md')
    clone = read_text(sync.REPO / skill / 'SKILL.md')
    text = installed if installed is not None else clone
    info = parse(text, skill, terms)
    rules = info['rules']
    kinds = []
    for rule in rules:
        for kind in rule.get('kinds') or []:
            if kind not in kinds:
                kinds.append(kind)
    latest = max((r['latest'] for r in rules if r.get('latest')), default=None)
    if mode in ('maintainer', 'not set up'):
        state = mode
    elif text is None:
        state = 'missing'
    elif not info['personal']:
        state = 'shared'
    elif not rules:
        state = 'started'
    else:
        state = 'built'
    if not info['personal']:  # someone else's rules (the shared starting copy) are not counted as the person's
        rules, kinds, latest = [], [], None
        info['sections'] = {}
    return {'skill': skill, 'state': state, 'personal': info['personal'], 'rules': len(rules),
            'sections': info['sections'], 'sources': kinds, 'latest': latest,
            'installed': installed is not None, 'in_clone': clone is not None,
            'installed_matches_clone': installed is not None and clone is not None
            and installed.replace('\r\n', '\n') == clone.replace('\r\n', '\n'),
            'problems': len(info['errors'])}


def check_item(skill, info, mode, record):
    """One setup item in check-setup.py's shape: ok (True, False, or None), required, detail, fix, plus extras."""
    built = (record.get('skills', {}).get(skill) or {}).get('built_at')
    extra = {'skill': skill, 'state': info['state'], 'rules': info['rules'], 'sources': info['sources'],
             'latest': info['latest'], 'built_at': built}
    noun = 'voice' if skill == 'my-voice' else 'taste'
    if mode == 'maintainer':
        detail = ('Maintainer setup: my-voice is your own.' if skill == 'my-voice' else
                  'Maintainer setup: my-taste has its own daily update.')
        return dict(ok=True, required=True, detail=detail, **extra)
    if mode != 'attendee':
        return dict(ok=False, required=True, detail='Needs your own copy of the skills first (the skills step).',
                    fix='Finish the skills step (sync-skills.py setup-attendee), then build your voice and taste.',
                    **extra)
    state = info['state']
    if state == 'built':
        sections = info['sections']
        if skill == 'my-voice':
            core, patterns = sections.get('Core voice', 0), sections.get('Patterns by channel', 0)
            counted = f"{core} rule{'' if core == 1 else 's'}" + (
                f" and {patterns} channel pattern{'' if patterns == 1 else 's'}" if patterns else '')
        else:
            counted = f"{info['rules']} rule{'' if info['rules'] == 1 else 's'}"
        detail = f"Yours: {counted} from your {words(info['sources'])}" + (
            f" (latest {short_date(info['latest'])})." if info['latest'] else '.')
        if info['problems']:
            detail += f" {info['problems']} rule(s) need a fix: run personal-skills.py check."
        return dict(ok=True, required=True, detail=detail, **extra)
    if state == 'started':
        detail = f'Started from the template, no rules yet. Build your {noun} from your own work.'
    elif state == 'missing':
        detail = f'Not built yet. Build your {noun} from the design feedback you gave and got.' if noun == 'taste' else \
            'my-voice is not installed yet.'
    else:
        detail = ('Still the shared starting voice. Build yours from what you sent.' if noun == 'voice' else
                  'Still a shared my-taste. Build yours from the design feedback you gave and got.')
    return dict(ok=False, required=True, detail=detail, fix=BUILD_ASK, **extra)


def evidence_summary():
    samples = read_text(PRIVATE / 'voice-samples.md') or ''
    notes = read_text(PRIVATE / 'taste-evidence.md') or ''
    stats = {}
    try:
        stats = json.loads(read_text(PRIVATE / 'agent-chats' / 'stats.json') or '{}')
    except ValueError:
        stats = {}
    ledger = {}
    try:
        data = json.loads(read_text(LEDGER) or '{}')
        entries = data.get('rules', data) if isinstance(data, dict) else data
        if isinstance(entries, dict):
            entries = list(entries.values())
        for entry in entries if isinstance(entries, list) else []:
            if isinstance(entry, dict) and entry.get('skill') in ('my-voice', 'my-taste') and entry.get('status') == 'active':
                ledger[entry['skill']] = ledger.get(entry['skill'], 0) + 1
    except ValueError:
        ledger = {}
    return {'voice_samples': len(re.findall(r'(?m)^### ', samples)),
            'taste_notes': len(re.findall(r'(?m)^## ', notes)),
            'agent_chats': {'human_messages': (stats.get('messages') or {}).get('human', 0),
                            'sessions': stats.get('sessions_with_human_messages', 0),
                            'since': stats.get('since')} if stats else None,
            'ledger_active_rules': ledger}


def status_report():
    settings = sync.load_settings()
    mode = mode_of(settings)
    record, record_problem = load_record()
    terms = private_terms()
    skills = {skill: skill_state(skill, settings, terms) for skill in SKILLS.values()}
    report = {'tool': 'personal-skills.py', 'version': VERSION, 'mode': mode, 'clone': sync.tilde(sync.REPO),
              'skills_dir': sync.tilde(sync.SKILLS),
              'private_folder': {'path': sync.tilde(PRIVATE), 'exists': PRIVATE.is_dir(),
                                 'owner_only': owner_only(PRIVATE)},
              'skills': skills,
              'check_items': {ITEMS[s]: check_item(s, info, mode, record) for s, info in skills.items()}}
    if mode == 'attendee':
        report['evidence'] = evidence_summary()
    if record_problem:
        report['record_problem'] = record_problem
    return report


# ---------------------------------------------------------------- commands

def emit(args, report, lines):
    if args.json:
        print(json.dumps(report, indent=1))
    else:
        for line in lines:
            print(line)


def need_attendee(args, command):
    settings = sync.load_settings()
    mode = mode_of(settings)
    if mode == 'attendee':
        return settings
    why = ('this machine runs the maintainer setup, where my-voice is already yours and my-taste has its own update; '
           f'{command} only works in your own private copy (automations/ATTENDEES.md)' if mode == 'maintainer' else
           f'{command} needs your own private copy of the skills first: run sync-skills.py setup-attendee')
    emit(args, {'ok': False, 'command': command, 'mode': mode, 'error': why}, [f'not done: {why}'])
    return None


def cmd_status(args):
    report = status_report()
    lines = [f"mode: {report['mode']} ({report['clone']})"]
    for skill, info in report['skills'].items():
        item = report['check_items'][ITEMS[skill]]
        lines.append(f"{skill}: {info['state']}. {item['detail']}")
    if report.get('evidence'):
        ev = report['evidence']
        chats = ev.get('agent_chats') or {}
        lines.append(f"private folder {report['private_folder']['path']}: {ev['voice_samples']} voice samples, "
                     f"{ev['taste_notes']} taste notes, {chats.get('human_messages', 0)} messages from agent chats")
    if report.get('record_problem'):
        lines.append(report['record_problem'])
    emit(args, report, lines)
    return 0


def cmd_collect(args):
    settings = need_attendee(args, 'collect')
    if settings is None:
        return 2
    if args.days < 1 or args.days > 365:
        emit(args, {'ok': False, 'error': '--days is 1 to 365'}, ['--days is 1 to 365'])
        return 2
    make_private(PRIVATE)
    out = PRIVATE / 'agent-chats'
    if out.exists():
        shutil.rmtree(out, ignore_errors=True)
    make_private(out)
    since = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=args.days)).strftime('%Y-%m-%dT%H:%M:%SZ')
    command = [sys.executable, str(sync.REPO / 'tools' / 'collect-messages.py'), '--since', since, '--out', str(out),
               '--state-dir', str(SESSIONS)]
    name = (sync.git('config', 'user.name') or '').split(' ')[0]
    if name:
        command += ['--name', name]
    try:
        r = subprocess.run(command, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=900)
        code, err = r.returncode, r.stderr
    except subprocess.TimeoutExpired:
        code, err = 124, 'collect-messages.py timed out'
    private_files(PRIVATE)
    try:
        stats = json.loads(read_text(out / 'stats.json') or '{}')
    except ValueError:
        stats = {}
    record, _ = load_record()
    if code == 0:
        record.update(collected_at=now_iso(), collect_days=args.days)
        save_record(record)
    parts = sorted(p.name for p in out.glob('digest-part-*.md'))
    report = {'ok': code == 0, 'command': 'collect', 'folder': sync.tilde(PRIVATE), 'owner_only': owner_only(PRIVATE),
              'agent_chats': sync.tilde(out), 'since': since,
              'human_messages': (stats.get('messages') or {}).get('human', 0),
              'sessions': stats.get('sessions_with_human_messages', 0), 'digest_parts': parts,
              'voice_samples': sync.tilde(PRIVATE / 'voice-samples.md'),
              'taste_evidence': sync.tilde(PRIVATE / 'taste-evidence.md'),
              'ledger': sync.tilde(LEDGER), 'private_terms': sync.tilde(TERMS)}
    if code:
        report['error'] = sync.first_error(err)
    emit(args, report, [
        f"{'collected' if code == 0 else 'collecting failed'}: {report['human_messages']} of your messages from "
        f"{report['sessions']} sessions since {since[:10]} in {report['agent_chats']}"
        + (f" ({report.get('error')})" if code else ''),
        f"private folder {report['folder']}: write voice samples to {report['voice_samples']} and taste notes to "
        f"{report['taste_evidence']}"])
    return 0 if code == 0 else 1


def shared_version(skill):
    """The shared repo's SKILL.md for this skill (public/main, else origin/main), or None."""
    for ref in ('refs/remotes/public/main', 'refs/remotes/origin/main'):
        if sync.rev(ref):
            text = sync.git('show', f'{ref}:{skill}/SKILL.md')
            if text is not None:
                return text
    return None


def selected(args):
    return list(SKILLS.values()) if args.skill == 'both' else [SKILLS[args.skill]]


class Clone:
    """The clone, ready for a change: the sync's lock held (so a daily sync never runs at the same time), on the review
    branch, and edits a session made to the installed copies of these skills brought in first."""

    def __init__(self, settings, skills, dry_run):
        self.settings, self.skills, self.dry_run, self.locked, self.harvested = settings, skills, dry_run, False, []

    def open(self):
        """None when ready, or why not."""
        if not (sync.REPO / '.git').exists():
            return f'{sync.tilde(sync.REPO)} is not a clone of your skills'
        busy = sync.git_busy()
        if busy:
            return f'a git operation is in progress in {sync.tilde(sync.REPO)} ({busy}); finish or abort it'
        if self.dry_run:
            return None
        if not sync.take_lock(sync.SYNC_LOCK, 1800):
            return 'the daily skills sync is running right now; try again in a minute'
        self.locked = True
        run = sync.Run(sync.host_name(self.settings))
        if not sync.switch_to_review(self.settings, run):
            return '; '.join(run.notes) or 'could not switch the clone to its review branch'
        _, entries, _ = sync.classify()
        if any(e['state'] in sync.PENDING and e['skill'] in self.skills for e in entries):
            _, conflicts, written, _ = sync.do_harvest(host=sync.host_slug(run.host))
            self.harvested = written
            clash = [c['path'] for c in conflicts if c['path'].split('/')[0] in self.skills]
            if clash:
                return (f"the installed copy and your clone both changed: {', '.join(clash)}. Merge the saved versions "
                        'by hand (sync-skills.py status lists them), then try again.')
        return None

    def close(self):
        if self.locked:
            shutil.rmtree(sync.SYNC_LOCK, ignore_errors=True)
            self.locked = False


def commit_paths(paths, message):
    """Commit just these paths on the checked-out branch. Returns (sha or '', error)."""
    rc, _, err = sync.g('add', '--', *paths)
    if rc:
        return '', sync.first_error(err)
    if sync.g('diff', '--cached', '--quiet', '--', *paths)[0] == 0:
        return '', ''
    rc, _, err = sync.g('commit', '-q', '-m', message, '-m', sync.COAUTHOR, '--', *paths)
    if rc:
        return '', sync.first_error(err)
    return sync.rev('HEAD'), ''


def install(report):
    code, changed, going, notes = sync.do_install()
    report['installed'] = changed
    if notes:
        report['install_notes'] = notes
    return code


def fail(args, report, why, verb='not done'):
    report['ok'] = False
    report['error'] = why
    emit(args, report, [f'{verb}: {why}'] + [f'  {p}' for p in report.get('problems', [])])
    return 1


def plan_start(skill):
    """What start does to one skill: keep it (already yours) or start it from the template."""
    current = read_text(sync.REPO / skill / 'SKILL.md')
    if current is not None and MARKER in current:
        return {'action': 'kept', 'detail': 'already yours'}
    text = template_text(skill)
    if text is None:
        return {'action': 'blocked', 'detail': f'{skill}/{TEMPLATE} is missing here: your copy is older than the shared '
                'skills that have it. Run sync-skills.py upstream-pr, merge that pull request, then try again.'}
    plan = {'action': 'started', 'template': text, 'replaces': 'nothing (it is new)'}
    if current is not None:
        shared = shared_version(skill)
        current_lf = current.replace('\r\n', '\n')
        if shared is not None and current_lf != shared.replace('\r\n', '\n'):
            plan['replaces'] = 'your edited copy'
            plan['your_lines'] = sum(1 for line in difflib.ndiff(shared.replace('\r\n', '\n').splitlines(),
                                                                   current_lf.splitlines())
                                     if line.startswith('+ ') and line[2:].strip())
        else:
            plan['replaces'] = 'the shared copy'
        plan['current'] = current_lf
    return plan


def cmd_start(args):
    settings = need_attendee(args, 'start')
    if settings is None:
        return 2
    report = {'ok': False, 'command': 'start', 'dry_run': bool(args.dry_run), 'skills': {}, 'committed': None,
              'installed': [], 'private_folder': sync.tilde(PRIVATE)}
    skills = selected(args)
    clone = Clone(settings, skills, args.dry_run)
    try:
        why = clone.open()
        if why:
            return fail(args, report, why)
        plans = {skill: plan_start(skill) for skill in skills}
        report['skills'] = {s: {k: v for k, v in p.items() if k not in ('template', 'current')} for s, p in plans.items()}
        blocked = [p['detail'] for p in plans.values() if p['action'] == 'blocked']
        if blocked:
            return fail(args, report, blocked[0])
        starting = [s for s, p in plans.items() if p['action'] == 'started']
        if args.dry_run or not starting:
            report['ok'] = True
            emit(args, report, [f"{'would start' if args.dry_run and p['action'] == 'started' else p['action']} {s}: "
                                + (f"replaces {p['replaces']}" if p['action'] == 'started' else p['detail'])
                                for s, p in plans.items()])
            return 0
        stamp = dt.datetime.now().strftime('%Y%m%d-%H%M%S')
        for skill in starting:
            plan = plans[skill]
            if plan.get('current') is not None:
                make_private(PRIVATE)
                make_private(PRIVATE / 'previous')
                keep = PRIVATE / 'previous' / f'{skill}-{stamp}.md'
                write_lf(keep, plan['current'])
                private_files(PRIVATE / 'previous')
                report['skills'][skill]['previous_copy'] = sync.tilde(keep)
            write_lf(sync.REPO / skill / 'SKILL.md', plan['template'])
        sha, error = commit_paths([f'{s}/SKILL.md' for s in starting], f"Start my own {' and '.join(starting)}")
        if error:
            return fail(args, report, f'commit failed: {error}')
        report['committed'] = sha[:12] if sha else None
        code = install(report)
    finally:
        clone.close()
    record, _ = load_record()
    for skill in starting:
        entry = record['skills'].setdefault(skill, {})
        entry.update(started_at=now_iso())
        for key in ('built_at', 'rules', 'sources', 'latest'):
            entry.pop(key, None)
        if report['skills'][skill].get('previous_copy'):
            entry['previous_copy'] = report['skills'][skill]['previous_copy']
    save_record(record)
    report['ok'] = code in (0, 3)
    report['check_items'] = status_report()['check_items']
    lines = []
    for skill, entry in report['skills'].items():
        if entry['action'] == 'started':
            lines.append(f"started {skill} from the template (it replaces {entry['replaces']})"
                         + (f"; the old copy is in {entry['previous_copy']}" if entry.get('previous_copy') else '')
                         + (f"; it had {entry['your_lines']} line(s) of your own: carry the ones still true into your "
                            'rules' if entry.get('your_lines') else ''))
        else:
            lines.append(f"kept {skill}: {entry['detail']}")
    lines.append(f"committed {report['committed'] or 'nothing new'} on {sync.review_branch(settings)}; installed "
                 f"{', '.join(report['installed']) or 'nothing new'}")
    emit(args, report, lines)
    return 0 if report['ok'] else 1


def run_check(skills):
    terms = private_terms()
    results = {}
    for skill in skills:
        text = read_text(sync.REPO / skill / 'SKILL.md')
        info = parse(text, skill, terms)
        results[skill] = {'exists': text is not None, 'personal': info['personal'], 'rules': len(info['rules']),
                          'sections': info['sections'], 'errors': info['errors'], 'warnings': info['warnings']}
        if text is not None and not info['personal']:
            results[skill]['note'] = 'not yours yet: run personal-skills.py start first'
    return results


def cmd_check(args):
    results = run_check(selected(args))
    errors = sum(len(r['errors']) for r in results.values() if r['personal'])
    report = {'ok': errors == 0, 'command': 'check', 'skills': results}
    lines = []
    for skill, r in results.items():
        if not r['exists']:
            lines.append(f'{skill}: not in this copy')
            continue
        if not r['personal']:
            lines.append(f'{skill}: not yours yet (nothing to check)')
            continue
        lines.append(f"{skill}: {r['rules']} rule(s), {len(r['errors'])} problem(s)")
        lines += [f'  error: {e}' for e in r['errors']] + [f'  warning: {w}' for w in r['warnings']]
    emit(args, report, lines)
    return 0 if errors == 0 else 1


def validate(prefixes):
    """validate-skills.py on the clone with your private terms: (errors under these prefixes, other errors)."""
    command = [sys.executable, str(sync.REPO / 'tools' / 'validate-skills.py'), '--quiet', '--repo', str(sync.REPO)]
    if TERMS.is_file():
        command += ['--private-terms', str(TERMS)]
    try:
        r = subprocess.run(command, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=900)
    except subprocess.TimeoutExpired:
        return ['validate-skills.py timed out'], []
    mine, other = [], []
    for line in r.stdout.splitlines():
        if line.startswith('error: '):
            (mine if line[7:].startswith(tuple(prefixes)) else other).append(line[7:])
    if r.returncode and not mine and not other:
        mine.append(sync.first_error(r.stderr or r.stdout))
    return mine, other


def cmd_save(args):
    settings = need_attendee(args, 'save')
    if settings is None:
        return 2
    report = {'ok': False, 'command': 'save', 'dry_run': bool(args.dry_run), 'skills': {}, 'committed': None,
              'installed': []}
    skills = selected(args)
    clone = Clone(settings, skills, args.dry_run)
    try:
        why = clone.open()
        if why:
            return fail(args, report, why, 'not saved')
        if clone.harvested:
            report['harvested'] = clone.harvested
        results = run_check(skills)
        report['skills'] = results
        mine = [s for s in skills if results[s]['personal']]
        if not mine:
            return fail(args, report, 'nothing to save: neither skill is yours yet (run personal-skills.py start '
                        'first)', 'not saved')
        report['problems'] = [f'{e}' for s in mine for e in results[s]['errors']]
        if report['problems']:
            return fail(args, report, f"{len(report['problems'])} problem(s) in your rules; fix them, then save again",
                        'not saved')
        in_skills, others = validate([f'{s}/' for s in mine])
        report['validator_other'] = others
        if in_skills:
            report['problems'] = in_skills
            return fail(args, report, f'validate-skills.py found {len(in_skills)} problem(s) in your skills', 'not saved')
        report.pop('problems')
        if args.dry_run:
            report['ok'] = True
            emit(args, report, [f"would save {s}: {results[s]['rules']} rule(s)" for s in mine])
            return 0
        message = args.message or f"Build my {' and '.join(mine)} from my own work"
        sha, error = commit_paths([f'{s}/SKILL.md' for s in mine], message)
        if error:
            return fail(args, report, f'commit failed: {error}', 'not saved')
        report['committed'] = sha[:12] if sha else None
        code = install(report)
    finally:
        clone.close()
    record, _ = load_record()
    for skill in mine:
        info = skill_state(skill, sync.load_settings())
        if info['rules']:
            record['skills'].setdefault(skill, {}).update(built_at=now_iso(), rules=info['rules'],
                                                          sources=info['sources'], latest=info['latest'])
    save_record(record)
    report['ok'] = code in (0, 3)
    report['check_items'] = status_report()['check_items']
    lines = [f"saved {' and '.join(mine)}: committed {report['committed'] or 'nothing new'} on "
             f"{sync.review_branch(settings)}; installed {', '.join(report['installed']) or 'nothing new'}"]
    lines += [f"{item}: {value['detail']}" for item, value in report['check_items'].items()]
    if report.get('validator_other'):
        lines.append(f"note: validate-skills.py also reports {len(report['validator_other'])} problem(s) elsewhere in "
                     'your copy, outside my-voice and my-taste')
    emit(args, report, lines)
    return 0 if report['ok'] else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('command', choices=('status', 'collect', 'start', 'check', 'save'))
    parser.add_argument('--skill', choices=('voice', 'taste', 'both'), default='both')
    parser.add_argument('--days', type=int, default=90, help='collect: how far back to read your agent chats')
    parser.add_argument('--message', help='save: the commit message')
    parser.add_argument('--dry-run', action='store_true', help='start and save: say what would change, change nothing')
    parser.add_argument('--json', action='store_true', help='print one JSON object')
    parser.add_argument('--repo', help='the skills clone (default: the one this script is in)')
    args = parser.parse_args()
    if args.repo:
        sync.REPO = Path(args.repo).expanduser().resolve()
    return {'status': cmd_status, 'collect': cmd_collect, 'start': cmd_start, 'check': cmd_check,
            'save': cmd_save}[args.command](args)


if __name__ == '__main__':
    sys.exit(main())

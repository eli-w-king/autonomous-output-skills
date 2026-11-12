#!/usr/bin/env python3
"""Test tools/personal-skills.py offline, in a scratch folder: making my-voice and my-taste each person's own.

Local bare repos stand in for the private copy and the shared repo, and a fake GitHub CLI records pull requests (the
same harness as test-sync-attendee.py). HOME, COPILOT_HOME, the session history, the git config, and the temp folder
all point into the test folder, so nothing else on this machine is read or changed. The evidence is made up, in the
style of the workshop's fictional practice content (a pretend content designer), never anyone's real messages.

  test-personal-skills.py [--root DIR] [--keep]

It checks: the shared snapshot publishes only my-taste's template and taste procedure, and passes the validator as a
published tree; status before setup, and right after it (voice: the shared one, taste: missing), in check-setup.py's
item shape; collect (only what the person typed, into a folder only they can read); start --dry-run changes nothing;
start saves a person's own earlier edit privately and makes both skills theirs, once; check and save refuse rules with
a quote, a link, an email address, a mention, a dash, a private term, an unknown source, or no citation; save commits
only the two skills and installs them; the evidence never reaches the clone, its history, or the private copy on
GitHub; a shared update keeps their my-voice and my-taste and brings the new taste procedure; the maintainer setup is
refused. Exit 0 when every check passes. Works on macOS, Linux, and Windows.
"""
import argparse
import datetime as dt
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('test_sync_attendee', HERE / 'test-sync-attendee.py')
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)
check, Env, remove_tree, SLUG = harness.check, harness.Env, harness.remove_tree, harness.SLUG
CANARY = 'PRACTICE-' + 'CANARY-' + str(4417 * 3)  # built, so this file never contains it
DASH = '\u2014'
SHARED_TASTE = ('my-taste/SKILL.template.md', 'my-taste/references/taste-from-workiq.md')


def tool(env, *args, settings=None):
    """personal-skills.py in the clone: (exit code, parsed JSON or {})."""
    run_env = dict(env.env)
    if settings:
        run_env['SKILLS_SYNC_SETTINGS'] = str(settings)
    r = subprocess.run([sys.executable, str(env.clone / 'tools' / 'personal-skills.py'), *args, '--json'],
                       capture_output=True, text=True, encoding='utf-8', errors='replace', env=run_env, timeout=900)
    try:
        return r.returncode, json.loads(r.stdout)
    except ValueError:
        print(f'---- personal-skills.py {" ".join(args)} exited {r.returncode}\n{r.stdout[-2000:]}\n{r.stderr[-2000:]}')
        return r.returncode, {}


def write_session(env, sid, cwd, messages):
    """A Copilot session in the scratch session history: [(minutes ago, text, extra event fields)]."""
    folder = env.copilot / 'session-state' / sid
    folder.mkdir(parents=True, exist_ok=True)
    (folder / 'workspace.yaml').write_text(f'client_name: test-cli\ncwd: {cwd}\nname: practice\n', encoding='utf-8')
    now = dt.datetime.now(dt.timezone.utc)
    lines = []
    for minutes, text, extra in messages:
        event = {'type': 'user.message', 'timestamp': (now - dt.timedelta(minutes=minutes)).strftime('%Y-%m-%dT%H:%M:%SZ'),
                 'data': {'content': text}}
        event.update(extra)
        lines.append(json.dumps(event))
    (folder / 'events.jsonl').write_text('\n'.join(lines) + '\n', encoding='utf-8')


GOOD_VOICE = '''## Core voice

The user's own rules, from their own writing. Each one ends with the kinds of messages it came from,
how many times it showed up, and the last time it did.

1. **Lead with the decision.** Say which option you'd pick and why in the first sentence, then the
   details. (from: sent Teams messages, sent email; 6 sightings; latest 2026-11-09)
2. **Short chat replies.** One or two sentences in a thread, and a plain "+1" when you agree. (from: sent
   Teams messages; 8 sightings; latest 2026-11-10)
3. **Name the word.** When copy is inconsistent, say which word to keep for every place it shows up.
   (from: sent Teams messages, agent chats; 4 sightings; latest 2026-11-10)
4. **Questions over verdicts.** End feedback with one real question rather than a ruling. (from: sent
   Teams messages; 3 sightings; latest 2026-11-08)
5. **No exclamation points in email.** Keep email calm and plain; save warmth for the first line.
   (from: sent email; 3 sightings; latest 2026-11-06)

## Patterns by channel

How the user writes the kinds of messages they send most, from the same evidence.

**Feedback in a design thread.** Agree or disagree in the first words, give one concrete change, and stop.
(from: sent Teams messages; 5 sightings; latest 2026-11-10)
'''

GOOD_TASTE = {
    'Design': '''- **D01.** Use one name for one thing across every surface. [`everywhere`] (from: Teams feedback, agent chats; 5
  sightings; latest 2026-11-10; mixed)
- **D02.** Keep the controls people use most visible; fold the rest behind a clear label. [`app/panels`] (from: Teams
  feedback, Figma comments; 4 sightings; latest 2026-11-09; received)''',
    'Taste': '''- **T01.** Cut borders and chrome before cutting content. [`everywhere`] (from: agent chats; 3 sightings; latest
  2026-11-10; own)''',
    'How I review': '''- **R01.** Check every option in dark mode and at phone width before picking one. [`everywhere`] (from: PR
  reviews, Teams feedback; 3 sightings; latest 2026-11-07; mixed)''',
}


def replace_section(text, heading, body):
    """Swap one section's body (between its ## heading and the next) for body."""
    start = text.index(f'## {heading}\n')
    end = text.find('\n## ', start + 1)
    end = len(text) if end < 0 else end + 1
    return text[:start] + body.rstrip('\n') + '\n\n' + text[end:]


def write_good_rules(env):
    voice = env.clone / 'my-voice' / 'SKILL.md'
    text = voice.read_text(encoding='utf-8')
    start = text.index('## Core voice\n')
    end = text.index('## How to deliver\n')
    voice.write_text(text[:start] + GOOD_VOICE + '\n' + text[end:], encoding='utf-8')
    taste = env.clone / 'my-taste' / 'SKILL.md'
    text = taste.read_text(encoding='utf-8')
    for heading, rules in GOOD_TASTE.items():
        start = text.index(f'## {heading}\n')
        end = text.index('\n## ', start + 1)
        section = text[start:end]
        placeholder = next(line for line in section.splitlines() if line.startswith('_No rules yet'))
        section = section.replace(placeholder, rules)
        text = text[:start] + section + text[end:]
    taste.write_text(text, encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--root', help='the test folder (default: a new temporary folder)')
    parser.add_argument('--keep', action='store_true', help='keep the test folder afterwards')
    args = parser.parse_args()
    root = Path(args.root).resolve() if args.root else Path(tempfile.mkdtemp(prefix='personal-skills-test-'))
    if root.exists() and any(root.iterdir()):
        print(f'{root} is not empty')
        return 2
    root.mkdir(parents=True, exist_ok=True)
    env = Env(root)
    env.env['COPILOT_SESSION_STATE'] = str(env.copilot / 'session-state')
    try:
        return run_checks(env)
    finally:
        if not args.keep:
            remove_tree(root)
        else:
            print(f'kept {root}')


def run_checks(env):
    # The shared repo as attendees get it: my-taste's template and taste procedure, nothing else from my-taste/
    public_work = harness.shared_snapshot(env)
    shared = set(env.run('git', 'ls-files', cwd=public_work).stdout.split())
    check(set(SHARED_TASTE) <= shared and not {p for p in shared if p.startswith('my-taste/')} - set(SHARED_TASTE)
          and not any(p.startswith('private/') for p in shared),
          'the shared skills publish only my-taste/SKILL.template.md and its taste procedure from my-taste/')
    r = env.run(sys.executable, public_work / 'tools' / 'validate-skills.py', '--published', '--repo', public_work)
    check(r.returncode == 0, f'the shared skills pass the validator as a published tree ({r.stdout.strip()[-200:]})')
    for extra in ('my-taste/SKILL.md', 'my-taste/references/vscode-conventions.md', 'my-taste/references/new-notes.md'):
        stray = public_work / extra
        stray.write_text('---\nname: my-taste\ndescription: test\n---\n', encoding='utf-8')
        r = env.run(sys.executable, public_work / 'tools' / 'validate-skills.py', '--published', '--repo', public_work)
        stray.unlink()
        check(r.returncode == 1 and f'{extra}: private/, my-taste/' in r.stdout,
              f'the validator fails a published tree with {extra} in it')
    env.run('git', 'clone', '-q', env.public, env.clone, check_rc=0)

    # Before setup: both items wait for the skills step
    code, out = tool(env, 'status')
    items = out.get('check_items', {})
    check(code == 0 and out.get('mode') == 'not set up' and set(items) == {'voice', 'taste'}
          and all(i['ok'] is False and i['required'] and i['detail'] and i.get('fix') for i in items.values()),
          f"status before setup: both items wait for the skills step ({[i.get('detail') for i in items.values()]})")

    r = env.sync('setup-attendee', '--private-repo', SLUG, '--create', '--json', '--no-schedule', '--public-url',
                 env.public.as_uri())
    check(r.returncode == 0, 'setup-attendee succeeds')
    code, out = tool(env, 'status')
    voice, taste = out.get('check_items', {}).get('voice', {}), out.get('check_items', {}).get('taste', {})
    check(out.get('mode') == 'attendee' and voice.get('state') == 'shared' and voice.get('ok') is False
          and taste.get('state') == 'missing' and taste.get('ok') is False and 'build my voice and taste' in voice.get('fix', ''),
          f"after setup: voice is the shared one, taste is missing ({voice.get('detail')} / {taste.get('detail')})")
    check(not (env.skills / 'my-taste').exists() and (env.clone / 'my-taste' / 'SKILL.template.md').is_file(),
          'my-taste is not installed yet; its template is in the clone')

    # collect: only what the person typed, in a private folder
    write_session(env, 'practice-session-1', '~/Code/excalidraw-workshop', [
        (300, 'Shorter please. And pick one word for the same group: Arrange, everywhere.', {}),
        (200, f'Perfect, that one. Too much chrome on the floating bar though, cut the borders. {CANARY}', {}),
        (100, 'You are recording a demo of the panel. Your complete brief is at ~/brief.md', {'agentId': 'agent-1'}),
    ])
    write_session(env, 'practice-session-2', '~/Code/excalidraw-workshop', [
        (50, '[weekly-skill-miner] Weekly skill update. Run the runner.', {}),
    ])
    code, out = tool(env, 'collect', '--days', '30')
    private = env.state / 'private'
    check(code == 0 and out.get('human_messages') == 2 and out.get('sessions') == 1,
          f"collect keeps only the 2 messages the person typed ({out.get('human_messages')} from {out.get('sessions')} session)")
    if os.name != 'nt':
        check(oct(private.stat().st_mode & 0o777) == '0o700' and out.get('owner_only') is True,
              'the private folder is readable only by the person (700)')
    (private / 'voice-samples.md').write_text(f'## Teams chat\n\n### 2026-11-10, reply in a design thread\n\n+1, otherwise '
                                             f'love it. One word for the same group, please. {CANARY}\n', encoding='utf-8')
    (private / 'taste-evidence.md').write_text(f'## 2026-11-10, Teams feedback, received (a teammate), agreed\n\nAsked for '
                                              f'one word for one group across panels. {CANARY}\n', encoding='utf-8')
    (env.state / 'private-terms.txt').write_text('# names\nProject Falcon\n', encoding='utf-8')

    # A correction the person already made to their my-voice (Module 14), still waiting for review
    harness.append(env.skills / 'my-voice' / 'SKILL.md', '- My own rule from a session: sign off with my first name.')

    # start --dry-run changes nothing
    head = env.git('-C', env.clone, 'rev-parse', 'HEAD')
    code, out = tool(env, 'start', '--dry-run')
    check(code == 0 and out.get('skills', {}).get('my-voice', {}).get('action') == 'started'
          and out.get('skills', {}).get('my-taste', {}).get('action') == 'started'
          and env.git('-C', env.clone, 'rev-parse', 'HEAD') == head and not (env.clone / 'my-taste' / 'SKILL.md').exists(),
          'start --dry-run says it would start both and changes nothing')

    # start: both become the person's own, their earlier edit is kept privately
    code, out = tool(env, 'start')
    voice_entry = out.get('skills', {}).get('my-voice', {})
    check(code == 0 and voice_entry.get('replaces') == 'your edited copy' and voice_entry.get('your_lines') == 1,
          f"start brings in the person's own edit first and says so ({voice_entry.get('replaces')}, "
          f"{voice_entry.get('your_lines')} line)")
    previous = voice_entry.get('previous_copy', '')
    previous_path = Path(previous.replace('~', str(env.home), 1)) if previous.startswith('~') else Path(previous)
    check(previous_path.is_file() and 'sign off with my first name' in previous_path.read_text(encoding='utf-8')
          and str(private) in str(previous_path), 'the old copy is saved in the private folder')
    for skill in ('my-voice', 'my-taste'):
        text = (env.clone / skill / 'SKILL.md').read_text(encoding='utf-8')
        installed = env.skills / skill / 'SKILL.md'
        check(text.startswith('---\nname: ' + skill) and '<!-- personal skill:' in text and installed.is_file()
              and installed.read_text(encoding='utf-8') == text, f'{skill} starts from the template and is installed')
    check('Say the thing first' not in (env.clone / 'my-voice' / 'SKILL.md').read_text(encoding='utf-8'),
          "nobody else's voice rules are left in the person's my-voice")
    check(env.git('-C', env.clone, 'symbolic-ref', '--short', 'HEAD') == 'skill-updates'
          and env.git('-C', env.clone, 'log', '-1', '--format=%s') == 'Start my own my-voice and my-taste'
          and sorted(env.git('-C', env.clone, 'diff', '--name-only', 'HEAD~1', 'HEAD').split())
          == ['my-taste/SKILL.md', 'my-voice/SKILL.md'],
          'start commits only the two skills, on skill-updates')
    code, out = tool(env, 'status')
    items = out.get('check_items', {})
    check(items.get('voice', {}).get('state') == 'started' and items.get('voice', {}).get('ok') is False
          and items.get('taste', {}).get('state') == 'started', 'status: both started, no rules yet')
    head = env.git('-C', env.clone, 'rev-parse', 'HEAD')
    code, out = tool(env, 'start')
    check(code == 0 and {s['action'] for s in out.get('skills', {}).values()} == {'kept'}
          and env.git('-C', env.clone, 'rev-parse', 'HEAD') == head, 'a second start keeps both as they are')

    # Rules with problems: check and save refuse them
    write_good_rules(env)
    voice_path = env.clone / 'my-voice' / 'SKILL.md'
    good_voice = voice_path.read_text(encoding='utf-8')
    bad = good_voice.replace(
        '## Patterns by channel\n',
        '6. **Quote.** Opens with "I took a first pass at the panel" in posts. (from: sent Teams messages; 3 sightings; '
        'latest 2026-11-09)\n'
        '7. **Email.** Copies rae@example.com and @dana on reviews. (from: sent email; 3 sightings; latest 2026-11-09)\n'
        f'8. **Dash.** Uses a dash {DASH} often, see https://example.com/style. (from: Slack; 3 sightings; latest 2026-11-09)\n'
        '9. **Codename.** Talks about Project Falcon a lot.\n\n## Patterns by channel\n')
    voice_path.write_text(bad, encoding='utf-8')
    code, out = tool(env, 'check')
    errors = ' '.join(out.get('skills', {}).get('my-voice', {}).get('errors', []))
    wanted = ('a quote of', 'an email address', 'an @mention', 'an em or en dash', 'a link', 'unknown source kind Slack',
              'a private term', 'no "(from:')
    check(code == 1 and all(w in errors for w in wanted),
          f"check finds every problem ({[w for w in wanted if w not in errors] or 'all found'})")
    code, out = tool(env, 'save')
    check(code == 1 and env.git('-C', env.clone, 'rev-parse', 'HEAD') == head,
          f"save refuses rules with problems and commits nothing ({out.get('error')})")
    voice_path.write_text(good_voice, encoding='utf-8')
    taste_path = env.clone / 'my-taste' / 'SKILL.md'
    good_taste = taste_path.read_text(encoding='utf-8')
    taste_path.write_text(good_taste.replace('[`everywhere`] (from: agent chats; 3 sightings',
                                             '(from: agent chats; 3 sightings'), encoding='utf-8')
    code, out = tool(env, 'check')
    check(code == 1 and any('no area' in e for e in out.get('skills', {}).get('my-taste', {}).get('errors', [])),
          'check wants an area on every taste rule')
    taste_path.write_text(good_taste, encoding='utf-8')
    code, out = tool(env, 'check')
    check(code == 0 and out.get('skills', {}).get('my-voice', {}).get('rules') == 6
          and out.get('skills', {}).get('my-taste', {}).get('rules') == 4, 'check passes the fixed rules (6 voice, 4 taste)')

    # save: commits the two skills, installs them, and the items turn green
    code, out = tool(env, 'save')
    items = out.get('check_items', {})
    check(code == 0 and out.get('committed') and sorted(out.get('installed', [])) == ['my-taste', 'my-voice'],
          f"save commits and installs both ({out.get('committed')}, {out.get('installed')})")
    check(sorted(env.git('-C', env.clone, 'diff', '--name-only', 'HEAD~1', 'HEAD').split())
          == ['my-taste/SKILL.md', 'my-voice/SKILL.md']
          and env.git('-C', env.clone, 'log', '-1', '--format=%s') == 'Build my my-voice and my-taste from my own work',
          'save commits only the two skills')
    check(items.get('voice', {}).get('ok') is True and items.get('voice', {}).get('detail', '').startswith(
        'Yours: 5 rules and 1 channel pattern from your sent Teams messages, sent email and agent chats'),
          f"voice is green: {items.get('voice', {}).get('detail')}")
    check(items.get('taste', {}).get('ok') is True and items.get('taste', {}).get('detail', '').startswith('Yours: 4 rules'),
          f"taste is green: {items.get('taste', {}).get('detail')}")
    for skill in ('my-voice', 'my-taste'):
        check((env.skills / skill / 'SKILL.md').read_text(encoding='utf-8')
              == (env.clone / skill / 'SKILL.md').read_text(encoding='utf-8'), f'the installed {skill} is the saved one')
    record = json.loads((env.state / 'personal-skills.json').read_text(encoding='utf-8'))
    check(record.get('format') == 'personal-skills' and record.get('skills', {}).get('my-taste', {}).get('rules') == 4,
          'the record says what was built, and when')

    # The evidence stays on this machine: never in the clone, its history, or the private copy on GitHub
    r = env.sync('sync')
    check(r.returncode == 0 and '<!-- personal skill:' in env.bare_git(env.private, 'show', 'skill-updates:my-taste/SKILL.md'),
          'the daily sync takes the rules to skill-updates in the private copy')
    leaks = [where for where, text in (
        ('clone files', env.run('git', 'grep', '-I', '-l', CANARY, cwd=env.clone).stdout),
        ('clone history', env.run('git', 'log', '--all', '-p', cwd=env.clone).stdout),
        ('private copy', env.run('git', '--git-dir', env.private, 'log', '--all', '-p').stdout),
        ('installed skills', ''.join(p.read_text(encoding='utf-8', errors='ignore') for p in env.skills.rglob('*.md'))))
        if CANARY in text]
    check(not leaks, f"the evidence never leaves the private folder ({', '.join(leaks) or 'no leaks'})")
    check(not any('voice-samples' in p or 'taste-evidence' in p or 'agent-chats' in p
                  for p in env.git('-C', env.clone, 'ls-files').split()), 'no evidence file is tracked in the clone')

    # A shared update: their my-voice and my-taste stay theirs; the new taste procedure comes in
    harness.append(public_work / 'my-voice' / 'SKILL.md', '- Shared update: a new channel pattern.')
    harness.append(public_work / 'my-taste' / 'references' / 'taste-from-workiq.md', 'Shared update: one more source.')
    env.run('git', 'commit', '-q', '-am', 'Shared update', cwd=public_work, check_rc=0)
    env.run('git', 'push', '-q', env.public, 'main', cwd=public_work, check_rc=0)
    env.on_github(('merge', '--squash', '-q', 'origin/skill-updates'), ('commit', '-q', '-m', 'Skill updates (#1)'))
    r = env.sync('upstream-pr', '--json')
    out = json.loads(r.stdout or '{}')
    upstream_voice = env.bare_git(env.private, 'show', 'upstream-updates:my-voice/SKILL.md')
    check(out.get('action') == 'opened' and 'my-voice/SKILL.md' in out.get('kept', []) and not out.get('conflicts'),
          f"upstream-pr keeps the person's my-voice ({out.get('action')}, kept {out.get('kept')})")
    check('Lead with the decision' in upstream_voice and 'Shared update' not in upstream_voice
          and 'D01' in env.bare_git(env.private, 'show', 'upstream-updates:my-taste/SKILL.md')
          and 'Shared update: one more source.' in env.bare_git(env.private, 'show',
                                                                'upstream-updates:my-taste/references/taste-from-workiq.md'),
          'and brings the new taste procedure, with their my-voice and my-taste unchanged')

    # The maintainer setup: status reports, nothing changes
    maintainer = env.root / 'maintainer-settings.json'
    maintainer.write_text(json.dumps({'private_url': 'https://github.com/someone/private-skills.git',
                                      'private_user': 'someone'}), encoding='utf-8')
    head = env.git('-C', env.clone, 'rev-parse', 'HEAD')
    before = (env.clone / 'my-voice' / 'SKILL.md').read_text(encoding='utf-8')
    codes = [tool(env, command, settings=maintainer)[0] for command in ('start', 'save', 'collect')]
    code, out = tool(env, 'status', settings=maintainer)
    check(codes == [2, 2, 2] and env.git('-C', env.clone, 'rev-parse', 'HEAD') == head
          and (env.clone / 'my-voice' / 'SKILL.md').read_text(encoding='utf-8') == before,
          'start, save, and collect refuse the maintainer setup and change nothing')
    check(out.get('mode') == 'maintainer' and all(i.get('ok') is True for i in out.get('check_items', {}).values()),
          'status on the maintainer setup: both items are fine as they are')

    print(f"\n{'all checks passed' if not harness.FAILED else f'{len(harness.FAILED)} check(s) failed'}")
    return 1 if harness.FAILED else 0


if __name__ == '__main__':
    sys.exit(main())

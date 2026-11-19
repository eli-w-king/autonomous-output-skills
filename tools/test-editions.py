#!/usr/bin/env python3
"""Test the skill editions (editions/<edition>/<skill>/) offline, in a scratch folder.

  test-editions.py [--root DIR] [--keep]

It checks:
  - the daily sync's install (tools/sync-skills.py install) and install-devbox.mjs put only the top-level skills in the
    skills folder, never an edition, from a clone that has editions;
  - the publish step (publish_tree in tools/publish-public.py) keeps every file under editions/, including
    editions/ai-first/my-taste/, while it leaves out private/ and the private-only my-taste/;
  - the validator passes the editions as a published tree, and fails an edition skill with no frontmatter, a name that
    differs from its folder, no full skill of that name, an em dash, a private term, a folder editions.json doesn't
    list, a listed skill with no folder, a status other than required or optional, or a skill it says never to have;
  - the ai-first edition: the four required skills, the three optional ones, no my-voice, each SKILL.md under a third
    of its full skill's with a short description, and nothing about Work IQ, Teams, Azure or dev boxes;
  - my-taste's taste.mjs: messages keeps only what the person typed (not autopilot, sub-agents, text another session
    sent, the weekly taste update's own session, or anything older than the window), and backup, check, restore and
    report work inside the skill's own folder.
HOME, COPILOT_HOME, the git config and the temp folder point into the test folder, so nothing else on this machine is
read or changed. Exit 0 when every check passes. Works on macOS, Linux, and Windows.
"""
import argparse
import datetime as dt
import importlib.util
import json
import re
import shutil
import subprocess
import sys
import tempfile
import textwrap
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('test_sync_attendee', HERE / 'test-sync-attendee.py')
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)
check, Env, remove_tree, shared_snapshot, SOURCE = harness.check, harness.Env, harness.remove_tree, harness.shared_snapshot, harness.SOURCE
EDITION = 'ai-first'
REQUIRED = {'autonomous-variations', 'autonomous-prototypes', 'autonomous-demos', 'autonomous-computer-use'}
OPTIONAL = {'autonomous-runs', 'autonomous-research', 'my-taste'}
CANARY = 'EDITION-' + 'CANARY-' + str(2207 * 3)  # built, so this file never contains it
DASH = '\u2014'
SCRIPT_NAMES = {'demo.mjs', 'keep-awake.mjs', 'taste.mjs', 'lab-pill.js', 'editions.json'}


def top_skills(tree):
    return sorted(p.name for p in tree.iterdir() if p.is_dir() and (p / 'SKILL.md').is_file())


def folders(path):
    return sorted(p.name for p in path.iterdir() if p.is_dir()) if path.is_dir() else []


def check_installers(env):
    env.run('git', 'clone', '-q', env.public, env.clone, check_rc=0)
    expected = top_skills(env.clone)
    r = env.sync('install')
    check(r.returncode == 0, f"sync-skills.py install succeeds ({(r.stdout or r.stderr).strip().splitlines()[-1:]})")
    installed = folders(env.skills)
    check(installed == expected, f'the sync installs exactly the top-level skills ({len(installed)}: {", ".join(installed)})')
    shared = [n for n in installed if (env.clone / 'editions' / EDITION / n).is_dir()]
    check(bool(shared) and all((env.skills / n / 'SKILL.md').read_bytes() == (env.clone / n / 'SKILL.md').read_bytes()
                               for n in shared),
          f'skills that also have an edition are installed as the full skill ({", ".join(shared)})')
    leaked = sorted(p.name for p in env.skills.rglob('*') if p.is_file() and p.name in SCRIPT_NAMES)
    check('editions' not in installed and not leaked, f'nothing from editions/ reaches the installed skills ({leaked})')
    node = shutil.which('node')
    if not check(bool(node), 'Node is installed (for install-devbox.mjs and taste.mjs)'):
        return
    devbox = env.root / 'devbox-skills'
    r = env.run(node, env.clone / 'tools' / 'install-devbox.mjs', '--repo', env.clone, '--skills', devbox)
    check(r.returncode == 0 and folders(devbox) == expected,
          f'install-devbox.mjs installs exactly the top-level skills ({", ".join(folders(devbox))} {r.stderr.strip()[-200:]})')


def check_publish(env, public_work):
    private_work = env.root / 'private-work'
    shutil.copytree(public_work, private_work, ignore=shutil.ignore_patterns('.git'))
    shutil.copy2(SOURCE / '.publishignore', private_work / '.publishignore')
    (private_work / 'private').mkdir(exist_ok=True)
    (private_work / 'private' / 'notes.txt').write_text('Private notes for the test.\n', encoding='utf-8')
    (private_work / 'my-taste' / 'SKILL.md').write_text('---\nname: my-taste\ndescription: "A private taste."\n---\n\n# Mine\n',
                                                        encoding='utf-8')
    env.run('git', 'init', '-q', '-b', 'main', cwd=private_work, check_rc=0)
    env.run('git', 'add', '-A', cwd=private_work, check_rc=0)
    env.run('git', 'commit', '-q', '-m', 'The private skills', cwd=private_work, check_rc=0)
    helper = env.root / 'publish_tree.py'
    helper.write_text(textwrap.dedent(f'''\
        import importlib.util, json
        from pathlib import Path
        spec = importlib.util.spec_from_file_location('publish_public', {str(SOURCE / 'tools' / 'publish-public.py')!r})
        publish = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(publish)
        publish.sync.REPO = Path({str(private_work)!r})
        tree, removed = publish.publish_tree(publish.sync.rev('HEAD'))
        files = (publish.sync.git('ls-tree', '-r', '--name-only', tree) or '').splitlines()
        print(json.dumps({{'removed': removed, 'files': files}}))
        '''), encoding='utf-8')
    r = env.run(sys.executable, helper)
    try:
        out = json.loads(r.stdout)
    except ValueError:
        check(False, f'publish_tree runs ({r.stderr.strip()[-300:]})')
        return
    edition_files = sorted(p.relative_to(private_work).as_posix() for p in (private_work / 'editions').rglob('*') if p.is_file())
    check(bool(edition_files) and set(edition_files) <= set(out['files']),
          f'the publish tree keeps every file under editions/ ({len(edition_files)})')
    check(f'editions/{EDITION}/my-taste/SKILL.md' in out['files'] and f'editions/{EDITION}/my-taste/scripts/taste.mjs' in out['files'],
          "the publish tree keeps the edition's my-taste (the private-only rule is for the top-level my-taste/ only)")
    check('private/notes.txt' in out['removed'] and 'my-taste/SKILL.md' in out['removed'] and 'private/notes.txt' not in out['files'],
          'the publish tree still leaves out private/ and the private-only my-taste/SKILL.md')
    check(not [p for p in out['removed'] if p.startswith('editions/')], 'nothing under editions/ is left out of the publish')


def validate(env, tree, terms):
    r = env.run(sys.executable, tree / 'tools' / 'validate-skills.py', '--repo', tree, '--private-terms', terms)
    return r.returncode, [line for line in r.stdout.splitlines() if line.startswith('error:')]


def check_validator(env, public_work):
    terms = env.root / 'terms.txt'
    terms.write_text(f'# test terms\n{CANARY}\n', encoding='utf-8')
    rc, errors = validate(env, public_work, terms)
    check(rc == 0 and not errors, f'the validator passes the editions as a published tree ({errors[:3]})')
    base = f'editions/{EDITION}'
    valid = '---\nname: {name}\ndescription: "A test skill."\n---\n\n# Test\n'

    def edit(path, old, new):
        text = path.read_text(encoding='utf-8')
        path.write_text(text.replace(old, new, 1) if old else text + new, encoding='utf-8')

    def relist(tree, change):
        path = tree / base / 'editions.json'
        listing = json.loads(path.read_text(encoding='utf-8'))
        change(listing)
        path.write_text(json.dumps(listing, indent=1), encoding='utf-8')

    def add_skill(tree, name, listed):
        (tree / base / name).mkdir()
        (tree / base / name / 'SKILL.md').write_text(valid.format(name=name), encoding='utf-8')
        if listed:
            relist(tree, lambda l: l['skills'].append({'name': name, 'status': 'optional', 'summary': 'A test skill.'}))

    demos = f'{base}/autonomous-demos/SKILL.md'
    cases = [
        ('no frontmatter', lambda t: edit(t / demos, '---\nname:', 'name:'), f'{demos}: missing frontmatter'),
        ('a name that differs from its folder', lambda t: edit(t / demos, 'name: autonomous-demos', 'name: demos-light'),
         'name "demos-light" differs from its folder'),
        ('no full skill of that name', lambda t: add_skill(t, 'autonomous-banana', True), 'there is no full skill named autonomous-banana'),
        ('an em dash', lambda t: edit(t / base / 'autonomous-runs' / 'SKILL.md', '', f'\nKeep going {DASH} then stop.\n'),
         f'{base}/autonomous-runs/SKILL.md:'),
        ('a private term', lambda t: edit(t / base / 'autonomous-research' / 'SKILL.md', '', f'\nAsk {CANARY} first.\n'), 'private term'),
        ('a folder editions.json does not list', lambda t: add_skill(t, 'autonomous-setup', False),
         f'{base}/autonomous-setup: not listed in editions.json'),
        ('a listed skill with no folder', lambda t: shutil.rmtree(t / base / 'autonomous-runs'), 'autonomous-runs is listed but has no folder'),
        ('a skill it must never have', lambda t: add_skill(t, 'my-voice', False), 'never has my-voice'),
        ('a status other than required or optional',
         lambda t: relist(t, lambda l: l['skills'][0].update(status='maybe')), 'needs a status (required or optional)'),
    ]
    for label, change, expected in cases:
        tree = env.root / 'cases' / re.sub(r'\W+', '-', label)
        shutil.copytree(public_work, tree, ignore=shutil.ignore_patterns('.git'))
        env.run('git', 'init', '-q', cwd=tree, check_rc=0)
        change(tree)
        rc, errors = validate(env, tree, terms)
        check(rc == 1 and any(expected in e for e in errors), f'the validator fails an edition with {label} ({errors[:2]})')
        remove_tree(tree)


def check_content():
    root = SOURCE / 'editions' / EDITION
    listing = json.loads((root / 'editions.json').read_text(encoding='utf-8'))
    status = {e['name']: e['status'] for e in listing['skills']}
    check({n for n, s in status.items() if s == 'required'} == REQUIRED, 'ai-first requires variations, prototypes, demos and Computer Use')
    check({n for n, s in status.items() if s == 'optional'} == OPTIONAL, 'ai-first offers runs, research and my-taste as optional')
    check('my-voice' in listing.get('never', []) and not (root / 'my-voice').exists(), 'ai-first never has my-voice')
    heavy, wordy = [], []
    for name in sorted(REQUIRED | OPTIONAL):
        text = (root / name / 'SKILL.md').read_text(encoding='utf-8')
        full = SOURCE / name / 'SKILL.md'
        if full.is_file() and (root / name / 'SKILL.md').stat().st_size * 3 >= full.stat().st_size:
            heavy.append(name)
        description = re.search(r'^description:\s*"?(.*?)"?$', text, re.M)
        if not description or len(description.group(1)) > 500:
            wordy.append(name)
    check(not heavy, f'every edition SKILL.md is under a third of its full skill ({heavy})')
    check(not wordy, f'every edition description is under 500 characters, so every session stays cheap ({wordy})')
    internal = re.compile(r'(?i)\bwork ?iq\b|\bteams\b|\bazure\b|\bdev ?box(es)?\b')
    hits = [f'{p.relative_to(root).as_posix()}:{n}' for p in sorted(root.rglob('*')) if p.is_file()
            for n, line in enumerate(p.read_text(encoding='utf-8').splitlines(), 1) if internal.search(line)]
    check(not hits, f'the edition never mentions Work IQ, Teams, Azure or dev boxes ({hits[:3]})')


def write_session(env, sid, cwd, events):
    folder = env.copilot / 'session-state' / sid
    folder.mkdir(parents=True)
    (folder / 'workspace.yaml').write_text(f'id: {sid}\ncwd: {cwd}\n', encoding='utf-8')
    (folder / 'events.jsonl').write_text(''.join(json.dumps(e) + '\n' for e in events), encoding='utf-8')


def check_taste(env):
    node = shutil.which('node')
    if not node:
        return
    now = dt.datetime.now(dt.timezone.utc)

    def at(days):
        return (now - dt.timedelta(days=days)).strftime('%Y-%m-%dT%H:%M:%S.000Z')

    def said(days, text, **extra):
        return {'type': 'user.message', 'timestamp': at(days), 'data': {'content': text, **extra.pop('data', {})}, **extra}

    brief = 'Build one variation of the toolbar, in parallel with other sessions. Read AGENTS.md first.'
    # The Agents window gives every typed turn a parentAgentTaskId; other agents' text has a source like agent-<id>.
    write_session(env, 'one', '/work/excalidraw-case-study', [
        said(1, '<current_datetime>now</current_datetime>The toolbar feels too busy. Keep it calm and left align the labels.',
             data={'parentAgentTaskId': 'turn-1'}),
        said(1, 'Continue with the plan.', data={'source': 'autopilot'}),
        said(1, 'A note from the system about the tools.', data={'source': 'system', 'parentAgentTaskId': 'turn-2'}),
        said(1, 'Hand off from another agent: check the build.', data={'source': 'agent-1234', 'parentAgentTaskId': 'turn-3'}),
        {'type': 'tool.execution_start', 'timestamp': at(1), 'data': {'toolName': 'create_session', 'arguments': {'prompt': brief}}},
        said(1, 'You are a sub-agent: review the diff.', agentId='sub-1'),
        said(30, 'An old note from last month about gradients.'),
    ])
    write_session(env, 'two', '/work/excalidraw-case-study.worktrees/calm', [
        said(1, brief),
        said(0.5, 'Make the icons bigger, I love bold shapes.', data={'parentAgentTaskId': 'turn-4'}),
    ])
    write_session(env, 'four', '/home/you/.copilot/chats/3fa489ec-5504-4a58-b101-cc5c1edaebf6', [
        said(0.3, 'Give the empty state a friendlier line.', data={'parentAgentTaskId': 'turn-5'}),
    ])
    write_session(env, 'three', '/work/ai-first-workshop', [
        said(0.2, "Weekly taste update. Use the my-taste skill's weekly update."),
        said(0.2, 'A later message in the automation session.'),
    ])
    skill = env.root / 'skills-copy' / 'my-taste'
    shutil.copytree(SOURCE / 'editions' / EDITION / 'my-taste', skill)
    script = skill / 'scripts' / 'taste.mjs'
    r = env.run(node, script, 'messages', '--days', '7')
    kept = ['too busy', 'bold shapes', '(chat): Give the empty state']
    dropped = ['Continue with the plan', 'sub-agent', 'Build one variation', 'old note', 'Weekly taste update',
               'automation session', 'current_datetime', 'note from the system', 'another agent', '3fa489ec']
    check(r.returncode == 0 and all(k in r.stdout for k in kept) and not any(d in r.stdout for d in dropped),
          f'taste.mjs messages keeps only what the person typed in the last 7 days ({r.stdout.strip()[-300:]})')
    original = (skill / 'SKILL.md').read_text(encoding='utf-8')
    r = env.run(node, script, 'backup')
    backups = list((skill / 'backups').glob('SKILL-*.md'))
    check(r.returncode == 0 and len(backups) == 1 and backups[0].read_text(encoding='utf-8') == original,
          "taste.mjs backup copies SKILL.md into the skill's backups/ folder")
    check(env.run(node, script, 'check').returncode == 0, 'taste.mjs check passes the edition as shipped')
    (skill / 'SKILL.md').write_text(original + f'\n- **Calm toolbars {DASH} few tools.** (seen 2 times)\n', encoding='utf-8')
    check(env.run(node, script, 'check').returncode == 1, 'taste.mjs check catches an em dash')
    r = env.run(node, script, 'restore')
    check(r.returncode == 0 and (skill / 'SKILL.md').read_text(encoding='utf-8') == original
          and len(list((skill / 'backups').glob('SKILL-*-replaced.md'))) == 1,
          'taste.mjs restore puts the backup back and keeps a copy of what it replaced')
    r = env.run(node, script, 'report', '--text', 'Nothing new this week.')
    reports = list((skill / 'updates').glob('*.md'))
    check(r.returncode == 0 and len(reports) == 1 and 'Nothing new this week.' in reports[0].read_text(encoding='utf-8'),
          "taste.mjs report writes updates/<date>.md in the skill's folder")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--root', help='the test folder (default: a new temporary folder)')
    parser.add_argument('--keep', action='store_true', help='keep the test folder afterwards')
    args = parser.parse_args()
    root = Path(args.root).resolve() if args.root else Path(tempfile.mkdtemp(prefix='editions-test-'))
    if root.exists() and any(root.iterdir()):
        print(f'{root} is not empty')
        return 2
    root.mkdir(parents=True, exist_ok=True)
    env = Env(root)
    try:
        if not check((SOURCE / 'editions' / EDITION / 'editions.json').is_file(), f'editions/{EDITION} exists'):
            return 1
        public_work = shared_snapshot(env)
        check_content()
        check_installers(env)
        check_publish(env, public_work)
        check_validator(env, public_work)
        check_taste(env)
    finally:
        if args.keep:
            print(f'kept {root}')
        else:
            remove_tree(root)
    print('all checks passed' if not harness.FAILED else f'{len(harness.FAILED)} check(s) failed')
    return 1 if harness.FAILED else 0


if __name__ == '__main__':
    sys.exit(main())

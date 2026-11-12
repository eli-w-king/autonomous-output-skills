#!/usr/bin/env python3
"""Publish the private skills repo to the public one, without private/ and without its history.

The private repo (remote origin) has everything. The public repo (remote public) gets the same tree
minus private/, .publishignore, and the paths .publishignore lists (one gitignore-style pattern per
line), as one new commit on top of public/main. Private history never goes to the public repo.

  1. Fetch both remotes. Teammates may push to the public repo, so public/main is merged into the
     private main first (and pushed to origin) when it has commits that main does not.
  2. Build the publish tree from main and check it with validate-skills.py: every check, the private
     terms in private/private-terms.txt (and ~/.copilot/skill-miner/private-terms.txt when present),
     no binary files added, and a commit message with no email addresses.
  3. Make one commit on top of public/main with git commit-tree, push it to public main, then record
     it in the private main as a merge that keeps main's tree, so the next merge of public/main only
     brings in what teammates added since.

--dry-run does steps 1 and 2 without changing a ref or pushing anything, and lists what would change.

While private/publish-hold.txt exists in the private main, every real publish stops before it changes
anything (the weekly miner then pushes to the private repo only); its first line says why. Dry runs still
work. Delete the file to publish again.

Usage: publish-public.py [--dry-run] [--message TEXT | --message-file FILE] [--repo CLONE]
Exit codes: 0 published or nothing to publish (or a clean dry run), 1 not published (the reason is printed)
"""
import argparse
import importlib.util
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('sync_skills', HERE / 'sync-skills.py')
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)
TRAILER = re.compile(r'(?i)^(co-authored-by|signed-off-by|copilot-session|reviewed-by):')
HOLD = 'private/publish-hold.txt'


def fail(message):
    print(f'Not published: {message}')
    return 1


def git(*args, env=None, input=None, timeout=300):
    rc, out, err = sync.g(*args, env=env, input=input, timeout=timeout)
    return rc, out, err


def publish_tree(commit):
    """main's tree without private/, .publishignore, and what .publishignore lists. Returns (tree, removed paths)."""
    with sync.scratch_dir() as tmp:
        env = dict(sync.GIT_ENV, GIT_INDEX_FILE=str(Path(tmp) / 'index'))
        rc, _, err = git('read-tree', commit, env=env)
        if rc:
            raise RuntimeError(f'git read-tree {commit}: {sync.first_error(err)}')
        removed = set()
        listed = (sync.git('ls-tree', '-r', '--name-only', '-z', commit) or '').split('\0')
        removed.update(p for p in listed if p == '.publishignore' or p.startswith('private/'))
        rules = sync.git('show', f'{commit}:.publishignore')
        if rules:
            (Path(tmp) / 'rules').write_text(rules + '\n', encoding='utf-8')
            rc, out, _ = git('ls-files', '-i', '-c', f"--exclude-from={Path(tmp) / 'rules'}", '-z', env=env)
            removed.update(p for p in out.split('\0') if p)
        removed.discard('')
        if removed:
            # update-index works on the temporary index alone; rm --cached would compare with the clone's
            # HEAD and working tree, and refuse when the clone's main is behind the commit being published.
            spec_bytes = b''.join(p.encode('utf-8', 'surrogateescape') + b'\0' for p in sorted(removed))
            rc, _, err = git('update-index', '--force-remove', '-z', '--stdin', env=env, input=spec_bytes)
            if rc:
                raise RuntimeError(f'git update-index --force-remove: {sync.first_error(err)}')
        rc, tree, err = git('write-tree', env=env)
        if rc:
            raise RuntimeError(f'git write-tree: {sync.first_error(err)}')
        return tree, sorted(removed)


def message_from(args, changed_tops):
    text = ''
    if args.message_file:
        text = Path(args.message_file).read_text(encoding='utf-8')
    elif args.message:
        text = args.message
    lines = [line.rstrip() for line in text.splitlines() if not TRAILER.match(line.strip())]
    while lines and not lines[-1]:
        lines.pop()
    while lines and not lines[0]:
        lines.pop(0)
    if not lines:
        lines = ['Update skills: ' + ', '.join(changed_tops[:6]) + (f' and {len(changed_tops) - 6} more' if len(changed_tops) > 6 else '')]
    return '\n'.join(lines) + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--message', help='the public commit message (trailers with email addresses are dropped)')
    parser.add_argument('--message-file', help='read the public commit message from this file')
    parser.add_argument('--repo', help='the private clone (default: the one this script is in)')
    args = parser.parse_args()
    if args.repo:
        sync.REPO = Path(args.repo).expanduser().resolve()
    repo = sync.REPO
    settings = sync.load_settings()
    if settings.get('mode') == 'attendee':
        return fail('this machine is set up in attendee mode (automations/ATTENDEES.md): your private copy never '
                    'publishes to the shared repo. To suggest a change there, open a pull request from a fork.')

    if sync.git('symbolic-ref', '--short', '-q', 'HEAD') != 'main':
        return fail(f'{repo} is not on main')
    busy = sync.git_busy()
    if busy:
        return fail(f'a git operation is in progress in {repo} ({busy})')
    if not sync.git('remote', 'get-url', 'public'):
        return fail('there is no public remote; run sync-skills.py setup')
    if settings.get('public_url') and not sync.same_url(sync.git('remote', 'get-url', 'origin'), settings.get('private_url')):
        return fail('origin is not the private repo from ~/.copilot/skills-sync.json')
    terms = [repo / 'private' / 'private-terms.txt', sync.STATE / 'private-terms.txt']
    terms = [t for t in terms if t.is_file()]
    if not terms:
        return fail('no private terms file (private/private-terms.txt); the publish check needs one')

    owner = not args.dry_run and sync.take_lock(sync.SYNC_LOCK, 1800)
    if not args.dry_run and not owner:
        return fail('a sync is running; try again in a minute')
    try:
        for remote in ('origin', 'public'):
            rc, _, err = git('fetch', '-q', remote)
            if rc:
                return fail(f'git fetch {remote}: {sync.first_error(err)}')
        if sync.dirty_paths():
            return fail(f'{repo} has uncommitted changes; let the sync commit them first')
        head = sync.rev('HEAD')
        origin_main, public_main = sync.rev('refs/remotes/origin/main'), sync.rev('refs/remotes/public/main')
        if head != origin_main:
            if sync.is_ancestor(head, origin_main):
                if args.dry_run:
                    print(f'note: main is behind origin/main; using origin/main {origin_main[:7]}')
                    head = origin_main
                else:
                    git('merge', '--ff-only', '-q', 'refs/remotes/origin/main')
                    head = origin_main
            elif args.dry_run:
                print(f"note: using the local main, which has {sync.count(f'{origin_main}..{head}')} commit(s) not on origin yet")
            else:
                return fail('main has commits that are not on origin yet; run sync-skills.py sync first')

        # A hold in the private repo stops every real publish, from any machine or the weekly miner.
        hold = sync.git('show', f'{head}:{HOLD}')
        if hold is not None:
            reason = next((l.strip() for l in hold.splitlines() if l.strip() and not l.lstrip().startswith('#')),
                          'no reason given')
            if not args.dry_run:
                return fail(f'publishing is on hold ({HOLD}: {reason}). Remove that file to publish.')
            print(f'note: publishing is on hold ({HOLD}: {reason}); a real publish stops here')

        # 1. Teammates' commits on the public repo come into the private main first.
        source = head
        if not sync.is_ancestor(public_main, head):
            new = sync.count(f'{head}..{public_main}')
            if args.dry_run:
                rc, out, _ = git('merge-tree', '--write-tree', head, public_main)
                if rc:
                    return fail(f'public/main has {new} commit(s) that conflict with the private main; merge public/main into main by hand')
                print(f'would merge {new} commit(s) from public/main into the private main first')
                rc, source, err = git('commit-tree', out.splitlines()[0], '-p', head, '-p', public_main, '-m', 'Dry run merge')
            else:
                rc, _, err = git('merge', '--no-edit', '-q', '-m', 'Merge public main into the private main', 'refs/remotes/public/main')
                if rc:
                    if sync.git_busy():
                        git('merge', '--abort')
                    return fail(f'public/main has {new} commit(s) that conflict with the private main; merge public/main into main by hand')
                rc, _, err = git('push', '-q', 'origin', 'HEAD:refs/heads/main')
                if rc:
                    return fail(f'could not push the merge of public/main to origin: {sync.first_error(err)}')
                source = sync.rev('HEAD')
                print(f'merged {new} commit(s) from public/main into the private main and pushed it')

        # 2. The publish tree and its commit.
        tree, removed = publish_tree(source)
        if tree == sync.git('rev-parse', f'{public_main}^{{tree}}'):
            print('Nothing to publish: the public repo already has this tree.')
            return 0
        changed = (sync.git('diff', '--name-status', '--no-renames', public_main, tree) or '').splitlines()
        tops = []
        for row in changed:
            top = row.split('\t', 1)[-1].split('/', 1)[0]
            if top not in tops:
                tops.append(top)
        message = message_from(args, tops)
        env = dict(sync.GIT_ENV)
        if settings.get('publish_email'):
            name = settings.get('publish_name') or settings.get('public_user') or 'skills'
            env.update(GIT_AUTHOR_NAME=name, GIT_AUTHOR_EMAIL=settings['publish_email'],
                       GIT_COMMITTER_NAME=name, GIT_COMMITTER_EMAIL=settings['publish_email'])
        rc, commit, err = git('commit-tree', tree, '-p', public_main, '-F', '-', env=env, input=message.encode('utf-8'))
        if rc:
            return fail(f'git commit-tree: {sync.first_error(err)}')
        leaked = [p for p in (sync.git('ls-tree', '-r', '--name-only', commit) or '').splitlines()
                  if p.startswith('private/') or p == '.publishignore' or p in removed]
        if leaked:
            return fail(f'the publish tree still has unpublished paths: {leaked[:3]}')
        if sync.count(f'{public_main}..{commit}') != 1:
            return fail('the publish commit is not exactly one commit on top of public/main')

        # Validate the tree exactly as it will be published, in a temporary worktree.
        work = Path(tempfile.mkdtemp(prefix='publish-check-'))
        try:
            rc, _, err = git('worktree', 'add', '-q', '--detach', str(work / 'tree'), commit)
            if rc:
                return fail(f'git worktree add: {sync.first_error(err)}')
            command = [sys.executable, str(work / 'tree' / 'tools' / 'validate-skills.py'), '--base', public_main,
                       '--commits', public_main, '--published', '--quiet']
            for t in terms:
                command += ['--private-terms', str(t)]
            if (repo / 'private' / 'public-terms.txt').is_file():
                command += ['--public-terms', str(repo / 'private' / 'public-terms.txt')]
            r = subprocess.run(command, capture_output=True, text=True, timeout=900, env=sync.GIT_ENV)
            report = (r.stdout + r.stderr).strip()
        finally:
            git('worktree', 'remove', '--force', str(work / 'tree'))
            shutil.rmtree(work, ignore_errors=True)
            git('worktree', 'prune')
        if r.returncode:
            print(report)
            return fail('the validator found problems in the publish tree (above); nothing was pushed')

        print(f"{'Would publish' if args.dry_run else 'Publishing'} {commit[:7]} on top of public/main {public_main[:7]}:")
        print('  ' + message.splitlines()[0])
        for row in changed:
            print(f'  {row}')
        print(f'  ({len(changed)} file(s); left out: private/ and {len(removed)} unpublished file(s); validator: clean)')
        if args.dry_run:
            return 0

        # 3. Push the one commit, then record it in the private main.
        rc, _, err = git('push', '-q', 'public', f'{commit}:refs/heads/main')
        if rc:
            return fail(f'git push public: {sync.first_error(err)} (the next publish tries again)')
        old = sync.rev('HEAD')
        record = (f'Record publish {commit[:7]} to the public repo\n\nKeeps the private tree; the next merge of public/main '
                  f'only brings in what teammates add after this.\n\n{sync.COAUTHOR}\n')
        rc, merge, err = git('commit-tree', f'{old}^{{tree}}', '-p', old, '-p', commit, '-F', '-', input=record.encode('utf-8'))
        if rc or git('update-ref', '-m', 'publish-public: record the publish', 'refs/heads/main', merge, old)[0]:
            print(f'warning: published, but could not record it in main ({sync.first_error(err)})')
        else:
            rc, _, err = git('push', '-q', 'origin', 'HEAD:refs/heads/main')
            if rc:
                print(f'warning: published; the record commit is local until the next sync pushes it ({sync.first_error(err)})')
        url = re.sub(r'\.git$', '', settings.get('public_url') or sync.git('remote', 'get-url', 'public') or '')
        print(f'Published: {url}/commit/{commit}')
        return 0
    finally:
        if owner:
            shutil.rmtree(sync.SYNC_LOCK, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())

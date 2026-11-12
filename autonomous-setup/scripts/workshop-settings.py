#!/usr/bin/env python3
"""Show or apply the workshop's VS Code Insiders settings, and change nothing else.

  workshop-settings.py diff    [--snippet FILE] [--settings FILE] [--json]
  workshop-settings.py apply   [--snippet FILE] [--settings FILE] [--json]
  workshop-settings.py restore [--backup FILE] [--settings FILE] [--json]

diff lists what apply would add or change in the user settings.json of VS Code Insiders (the default profile) and
prints the change as a unified diff. apply backs the file up first (to ~/.copilot/workshop-setup/backups/), sets only
the snippet's keys, keeps everything else exactly as it was (comments, order, formatting, line endings), checks the
result, and replaces the file in one step. It refuses a settings.json with a syntax error. restore puts the newest
backup (or --backup FILE) back; when apply created the file (there was none to back up), it takes the workshop
settings back out and deletes the file if nothing else is in it.

The snippet defaults to references/workshop-settings.jsonc next to this script. Some settings take effect only after
Insiders restarts; the output says when (restart_needed).
Exit codes: 0 done or nothing to do, 1 error, 2 usage error.
"""
import argparse
import difflib
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import setuplib as L  # noqa: E402

WS = L.load_workshop()
BACKUPS = L.STATE_DIR / 'backups'
# Settings whose description says they apply after a restart.
RESTART_KEYS = {'chat.agentHost.computerUse.enabled'}


def fail(message, as_json):
    print(json.dumps({'ok': False, 'error': message}) if as_json else 'error: %s' % message)
    return 1


def read(path):
    raw = path.read_bytes() if path.is_file() else b''
    bom = raw.startswith(b'\xef\xbb\xbf')
    return raw.decode('utf-8-sig'), bom


def plan(text, entries):
    """The new text and what changes, after checking that only the snippet's keys differ."""
    new, changed, added = L.merge_settings(text, entries)
    before = L.parse_jsonc(text) if text.strip() else {}
    after = L.parse_jsonc(new)
    keys = {k for k, _, _ in entries}
    for key, value, _ in entries:
        if after.get(key) != value:
            raise L.JSONCError('after the edit, %s does not have the workshop value' % key)
    if {k: v for k, v in before.items() if k not in keys} != {k: v for k, v in after.items() if k not in keys}:
        raise L.JSONCError('the edit would change other settings; nothing was written')
    return new, changed, added, before


def undo_new_file(settings, args):
    """apply created settings.json (there was none), so there is no backup: take the workshop settings and the comments
    apply added back out, and delete the file when nothing else is left in it."""
    snippet = L.expand(args.snippet) if args.snippet else L.REFS / WS['settings_snippet']
    if not settings.is_file():
        result = {'ok': True, 'restored': 'nothing to do: there is no settings file', 'settings': L.tilde(settings)}
        print(json.dumps(result) if args.json else result['restored'])
        return 0
    try:
        entries = L.snippet_entries(snippet.read_text(encoding='utf-8'))
        text, bom = read(settings)
        new, removed, left = L.remove_settings(text, entries)
        others_before = {k: v for k, v in L.parse_jsonc(text).items() if k not in {e[0] for e in entries}}
        if (L.parse_jsonc(new) if new.strip() else {}) != others_before:
            raise L.JSONCError('taking the workshop settings out would change other settings; nothing was written')
    except (OSError, L.JSONCError) as error:
        return fail('%s: %s' % (L.tilde(settings), error), args.json)
    if left == 0:
        settings.unlink()
        done = 'deleted %s, which the setup had created (it held only the workshop settings)' % L.tilde(settings)
    else:
        L.write_atomic(settings, ('\ufeff' if bom else '') + new, mode_from=settings)
        done = 'took the workshop settings out of %s and kept your other settings' % L.tilde(settings)
    L.set_answers(settings_backup='restored')
    result = {'ok': True, 'restored': done, 'removed': removed, 'settings': L.tilde(settings)}
    print(json.dumps(result) if args.json else done)
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('command', choices=('diff', 'apply', 'restore'))
    parser.add_argument('--snippet', help='the settings to apply (default: references/%s)' % WS['settings_snippet'])
    parser.add_argument('--settings', help='the settings.json to change (default: VS Code Insiders, default profile)')
    parser.add_argument('--backup', help='restore: the backup to put back (default: the newest)')
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args()
    settings = L.expand(args.settings) if args.settings else L.insiders_settings_path()

    if args.command == 'restore':
        backups = sorted(BACKUPS.glob('settings-*.json')) if BACKUPS.is_dir() else []
        backup = L.expand(args.backup) if args.backup else (backups[-1] if backups else None)
        created = L.load_state()['answers'].get('settings_backup') == 'none (new file)'
        if not args.backup and not backup and created:
            return undo_new_file(settings, args)
        if not backup or not backup.is_file():
            return fail('no settings backup to restore in %s' % L.tilde(BACKUPS), args.json)
        L.write_atomic(settings, backup.read_bytes().decode('utf-8'), mode_from=settings)
        result = {'ok': True, 'restored': L.tilde(backup), 'settings': L.tilde(settings)}
        print(json.dumps(result) if args.json else 'restored %s from %s' % (L.tilde(settings), L.tilde(backup)))
        return 0

    snippet = L.expand(args.snippet) if args.snippet else L.REFS / WS['settings_snippet']
    try:
        entries = L.snippet_entries(snippet.read_text(encoding='utf-8'))
    except (OSError, L.JSONCError) as error:
        return fail('cannot read the snippet %s: %s' % (L.tilde(snippet), error), args.json)
    text, bom = read(settings)
    try:
        new, changed, added, before = plan(text, entries)
    except L.JSONCError as error:
        return fail('%s: %s. Fix the file in VS Code (it underlines the problem), then run this again.'
                    % (L.tilde(settings), error), args.json)
    values = {k: v for k, v, _ in entries}
    result = {'ok': True, 'settings': L.tilde(settings), 'exists': settings.is_file(), 'snippet': L.tilde(snippet),
              'add': [{'key': k, 'value': values[k]} for k in added],
              'change': [{'key': k, 'from': before.get(k), 'to': values[k]} for k in changed],
              'already_set': [k for k in values if k not in added and k not in changed],
              'restart_needed': bool(RESTART_KEYS & (set(added) | set(changed)))}
    # The diff shows lines of their own settings.json around the change: never let a token or key through.
    diff = L.redact(''.join(difflib.unified_diff(text.splitlines(True), new.splitlines(True), 'settings.json (now)',
                                                 'settings.json (with the workshop settings)')))

    if args.command == 'diff':
        result['diff'] = diff
        if args.json:
            print(json.dumps(result, indent=1))
        elif not added and not changed:
            print('All %d workshop settings are already set in %s.' % (len(values), L.tilde(settings)))
        else:
            print('%d to add, %d to change in %s%s\n\n%s' % (
                len(added), len(changed), L.tilde(settings),
                ' (restart Insiders afterwards)' if result['restart_needed'] else '', diff))
        return 0

    if not added and not changed:
        result['written'] = False
        print(json.dumps(result) if args.json else 'Nothing to change: the workshop settings are already set.')
        return 0
    backup = None
    if settings.is_file():
        BACKUPS.mkdir(parents=True, exist_ok=True)
        backup = BACKUPS / ('settings-%s.json' % L.stamp())
        shutil.copy2(str(settings), str(backup))
    L.write_atomic(settings, ('\ufeff' if bom else '') + new, mode_from=settings if settings.is_file() else None)
    check, _ = read(settings)
    if check != new:
        return fail('the file changed while it was being written; the backup is %s' % (L.tilde(backup) if backup else 'none'),
                    args.json)
    L.set_answers(settings_backup=str(backup) if backup else 'none (new file)')
    result.update({'written': True, 'backup': L.tilde(backup) if backup else None})
    if args.json:
        print(json.dumps(result, indent=1))
    else:
        print('Applied %d workshop settings to %s.%s%s' % (
            len(added) + len(changed), L.tilde(settings), ' Backup: %s.' % L.tilde(backup) if backup else '',
            ' Restart VS Code Insiders for them all to take effect.' if result['restart_needed'] else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main())

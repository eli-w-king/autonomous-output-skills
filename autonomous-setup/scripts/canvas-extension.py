#!/usr/bin/env python3
"""Put the setup checklist canvas where the chat that's already running can load it.

  canvas-extension.py status  [--source DIR] [--json]
  canvas-extension.py install [--source DIR] [--json]
  canvas-extension.py remove  [--json]

A plugin installed from a terminal only loads in chats that start after it, and VS Code doesn't launch extensions from
a session's own folder. So the setup copies the canvas extension from the clone
(plugins/workshop-setup/extensions/setup-checklist) into Copilot's user extensions folder
(~/.copilot/extensions/setup-checklist): extensions_reload loads it into the running chat, and every later chat loads
it when it starts. install copies only when the copy there differs from the clone's (it replaces the folder whole) and
says whether a reload is needed. status reports the same and changes nothing. remove deletes the copy.

Use one or the other, never both: with the workshop-setup plugin and this copy, every chat sees two providers of the
same canvas id, and list_canvas_capabilities and open_canvas fail until they get an extensionId. So install never
copies when the plugin is installed (the plugin brings the canvas to chats that start after it), and status warns
when both are there.

Environment: COPILOT_HOME (default ~/.copilot). Exit codes: 0 ok, 1 error, 2 usage error.
"""
import argparse
import hashlib
import json
import os
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import setuplib as L  # noqa: E402

NAME = 'setup-checklist'
PART = Path('plugins') / 'workshop-setup' / 'extensions' / NAME
TARGET = L.COPILOT / 'extensions' / NAME
EXTENSION_ID = 'user:' + NAME
PLUGIN_EXTENSION_ID = 'plugin:workshop-setup:' + NAME


def source_dir(given=None):
    """The clone's copy: --source, the repo this script runs from, then the clone in the Copilot home."""
    if given:
        return L.expand(given)
    for root in (L.SKILL_DIR.parent, L.COPILOT / 'autonomous-output-skills'):
        if (root / PART / 'extension.mjs').is_file():
            return root / PART
    return L.COPILOT / 'autonomous-output-skills' / PART


def digest(folder):
    """A hash of every file's relative path and bytes, or None when there's no extension there."""
    if not (folder / 'extension.mjs').is_file():
        return None
    h = hashlib.sha256()
    for path in sorted(p for p in folder.rglob('*') if p.is_file() and not p.name.startswith('.')):
        h.update(path.relative_to(folder).as_posix().encode('utf-8') + b'\0')
        h.update(path.read_bytes() + b'\0')
    return h.hexdigest()


def plugin_installed():
    config = L.read_json(L.COPILOT / 'config.json', {}) or {}
    listed = any(str(p.get('name', '')) == 'workshop-setup' for p in config.get('installedPlugins') or [])
    return listed or (L.COPILOT / 'installed-plugins' / 'autonomous-output-skills' / 'workshop-setup').is_dir()


def status(given=None):
    source = source_dir(given)
    want, have = digest(source), digest(TARGET)
    out = {'ok': want is not None, 'source': L.tilde(source), 'source_found': want is not None,
           'target': L.tilde(TARGET), 'installed': have is not None, 'current': have is not None and have == want,
           'extension_id': EXTENSION_ID, 'plugin_installed': plugin_installed()}
    if want is None:
        out['detail'] = 'no canvas extension at %s; clone or pull the skills repo first' % L.tilde(source)
    elif out['current']:
        out['detail'] = 'the canvas is in the user extensions folder and matches the clone'
    else:
        out['detail'] = 'the canvas %s; install copies it' % ('is out of date' if have else 'is not installed yet')
    if out['plugin_installed']:
        if out['installed']:
            out['warning'] = ('the workshop-setup plugin is installed too, so chats see two providers of the canvas: open '
                              'it with extensionId %s, then remove this copy (canvas-extension.py remove)'
                              % PLUGIN_EXTENSION_ID)
    return out


def install(given=None):
    out = status(given)
    if not out['source_found']:
        return out
    if out['plugin_installed'] and not out['installed']:
        out.update(changed=False, reload_needed=False, skipped='plugin',
                   detail='the workshop-setup plugin provides the canvas in chats that start after it was installed; '
                          'not copying, so the canvas id stays unique')
        return out
    if out['current']:
        out.update(changed=False, reload_needed=False)
        return out
    source = source_dir(given)
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    staging = TARGET.parent / ('.%s.new-%d' % (NAME, os.getpid()))
    L.rmtree(staging)
    shutil.copytree(source, staging, ignore=shutil.ignore_patterns('.*'))
    if TARGET.exists():
        L.rmtree(TARGET)
    os.replace(staging, TARGET)
    out = status(given)
    out.update(changed=True, reload_needed=True,
               detail='copied the canvas to %s; call extensions_reload, then list_canvas_capabilities' % L.tilde(TARGET))
    return out


def remove():
    existed = TARGET.exists()
    if existed:
        L.rmtree(TARGET)
    return {'ok': not TARGET.exists(), 'removed': existed, 'target': L.tilde(TARGET),
            'detail': 'removed %s' % L.tilde(TARGET) if existed else 'nothing at %s' % L.tilde(TARGET)}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('command', choices=('status', 'install', 'remove'))
    parser.add_argument('--source', help='the extension folder to copy (default: the clone\'s %s)' % PART.as_posix())
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args()
    try:
        out = remove() if args.command == 'remove' else install(args.source) if args.command == 'install' \
            else status(args.source)
    except OSError as error:
        out = {'ok': False, 'detail': '%s failed: %s' % (args.command, error)}
    print(json.dumps(out, indent=1) if args.json else out.get('detail', ''))
    if out.get('warning') and not args.json:
        print('warning: ' + out['warning'])
    return 0 if out.get('ok') else 1


if __name__ == '__main__':
    sys.exit(main())

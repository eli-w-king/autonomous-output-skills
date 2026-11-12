#!/usr/bin/env python3
"""Add or check the MCP servers the setup offers, in Copilot's MCP config (~/.copilot/mcp-config.json, which Copilot
CLI and the Agents window's Copilot sessions read). Changes nothing else.

  mcp-servers.py status [--json]
  mcp-servers.py add playwright [--browser chrome|msedge] [--version V] [--dry-run] [--json]
  mcp-servers.py add devbox [--version V] [--dry-run] [--json]
  mcp-servers.py remove NAME [--json]

playwright is the Playwright MCP server (@playwright/mcp) on the installed Chrome or Edge, so no browser downloads:
agents can open a page, click, fill and take screenshots from one prompt. devbox is Microsoft's Dev Box MCP server
(@microsoft/devbox-mcp, an alpha), so agents can list, start, stop and set up dev boxes from chat.

The version is pinned to the newest plain release (x.y.z) the npm registry has, because a registry can point "latest"
at an old prerelease (Microsoft's npm feed does for @playwright/mcp). add keeps a backup of the file, never adds a
second server for something that's already there, and never touches other servers. New sessions pick the server up.
Exit codes: 0 done or nothing to do, 1 error, 2 usage error.
"""
import argparse
import json
import re
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import setuplib as L  # noqa: E402

CONFIG = L.COPILOT / 'mcp-config.json'
BACKUPS = L.STATE_DIR / 'backups'
SERVERS = {
    'playwright': {'package': '@playwright/mcp', 'fallback': '0.0.84', 'match': 'playwright'},
    'devbox': {'package': '@microsoft/devbox-mcp', 'fallback': '0.0.3-alpha.4', 'match': 'devbox-mcp'},
}


def read_config():
    if not CONFIG.is_file():
        return {}, None
    try:
        return L.parse_jsonc(CONFIG.read_text(encoding='utf-8-sig')) or {}, None
    except (OSError, L.JSONCError) as error:
        return None, str(error)


def find(servers, needle):
    return [name for name, entry in (servers or {}).items() if needle in json.dumps(entry).lower() or needle in name.lower()]


def newest_release(package, fallback):
    """The registry's "latest" or its highest plain x.y.z release, whichever was published last (a registry can leave
    "latest" on an old prerelease), or the fallback when npm can't say."""
    npm = L.which('npm.cmd' if L.IS_WIN else 'npm') or L.which('npm')
    if not npm:
        return fallback, 'npm not found; using %s' % fallback
    code, out, _ = L.run([npm, 'view', package, 'dist-tags', 'time', '--json'], timeout=60)
    try:
        info = json.loads(out) if code == 0 else {}
    except ValueError:
        info = {}
    times = info.get('time') or {}
    latest = (info.get('dist-tags') or {}).get('latest')
    plain = [v for v in times if re.fullmatch(r'\d+\.\d+\.\d+', v)]
    candidates = [v for v in (latest, max(plain, key=lambda v: tuple(int(x) for x in v.split('.')), default=None)) if v]
    if not candidates:
        return fallback, 'npm could not list versions; using %s' % fallback
    best = max(candidates, key=lambda v: times.get(v) or '')
    return best, 'newest published of latest (%s) and the highest release' % latest


def entry_for(name, version, browser=None):
    args = ['-y', '%s@%s' % (SERVERS[name]['package'], version)]
    if name == 'playwright':
        args += ['--browser', browser or 'chrome']
    command = 'npx'
    if L.IS_WIN:
        command, args = 'cmd', ['/c', 'npx'] + args
    return {'type': 'local', 'command': command, 'args': args, 'tools': ['*']}


def default_browser():
    """chrome when Chrome is installed, msedge otherwise (Edge comes with Windows)."""
    if L.IS_MAC:
        for base in (Path('/Applications'), L.HOME / 'Applications'):
            if (base / 'Google Chrome.app').is_dir():
                return 'chrome'
        return 'msedge'
    if L.IS_WIN:
        import os
        for root in (os.environ.get('ProgramFiles'), os.environ.get('ProgramFiles(x86)'), os.environ.get('LOCALAPPDATA')):
            if root and (Path(root) / 'Google' / 'Chrome' / 'Application' / 'chrome.exe').is_file():
                return 'chrome'
        return 'msedge'
    return 'chrome'


def write_config(data):
    if CONFIG.is_file():
        BACKUPS.mkdir(parents=True, exist_ok=True)
        backup = BACKUPS / ('mcp-config-%s.json' % L.stamp())
        shutil.copy2(str(CONFIG), str(backup))
    else:
        backup = None
    L.write_atomic(CONFIG, json.dumps(data, indent=2) + '\n', mode_from=CONFIG if CONFIG.is_file() else None)
    return backup


def emit(result, as_json):
    print(json.dumps(result, indent=1) if as_json else result.get('detail') or json.dumps(result))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('status')
    p.add_argument('--json', action='store_true')
    p = sub.add_parser('add')
    p.add_argument('name', choices=sorted(SERVERS))
    p.add_argument('--browser', choices=('chrome', 'msedge'))
    p.add_argument('--version')
    p.add_argument('--dry-run', action='store_true')
    p.add_argument('--json', action='store_true')
    p = sub.add_parser('remove')
    p.add_argument('name')
    p.add_argument('--json', action='store_true')
    args = parser.parse_args()

    data, error = read_config()
    if data is None:
        emit({'ok': False, 'error': '%s has a syntax problem: %s' % (L.tilde(CONFIG), error),
              'detail': 'Fix %s first; nothing was changed.' % L.tilde(CONFIG)}, args.json)
        return 1
    servers = data.get('mcpServers') or {}

    if args.command == 'status':
        found = {name: find(servers, spec['match']) for name, spec in SERVERS.items()}
        emit({'ok': True, 'file': L.tilde(CONFIG), 'servers': sorted(servers), 'found': found,
              'detail': '%s: %s' % (L.tilde(CONFIG), ', '.join(sorted(servers)) or 'no servers')}, args.json)
        return 0

    if args.command == 'remove':
        if args.name not in servers:
            emit({'ok': True, 'removed': False, 'detail': 'no server named %s' % args.name}, args.json)
            return 0
        del servers[args.name]
        data['mcpServers'] = servers
        backup = write_config(data)
        emit({'ok': True, 'removed': True, 'backup': L.tilde(backup) if backup else None,
              'detail': 'removed %s from %s' % (args.name, L.tilde(CONFIG))}, args.json)
        return 0

    existing = find(servers, SERVERS[args.name]['match']) or ([args.name] if args.name in servers else [])
    if existing:
        emit({'ok': True, 'added': False, 'existing': existing,
              'detail': 'already there as %s; nothing changed' % ', '.join(existing)}, args.json)
        return 0
    version, why = (args.version, 'as asked') if args.version else newest_release(SERVERS[args.name]['package'],
                                                                                 SERVERS[args.name]['fallback'])
    if args.name == 'playwright' and not args.browser and L.devbox_mode():
        browser = 'chrome'  # a dev box's Playwright uses Chrome, even when Chrome isn't installed yet
    else:
        browser = args.browser or (default_browser() if args.name == 'playwright' else None)
    entry = entry_for(args.name, version, browser)
    result = {'ok': True, 'file': L.tilde(CONFIG), 'name': args.name, 'entry': entry, 'version': version,
              'version_source': why}
    if args.dry_run:
        result.update(added=False, dry_run=True, detail='would add %s to %s: %s' % (args.name, L.tilde(CONFIG),
                                                                                   json.dumps(entry)))
        emit(result, args.json)
        return 0
    servers[args.name] = entry
    data['mcpServers'] = servers
    backup = write_config(data)
    result.update(added=True, backup=L.tilde(backup) if backup else None,
                  detail='added %s (%s@%s) to %s; new sessions pick it up' % (args.name, SERVERS[args.name]['package'],
                                                                              version, L.tilde(CONFIG)))
    emit(result, args.json)
    return 0


if __name__ == '__main__':
    sys.exit(main())

#!/usr/bin/env python3
"""A dev box that stays on: find one, create one, set it up and remove it, through the Dev Center API with the Azure
CLI's sign-in (every call goes through `az rest`, so `az login` in the person's own terminal comes first).

  devbox.py status     [--json]                       projects, pools (best first), your boxes, and the one that stays on
  devbox.py pools      [--project P] [--json]         the pools, best first for a box that stays on
  devbox.py create     --project P --pool X --name N [--dry-run] [--json]
  devbox.py wait       --project P --name N [--minutes M] [--json]
  devbox.py customize  --project P --name N [--only all|system|user] [--validate-only] [--dry-run] [--json]
  devbox.py tasks      --project P --name N [--logs] [--json]
  devbox.py link       --project P --name N [--json]
  devbox.py delete     --project P --name N --yes [--force] [--minutes M] [--dry-run] [--json]
  devbox.py imagedef                                  the image definition (YAML) a Dev Box admin can build a pool from
  devbox.py paste                                     PowerShell to paste on the box when customization tasks aren't allowed
  devbox.py ask-admin  [--project P]                  a message for a Dev Box admin: the pool settings, then the YAML
  devbox.py admin-plan --project P --subscription S --resource-group G [--region R] [--catalog C] [--pool X] [--json]
                                                      for project admins: the exact requests, printed and never sent

A box stays on when it can't hibernate and its pool has no auto-stop schedule. Dev Box stops a box on disconnect (or
when nobody connects) only if it can hibernate, and a schedule stops every box in its pool. Hibernation isn't a switch
on image definition pools: a box can hibernate when both the base image and the size support it, and no 32 vCPU size
does. So "hibernation not supported" plus "no schedule" is what keeps a box on.

create, customize and delete change things: run them only after the person agrees, and show --dry-run first. delete
removes only a box this script created (recorded in the setup's progress file) unless --force. Nothing here creates a
catalog, an image definition or a pool. wait returns at once with --minutes 0 (the default), so the interview can keep
going while a box provisions (30 to 90 minutes) and check back.
Exit codes: 0 ok, 1 error, 2 usage error or refused, 3 the Azure CLI is missing or not signed in.
"""
import argparse
import concurrent.futures
import json
import os
import re
import sys
import time
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import setuplib as L  # noqa: E402

API = '2025-02-01'
ARM_API = '2025-02-01'
DEVCENTER = 'https://devcenter.azure.com'
GRAPH = 'https://management.azure.com/providers/Microsoft.ResourceGraph/resources'
PORTAL = 'https://devbox.microsoft.com'
NAME_RE = re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9-_.]{2,62}$')
MIN_CPU, MIN_GB = 16, 64
DONE_STATES = {'Succeeded', 'ProvisionedWithWarning', 'Failed', 'Canceled'}
WS = L.load_workshop()

# What the box gets. System tasks install machine-wide; user tasks run as the person once they first sign in to the
# box (Dev Box queues them until then), which suits per-user installers like VS Code Insiders and Python.
SYSTEM_TOOLS = [
    ('Microsoft.PowerShell', 'PowerShell 7'),
    ('Git.Git', 'Git'),
    ('GitHub.cli', 'GitHub CLI'),
    ('OpenJS.NodeJS.LTS', 'Node.js LTS'),
    ('Google.Chrome', 'Chrome'),
    ('Microsoft.AzureCLI', 'Azure CLI'),
    ('Microsoft.Azd', 'Azure Developer CLI'),
]
USER_TOOLS = [
    ('Microsoft.VisualStudioCode.Insiders', 'VS Code Insiders'),
    ('Python.Python.3.13', 'Python 3.13'),
    ('Gyan.FFmpeg', 'FFmpeg'),
    ('jqlang.jq', 'jq'),
]
FEED = WS.get('npm_feed') or 'https://packagefeedproxy.microsoft.io/npm/'
USER_SETUP = '; '.join([
    "$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + "
    "[Environment]::GetEnvironmentVariable('Path','User')",
    'Set-ExecutionPolicy -Scope CurrentUser RemoteSigned -Force',
    'git config --global core.longpaths true',
    'npm.cmd config set registry %s' % FEED,
    'npm.cmd install -g yarn',
    "$py = Join-Path $env:LOCALAPPDATA 'Programs\\Python\\Python313\\python.exe'",
    "if (-not (Test-Path $py)) { $py = (Get-Command python -ErrorAction SilentlyContinue).Source }",
    '& $py -m pip install --user --disable-pip-version-check Pillow',
])
IMAGE = 'microsoftvisualstudio_visualstudioplustools_vs-2022-ent-general-win11-m365-gen2'
IMAGE_DEFINITION = 'always-on-agent-box'
SKU_32 = 'general_i_32c128gb512ssd_v2'
# Built-in task names as the Dev Center API takes them.
TASK_NAMES = {'winget': '~/winget', 'powershell': '~/powershell'}

# Regions near the person, from their time zone, to break ties between pools.
GEO_REGIONS = {
    'us-west': ['westus2', 'westus3', 'westus', 'westcentralus'],
    'us-central': ['centralus', 'southcentralus', 'northcentralus', 'westcentralus'],
    'us-east': ['eastus', 'eastus2', 'canadacentral', 'centralus'],
    'south-america': ['brazilsouth'],
    'europe': ['westeurope', 'northeurope', 'uksouth', 'germanywestcentral', 'swedencentral', 'francecentral'],
    'india': ['centralindia', 'southindia'],
    'asia': ['southeastasia', 'eastasia', 'japaneast', 'koreacentral'],
    'australia': ['australiaeast', 'australiasoutheast'],
}


class AzError(Exception):
    def __init__(self, message, code=None, status=None):
        super().__init__(message)
        self.code, self.status = code, status


# ---------------------------------------------------------------- the Azure CLI

def az_path():
    return L.which('az')


def parse_az_error(err):
    """az rest prints 'ERROR: Not Found({"error": {...}})'. Returns (status text, code, message)."""
    text = (err or '').strip()
    m = re.search(r'ERROR:\s*([^({]*?)\s*\((\{.*\})\)\s*$', text, re.S)
    if m:
        try:
            body = json.loads(m.group(2))
            inner = body.get('error') or body
            return m.group(1).strip() or None, inner.get('code'), inner.get('message') or m.group(1)
        except ValueError:
            pass
    line = L.first_line(re.sub(r'^ERROR:\s*', '', text))
    return None, None, line or 'the Azure CLI failed'


def az_json(args, timeout=90):
    az = az_path()
    if not az:
        raise AzError('the Azure CLI is not installed', code='AzNotInstalled')
    code, out, err = L.run([az, *args, '--only-show-errors'], timeout=timeout)
    if code != 0:
        status, ecode, message = parse_az_error(err or out)
        if code == 124:
            ecode, message = 'Timeout', 'the Azure CLI timed out after %ds' % timeout
        if re.search(r"az login|AADSTS70043|AADSTS50173|refresh token|Interactive authentication", err or '', re.I):
            ecode = ecode or 'NotSignedIn'
        raise AzError(L.redact(message), code=ecode, status=status)
    if not out.strip():
        return None
    try:
        return json.loads(out)
    except ValueError:
        return out


def rest(method, url, body=None, params=None, resource=DEVCENTER, timeout=90):
    """One Dev Center (or other) REST call through az rest. The body goes through a file, and query parameters through
    --url-parameters, so nothing in them meets a shell (az is az.cmd on Windows)."""
    args = ['rest', '--method', method, '--url', url, '--output', 'json']
    if resource:
        args += ['--resource', resource]
    query = dict(params or {})
    if resource == DEVCENTER and 'api-version=' not in url and 'api-version' not in (params or {}):
        query.setdefault('api-version', API)
    if query:
        args += ['--url-parameters'] + ['%s=%s' % kv for kv in query.items()]
    tmp, made = None, []
    if body is not None:
        # A file, not an argument: on Windows az is az.cmd, and cmd.exe would read the query's | and & itself.
        folder = L.STATE_DIR / 'tmp'
        made = [d for d in (L.STATE_DIR, folder) if not d.exists()]
        folder.mkdir(parents=True, exist_ok=True)
        tmp = folder / ('body-%d-%d.json' % (os.getpid(), int(time.time() * 1000)))
        tmp.write_text(json.dumps(body), encoding='utf-8')
        args += ['--body', '@' + str(tmp), '--headers', 'Content-Type=application/json']
    try:
        return az_json(args, timeout=timeout)
    finally:
        if tmp:
            try:
                tmp.unlink()
            except OSError:
                pass
        for d in reversed(made):  # leave no trace when the folders weren't there before (the check writes nothing)
            try:
                d.rmdir()
            except OSError:
                pass


def signed_in():
    """(installed, signed in, detail). Never prints who is signed in."""
    if not az_path():
        return False, False, 'the Azure CLI is not installed'
    try:
        account = az_json(['account', 'show', '--output', 'json'], timeout=60)
    except AzError as error:
        return True, False, 'not signed in to the Azure CLI (%s)' % error
    return True, bool(account), 'signed in' if account else 'not signed in to the Azure CLI'


def paged(url, params=None):
    out, data, guard = [], rest('get', url, params=params), 0
    while isinstance(data, dict):
        out += data.get('value') or []
        nxt = data.get('nextLink')
        guard += 1
        if not nxt or guard > 50:
            break
        # The query goes through --url-parameters too: a & in --url would reach cmd.exe on Windows.
        parts = urllib.parse.urlsplit(nxt)
        data = rest('get', urllib.parse.urlunsplit(parts._replace(query='')),
                    params=dict(urllib.parse.parse_qsl(parts.query, keep_blank_values=True)))
    return out


# ---------------------------------------------------------------- reading

def projects():
    query = {'query': 'Resources | where type =~ "microsoft.devcenter/projects" '
                      '| project name, devCenterUri = tostring(properties.devCenterUri), location, '
                      'resourceGroup, subscriptionId, id'}
    data = rest('post', GRAPH, body=query, params={'api-version': '2021-03-01'}, resource=None)
    rows = (data or {}).get('data') or []
    return [{'name': r.get('name'), 'devcenter': (r.get('devCenterUri') or '').rstrip('/'), 'location': r.get('location'),
             'resource_group': r.get('resourceGroup'), 'subscription': r.get('subscriptionId'), 'id': r.get('id')}
            for r in rows if r.get('name') and r.get('devCenterUri')]


def local_timezone():
    if L.IS_WIN:
        code, out, _ = L.run(['tzutil', '/g'], timeout=10)
        return out.strip() if code == 0 else ''
    tz = os.environ.get('TZ', '')
    if not tz:
        try:
            tz = os.path.realpath('/etc/localtime').split('zoneinfo/')[-1]
        except OSError:
            tz = ''
    return tz


def geography(tz=None):
    tz = (tz if tz is not None else local_timezone()) or ''
    t = tz.lower()
    rules = [
        ('australia', ('australia/', 'aus ', 'e. australia', 'cen. australia', 'w. australia')),
        ('us-west', ('america/los_angeles', 'america/vancouver', 'america/phoenix', 'america/denver', 'america/boise',
                     'america/tijuana', 'pacific standard', 'mountain standard', 'us mountain')),
        ('us-central', ('america/chicago', 'america/mexico_city', 'america/winnipeg', 'central standard time')),
        ('us-east', ('america/new_york', 'america/toronto', 'america/detroit', 'america/halifax', 'eastern standard')),
        ('south-america', ('america/sao_paulo', 'america/argentina', 'america/bogota', 'america/lima', 'america/santiago',
                           'e. south america', 'sa pacific', 'argentina')),
        ('europe', ('europe/', 'gmt standard', 'w. europe', 'central europe', 'romance', 'gtb', 'e. europe', 'fle ',
                    'central european')),
        ('india', ('asia/kolkata', 'asia/calcutta', 'india standard')),
        ('asia', ('asia/', 'tokyo', 'korea', 'china', 'singapore', 'taipei')),
    ]
    for geo, needles in rules:
        if any(n in t for n in needles):
            return geo
    return None


def pool_facts(pool, schedules, geo=None):
    """Plain facts about a pool and how well it fits a box that stays on (tier 0 is what we want)."""
    hw = pool.get('hardwareProfile') or {}
    hib = pool.get('hibernateSupport')
    stops = [s for s in schedules if str(s.get('type') or 'StopDevBox') == 'StopDevBox']
    cpus, gb = hw.get('vCPUs') or 0, hw.get('memoryGB') or 0
    stop_on_disconnect = (pool.get('stopOnDisconnect') or {}).get('status') == 'Enabled'
    stop_on_no_connect = (pool.get('stopOnNoConnect') or {}).get('status') == 'Enabled'
    no_hibernation = hib in ('Disabled', 'OsUnsupported')
    if no_hibernation and not stops:
        tier, why = 0, 'stays on: it can\'t hibernate and has no auto-stop schedule'
    elif no_hibernation:
        tier, why = 1, 'stops every day at %s %s (auto-stop schedule)' % (stops[0].get('time'), stops[0].get('timeZone'))
    elif hib == 'Enabled':
        parts = ['can hibernate']
        if stop_on_disconnect:
            parts.append('stops %s min after you disconnect' % (pool.get('stopOnDisconnect') or {}).get('gracePeriodMinutes'))
        if stops:
            parts.append('stops daily at %s' % stops[0].get('time'))
        tier, why = 2, ', '.join(parts)
    else:
        tier, why = 3, 'hibernation support unknown'
    region = pool.get('location')
    near = GEO_REGIONS.get(geo or '', [])
    return {
        'name': pool.get('name'), 'region': region, 'vcpus': cpus, 'memory_gb': gb,
        'disk_gb': ((pool.get('storageProfile') or {}).get('osDisk') or {}).get('diskSizeGB'),
        'sku': hw.get('skuName'), 'image': (pool.get('imageReference') or {}).get('name'),
        'hibernation': hib, 'schedule': ['%s %s' % (s.get('time'), s.get('timeZone')) for s in stops],
        'stop_on_disconnect': stop_on_disconnect, 'stop_on_no_connect': stop_on_no_connect,
        'local_admin': pool.get('localAdministrator') == 'Enabled', 'health': pool.get('healthStatus'),
        'stays_on': tier == 0, 'tier': tier, 'why': why, 'big_enough': cpus >= MIN_CPU and gb >= MIN_GB,
        'near': region in near, '_near_rank': near.index(region) if region in near else len(near) + 1,
    }


def rank(pools):
    """Best first: stays on, then big enough, local admin, healthy, nearby, bigger, by name."""
    return sorted(pools, key=lambda p: (p['tier'], not p['big_enough'], not p['local_admin'],
                                        p['health'] not in ('Healthy', 'Warning'), p['_near_rank'],
                                        -(p['vcpus'] or 0), -(p['memory_gb'] or 0), p['name'] or ''))


def box_facts(box, pools_by_name):
    hw = box.get('hardwareProfile') or {}
    pool = pools_by_name.get((box.get('projectName'), box.get('poolName'))) or {}
    hib = box.get('hibernateSupport')
    stays_on = hib in ('Disabled', 'OsUnsupported') and not pool.get('schedule')
    return {'name': box.get('name'), 'project': box.get('projectName'), 'pool': box.get('poolName'),
            'region': box.get('location'), 'vcpus': hw.get('vCPUs'), 'memory_gb': hw.get('memoryGB'),
            'power': box.get('powerState'), 'provisioning': box.get('provisioningState'),
            'hibernation': hib, 'local_admin': box.get('localAdministrator') == 'Enabled',
            'stays_on': bool(stays_on) if pool else None, 'running': box.get('powerState') == 'Running',
            'created': box.get('createdTime')}


def _project_details(project, geo):
    dc, name = project['devcenter'], project['name']
    base = '%s/projects/%s' % (dc, name)
    out = {'name': name, 'devcenter': dc, 'error': None}
    try:
        pools = paged(base + '/pools')
        schedules = paged(base + '/schedules')
    except AzError as error:
        out['error'] = str(error)
        pools, schedules = [], []
    by_pool = {}
    for s in schedules:
        pool_name = (s.get('sourceUri') or '').rstrip('/').rsplit('/', 1)[-1]
        by_pool.setdefault(pool_name, []).append(s)
    out['pools'] = rank([pool_facts(p, by_pool.get(p.get('name'), []), geo) for p in pools])
    try:
        abilities = rest('get', base + '/users/me/abilities') or {}
    except AzError:
        abilities = {}
    admin, dev = abilities.get('abilitiesAsAdmin') or [], abilities.get('abilitiesAsDeveloper') or []
    out['project_admin'] = 'WriteDevBoxes' in admin
    out['can_create'] = 'WriteDevBoxes' in dev or 'WriteDevBoxes' in admin
    out['can_customize'] = 'CustomizeDevBoxes' in dev
    try:
        info = rest('get', base) or {}
        out['max_boxes_per_user'] = info.get('maxDevBoxesPerUser')
    except AzError:
        out['max_boxes_per_user'] = None
    return out


def status(project_filter=None):
    installed, ok, detail = signed_in()
    report = {'ok': ok, 'az_installed': installed, 'signed_in': ok, 'detail': detail, 'projects': [], 'pools': [],
              'boxes': [], 'stays_on_box': None, 'portal': PORTAL}
    if not ok:
        return report
    try:
        found = projects()
    except AzError as error:
        report.update(ok=False, detail='could not list Dev Box projects: %s' % error)
        return report
    if project_filter:
        found = [p for p in found if p['name'].lower() == project_filter.lower()]
    geo = geography()
    report['near'] = geo
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        details = list(pool.map(lambda p: _project_details(p, geo), found))
        centers = sorted({p['devcenter'] for p in found})
        boxes_raw = list(pool.map(lambda dc: _safe_paged(dc + '/users/me/devboxes'), centers))
    pools_by_name = {}
    for d in details:
        for p in d['pools']:
            pools_by_name[(d['name'], p['name'])] = p
            report['pools'].append(dict(p, project=d['name']))
    boxes = [box_facts(b, pools_by_name) for chunk in boxes_raw for b in chunk
             if not project_filter or (b.get('projectName') or '').lower() == project_filter.lower()]
    for d in details:
        d['your_boxes'] = len([b for b in boxes if b['project'] == d['name']])
        d['pools_that_stay_on'] = [p['name'] for p in d['pools'] if p['stays_on']]
        d['pool_count'] = len(d.pop('pools'))
    report['projects'] = details
    report['pools'] = rank(report['pools'])
    for p in report['pools']:
        p.pop('_near_rank', None)
    report['boxes'] = boxes
    on = [b for b in boxes if b['stays_on'] and b['running']] or [b for b in boxes if b['stays_on']]
    report['stays_on_box'] = on[0]['name'] if on else None
    report['stays_on_box_running'] = bool(on and on[0]['running'])
    return report


def _safe_paged(url):
    try:
        return paged(url)
    except AzError:
        return []


def find_project(name):
    for p in projects():
        if p['name'].lower() == name.lower():
            return p
    raise AzError('no Dev Box project named %s is visible to you' % name, code='ProjectNotFound')


def box_url(project, name):
    return '%s/projects/%s/users/me/devboxes/%s' % (project['devcenter'], project['name'], name)


def get_box(project, name):
    try:
        return rest('get', box_url(project, name))
    except AzError as error:
        if error.code in ('NotFound', 'DevBoxNotFound') or (error.status or '').lower() == 'not found':
            return None
        raise


# ---------------------------------------------------------------- what the box gets

def tasks(only='all'):
    system = [{'name': TASK_NAMES['winget'], 'displayName': label, 'runAs': 'System', 'parameters': {'package': pkg}}
              for pkg, label in SYSTEM_TOOLS]
    user = [{'name': TASK_NAMES['winget'], 'displayName': label, 'runAs': 'User', 'parameters': {'package': pkg}}
            for pkg, label in USER_TOOLS]
    user.append({'name': TASK_NAMES['powershell'], 'displayName': 'Account setup (npm feed, Yarn, Pillow, git)',
                 'runAs': 'User', 'parameters': {'command': USER_SETUP}})
    return system if only == 'system' else user if only == 'user' else system + user


def _yaml_str(text):
    return "'%s'" % str(text).replace("'", "''")


def image_definition():
    lines = ['$schema: "1.0"', 'name: %s' % IMAGE_DEFINITION,
             'description: %s' % _yaml_str('A Windows dev box for coding agents that stays on: VS Code Insiders, Git, '
                                           'GitHub CLI, Node.js, Python, FFmpeg, Chrome and the Azure CLIs.'),
             '# Visual Studio 2022 on Windows 11. A plain Windows 11 Enterprise image works too; list what your dev',
             '# center offers with: az devcenter admin image list --dev-center-name <name> --resource-group <group>',
             'image: %s' % IMAGE, 'tasks:']
    for pkg, label in SYSTEM_TOOLS:
        lines += ['  - name: ~/winget', '    displayName: %s' % _yaml_str(label), '    parameters:',
                  '      package: %s' % pkg]
    lines += ['# These run as the person when they first sign in to the box.', 'userTasks:']
    for pkg, label in USER_TOOLS:
        lines += ['  - name: ~/winget', '    displayName: %s' % _yaml_str(label), '    parameters:',
                  '      package: %s' % pkg]
    lines += ['  - name: ~/powershell', '    displayName: %s' % _yaml_str('Account setup (npm feed, Yarn, Pillow, git)'),
              '    parameters:', '      command: %s' % _yaml_str(USER_SETUP)]
    return '\n'.join(lines) + '\n'


def paste_script():
    ids = SYSTEM_TOOLS + USER_TOOLS
    lines = ['# Dev box setup: the same tools and account setup the automatic route installs.',
             '# Paste into PowerShell on the dev box (Terminal, Run as administrator), then wait for "Done".',
             '$ids = @(%s)' % ', '.join("'%s'" % pkg for pkg, _ in ids),
             'foreach ($id in $ids) { winget install --id $id -e --source winget --accept-source-agreements '
             '--accept-package-agreements --disable-interactivity }']
    lines += [part.strip() for part in USER_SETUP.split('; ')]
    lines.append("Write-Host 'Done. Open VS Code Insiders and sign in to GitHub.'")
    return '\n'.join(lines) + '\n'


POOL_SETTINGS = [
    'Built from the image definition below (imagedefinition.yaml), in a catalog attached to the project.',
    'Size: 32 vCPU, 128 GB (%s or bigger). Dev Box can\'t hibernate a 32 vCPU box, which is what keeps it from '
    'stopping when I disconnect. 16 vCPU and 64 GB works too if the image definition\'s base image doesn\'t support '
    'hibernation (Windows 11 Enterprise + OS Optimizations).' % SKU_32,
    'Auto-stop on schedule: off. Stop on disconnect and "hibernate dev boxes that have never been accessed": off.',
    'Dev box creator privileges: Local Administrator.',
    'Region: %s.',
    'Network: Microsoft hosted network is fine (or the project\'s usual network connection).',
]


def admin_message(project=None, region=None):
    region = region or (GEO_REGIONS.get(geography() or '') or ['the region nearest me'])[0]
    settings = [s % region if '%s' in s else s for s in POOL_SETTINGS]
    lines = ['Hi! Could you set up a Dev Box pool I can use for a dev box that stays on (or point me to one that '
             'already exists)? It runs coding agents overnight, so it shouldn\'t stop or hibernate on its own.', '']
    if project:
        lines += ['Project: %s' % project, '']
    lines += ['What I need:'] + ['- %s' % s for s in settings]
    lines += ['', 'Who can do it: a DevCenter Project Admin (or Owner or Contributor) creates the pool and attaches the '
              'catalog. If the project can\'t have its own catalogs yet, a dev center owner turns on project-level '
              'catalogs first. The first image build makes a temporary dev box, so it takes a while.', '',
              'imagedefinition.yaml:', '', image_definition(), 'Thank you!']
    return '\n'.join(lines)


def admin_plan(project, subscription, group, region, catalog='agent-box', pool='always-on-agent-box'):
    """The ARM requests a project admin would send, in order. Printed only; never sent from here."""
    pid = '/subscriptions/%s/resourceGroups/%s/providers/Microsoft.DevCenter/projects/%s' % (subscription, group, project)
    arm = 'https://management.azure.com' + pid
    repo = 'https://github.com/%s.git' % WS['skills']['public_repo']
    image_id = '%s/images/~Catalog~%s~%s' % (pid, catalog, IMAGE_DEFINITION)
    return [
        {'step': 'Attach the catalog that holds imagedefinition.yaml (project-level catalogs must be on for the dev '
                 'center). A private repo also needs secretIdentifier, a Key Vault secret with a GitHub token.',
         'method': 'PUT', 'url': '%s/catalogs/%s?api-version=%s' % (arm, catalog, ARM_API),
         'body': {'properties': {'gitHub': {'uri': repo, 'branch': 'main', 'path': '/autonomous-setup/devbox'},
                                 'syncType': 'Scheduled'}}},
        {'step': 'Wait until the catalog syncs and the image definition shows up (its first image build starts by '
                 'itself when automatic builds are on).', 'method': 'GET',
         'url': '%s/catalogs/%s/imageDefinitions/%s?api-version=%s' % (arm, catalog, IMAGE_DEFINITION, ARM_API)},
        {'step': 'Create the pool: 32 vCPU (no hibernation), no schedule, stop on disconnect off, local admin on.',
         'method': 'PUT', 'url': '%s/pools/%s?api-version=%s' % (arm, pool, ARM_API),
         'body': {'location': region, 'properties': {
             'devBoxDefinitionType': 'Value', 'devBoxDefinitionName': '~Catalog~%s~%s' % (catalog, IMAGE_DEFINITION),
             'devBoxDefinition': {'imageReference': {'id': image_id}, 'sku': {'name': SKU_32}},
             'networkConnectionName': 'managedNetwork', 'virtualNetworkType': 'Managed',
             'managedVirtualNetworkRegions': [region], 'licenseType': 'Windows_Client', 'localAdministrator': 'Enabled',
             'singleSignOnStatus': 'Enabled', 'stopOnDisconnect': {'status': 'Disabled'},
             'stopOnNoConnect': {'status': 'Disabled'}, 'displayName': 'Always on (agents)'}}},
        {'step': 'Check that the pool has no schedule (an empty list means no auto-stop).', 'method': 'GET',
         'url': '%s/pools/%s/schedules?api-version=%s' % (arm, pool, ARM_API)},
    ]


# ---------------------------------------------------------------- changing things

def record_created(project, name, pool):
    data = L.load_state()
    made = [b for b in data['answers'].get('devboxes_created') or [] if isinstance(b, dict)]
    if not any(b.get('project') == project and b.get('name') == name for b in made):
        made.append({'project': project, 'name': name, 'pool': pool, 'at': L.now()})
    data['answers']['devboxes_created'] = made
    data['answers']['devbox'] = '%s/%s' % (project, name)
    L.save_state(data)


def created_here(project, name):
    made = L.load_state()['answers'].get('devboxes_created') or []
    return any(isinstance(b, dict) and b.get('project', '').lower() == project.lower() and b.get('name') == name
               for b in made)


def validate_tasks(project, task_list, minutes=5):
    url = '%s/projects/%s/customizationTasks:validateGroup' % (project['devcenter'], project['name'])
    result = rest('post', url, body={'tasks': task_list})
    deadline = time.time() + minutes * 60
    while isinstance(result, dict) and result.get('status') in ('Running', 'NotStarted') and time.time() < deadline:
        time.sleep(5)
        op = result.get('id') or ''
        result = rest('get', project['devcenter'] + op) if op.startswith('/') else result
    outcome = (result or {}).get('result') or {}
    return {'status': (result or {}).get('status'), 'validation': outcome.get('validationResult'),
            'errors': outcome.get('errors') or [], 'raw_error': (result or {}).get('error')}


def customization_groups(project, name):
    return paged(box_url(project, name) + '/customizationGroups', params={'include': 'tasks'})


def task_log(log_uri):
    try:
        text = rest('get', log_uri)
    except AzError as error:
        return 'log not available: %s' % error
    return text if isinstance(text, str) else json.dumps(text)


# ---------------------------------------------------------------- output

def emit(data, as_json, text=None):
    if as_json:
        print(L.redact(json.dumps(data, indent=1, default=str)))
    else:
        print(L.redact(text if text is not None else json.dumps(data, indent=1, default=str)))


def describe_status(report):
    if not report['signed_in']:
        return report['detail']
    lines = []
    for p in report['projects']:
        lines.append('%s: %d pools (%s stay on), %d of your boxes%s' % (
            p['name'], p['pool_count'], len(p['pools_that_stay_on']), p['your_boxes'],
            ', you are a project admin' if p['project_admin'] else ''))
    for b in report['boxes']:
        lines.append('  box %s (%s, %s): %s, %s' % (b['name'], b['project'], b['pool'], b['power'] or b['provisioning'],
                                                    'stays on' if b['stays_on'] else 'can stop on its own'))
    for p in report['pools'][:5]:
        lines.append('  pool %s (%s, %s, %s vCPU, %s GB): %s' % (p['name'], p['project'], p['region'], p['vcpus'],
                                                                p['memory_gb'], p['why']))
    if not report['projects']:
        lines.append('no Dev Box projects are visible to you')
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('status')
    p.add_argument('--project')
    p.add_argument('--json', action='store_true')
    p = sub.add_parser('pools')
    p.add_argument('--project')
    p.add_argument('--json', action='store_true')
    for name in ('create', 'wait', 'customize', 'tasks', 'link', 'delete'):
        p = sub.add_parser(name)
        p.add_argument('--project', required=True)
        p.add_argument('--name', required=True)
        p.add_argument('--json', action='store_true')
        if name in ('create', 'customize', 'delete'):
            p.add_argument('--dry-run', action='store_true')
        if name in ('wait', 'delete'):
            p.add_argument('--minutes', type=float, default=0)
        if name == 'create':
            p.add_argument('--pool', required=True)
        if name == 'customize':
            p.add_argument('--only', choices=('all', 'system', 'user'), default='all')
            p.add_argument('--group', default='agent-box-setup')
            p.add_argument('--validate-only', action='store_true')
        if name == 'tasks':
            p.add_argument('--logs', action='store_true')
        if name == 'delete':
            p.add_argument('--yes', action='store_true')
            p.add_argument('--force', action='store_true')
    sub.add_parser('imagedef')
    sub.add_parser('paste')
    p = sub.add_parser('ask-admin')
    p.add_argument('--project')
    p.add_argument('--region')
    p = sub.add_parser('admin-plan')
    p.add_argument('--project', required=True)
    p.add_argument('--subscription', required=True)
    p.add_argument('--resource-group', required=True)
    p.add_argument('--region')
    p.add_argument('--catalog', default='agent-box')
    p.add_argument('--pool', default='always-on-agent-box')
    p.add_argument('--json', action='store_true')
    args = parser.parse_args()
    as_json = getattr(args, 'json', False)

    if args.command == 'imagedef':
        sys.stdout.write(image_definition())
        return 0
    if args.command == 'paste':
        sys.stdout.write(paste_script())
        return 0
    if args.command == 'ask-admin':
        print(admin_message(args.project, args.region))
        return 0
    if args.command == 'admin-plan':
        region = args.region or (GEO_REGIONS.get(geography() or '') or ['westus2'])[0]
        steps = admin_plan(args.project, args.subscription, args.resource_group, region, args.catalog, args.pool)
        emit({'ok': True, 'sent': False, 'steps': steps}, as_json,
             '\n\n'.join('%d. %s\n%s %s%s' % (i + 1, s['step'], s['method'], s['url'],
                                               '\n' + json.dumps(s['body'], indent=1) if s.get('body') else '')
                         for i, s in enumerate(steps)) + '\n\n(Printed only. Nothing was sent.)')
        return 0

    for value in (getattr(args, 'name', None), getattr(args, 'pool', None)):
        if value is not None and not NAME_RE.match(value):
            parser.error('names are 3 to 63 letters, digits, - _ or . and start with a letter or digit: %r' % value)

    try:
        if args.command in ('status', 'pools'):
            report = status(args.project)
            if not report['signed_in']:
                emit(report, as_json, report['detail'] + '. Run az login in your own terminal, then try again.')
                return 3
            if args.command == 'pools':
                emit({'ok': True, 'pools': report['pools'], 'near': report.get('near')}, as_json,
                     '\n'.join('%s/%s (%s, %s vCPU, %s GB): %s' % (p['project'], p['name'], p['region'], p['vcpus'],
                                                                   p['memory_gb'], p['why']) for p in report['pools'])
                     or 'no pools')
            else:
                emit(report, as_json, describe_status(report))
            return 0

        installed, ok, detail = signed_in()
        if not ok:
            emit({'ok': False, 'error': detail, 'az_installed': installed}, as_json,
                 detail + '. Run az login in your own terminal, then try again.')
            return 3
        project = find_project(args.project)
        url = box_url(project, args.name)

        if args.command == 'create':
            request = {'method': 'PUT', 'url': '%s?api-version=%s' % (url, API), 'body': {'poolName': args.pool}}
            existing = get_box(project, args.name)
            if existing:
                emit({'ok': True, 'created': False, 'exists': True, 'box': box_facts(existing, {})}, as_json,
                     '%s already exists (%s).' % (args.name, existing.get('provisioningState')))
                return 0
            if args.dry_run:
                emit({'ok': True, 'dry_run': True, 'request': request}, as_json,
                     'Would send: PUT %s\n%s' % (request['url'], json.dumps(request['body'])))
                return 0
            started = time.time()
            box = rest('put', url, body={'poolName': args.pool}) or {}
            record_created(project['name'], args.name, args.pool)
            emit({'ok': True, 'created': True, 'box': box_facts(box, {}), 'seconds': round(time.time() - started, 1),
                  'next': 'devbox.py wait --project %s --name %s --minutes 5 (it takes 30 to 90 minutes)'
                          % (project['name'], args.name)}, as_json,
                 'Creating %s in %s (%s). It takes 30 to 90 minutes.' % (args.name, args.pool, box.get('provisioningState')))
            return 0

        if args.command == 'wait':
            started = time.time()
            deadline = started + args.minutes * 60
            while True:
                box = get_box(project, args.name)
                state = (box or {}).get('provisioningState')
                if box is None or state in DONE_STATES or time.time() >= deadline:
                    break
                time.sleep(min(60, max(5, deadline - time.time())))
            facts = box_facts(box, {}) if box else None
            done = bool(box) and state in DONE_STATES
            emit({'ok': box is not None and state != 'Failed', 'done': done, 'box': facts,
                  'error': (box or {}).get('error'), 'waited_seconds': round(time.time() - started, 1)}, as_json,
                 'no box named %s' % args.name if box is None else '%s: %s, %s' % (args.name, state, box.get('powerState')))
            return 0 if box is not None and state != 'Failed' else 1

        if args.command == 'customize':
            task_list = tasks(args.only)
            if args.dry_run:
                emit({'ok': True, 'dry_run': True, 'request': {
                    'method': 'PUT', 'url': '%s/customizationGroups/%s?api-version=%s' % (url, args.group, API),
                    'body': {'tasks': task_list}}}, as_json)
                return 0
            check = validate_tasks(project, task_list)
            if args.validate_only or check['validation'] != 'Succeeded':
                emit({'ok': check['validation'] == 'Succeeded', 'validated': check}, as_json)
                return 0 if check['validation'] == 'Succeeded' else 1
            box = get_box(project, args.name)
            if not box or box.get('provisioningState') not in ('Succeeded', 'ProvisionedWithWarning'):
                emit({'ok': False, 'error': 'the box is not ready yet (%s)' % (box or {}).get('provisioningState')}, as_json)
                return 1
            group = rest('put', '%s/customizationGroups/%s' % (url, args.group), body={'tasks': task_list}) or {}
            emit({'ok': True, 'validated': check, 'group': {'name': group.get('name'), 'status': group.get('status'),
                                                           'tasks': len(group.get('tasks') or task_list)},
                  'next': 'System tasks start now; user tasks wait until the person first signs in to the box. '
                          'Check with devbox.py tasks --project %s --name %s' % (project['name'], args.name)}, as_json)
            return 0

        if args.command == 'tasks':
            groups = customization_groups(project, args.name)
            out = []
            for g in groups:
                entry = {'group': g.get('name'), 'status': g.get('status'), 'tasks': []}
                for t in g.get('tasks') or []:
                    task = {'name': t.get('displayName') or t.get('name'), 'run_as': t.get('runAs') or 'System',
                            'status': t.get('status'), 'start': t.get('startTime'), 'end': t.get('endTime')}
                    if args.logs and t.get('logUri'):
                        task['log'] = task_log(t['logUri'])[-4000:]
                    entry['tasks'].append(task)
                out.append(entry)
            emit({'ok': True, 'groups': out}, as_json)
            return 0

        if args.command == 'link':
            conn = rest('get', url + '/remoteConnection') or {}
            emit({'ok': True, 'web': conn.get('webUrl'), 'rdp': conn.get('rdpConnectionUrl'), 'portal': PORTAL}, as_json,
                 'Open in the browser: %s\nOr the Windows App: %s\nAll your boxes: %s'
                 % (conn.get('webUrl'), conn.get('rdpConnectionUrl'), PORTAL))
            return 0

        if args.command == 'delete':
            if not args.yes:
                parser.error('delete needs --yes (it removes the box and everything on it)')
            if not args.force and not created_here(project['name'], args.name):
                emit({'ok': False, 'refused': 'this setup did not create %s; it only removes boxes it created' % args.name},
                     as_json)
                return 2
            box = get_box(project, args.name)
            if box is None:
                emit({'ok': True, 'deleted': False, 'detail': 'no box named %s' % args.name}, as_json)
                return 0
            if args.dry_run:
                emit({'ok': True, 'dry_run': True, 'request': {'method': 'DELETE', 'url': '%s?api-version=%s' % (url, API)}},
                     as_json)
                return 0
            started = time.time()
            rest('delete', url)
            deadline = started + args.minutes * 60
            gone = False
            while True:
                gone = get_box(project, args.name) is None
                if gone or time.time() >= deadline:
                    break
                time.sleep(30)
            emit({'ok': True, 'deleted': gone, 'deleting': not gone, 'seconds': round(time.time() - started, 1)}, as_json,
                 '%s %s.' % (args.name, 'is gone' if gone else 'is being deleted'))
            return 0
    except AzError as error:
        emit({'ok': False, 'error': str(error), 'code': error.code}, as_json, 'error: %s' % error)
        return 3 if error.code in ('AzNotInstalled', 'NotSignedIn') else 1
    return 0


if __name__ == '__main__':
    sys.exit(main())

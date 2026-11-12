#!/usr/bin/env python3
"""Offline tests for autonomous-setup's scripts: devbox.py (against a fake `az` that replays recorded Dev Center
responses), mcp-servers.py, and the check's items (groups, Try-it prompts, the practice repo as later).

  python3 tools/test-autonomous-setup.py [--scratch DIR] [--keep]

Nothing here signs in, calls Azure or GitHub, or touches the real ~/.copilot: every script runs with a scratch HOME
and COPILOT_HOME. --scratch picks the folder (default: a new temporary folder). Exit code 0 when every test passes.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCRIPTS = REPO / 'autonomous-setup' / 'scripts'
DC = 'https://tenant-fakecenter.westus2.devcenter.azure.com'
SCRATCH = None

FAKE_AZ = r'''#!/usr/bin/env python3
import json, os, re, sys
args = sys.argv[1:]
log = os.environ['FAKE_AZ_LOG']
responses = json.load(open(os.environ['FAKE_AZ_RESPONSES']))
if args[:2] == ['account', 'show']:
    if os.environ.get('FAKE_AZ_SIGNED_OUT'):
        sys.stderr.write("ERROR: Please run 'az login' to setup account.\n"); sys.exit(1)
    print(json.dumps({'id': 'sub', 'tenantId': 'tenant'})); sys.exit(0)
def opt(name):
    return args[args.index(name) + 1] if name in args else None
method, url = (opt('--method') or 'get').upper(), opt('--url')
params = []
if '--url-parameters' in args:
    i = args.index('--url-parameters') + 1
    while i < len(args) and not args[i].startswith('--'):
        params.append(args[i]); i += 1
body = opt('--body')
if body and body.startswith('@'):
    body = json.load(open(body[1:]))
path = url.split('.azure.com', 1)[-1] if 'devcenter.azure.com' in url else ('graph' if 'ResourceGraph' in url else url)
with open(log, 'a') as f:
    f.write(json.dumps({'method': method, 'path': path, 'params': params, 'body': body}) + '\n')
key = '%s %s' % (method, path)
queue = responses.get(key)
if queue is None:
    sys.stderr.write('ERROR: Not Found({"error": {"code": "NotFound", "message": "no recorded response for %s"}})\n' % key)
    sys.exit(1)
counts_file = log + '.counts'
counts = json.load(open(counts_file)) if os.path.exists(counts_file) else {}
n = counts.get(key, 0); counts[key] = n + 1
json.dump(counts, open(counts_file, 'w'))
reply = queue[min(n, len(queue) - 1)] if isinstance(queue, list) else queue
if 'error' in reply:
    sys.stderr.write('ERROR: %s(%s)\n' % (reply.get('status', 'Bad Request'), json.dumps({'error': reply['error']})))
    sys.exit(1)
if reply.get('body') is not None:
    print(json.dumps(reply['body']))
'''


def pool(name, region, cpus, gb, hib, sod=False, admin=True):
    return {'name': name, 'location': region, 'hibernateSupport': hib, 'localAdministrator': 'Enabled' if admin else 'Disabled',
            'stopOnDisconnect': {'status': 'Enabled' if sod else 'Disabled', 'gracePeriodMinutes': 60},
            'stopOnNoConnect': {'status': 'Disabled'}, 'healthStatus': 'Healthy',
            'hardwareProfile': {'vCPUs': cpus, 'memoryGB': gb, 'skuName': 'general_i_%dc%dgb512ssd_v2' % (cpus, gb)},
            'storageProfile': {'osDisk': {'diskSizeGB': 512}}, 'imageReference': {'name': 'img'}}


def box(name, pool_name, power='Running', state='Succeeded', hib='Disabled'):
    return {'name': name, 'projectName': 'TeamProject', 'poolName': pool_name, 'hibernateSupport': hib,
            'provisioningState': state, 'powerState': power, 'location': 'westus2', 'localAdministrator': 'Enabled',
            'hardwareProfile': {'vCPUs': 32, 'memoryGB': 128}}


BASE = '/projects/TeamProject'
RESPONSES = {
    'POST graph': {'body': {'data': [{'name': 'TeamProject', 'devCenterUri': DC + '/', 'location': 'westus2',
                                      'resourceGroup': 'rg', 'subscriptionId': 'sub', 'id': '/x/TeamProject'}]}},
    'GET %s/pools' % BASE: {'body': {'value': [
        pool('small-hibernate', 'eastus', 8, 32, 'Enabled', sod=True),
        pool('big-always-on', 'westus2', 32, 128, 'Disabled', sod=True),
        pool('mid-scheduled', 'westus2', 16, 64, 'Disabled'),
        pool('big-far', 'brazilsouth', 32, 128, 'Disabled')]}},
    'GET %s/schedules' % BASE: {'body': {'value': [
        {'name': 'default', 'sourceUri': DC + BASE + '/pools/mid-scheduled', 'type': 'StopDevBox', 'time': '19:00',
         'timeZone': 'America/Los_Angeles', 'frequency': 'Daily'}]}},
    'GET %s/users/me/abilities' % BASE: {'body': {'abilitiesAsAdmin': [],
                                                  'abilitiesAsDeveloper': ['CustomizeDevBoxes', 'WriteDevBoxes']}},
    'GET %s' % BASE: {'body': {'name': 'TeamProject', 'maxDevBoxesPerUser': 4}},
    'GET /users/me/devboxes': {'body': {'value': [box('my-box', 'big-always-on')]}},
    'GET %s/users/me/devboxes/new-box' % BASE: [
        {'error': {'code': 'NotFound', 'message': 'not found'}, 'status': 'Not Found'},
        {'body': box('new-box', 'big-always-on', power=None, state='Creating')},
        {'error': {'code': 'NotFound', 'message': 'not found'}, 'status': 'Not Found'}],
    'PUT %s/users/me/devboxes/new-box' % BASE: {'body': box('new-box', 'big-always-on', power=None, state='Creating')},
    'DELETE %s/users/me/devboxes/new-box' % BASE: {'body': None},
    'GET %s/users/me/devboxes/my-box' % BASE: {'body': box('my-box', 'big-always-on')},
    'POST %s/customizationTasks:validateGroup' % BASE: {'body': {'id': '/projects/TeamProject/operationstatuses/1',
                                                                 'status': 'Succeeded',
                                                                 'result': {'validationResult': 'Failed',
                                                                            'errors': [{'target': 'task 1'}]}}},
}


def make_env(name, responses=None, signed_out=False):
    root = Path(SCRATCH) / name
    shutil.rmtree(root, ignore_errors=True)
    (root / 'bin').mkdir(parents=True)
    (root / 'home').mkdir()
    (root / 'copilot').mkdir()
    az = root / 'bin' / 'az'
    az.write_text(FAKE_AZ)
    az.chmod(0o755)
    (root / 'responses.json').write_text(json.dumps(responses or RESPONSES))
    env = dict(os.environ, HOME=str(root / 'home'), COPILOT_HOME=str(root / 'copilot'),
               PATH='%s%s%s' % (root / 'bin', os.pathsep, os.environ.get('PATH', '')), TZ='America/Los_Angeles',
               FAKE_AZ_LOG=str(root / 'az.log'), FAKE_AZ_RESPONSES=str(root / 'responses.json'),
               WORKSHOP_SETUP_DESKTOP=str(root / 'desktop'))
    if signed_out:
        env['FAKE_AZ_SIGNED_OUT'] = '1'
    return root, env


def run(script, args, env, timeout=120):
    proc = subprocess.run([sys.executable, str(SCRIPTS / script)] + args, env=env, capture_output=True, text=True,
                          timeout=timeout)
    return proc.returncode, proc.stdout, proc.stderr


def calls(root):
    path = root / 'az.log'
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


class DevboxLogic(unittest.TestCase):
    def setUp(self):
        sys.path.insert(0, str(SCRIPTS))
        import devbox
        self.D = devbox

    def test_tiers_and_order(self):
        D = self.D
        schedules = {'mid-scheduled': [{'type': 'StopDevBox', 'time': '19:00', 'timeZone': 'UTC'}]}
        pools = [D.pool_facts(p, schedules.get(p['name'], []), 'us-west') for p in RESPONSES['GET %s/pools' % BASE]['body']['value']]
        ranked = [p['name'] for p in D.rank(pools)]
        self.assertEqual(ranked, ['big-always-on', 'big-far', 'mid-scheduled', 'small-hibernate'])
        tiers = {p['name']: p['tier'] for p in pools}
        self.assertEqual(tiers, {'big-always-on': 0, 'big-far': 0, 'mid-scheduled': 1, 'small-hibernate': 2})

    def test_geography(self):
        g = self.D.geography
        self.assertEqual(g('America/Los_Angeles'), 'us-west')
        self.assertEqual(g('Eastern Standard Time'), 'us-east')
        self.assertEqual(g('Europe/Berlin'), 'europe')
        self.assertEqual(g('Asia/Kolkata'), 'india')
        self.assertEqual(g('AUS Eastern Standard Time'), 'australia')
        self.assertIsNone(g('Etc/UTC'))

    def test_parse_az_error(self):
        status, code, message = self.D.parse_az_error('ERROR: Not Found({"error": {"code": "NotFound", "message": "gone"}})')
        self.assertEqual((status, code, message), ('Not Found', 'NotFound', 'gone'))
        self.assertEqual(self.D.parse_az_error("ERROR: Please run 'az login'")[2], "Please run 'az login'")

    def test_image_definition_file_matches(self):
        shipped = (REPO / 'autonomous-setup' / 'devbox' / 'imagedefinition.yaml').read_text(encoding='utf-8')
        self.assertEqual(shipped, self.D.image_definition())
        try:
            import yaml
        except ImportError:
            return
        data = yaml.safe_load(shipped)
        self.assertEqual(data['name'], self.D.IMAGE_DEFINITION)
        packages = [t['parameters'].get('package') for t in data['tasks'] + data['userTasks']]
        for pkg, _ in self.D.SYSTEM_TOOLS + self.D.USER_TOOLS:
            self.assertIn(pkg, packages)

    def test_paste_has_every_tool(self):
        text = self.D.paste_script()
        for pkg, _ in self.D.SYSTEM_TOOLS + self.D.USER_TOOLS:
            self.assertIn("'%s'" % pkg, text)
        self.assertIn('npm.cmd install -g yarn', text)


@unittest.skipIf(os.name == 'nt', 'the fake az is a script without an extension; it runs on macOS and Linux')
class DevboxCli(unittest.TestCase):
    def test_status(self):
        root, env = make_env('status')
        code, out, err = run('devbox.py', ['status', '--json'], env)
        self.assertEqual(code, 0, err)
        report = json.loads(out)
        self.assertEqual(report['stays_on_box'], 'my-box')
        self.assertEqual(report['pools'][0]['name'], 'big-always-on')
        self.assertTrue(report['projects'][0]['can_customize'])
        self.assertFalse(report['projects'][0]['project_admin'])
        self.assertTrue(all('api-version=2025-02-01' in c['params'] for c in calls(root) if c['path'] != 'graph'))

    def test_signed_out(self):
        _, env = make_env('signed-out', signed_out=True)
        code, out, _ = run('devbox.py', ['status', '--json'], env)
        self.assertEqual(code, 3)
        self.assertFalse(json.loads(out)['signed_in'])

    def test_create_dry_run_sends_nothing(self):
        root, env = make_env('dry')
        code, out, err = run('devbox.py', ['create', '--project', 'TeamProject', '--pool', 'big-always-on',
                                           '--name', 'new-box', '--dry-run', '--json'], env)
        self.assertEqual(code, 0, err)
        self.assertEqual(json.loads(out)['request']['body'], {'poolName': 'big-always-on'})
        self.assertFalse([c for c in calls(root) if c['method'] == 'PUT'])

    def test_create_then_guarded_delete(self):
        root, env = make_env('create')
        code, out, err = run('devbox.py', ['create', '--project', 'TeamProject', '--pool', 'big-always-on',
                                           '--name', 'new-box', '--json'], env)
        self.assertEqual(code, 0, err)
        puts = [c for c in calls(root) if c['method'] == 'PUT']
        self.assertEqual([p['body'] for p in puts], [{'poolName': 'big-always-on'}])
        state = json.loads((root / 'copilot' / 'workshop-setup' / 'state.json').read_text())
        self.assertEqual(state['answers']['devboxes_created'][0]['name'], 'new-box')
        code, _, _ = run('devbox.py', ['delete', '--project', 'TeamProject', '--name', 'new-box', '--json'], env)
        self.assertEqual(code, 2)
        code, out, _ = run('devbox.py', ['delete', '--project', 'TeamProject', '--name', 'my-box', '--yes', '--json'], env)
        self.assertEqual(code, 2)
        self.assertIn('refused', json.loads(out))
        code, out, err = run('devbox.py', ['delete', '--project', 'TeamProject', '--name', 'new-box', '--yes',
                                           '--minutes', '0.05', '--json'], env)
        self.assertEqual(code, 0, err)
        self.assertEqual([c['method'] for c in calls(root) if c['method'] == 'DELETE'], ['DELETE'])
        self.assertTrue(json.loads(out)['deleted'])

    def test_customize_stops_when_validation_fails(self):
        root, env = make_env('customize')
        code, out, err = run('devbox.py', ['customize', '--project', 'TeamProject', '--name', 'my-box', '--json'], env)
        self.assertEqual(code, 1, err)
        self.assertEqual(json.loads(out)['validated']['validation'], 'Failed')
        self.assertFalse([c for c in calls(root) if c['method'] == 'PUT'])
        sent = [c for c in calls(root) if c['method'] == 'POST' and c['path'].endswith(':validateGroup')][0]
        run_as = {t['runAs'] for t in sent['body']['tasks']}
        self.assertEqual(run_as, {'System', 'User'})


@unittest.skipIf(os.name == 'nt', 'uses the fake az on PATH; macOS and Linux')
class McpServers(unittest.TestCase):
    def test_add_once_and_remove(self):
        root, env = make_env('mcp')
        code, out, err = run('mcp-servers.py', ['add', 'playwright', '--version', '0.0.84', '--browser', 'chrome',
                                                '--json'], env)
        self.assertEqual(code, 0, err)
        config = json.loads((root / 'copilot' / 'mcp-config.json').read_text())
        args = config['mcpServers']['playwright']['args']
        self.assertIn('@playwright/mcp@0.0.84', args)
        self.assertEqual(args[-2:], ['--browser', 'chrome'])
        code, out, _ = run('mcp-servers.py', ['add', 'playwright', '--version', '0.0.84', '--json'], env)
        self.assertFalse(json.loads(out)['added'])
        code, out, _ = run('mcp-servers.py', ['remove', 'playwright', '--json'], env)
        self.assertTrue(json.loads(out)['removed'])


@unittest.skipIf(os.name == 'nt', 'uses the fake az on PATH; macOS and Linux')
class CheckItems(unittest.TestCase):
    def test_groups_try_it_and_later(self):
        root, env = make_env('check')
        run('check-setup.py', ['remember', '--set', 'checkInChat=Team check-in'], env)
        run('check-setup.py', ['tested', 'workiq'], env)
        code, out, err = run('check-setup.py', ['--quick'], env, timeout=300)
        self.assertEqual(code, 0, err)
        report = json.loads(out)
        items = report['items']
        self.assertTrue(all(v.get('group') for v in items.values()))
        self.assertIn('Team check-in', items['workiq']['try_it'])
        self.assertTrue(items['workiq']['tested'])
        self.assertTrue(items['practice']['later'])
        self.assertNotIn('practice', report['summary']['ok'] + report['summary']['missing'])
        self.assertIn('dictation', items)
        self.assertIn('weekly', items)


class ResearchSetup(unittest.TestCase):
    def research_item(self, name, values, answers, mode=0o600):
        root, env = make_env(name)
        path = root / 'home' / '.copilot' / 'research.env'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(''.join('%s=%s\n' % pair for pair in values.items()))
        path.chmod(mode)
        code = ('import json, runpy, sys; sys.path.insert(0, sys.argv[1]); '
                'm=runpy.run_path(sys.argv[1]+"/check-setup.py"); '
                'print(json.dumps(m["check_research"](json.loads(sys.argv[2]))))')
        proc = subprocess.run([sys.executable, '-c', code, str(SCRIPTS), json.dumps(answers)],
                              env=env, capture_output=True, text=True, timeout=30)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return json.loads(proc.stdout)

    def test_api_setup_requires_both_keys_and_device_sign_in(self):
        values = {'OUTSET_API_KEY': 'unit-outset', 'USERINTERVIEWS_API_KEY': 'unit-interviews',
                  'OUTSET_OAUTH_CLIENT_ID': 'unit-client', 'OUTSET_REFRESH_TOKEN': 'unit-refresh',
                  'USERINTERVIEWS_ACCOUNT_EMAIL': 'unit-account'}
        answers = {'research_api_setup': 'yes', 'userinterviews_access': 'own'}
        for i, missing in enumerate((None, 'OUTSET_API_KEY', 'USERINTERVIEWS_API_KEY', 'OUTSET_OAUTH_CLIENT_ID')):
            with self.subTest(missing=missing):
                current = {k: v for k, v in values.items() if k != missing}
                item = self.research_item('research-keys-%d' % i, current, answers)
                self.assertEqual(item['ok'], missing is None)
                self.assertEqual(item['api_credentials_configured'], missing is None)
                self.assertNotIn('unit-refresh', json.dumps(item))
                self.assertNotIn('unit-interviews', json.dumps(item))

    def test_browser_only_setup_does_not_require_api_keys(self):
        values = {'OUTSET_OAUTH_CLIENT_ID': 'unit-client', 'OUTSET_REFRESH_TOKEN': 'unit-refresh',
                  'USERINTERVIEWS_ACCOUNT_EMAIL': 'unit-account'}
        item = self.research_item('research-browser', values,
                                  {'recruit_with_outset': 'yes', 'userinterviews_access': 'team'})
        self.assertTrue(item['ok'])
        self.assertTrue(item['recruiting_ready'])
        self.assertFalse(item['api_credentials_configured'])

    @unittest.skipIf(os.name == 'nt', 'POSIX permission check')
    def test_shared_credentials_are_not_ready(self):
        item = self.research_item('research-shared', {'OUTSET_API_KEY': 'unit-outset'}, {}, mode=0o644)
        self.assertFalse(item['ok'])
        self.assertFalse(item['owner_only'])

    @unittest.skipUnless(shutil.which('node'), 'Node required for the platform probe')
    def test_userinterviews_probe_is_read_only_and_does_not_print_secrets(self):
        probe = (REPO / 'autonomous-research' / 'scripts' / 'probe.mjs').as_uri()
        cases = ((200, {'data': []}, True, True),
                 (401, {'error': 'unit-interviews'}, True, False),
                 (200, {'page': 'not an API response'}, True, False),
                 (200, {'data': []}, False, False))
        for i, (status, body, has_key, passed) in enumerate(cases):
            with self.subTest(status=status, has_key=has_key, body=body):
                root, env = make_env('research-probe-%d' % i)
                path = root / 'home' / '.copilot' / 'research.env'
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('USERINTERVIEWS_API_KEY=unit-interviews\n' if has_key else '')
                code = textwrap.dedent('''
                    import assert from 'node:assert/strict';
                    let calls = 0;
                    globalThis.fetch = async (url, opts) => {
                        calls++;
                        assert.equal(url, 'https://www.userinterviews.com/api/recruits?page[size]=1');
                        assert.equal(opts.method, 'GET');
                        assert.equal(opts.redirect, 'error');
                        assert.equal(opts.headers['user-interviews-apikey'], 'unit-interviews');
                        assert.equal(opts.headers.accept, 'application/vnd.user-interviews.v2+json');
                        assert.equal(opts.body, undefined);
                        return new Response(%s, {status: %d});
                    };
                    process.argv[2] = 'userinterviews';
                    await import(%s);
                    assert.equal(calls, %d);
                ''') % (json.dumps(json.dumps(body)), status, json.dumps(probe), 1 if has_key else 0)
                proc = subprocess.run([shutil.which('node'), '--input-type=module', '-e', code], env=env,
                                      capture_output=True, text=True, timeout=30)
                self.assertEqual(proc.returncode, 0 if passed else 1, proc.stderr)
                self.assertNotIn('unit-interviews', proc.stdout + proc.stderr)
                self.assertIn('PASS' if passed else 'FAIL', proc.stdout)


def main():
    global SCRATCH
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--scratch')
    parser.add_argument('--keep', action='store_true')
    args, rest = parser.parse_known_args()
    SCRATCH = args.scratch or tempfile.mkdtemp(prefix='autonomous-setup-test-')
    Path(SCRATCH).mkdir(parents=True, exist_ok=True)
    try:
        result = unittest.main(argv=[sys.argv[0]] + rest, exit=False, verbosity=1).result
    finally:
        if not args.keep:
            shutil.rmtree(SCRATCH, ignore_errors=True)
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    sys.exit(main())

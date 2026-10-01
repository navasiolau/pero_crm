"""Offline behavioral acceptance-transport checks; no Docker, DB, or network."""
import base64
from contextlib import ExitStack, redirect_stdout
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import stat
import sys
import types
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'acceptance' / 'crm-modernization-staging.py'
if sys.platform == 'win32':
    sys.modules.setdefault('fcntl', types.ModuleType('fcntl'))
SPEC = importlib.util.spec_from_file_location('crm_modernization_staging', SOURCE)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
REVISION = 'a' * 40
BUNDLE = b'console.log(JSON.stringify({ok:true}))'


def packet(operation='native', **extra):
    return {'revision': REVISION, 'operation': operation, 'bundle': base64.b64encode(BUNDLE).decode(),
            'bundleSha256': hashlib.sha256(BUNDLE).hexdigest(), **extra}


class RefreshPath:
    def lstat(self):
        return types.SimpleNamespace(st_mode=stat.S_IFDIR | 0o700, st_uid=0)

    def __truediv__(self, child):
        return child


class StackPath:
    def is_dir(self):
        return True

    def __truediv__(self, child):
        return types.SimpleNamespace(read_bytes=lambda: b'watcher')

    def __str__(self):
        return '/opt/crm-staging'


def containers():
    common = {'com.docker.compose.project': 'crm-staging',
              'com.docker.compose.project.working_dir': '/opt/crm-staging'}
    web = {'Id': 'web-id', 'Image': 'image-id', 'Config': {'Labels': {**common,
           'com.docker.compose.service': 'web', 'org.opencontainers.image.revision': REVISION},
           'Env': ['DATABASE_URL=postgresql://user:secret@db:5432/crm',
                   'S3_ENDPOINT=http://192.168.0.33:9000', 'S3_BUCKET=pero-crm-staging']},
           'State': {'Running': True, 'Health': {'Status': 'healthy'}},
           'NetworkSettings': {'Networks': {'crm-staging_backend': {'NetworkID': 'backend'},
                                            'crm-staging_frontend': {'NetworkID': 'frontend'}}}}
    db = {'Id': MODULE.DB_ID, 'Config': {'Labels': {**common, 'com.docker.compose.service': 'db'}},
          'State': {'Running': True, 'Health': {'Status': 'healthy'}, 'StartedAt': MODULE.DB_STARTED},
          'Mounts': [{'Type': 'volume', 'Name': 'crm-staging_pgdata', 'Destination': '/var/lib/postgresql/data'}],
          'NetworkSettings': {'Networks': {'crm-staging_backend': {'NetworkID': 'backend', 'Aliases': ['db']}}}}
    return web, db


class ModernizationTransportTests(unittest.TestCase):
    def invoke(self, request, hostname='crm-staging', identity_error=None, changed=False):
        events = []
        calls = []
        stage_identity = {'hostname': 'crm-staging', 'web': 'web-id', 'revision': REVISION}

        def identity(revision):
            events.append('identity')
            if identity_error:
                raise MODULE.Refused(identity_error)
            return {**stage_identity, 'revision': 'changed'} if changed and calls else stage_identity

        def execute(command, **kwargs):
            events.append('exec')
            calls.append((command, kwargs))
            return types.SimpleNamespace(returncode=0, stdout=b'{"ok":true}', stderr=b'private-secret')

        with ExitStack() as stack:
            stack.enter_context(patch.object(MODULE.sys, 'stdin', types.SimpleNamespace(buffer=io.BytesIO(json.dumps(request).encode()))))
            stack.enter_context(patch.object(MODULE.socket, 'gethostname', return_value=hostname))
            stack.enter_context(patch.object(MODULE, 'REFRESH', RefreshPath()))
            stack.enter_context(patch.object(MODULE, 'protected_open', return_value=1))
            stack.enter_context(patch.object(MODULE.os, 'fdopen', side_effect=lambda *args: io.StringIO()))
            stack.enter_context(patch.object(MODULE.fcntl, 'flock', create=True, return_value=None))
            stack.enter_context(patch.object(MODULE.fcntl, 'LOCK_EX', create=True, new=2))
            stack.enter_context(patch.object(MODULE.fcntl, 'LOCK_NB', create=True, new=4))
            stack.enter_context(patch.object(MODULE, 'require_refresh_idle', side_effect=lambda: events.append('refresh')))
            stack.enter_context(patch.object(MODULE, 'identity', side_effect=identity))
            stack.enter_context(patch.object(MODULE.subprocess, 'run', side_effect=execute))
            stack.enter_context(patch.dict(MODULE.os.environ, {'CRM_BYN_NATIVE_TARGET': 'production', 'CRM_MODERNIZATION_TARGET': 'production', 'CRM_MODERNIZATION_STAGE_PROOF': '{"hostname":"production"}'}, clear=True))
            output = io.StringIO()
            with redirect_stdout(output):
                try:
                    status = MODULE.main()
                    error = None
                except MODULE.Refused as refused:
                    status, error = None, str(refused)
            return status, error, calls, events, output.getvalue()

    def test_native_target_derived_only_after_verified_identity(self):
        result = self.invoke(packet(input={'target': 'production', 'env': {'DATABASE_URL': 'evil'}}))
        status, error, calls, events, output = result
        self.assertEqual((status, error), (0, None))
        command, kwargs = calls[0]
        self.assertEqual(kwargs['env']['CRM_BYN_NATIVE_TARGET'], 'staging')
        self.assertNotIn('DATABASE_URL', kwargs['env'])
        self.assertNotIn('CRM_STAGING_BROWSER_INPUT', kwargs['env'])
        self.assertEqual({command[index + 1] for index, token in enumerate(command) if token == '--env'}, {'CRM_BYN_NATIVE_TARGET', 'CRM_MODERNIZATION_TARGET', 'CRM_MODERNIZATION_STAGE_PROOF'})
        self.assertEqual(kwargs['env']['CRM_MODERNIZATION_TARGET'], 'staging')
        self.assertEqual(json.loads(kwargs['env']['CRM_MODERNIZATION_STAGE_PROOF']), {'hostname': 'crm-staging', 'web': 'web-id', 'revision': REVISION})
        self.assertEqual(kwargs['input'], BUNDLE)
        self.assertLess(events.index('identity'), events.index('exec'))
        body = json.loads(output)
        self.assertEqual(body['bundleSha256'], hashlib.sha256(BUNDLE).hexdigest())
        self.assertEqual(body['identity']['revision'], REVISION)
        self.assertNotIn('private-secret', output)

    def test_packet_cannot_inject_environment_or_database_target(self):
        for field in ('env', 'DATABASE_URL', 'CRM_BYN_NATIVE_TARGET', 'CRM_MODERNIZATION_TARGET', 'CRM_MODERNIZATION_STAGE_PROOF', 'target'):
            with self.subTest(field=field):
                _, error, calls, _, _ = self.invoke(packet(**{field: 'production'}))
                self.assertEqual(error, 'UNKNOWN_PACKET_FIELDS')
                self.assertEqual(calls, [])

    def test_wrong_host_and_failed_identity_never_execute(self):
        for options, expected in (({'hostname': 'production'}, 'STAGING_HOST_REQUIRED'),
                                  ({'identity_error': 'DATABASE_IDENTITY_CHANGED'}, 'DATABASE_IDENTITY_CHANGED')):
            with self.subTest(expected=expected):
                _, error, calls, _, _ = self.invoke(packet(), **options)
                self.assertEqual(error, expected)
                self.assertEqual(calls, [])

    def test_revision_bundle_and_operation_guards_before_execution(self):
        for extra, expected in (({'revision': 'abc'}, 'FULL_REVISION_REQUIRED'),
                                ({'bundleSha256': '0' * 64}, 'BUNDLE_CHECKSUM_MISMATCH'),
                                ({'bundle': ''}, 'BUNDLE_SIZE_INVALID'),
                                ({'operation': 'prod'}, 'UNKNOWN_OPERATION')):
            with self.subTest(expected=expected):
                _, error, calls, _, _ = self.invoke(packet(**extra))
                self.assertEqual(error, expected)
                self.assertEqual(calls, [])

    def test_readonly_and_prepare_retain_input_contract(self):
        status, error, calls, _, _ = self.invoke(packet('readonly'))
        self.assertEqual((status, error), (0, None))
        self.assertNotIn('--env', calls[0][0])
        data = {'operation': 'prepare', 'password': 'private'}
        status, error, calls, _, output = self.invoke(packet('prepare', input=data))
        self.assertEqual((status, error), (0, None))
        env = calls[0][1]['env']
        self.assertEqual(json.loads(base64.b64decode(env['CRM_STAGING_BROWSER_INPUT'])), data)
        command = calls[0][0]
        self.assertEqual({command[index + 1] for index, token in enumerate(command) if token == '--env'}, {'CRM_STAGING_BROWSER_INPUT', 'CRM_MODERNIZATION_TARGET', 'CRM_MODERNIZATION_STAGE_PROOF'})
        self.assertEqual(env['CRM_MODERNIZATION_TARGET'], 'staging')
        self.assertEqual(json.loads(env['CRM_MODERNIZATION_STAGE_PROOF']), {'hostname': 'crm-staging', 'web': 'web-id', 'revision': REVISION})
        self.assertNotIn('private', output)
        _, error, calls, _, _ = self.invoke(packet('prepare', input={'operation': 'restore'}))
        self.assertEqual(error, 'OPERATION_INPUT_MISMATCH')
        self.assertEqual(calls, [])

    def test_post_execution_identity_change_refuses_receipt(self):
        _, error, calls, _, output = self.invoke(packet(), changed=True)
        self.assertEqual(error, 'DEPLOYMENT_CHANGED_DURING_ACCEPTANCE')
        self.assertEqual(len(calls), 1)
        self.assertEqual(output, '')

    def test_actual_identity_guards_database_network_mount_and_revision(self):
        for mutation, expected in ((lambda w, d: d.update(Id='production-db'), 'DATABASE_IDENTITY_CHANGED'),
                                  (lambda w, d: d['Mounts'][0].update(Name='production-volume'), 'DATABASE_MOUNT_CHANGED'),
                                  (lambda w, d: d['NetworkSettings']['Networks']['crm-staging_backend'].update(NetworkID='other'), 'DATABASE_NETWORK_MISMATCH'),
                                  (lambda w, d: w['Config']['Labels'].update({'org.opencontainers.image.revision': 'b' * 40}), 'WEB_REVISION_MISMATCH'),
                                  (lambda w, d: w['Config'].update(Env=['DATABASE_URL=postgresql://u:p@production/crm']), 'DATABASE_BINDING_MISMATCH')):
            with self.subTest(expected=expected), ExitStack() as stack:
                web, db = containers()
                mutation(web, db)
                stack.enter_context(patch.object(MODULE.socket, 'gethostname', return_value='crm-staging'))
                stack.enter_context(patch.object(MODULE.os, 'geteuid', create=True, return_value=0))
                stack.enter_context(patch.object(MODULE, 'STACK', StackPath()))
                stack.enter_context(patch.object(MODULE, 'OUTER_SHA', hashlib.sha256(b'watcher').hexdigest()))
                stack.enter_context(patch.object(MODULE, 'inspect', side_effect=[web, db]))
                with self.assertRaisesRegex(MODULE.Refused, expected):
                    MODULE.identity(REVISION)


if __name__ == '__main__':
    unittest.main()

"""№211: reviewed CT100 dispatcher; identity checks precede any application call."""
# SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP on mismatch.
import base64
import hashlib
import json
import os
import re
import socket
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit

DB = '15fee2f9002f17118ad148331a3b5ba61bd4d0969deb3913f6fa55f76ff9d624'
DB_STARTED = '2026-09-23T11:42:09.206207656Z'
WATCHER = '823716e12e72dbf5fa3464b7fa7863581707061521c58c437d6862a698cdc825'


def need(value, code):
    if not value:
        raise RuntimeError(code)


def inspect(name):
    result = subprocess.run(['docker', '--host', 'unix:///var/run/docker.sock', 'inspect', name], capture_output=True, check=True)
    return json.loads(result.stdout)[0]


def identity(revision):
    need(socket.gethostname() == 'crm' and os.geteuid() == 0, 'PRODUCTION_HOST_STOP')
    need(Path('/opt/crm').resolve() == Path('/opt/crm'), 'PRODUCTION_DIRECTORY_STOP')
    need(hashlib.sha256(Path('/opt/crm/watch-prod.sh').read_bytes()).hexdigest() == WATCHER, 'PRODUCTION_WATCHER_STOP')
    web, db, renderer = [inspect('crm-' + name + '-1') for name in ['web', 'db', 'kp-renderer']]
    for service, item in [('web', web), ('db', db), ('kp-renderer', renderer)]:
        labels = item['Config'].get('Labels', {})
        need(labels.get('com.docker.compose.project') == 'crm' and labels.get('com.docker.compose.service') == service and
             labels.get('com.docker.compose.project.working_dir') == '/opt/crm', 'PRODUCTION_COMPOSE_STOP')
        need(item['State']['Running'] and item['State'].get('Health', {}).get('Status') == 'healthy', 'PRODUCTION_HEALTH_STOP')
    need(web['Config']['Labels'].get('org.opencontainers.image.revision') == revision and
         renderer['Config']['Labels'].get('org.opencontainers.image.revision') == revision, 'PRODUCTION_REVISION_STOP')
    need(db['Id'] == DB and db['State']['StartedAt'] == DB_STARTED, 'PRODUCTION_DATABASE_STOP')
    need(len(db['Mounts']) == 1 and db['Mounts'][0].get('Name') == 'crm_pgdata' and
         db['Mounts'][0].get('Destination') == '/var/lib/postgresql/data', 'PRODUCTION_VOLUME_STOP')
    wn, dn, rn = [item['NetworkSettings']['Networks'] for item in [web, db, renderer]]
    need(set(wn) == {'crm_backend', 'crm_frontend', 'crm_kp_render'} and set(dn) == {'crm_backend'} and set(rn) == {'crm_kp_render'}, 'PRODUCTION_NETWORK_STOP')
    need(wn['crm_backend']['NetworkID'] == dn['crm_backend']['NetworkID'] and wn['crm_kp_render']['NetworkID'] == rn['crm_kp_render']['NetworkID'], 'PRODUCTION_NETWORK_BINDING_STOP')
    env = dict(value.split('=', 1) for value in web['Config']['Env'] if '=' in value)
    url = urlsplit(env.get('DATABASE_URL', ''))
    need(url.hostname == 'db' and url.path == '/crm' and env.get('S3_BUCKET') == 'pero-crm', 'PRODUCTION_STORAGE_STOP')
    return {'hostname': 'crm', 'revision': revision, 'web': web['Id'], 'image': web['Image'], 'renderer': renderer['Id'],
            'database': db['Id'], 'databaseStartedAt': db['State']['StartedAt'], 'volume': 'crm_pgdata'}


try:
    packet = json.loads(sys.stdin.buffer.read(1024 * 1024 + 1))
    need(set(packet) == {'revision', 'mode', 'input', 'bundle', 'bundleSha256'}, 'PACKET_STOP')
    revision = packet['revision']
    need(re.fullmatch('[a-f0-9]{40}', revision), 'REVISION_FORMAT_STOP')
    need(packet['mode'] in ['check', 'apply', 'rollback'] and packet['input']['mode'] == packet['mode'], 'MODE_STOP')
    bundle = base64.b64decode(packet['bundle'], validate=True)
    need(0 < len(bundle) <= 256 * 1024 and hashlib.sha256(bundle).hexdigest() == packet['bundleSha256'], 'BUNDLE_HASH_STOP')
    before = identity(revision)
    command = ['docker', '--host', 'unix:///var/run/docker.sock', 'exec', '-i', '-w', '/app/apps/web',
               '-e', 'PERO_NUMBER_REPAIR_HOST=crm', '-e', 'PERO_NUMBER_REPAIR_REVISION=' + revision,
               '-e', 'PERO_NUMBER_REPAIR_INPUT=' + json.dumps(packet['input'], separators=(',', ':')),
               before['web'], 'timeout', '-s', 'KILL', '90', 'node', '--input-type=module']
    result = subprocess.run(command, input=bundle, capture_output=True)
    need(identity(revision) == before, 'PRODUCTION_CHANGED_DURING_OPERATION_STOP')
    need(len(result.stdout) <= 256 * 1024, 'OUTPUT_BOUND_STOP')
    body = json.loads(result.stdout)
    print(json.dumps({'identity': before, 'exitCode': result.returncode, 'result': body}))
    sys.exit(0 if result.returncode == 0 and body.get('status') == 'PASS' else 1)
except Exception as error:
    code = str(error) if re.fullmatch('[A-Z0-9_]{1,120}', str(error)) else 'PRODUCTION_NUMBER_REPAIR_DISPATCH_STOP'
    print(json.dumps({'status': 'STOP', 'code': code}))
    sys.exit(2)

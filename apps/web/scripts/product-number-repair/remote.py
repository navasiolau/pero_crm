"""№211: file-based Windows→PVE→CT100 transport; no shell quoting or service changes."""
import argparse
import base64
import hashlib
import json
import re
import subprocess
import sys
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['check', 'apply', 'rollback'])
    parser.add_argument('--revision', required=True)
    parser.add_argument('--bundle', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--baseline')
    args = parser.parse_args()
    if not re.fullmatch('[a-f0-9]{40}', args.revision):
        raise RuntimeError('FULL_REVISION_REQUIRED')
    out = Path(args.out).resolve()
    if out.exists() or '.playwright-mcp' not in out.parts:
        raise RuntimeError('NEW_PRIVATE_EVIDENCE_PATH_REQUIRED')
    out.parent.mkdir(parents=True, exist_ok=True)
    baseline = None
    if args.mode != 'check':
        if not args.baseline:
            raise RuntimeError('BASELINE_REQUIRED')
        prior = json.loads(Path(args.baseline).read_text(encoding='utf-8'))
        if prior.get('identity', {}).get('hostname') != 'crm' or prior.get('identity', {}).get('database') != '15fee2f9002f17118ad148331a3b5ba61bd4d0969deb3913f6fa55f76ff9d624' or prior.get('identity', {}).get('revision') != args.revision:
            raise RuntimeError('BASELINE_IDENTITY_STOP')
        if prior.get('result', {}).get('status') != 'PASS' or prior['result'].get('mode') != 'check':
            raise RuntimeError('CHECK_BASELINE_REQUIRED')
        baseline = prior['result']['result']
    operation = {'mode': args.mode, 'operationId': baseline['operationId'] if baseline else str(uuid.uuid4())}
    if baseline:
        operation['baseline'] = baseline
    bundle = Path(args.bundle).read_bytes()
    source = (HERE / 'production-dispatch.py').read_bytes()
    packet = {'revision': args.revision, 'mode': args.mode, 'input': operation,
              'bundle': base64.b64encode(bundle).decode(), 'bundleSha256': hashlib.sha256(bundle).hexdigest()}
    loader = "import base64;exec(compile(base64.b64decode(" + repr(base64.b64encode(source).decode()) + "),'reviewed-product-number-repair.py','exec'))"
    command = ['pct', 'exec', '100', '--', 'python3', '-c', loader]
    transport = ("import base64,json,os,socket,subprocess,sys\n"
                 "assert socket.gethostname()=='pve' and os.geteuid()==0,'PVE_IDENTITY_STOP'\n"
                 "result=subprocess.run(" + repr(command) + ",input=base64.b64decode(" + repr(base64.b64encode(json.dumps(packet).encode()).decode()) + "),capture_output=True)\n"
                 "sys.stdout.buffer.write(result.stdout)\n"
                 "if result.returncode and not result.stdout:print(json.dumps({'status':'STOP','code':'TRANSPORT_STOP'}))\n"
                 "sys.exit(result.returncode)\n").encode()
    path = out.with_suffix('.reviewed.py')
    if path.exists():
        raise RuntimeError('TRANSPORT_PATH_ALREADY_EXISTS')
    path.write_bytes(transport)
    if path.stat().st_size != len(transport) or path.read_bytes() != transport:
        raise RuntimeError('TRANSPORT_FILE_MISMATCH')
    result = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'pve-nb', 'python3', '-'],
                            input=path.read_bytes(), capture_output=True)
    if not result.stdout:
        raise RuntimeError('SSH_TRANSPORT_STOP')
    value = json.loads(result.stdout)
    out.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    body = value.get('result', {})
    answer = body.get('result', {})
    print(json.dumps({'status': body.get('status', value.get('status', 'STOP')), 'code': body.get('code', value.get('code')),
                      'mode': args.mode, 'revision': args.revision, 'evidence': str(out),
                      'productId': answer.get('productId'), 'activeCount': len(answer.get('composition', answer.get('active', []))) if args.mode == 'check' and body.get('status') == 'PASS' else None,
                      'from': answer.get('from', '1.64'), 'to': answer.get('to', '1.15'),
                      'bundleSha256': packet['bundleSha256'], 'transportBytes': len(transport)}))
    return result.returncode


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (RuntimeError, ValueError, OSError) as error:
        code = str(error) if re.fullmatch('[A-Z0-9_]{1,120}', str(error)) else 'REMOTE_NUMBER_REPAIR_STOP'
        print(json.dumps({'status': 'STOP', 'code': code}))
        sys.exit(2)

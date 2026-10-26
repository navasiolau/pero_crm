#!/usr/bin/env python3
"""PERO CRM KP helper: private API, durable operation receipts, revision guards."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid

BRIDGE = Path(__file__).resolve().parents[1] / 'mcp' / 'bridge.mjs'
ENV_NAMES = ('PERO_CRM_API_URL', 'PERO_CRM_API_KEY')


class ApiError(RuntimeError):
    pass


def load_json(path):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8-sig'), parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except (OSError, ValueError):
        raise ApiError('Не удалось прочитать JSON-файл.') from None


def write_json(path, value, *, exclusive=False):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n'
    if exclusive:
        with target.open('x', encoding='utf-8', newline='\n') as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
    else:
        temporary = target.with_name(target.name + '.' + str(uuid.uuid4()) + '.tmp')
        temporary.write_text(text, encoding='utf-8', newline='\n')
        os.replace(temporary, target)


def environment(workspace):
    result = os.environ.copy()
    path = Path(workspace) / '.env'
    if path.is_file():
        for line in path.read_text(encoding='utf-8-sig').splitlines():
            name, found, value = line.strip().removeprefix('export ').partition('=')
            if found and name.strip() in ENV_NAMES and not result.get(name.strip()):
                result[name.strip()] = value.strip().strip('"').strip("'")
    if any(not result.get(name) for name in ENV_NAMES):
        raise ApiError('Нужны PERO_CRM_API_URL и PERO_CRM_API_KEY в окружении или .env рабочего каталога; API_KEYS старого генератора не используется.')
    return result


class ApiClient:
    def __init__(self, workspace, runner=subprocess.run):
        self.env = environment(workspace)
        self.runner = runner

    def call(self, action, **args):
        try:
            timeout = None if action == 'job' and args.get('wait') is True else 110
            child = self.runner(['node', str(BRIDGE)], input=json.dumps({'action': action, 'args': args}, ensure_ascii=False, allow_nan=False),
                                text=True, encoding='utf-8', capture_output=True, env=self.env, timeout=timeout, check=False)
        except (OSError, subprocess.TimeoutExpired):
            raise ApiError('Помощник Node не завершён. Для записи проверьте сохранённый operationId; новое создание не повторялось.') from None
        try:
            response = json.loads(child.stdout)
            if not response.get('ok'):
                error = response.get('error') or {}
                message = str(error.get('message') or 'Ошибка API CRM.')
                message = message.replace(self.env['PERO_CRM_API_KEY'], '[ключ скрыт]')
                if error.get('operationId'):
                    message += ' operationId=' + str(error['operationId'])
                raise ApiError(message[:1500])
            return response['result']
        except (ValueError, KeyError, TypeError):
            raise ApiError('Не удалось проверить ответ помощника. Для записи используйте прежний operationId из квитанции.') from None


def request_fingerprint(action, args):
    encoded = json.dumps({'action': action, 'args': args}, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')
    return hashlib.sha256(encoded).hexdigest()


def command(client, action, args, receipt_path):
    """Persist before write. A receipt rerun performs reads only, never another write."""
    fingerprint = request_fingerprint(action, args)
    receipt_path = Path(receipt_path)
    if receipt_path.exists():
        receipt = load_json(receipt_path)
        if receipt.get('requestSha256') != fingerprint or receipt.get('action') != action:
            raise ApiError('Квитанция принадлежит другому запросу. Не меняйте UUID/запрос после неопределённого результата.')
        # Даже если ACK потерян, не отправляем запрос повторно автоматически.
        recovered = client.call('operation', id=receipt['operationId'])
        result = recovered.get('result', recovered)
        receipt.update(result=result, verified=True, recoveredByRead=True)
        write_json(receipt_path, receipt)
        return result
    operation_id = str(uuid.uuid4())
    receipt = {'operationId': operation_id, 'action': action, 'requestSha256': fingerprint, 'verified': False}
    write_json(receipt_path, receipt, exclusive=True)
    result = client.call(action, **args, operationId=operation_id)
    receipt.update(result=result, verified=True)
    write_json(receipt_path, receipt)
    return result


def fresh_document(client, document_id, before_path):
    before = load_json(before_path)
    if before.get('id') != document_id or not isinstance(before.get('revision'), int):
        raise ApiError('--before должен содержать свежий GET именно этого КП и его revision.')
    current = client.call('get', id=document_id)
    if current.get('revision') != before['revision'] or current.get('state') != before.get('state'):
        raise ApiError('КП уже изменилось. Прочитайте свежий документ, сохраните вмешавшиеся правки и повторите с новой квитанцией.')
    if not current.get('canEdit'):
        raise ApiError('КП редактируется только в статусе «Лид».')
    return before


def state_for_save(state, before=None):
    if not isinstance(state, dict) or not isinstance(state.get('items'), list) or not all(isinstance(row, dict) for row in state['items']):
        raise ApiError('Нужно полное state с массивом объектов items.')
    ids = [row['id'] for row in state['items'] if row.get('id')]
    if len(ids) != len(set(ids)):
        raise ApiError('ID позиций повторяются. Прежние items[].id сохраняйте, для новых позиций не копируйте чужой ID.')
    return state


def backup_document(client, document_id, directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=False)
    document = client.call('get', id=document_id)
    write_json(directory / 'document.json', document, exclusive=True)
    versions = client.call('versions', id=document_id)
    write_json(directory / 'versions.json', versions, exclusive=True)
    media_ids = sorted({str(row[slot])[9:] for row in document['state']['items'] for slot in ('image', 'image2')
                        if isinstance(row.get(slot), str) and row[slot].startswith('kp-media:')})
    images = []
    for media_id in media_ids:
        try:
            data = client.call('media', documentId=document_id, id=media_id, variant='optimized', scope='current')
            raw = base64.b64decode(data['base64'], validate=True)
            suffix = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp'}.get(data['mimeType'], '.bin')
            name = str(len(images) + 1) + suffix
            (directory / name).write_bytes(raw)
            images.append({'mediaId': media_id, 'path': name, 'sha256': hashlib.sha256(raw).hexdigest()})
        except ApiError as error:
            images.append({'mediaId': media_id, 'unavailable': str(error)})
    write_json(directory / 'media.json', images, exclusive=True)
    pdfs = []
    seen = set()
    for version in versions.get('versions', []):
        artifact_id = version.get('pdfArtifactId')
        if not artifact_id or artifact_id in seen: continue
        seen.add(artifact_id)
        try:
            data = client.call('artifact', id=artifact_id)
            raw = base64.b64decode(data['base64'], validate=True)
            if not raw.startswith(b'%PDF-'): raise ApiError('Артефакт не содержит PDF.')
            name = 'version-' + str(len(pdfs) + 1).zfill(3) + '.pdf'
            (directory / name).write_bytes(raw)
            pdfs.append({'artifactId': artifact_id, 'versionId': version['id'], 'path': name, 'sha256': hashlib.sha256(raw).hexdigest()})
        except ApiError as error:
            pdfs.append({'artifactId': artifact_id, 'versionId': version.get('id'), 'unavailable': str(error)})
    write_json(directory / 'pdfs.json', pdfs, exclusive=True)
    return {'directory': str(directory), 'id': document_id, 'revision': document['revision'], 'images': len(images), 'pdfs': len(pdfs),
            'unavailable': sum('unavailable' in row for row in images + pdfs)}


def main(argv=None):
    parser = argparse.ArgumentParser(description='КП и договоры через приватный API PERO CRM (Node 22+, Python 3.10+).')
    parser.add_argument('--workspace', default=r'E:\KP')
    commands = parser.add_subparsers(dest='action', required=True)
    for name in ('list', 'clients'):
        sub = commands.add_parser(name); sub.add_argument('--query', default='')
    for name in ('get', 'client', 'versions', 'contract', 'operation', 'job'):
        sub = commands.add_parser(name); sub.add_argument('id')
        sub.add_argument('--out')
        if name == 'job': sub.add_argument('--wait', action='store_true')
    sub = commands.add_parser('version'); sub.add_argument('id'); sub.add_argument('version_id'); sub.add_argument('--out')
    sub = commands.add_parser('backup'); sub.add_argument('id'); sub.add_argument('--directory', required=True)
    sub = commands.add_parser('save'); sub.add_argument('--state', required=True); sub.add_argument('--id'); sub.add_argument('--before'); sub.add_argument('--receipt', required=True)
    sub.add_argument('--client-id'); sub.add_argument('--fx'); sub.add_argument('--expected-number', type=int)
    for name in ('restore', 'pdf', 'upload'):
        sub = commands.add_parser(name); sub.add_argument('id'); sub.add_argument('--before', required=True); sub.add_argument('--receipt', required=True)
        if name == 'restore': sub.add_argument('version_id')
        if name == 'upload': sub.add_argument('file'); sub.add_argument('--optimized')
    for name in ('save-contract', 'generate-contract'):
        sub = commands.add_parser(name); sub.add_argument('id'); sub.add_argument('--form', required=True); sub.add_argument('--receipt', required=True)
        if name == 'save-contract': sub.add_argument('--settings', required=True)
    sub = commands.add_parser('artifact'); sub.add_argument('id'); sub.add_argument('--out', required=True)
    args = parser.parse_args(argv)
    client = ApiClient(args.workspace)
    action = args.action
    if action in ('list', 'clients'):
        result = client.call(action, query=args.query)
    elif action in ('get', 'client', 'versions', 'contract', 'operation', 'job'):
        result = client.call(action, id=args.id, **({'wait': args.wait} if action == 'job' else {}))
    elif action == 'version':
        result = client.call(action, id=args.id, versionId=args.version_id)
    elif action == 'backup':
        result = backup_document(client, args.id, args.directory)
    elif action == 'save':
        if args.id and not args.before: raise ApiError('Обновление требует --before, полученный командой get.')
        before = (load_json(args.before) if Path(args.receipt).exists() else fresh_document(client, args.id, args.before)) if args.id else None
        if before and before.get('id') != args.id: raise ApiError('Квитанция и --before должны относиться к одному КП.')
        request = {'state': state_for_save(load_json(args.state), before)}
        if args.id: request.update(id=args.id, expectedRevision=before['revision'])
        if args.client_id: request['clientId'] = args.client_id
        if args.fx: request['fx'] = load_json(args.fx)
        if args.expected_number is not None: request['expectedNumber'] = args.expected_number
        result = command(client, action, request, args.receipt)
        saved = client.call('get', id=result['id'])
        if saved.get('revision') != result.get('revision') or saved.get('state') != result.get('state'):
            raise ApiError('После сохранения ревизия уже изменилась. Квитанция сохранена; нужна сверка свежего GET.')
        result = {'receipt': result, 'document': saved, 'verifiedByGet': True}
    elif action in ('restore', 'pdf', 'upload'):
        before = fresh_document(client, args.id, args.before) if action != 'pdf' and not Path(args.receipt).exists() else load_json(args.before)
        if before.get('id') != args.id or not isinstance(before.get('revision'), int): raise ApiError('Нужен свежий GET этого документа.')
        request = {'id': args.id, 'expectedRevision': before['revision']}
        if action == 'restore': request['versionId'] = args.version_id
        if action == 'upload': request = {'documentId': args.id, 'expectedRevision': before['revision'], 'file': str(Path(args.file).resolve()), **({'optimized': str(Path(args.optimized).resolve())} if args.optimized else {})}
        result = command(client, action, request, args.receipt)
    elif action in ('save-contract', 'generate-contract'):
        form = load_json(args.form)
        request = {'id': args.id, 'expectedRevision': form['revision'], 'sourceRefs': form['sourceRefs'], 'clientBaseline': form['clientBaseline']}
        if action == 'save-contract': request['settings'] = load_json(args.settings)
        result = command(client, action, request, args.receipt)
    elif action == 'artifact':
        binary = client.call(action, id=args.id)
        raw = base64.b64decode(binary['base64'], validate=True)
        path = Path(args.out)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open('xb') as stream: stream.write(raw)
        result = {'path': str(path.resolve()), 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw), 'mimeType': binary['mimeType']}
    else:
        raise ApiError('Неизвестная команда.')
    if getattr(args, 'out', None) and action != 'artifact':
        write_json(args.out, result)
    else:
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    return 0


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'): sys.stdout.reconfigure(encoding='utf-8')
    if hasattr(sys.stderr, 'reconfigure'): sys.stderr.reconfigure(encoding='utf-8')
    try:
        sys.exit(main())
    except (ApiError, OSError, ValueError, KeyError, TypeError) as error:
        print(str(error) if isinstance(error, ApiError) else 'Ошибка локального файла или формата запроса. Квитанции сохранены; не повторяйте создание вслепую.', file=sys.stderr)
        sys.exit(1)

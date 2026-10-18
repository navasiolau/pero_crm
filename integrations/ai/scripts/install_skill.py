#!/usr/bin/env python3
"""Install the reviewed CRM skill bundle after a successful authenticated API probe."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import uuid

from pero_kp_api import ApiClient, ApiError

SOURCE = Path(__file__).resolve().parents[1]


def source_files():
    return [Path('SKILL.md'), Path('scripts/pero_kp_api.py'),
            *sorted(path.relative_to(SOURCE) for path in (SOURCE / 'mcp').glob('*.mjs')),
            *sorted(path.relative_to(SOURCE) for path in (SOURCE / 'references').glob('*.md'))]


def reject_links(path):
    path = Path(path).absolute()
    for candidate in (path, *path.parents):
        if candidate.exists() and (candidate.is_symlink() or (hasattr(candidate, 'is_junction') and candidate.is_junction())):
            raise ApiError('Каталог установки содержит symbolic link/junction. Проверьте точную цель вручную.')
        if candidate.exists() and os.name == 'nt' and getattr(candidate.lstat(), 'st_file_attributes', 0) & 0x400:
            raise ApiError('Каталог установки содержит reparse point. Установка остановлена.')


def install(target, backup_root, accepted_sha, probe):
    if not re.fullmatch(r'[a-f0-9]{40}', accepted_sha or ''):
        raise ApiError('Нужен полный SHA принятой CRM-ревизии.')
    target = Path(target).absolute()
    if target.name != 'pero-kp-commercial-proposal':
        raise ApiError('Цель должна быть каталогом навыка pero-kp-commercial-proposal.')
    reject_links(target)
    files = source_files()
    for file in files:
        if not (SOURCE / file).is_file(): raise ApiError('В исходном комплекте отсутствует обязательный файл.')
        reject_links(SOURCE / file)
        reject_links(target / file)
    # Пока CRM выключена/ключ недостаточен, установка ничего не меняет.
    result = probe()
    if not isinstance(result, dict) or not isinstance(result.get('documents'), list):
        raise ApiError('CRM API не подтвердил доступ к разделу КП; старый навык сохранён.')
    backup_root = Path(backup_root).absolute()
    reject_links(backup_root)
    backup = backup_root / ('crm-skill-backup-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + str(uuid.uuid4())[:8])
    backup.mkdir(parents=True, exist_ok=False)
    receipt = {'acceptedSha': accepted_sha, 'target': str(target), 'backup': str(backup), 'files': []}
    for file in files:
        previous = target / file
        if previous.exists():
            if not previous.is_file(): raise ApiError('Обязательный путь навыка занят каталогом; установка остановлена, резервная копия сохранена.')
            old = backup / file; old.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(previous, old)
        data = (SOURCE / file).read_bytes()
        receipt['files'].append({'path': file.as_posix(), 'sha256': hashlib.sha256(data).hexdigest(), 'previousSha256': hashlib.sha256(previous.read_bytes()).hexdigest() if previous.is_file() else None})
    # Сначала модули/справочники, затем точка входа: старый workflow не ссылается на недописанный новый комплект.
    for file in [file for file in files if file.name != 'SKILL.md'] + [Path('SKILL.md')]:
        destination = target / file
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(destination.name + '.' + str(uuid.uuid4()) + '.tmp')
        shutil.copy2(SOURCE / file, temporary)
        reject_links(destination)
        os.replace(temporary, destination)
    for row in receipt['files']:
        if hashlib.sha256((target / row['path']).read_bytes()).hexdigest() != row['sha256']:
            raise ApiError('Контрольная сумма установленного файла не совпала; сохраните резервную копию и проверьте каталог.')
    (backup / 'installation-receipt.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return receipt


def main():
    parser = argparse.ArgumentParser(description='Переключить навык на принятый API CRM; старые файлы сохраняются в точной резервной копии.')
    parser.add_argument('--workspace', default=r'E:\KP')
    parser.add_argument('--target', default=str(Path(os.environ.get('CODEX_HOME') or Path.home() / '.codex') / 'skills' / 'pero-kp-commercial-proposal'))
    parser.add_argument('--accepted-sha')
    parser.add_argument('--activate', action='store_true')
    args = parser.parse_args()
    if not args.activate:
        print(json.dumps({'activated': False, 'target': args.target, 'files': [str(path) for path in source_files()], 'next': 'После сквозной приёмки укажите --activate --accepted-sha <полный SHA>. API будет проверен перед изменением файлов.'}, ensure_ascii=False, indent=2))
        return
    client = ApiClient(args.workspace)
    result = install(args.target, args.workspace, args.accepted_sha, lambda: client.call('list'))
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'): sys.stdout.reconfigure(encoding='utf-8')
    if hasattr(sys.stderr, 'reconfigure'): sys.stderr.reconfigure(encoding='utf-8')
    try: main()
    except (ApiError, OSError, ValueError):
        print('Установка остановлена. Проверьте API, принятую ревизию и пути; имеющиеся резервные копии сохранены.', file=sys.stderr)
        sys.exit(1)

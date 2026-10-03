# Proposal

## Why

Общая загрузка теряет причины ошибок storage и может вернуть ошибку после сохранения файла. Предыдущая S3 QA успешна, текущая причина пользовательского сбоя пока не установлена.

## What Changes

- Явный CRM_FILE_STORAGE=s3|local; неполная S3 конфигурация не включает диск.
- Закрытый безопасный JSON ошибки с code/requestId/phase/message/commitState.
- UUID повтор обычной загрузки, атомарные File и audit receipt, уведомление после commit.
- Исходные байты и существующие ACL/CAS/форматы сохраняются.

## Capabilities

### New Capabilities
- `reliable-file-upload`: определённое хранилище, диагностируемая и повторяемая загрузка.

### Modified Capabilities

Нет.

## Impact

lib/s3.ts, сервер загрузки и POST /api/files/upload; клиентский контракт отдельной задачи48. Нет схемы/миграции, инфраструктурных изменений, доступа production или runtime storage writes агента. Deployment должен явно задать storage mode.

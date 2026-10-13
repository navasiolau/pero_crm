# Proposal

## Why

№168 сократил повторяющиеся тесты и QA, но оставил отдельные native runners и mock-хранилища. №169 переносит их контракты в общий CI с настоящими PostgreSQL/S3, чтобы дополнительно уменьшить проверочный код без потери содержательных случаев.

## What Changes

- Временный стенд только в существующем GitHub Ubuntu test job: PostgreSQL 17, официальный фиксированный MinIO и один запуск уже собранного Next.js.
- Guard цели до миграций, соединений и синтетических фикстур; только loopback, `pero_ci` и bucket текущего run.
- Общие PostgreSQL и HTTP/S3 cases вместо повторяющихся mock/native helpers; карта покрытия и фактический подсчёт сокращения.
- Удаление ресурсов стенда после успеха, ошибки и отмены; проверяемые журналы cleanup. После job контейнеры, сеть и тома стенда отсутствуют.

## Capabilities

### New Capabilities

- `ci-integration-test-runtime`: изолированные обязательные интеграционные проверки и удаление временного CI-стенда.

### Modified Capabilities

Нет изменений функций CRM.

## Impact

`.github/workflows/ci-cd.yml`, одна команда `apps/web/package.json`, `apps/web/tests/integration`, заменяемые тесты и QA, OpenSpec. Зависимости и production-конфигурация не меняются. Разрешение владельца на новый стенд и синтетические фикстуры относится только к CI №169; рабочие БД, S3, PVE/VPS, main и production исключены.

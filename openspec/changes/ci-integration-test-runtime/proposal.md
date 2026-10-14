# Proposal

## Согласованное продолжение — 14.10.2026

Владелец поручил закрыть найденные пробелы в существующем integration runner: реальный credentials login, отзыв сессии после чувствительных изменений и Bearer/scopes; складские/логистические денежные writers, исправления, rollback и конкурентность; Telegram одноразовая привязка/expiry/replay/disabled user и plugin command permissions/run-log через реальные routes. Все случаи размещаются в существующих тестах/фикстурах №169, без нового framework/runner/helper/test-файла, дополнительных jobs или новых стендов. Данные только синтетические внутри уже разрешённого CI; guards/ownership/finally/always cleanup сохраняются. Source/schema/deps/public APIs/main/production не меняются.

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

## Согласованные следующие native/HTTP ports — OPEN

Продолжение переносит уникальные task/percentage/auth/warehouse/logistics/queue/subscriber/file/cover/payroll/description/inline условия из старых manual/mock contours в existing integration files и fixtures; old verifyNative135 и meaningful snapshot/foreign-FK/falsy guards сохраняются. Случаи, не подтверждённые реальным PG/HTTP, не объявляются PASS. Для actual Auth.js fail-closed второй OWNED CI web того же image на loopback3101 использует тот же owned PG/network и unique `ci_fault_<run>_<attempt>` NOSUPERUSER LOGIN с CONNECTION LIMIT5 и минимальными plugin DML/User SELECT. После real instrumentation/syncPlugins bootstrap и health200 fault создаётся POSTBOOT: только этой роли задаётся CONNECTION LIMIT0 и завершаются только её exact role/datname=pero_ci sessions; ожидаются health503/session null/my307. Main role/PG service/S3/protected data неизменны, stop/reset/bypass/mocks не применяются. Прежняя CI260/259f приёмка сохраняется; новых framework/runners/test/helper файлов, working DB/S3/stand writes нет.

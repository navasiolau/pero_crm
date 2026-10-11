# Proposal

## Why

Карта159 показывает gaps, но отдельные native/runtime/browser receipts пока не связаны единым проверяемым контрактом с accepted SHA, фактическим image/target, producer version и источниками проверяемого кода. Старые native runners повторяют DDL либо создают global warehouse state и не подходят текущим существующим окружениям.

## What Changes

- Добавить общий QA evidence protocol/coordinator с явно объявленными обязательными сценариями, уровнями evidence и статусами PASS/FAIL/NOT_RUN/BLOCKED.
- Связать результаты с full accepted SHA, actual image/identity, run/scenario IDs, producer protocol/version/bundle hash и проверяемым production source manifest до/после сборки и исполнения.
- Переиспользовать qaTransport и существующие reviewed domain producers;129 fixtures и финансовые131/130 сценарии остаются у их авторов.
- Обновить два старых native entrypoints: import-inert, существующий проверенный local/staging target, current schema без replay migrations, existing ACTIVE warehouse run без создания/удаления main, rollback/exact-owned cleanup.
- Упаковать неизменённую существующую серверную зависимость Zod через поддерживаемый serverExternalPackages, если baseline Linux standalone не содержит пригодное public closure; версия, валидаторы и стандартная локаль сохраняются, whole dependency проверяется до native.
- Добавить реальные native и HTTP/runtime доказательства на accepted staging; UI/DTO acceptance требует визуальных и поведенческих сравнений, а identity/CI отдельно не закрывают сценарии.

## Capabilities

### New Capabilities

- release-evidence: проверяемая готовность QA по конкретной ревизии, целевой среде, source provenance и обязательным сценариям.

### Modified Capabilities

Нет. crm-autodeploy и бизнес-поведение приложения не меняются.

## Impact

QA protocol/coordinator, source/target helpers, два native runners и документация/OpenSpec. Scope дополнен prerequisite серверной упаковки: apps/web/next.config.ts может добавить literal zod к serverExternalPackages без dependency updates. apps/web/Dockerfile служит проверяемым входом и не меняется. Прежнее обещание QA-only пересмотрено; application src, валидаторы, default validation errors, UI, права и доменные вычисления сохраняются. Миграции, CI policy, transport/W07, production/main не меняются. Дампы/restic/reset/seed/новые БД запрещены. Packaging source release требует отдельного DESIGN_GO/root release; draft их не предоставляет.

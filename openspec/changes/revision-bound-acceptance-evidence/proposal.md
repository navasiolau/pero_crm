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

## Shared18 scoped QA adaptation

Для приёмки уже готовых18 кандидатов переиспользуется existing117 RootKit. Он создаёт только восемь Root-registered строк: четыре fresh пользователя (MANAGER, assigned/foreign ENGINEER, ACCOUNTANT), Client, Project IN_WORK, Product PREPARATION и assigned Product PRODUCTION. V1 historical HMAC receipts остаются V1; новый graph имеет V2. Старый MANAGER+DRAFT не запускается текущим entry.

Дополнительно разрешены только шесть QA paths kanban-search-owned-protocol/fixtures/root-runner/stage-browser/owned-entry и helpers/staging-acceptance-qualification. Четыре существующих117 test files остаются в области проверки, новые отрицательные cases находятся в двух из них. Production src/config/versions/lock/schema/transport не изменяются этим дополнением. Общая metadata qualification проверяет exact actual stage ledger/catalog, а не local migration-count alias.

Optional Task/Work/File и financial fixtures не создаются общей группой. Native128 frozen50/qty3/rate5 остаётся rollback proof отдельного автора. Для изменяющих status/DnD действий необходим конкретный registered audit/outbox closure; отсутствие такого разрешения означает BLOCKED, а не выполнение общего POST.

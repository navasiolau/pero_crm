# Proposal

## Why

Три выбранные suites повторяют ручной Module/require.cache injection и оставляют cache/globalThis.prisma без сценарной очистки. Задача161 переносит только этот fixture lifecycle в один helper, сохраняя реальные imports проверяемых модулей и все существующие денежные/ACL/file assertions.

## What Changes

- Один небольшой guarded-module-cache helper: explicit specifier allowlist, настоящий target require, snapshot/restore собственных cache/globals при успехе и любой ошибке.
- Неожиданные PrismaClient construction/query и network calls отказывают до внешнего эффекта; настоящие Enum/Decimal и Sharp остаются доступными.
- Первый переход только crm-byn-domain-payroll-actions, work-shares-settlement и file-pdf-view-route. Before/after hooks дают отдельный scope каждому сценарию, mutable fixture поддерживается через текущие closures/proxy.
- Сохранить22 business names и все value assertions:20 callback AST exact, ещё2 меняют только явно согласованный import seam tasks/queries. Добавить компактные helper guard/cleanup/reorder/repeat proofs в выбранных suites, без четвёртого семейства.
- Измерить source LOC/дублирование до/после; исчезают3 injector implementations, все suites используют1 helper. Новые protections не выдаются за снижение app bundle или native SQL evidence.

## Capabilities

### New Capabilities

Нет новых бизнес-возможностей. Это обслуживание тестового fixture tooling; skip_specs:true.

### Modified Capabilities

Нет. Money/access/file contracts и production behavior не меняются. Fake transactions не доказывают PostgreSQL locks.

## Impact

Branch feature/161, fresh origin/staging base d121f0798e963f32d13f52c9bde57c0aa82b7929.
Ownership: apps/web/tests/helpers/guarded-module-cache.ts;
apps/web/tests/crm-byn-domain-payroll-actions.test.ts;
apps/web/tests/work-shares-settlement.test.ts;
apps/web/tests/file-pdf-view-route.test.ts;
только этот OpenSpec change.
Нет app/schema/config/package/lock/CI изменений, DB/HTTP/stage execution, restic/dump/reset/seed/newDB/prod/main.
Ты не один в codebase; чужие правки сохраняются. SAFETY-RULES обязателен, guard mismatch → STOP.
Planning не разрешает install/Node test/source implementation; отдельный DESIGN_GO/root RELEASE обязательны.

## Scoped ESM wiring correction

Исходный actual baseline22/22 PASS. Первый per-case transition21/22 выявил cached ESM namespace tasks/queries, удерживающий закрытый Prisma proxy прошлого case. Guard FIXTURE_SCOPE_CLOSED сохраняется. Меняются только два import destructuring statements в work-shares-settlement: per-case real queries=scope.load("../src/server/tasks/queries"), затем const {mapTaskDetails}=queries. Query implementation настоящая, бизнес-assertions неизменны. Cachebuster/global proxy rebinding/разрешение stale effects не используются. До independent DESIGN_GO эти два source seam не меняются.

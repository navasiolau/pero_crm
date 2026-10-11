# Design

## Context

feature/161 от свежего d121f0798e963f32d13f52c9bde57c0aa82b7929. См. proposal; instruction/roots OpenSpec подтверждены.
Исходная инвентаризация без исполнения:
crm-byn-domain-payroll-actions:60lines/55nonblank/3tests/8inject calls;
work-shares-settlement:221/206/16/7;
file-pdf-view-route:29/27/3/2.
Итого310lines/288nonblank,22business test bodies,3implementations ручного injector; afterEach cleanup отсутствует.
Это текущая база, не baseline PASS. Production/src/package/schema/CI и161Node/test/install сейчас0.

## Goals / Non-Goals

**Goals:** Один helper, восстановление cache/globals после каждого сценария и prepare failure, реальный target import, явные guards неожиданных внешних вызовов, прежние22assertion bodies/Decimal/Enum/byte assertions.
**Non-Goals:** Общий mocking framework, четвёртая suite, перезапись business bodies, удаление исторических/SQL/migration guards, реальные network/Prisma/SQL/Next/stage effects или подмена DI доказательством PostgreSQL locks.

## Decisions

### One explicit owner scope

Новый apps/web/tests/helpers/guarded-module-cache.ts работает с owner createRequire и закрытыми overrides/target names конкретной suite. Неперечисленный specifier или внешний target отказывает до require/load.
Scoped API готовит overrides/globals и guard set, затем load настоящего target module; возвращает explicit restore. Hook beforeEach/afterEach назначает один отдельный scope на case. Helper остаётся import-inert.
Nested/parallel scopes в одном Node worker запрещены до эффекта; Promise.all внутри одного существующего case сохраняется. Test-file workers изолированы штатным Node runner.

Сохраняются prior require.cache entry identities и descriptors только заявленных globals. Для target/transitive modules, появившихся после scope load, фиксируются owned cache entries; restore удаляет только собственные новые entries и возвращает старые. Чужое изменение captured entry перед restore → refusal/failure, без перетирания. Restore idempotent, setup throw запускает cleanup; первичная ошибка сохраняется даже при null/undefined/false/0/empty-string rejection. Cleanup conflict не получает PASS.

### Declared imports and guards

Targets: payroll/actions; tasks/actions, tasks/share-actions иtasks/queries; app/api/files/[id]/route. Эти модули импортируются настоящими, их implementation не подменяется.
Existing override names:
- payroll: tasks/transaction, next/cache, server/require-role, plugins/changelog, plugins/events, notifications/notify, finance/queries, payroll/queries;
- work shares: src/auth, next/cache, products/revalidate, plugins/changelog, plugins/events, notifications/notify, payroll/queries;
- files: src/auth, lib/s3.
Все local specifiers остаются относительно owner suite, а не helper directory. Resolved filenames обязательны; ambiguous duplicate/unknown path не принимается.

Shared guard дополнительно обслуживает src/lib/prisma и @prisma/client. Настоящие enum/Prisma.Decimal exports сохраняются; cache export защищает только PrismaClient construction. Fixture database доступна через установленный fake prisma; unknown model/method call падает с явным UNEXPECTED_PRISMA_CALL до реального клиента. Никакой projection денежных типов или production source edits.
Network guard закрывает global fetch и Node connect/request entrypoints до сокета; descriptor snapshots восстанавливаются. Guards включаются после загрузки легитимных инструментов/Enum/Decimal и до target module load. Sharp остаётся реальным для PNG byte/dimension cases.
Mock effects проверяют active owner scope; call после restore отказывает. Неявное разрешение unmocked auth/S3/notifications отсутствует. Никаких HTTP probes ради проверки guard: original-effect spies обязаны остаться0.

### Suite migration preserves behavior

Меняются только fixture setup/teardown/import wiring и необходимые per-case default resets. Actions/routes остаются реальными.
Pay history/due/balance/writes сбрасываются к исходным defaults, Work fixture меняется через текущий dynamic proxy/closures, PDF visibility/sourceBytes/loggedIn/storageReads создаются заново. Все22case names/value assertions сохраняются.20callbacks имеют exact canonical AST; два callbacks tasks/queries допускают только AST-normalized import seam (dynamic import → текущий real scope.load binding), не произвольную нормализацию. Дополнительные helper cases отдельно размечены.
Один suite выполняет shared guard/cleanup/falsy/setup-error cases; другие подтверждают свои реальные positive/negative cases. Не добавляется отдельный generic helper test file и не дублируется одинаковая guard матрица везде.

### Verification and reduction

Перед source transition зафиксировать actual baseline22cases в отдельном разрешённом local slot, затем те же business cases, reorder/repeat и fault cases. Неизменённые body hashes/Names count дают keep evidence, а живые results подтверждают поведение.
LOC измеряется по source/helper/wiring/новым guards раздельно. Измеримый reuse —3injector implementations →1,17manual inject call sites →declared setup, preserved22bodies; total LOC может вырасти из-за новых safety guards, этот рост честно указан. Ни app performance, ни native lock credit не заявляются.
Пример последующего check: pnpm --filter @pero/web exec node --import tsx --test --test-concurrency=1 tests/crm-byn-domain-payroll-actions.test.ts tests/work-shares-settlement.test.ts tests/file-pdf-view-route.test.ts.
Install/frozen dependencies/typing/runtime slots только после отдельного root release. New helpers typed strict без необоснованного any.

## Risks / Trade-offs

- Guard захватил tool IPC → ограничить явные network entrypoints, сохранить stdio/esbuild/Sharp и доказать original external call counters0; не ослаблять protected target guard.
- Module closure удержала старый fixture → scope per case, owned target/transitive cache cleanup, active marker на mock effects; reorder/repeat proof.
- Global patch конфликтует → one active scope, descriptor identity checks и fail closed, без restore чужих writes.
- Реальный Decimal/Enum подменён → original exports сохраняются, existing value assertions unchanged.
- Новый helper разрастается → одна реализация fixture lifecycle/guard, только3consumer suites, никакого configurable plugin/mock engine.

## Migration Plan

Planning → independent DESIGN_GO/root source release → actual baseline/local meaningful guards/reorder/Node/typing/lint → CODE_REVIEW_GO → explicit root atomic commit161 → root normal merge staging/CI/accepted identity и relevant readonly runtime smoke.
No dump/restic/reset/seed/newDB/prod/main/warehouse_main init. SAFETY-RULES D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md обязателен; guard mismatch STOP, чужие edits сохраняются.

## Observed ESM cache and exact correction

Actual Node/tsx transition21/22 подтвердил stale namespace: engineering DTO FAIL FIXTURE_SCOPE_CLOSED в реальном mapTaskDetails. ESM namespace cache не принадлежит require.cache, его очистка не обещается. В beforeEach Work suite загружается настоящий tasks/queries через новый пятый fixed target; оба бизнес-case destructure mapper из текущего queries. Все вызовы/assertions/synthetic rows остаются прежними.

Proof обязан сравнить20exactcallback hashes,2explicit import-normalized hashes и все22names. Нормализатор принимает лишь ровно2исходных async import statements указанного exact specifier и ровно2новых current-binding statements. Новая negative ESM capsule сохраняет old namespace, closes owner, открывает fresh scope и доказывает old mapper refusal/new real mapper operation; не ослабляет guard. Ранее failure не получает PASS задним числом.

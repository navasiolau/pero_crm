# Independent core DI review (28.09.2026)

Scope: read-only review of `product-stage-pay/core.ts` and action wiring, plus new transaction-shaped in-memory DI tests. No PostgreSQL, migration, seed, HTTP runtime, browser, staging, production, commit, or deployment was run. The fixture models selected Prisma relation shapes and serializes supplied transactions with rollback; it is not native database proof.

## Confirmed findings and RED

1. **P1 first configuration**: `configureEngineeringPool` used a newly created pool without `works`; Prisma `create` returns only scalar fields unless `include` requests relations. RED: `first configure creates DRAFT with no works` failed at `assertDistribution` with `undefined.map`. Root changed `readContext` pool access to `.at(0)` and `ensureNewEngineeringPool` find/create to include `works`. Rerun green.
2. **P2 required task type**: `createEngineeringWorkCore` created the first Task without `type`, although ordinary task creation and the design require one. RED: first-work test found `undefined` instead of `Проектирование`. Root supplied that type and tightened due date and assignee checks. Rerun green.
3. **P2 semantic UUID replay**: conversion computed request fingerprint from raw `JSON.stringify(input)`. Replaying the same UUID with identical task mapping in another array order returned “Идентификатор запроса уже использован”. RED test reversed `taskShares` and reproduced this. Root normalized both work and task mappings by ID for the fingerprint, preserving full units/revisions. Rerun green.

## Green DI coverage

- First DRAFT enable through Prisma-like `include` shape; new work 100% weight and stage share, separate physical group, null monetary snapshots, required due date/estimate/type, DRAFT revision bump, inactive assignee rejection before writes.
- Legacy Work quantity 5 with tasks 2/3 maps explicitly to stage shares 80/20. Work/task IDs, physical quantity/group, old money snapshots, DONE state, assignee, time, files, and DAG are unchanged. Receipt captures old price and target shares. Same exact UUID replays without write; altered mapping is rejected.
- Two serialized close requests with the same UUID create exactly one settlement, two shares, two PayrollEntry rows, one status history, receipt, and outbox event. A new UUID after advancement is rejected. The fixture verifies 500 BYN × 5% = 25 BYN distributed 20/5.
- Injected exceptions after share, payroll, and history writes restore the entire transaction state. Changes to price, rate, payroll currency, task revision, and task status after quote preparation are rejected before writes.

Latest `pnpm --dir apps/web exec tsc --noEmit --pretty false`: pass. Latest `pnpm --dir apps/web exec eslint tests/product-engineering-integration.test.ts tests/helpers/product-engineering-integration-fixture.ts`: pass. Combined `pnpm --dir apps/web exec tsx --test tests/product-engineering-integration.test.ts tests/product-engineering-core.test.ts`: 22/22 pass.

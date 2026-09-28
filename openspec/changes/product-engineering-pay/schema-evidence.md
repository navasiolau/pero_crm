# Product engineering pay schema evidence

## Scope and relation names

Prepared only the schema and one unapplied additive migration from design §9 and the accepted `universal-work-shares` spec. Stable Prisma models/table names are `ProductStagePayPool`, `WorkPaymentConversion`, `ProductStageSettlement`, and `ProductStageSettlementShare`; generated client delegates are `productStagePayPool`, `workPaymentConversion`, `productStageSettlement`, and `productStageSettlementShare`. New enums are `ProductPayStage`, `ProductStagePayState`, `WorkPaymentKind`, and `TaskAllocationBudgetSource`.

## Preservation and guards

- Existing `Work.priceSnapshot`/`total` become nullable without changing values. Work defaults to `LEGACY`; the CHECK requires legacy money fields and forbids legacy pool/weight fields. ENGINEERING requires product, pool, and weight. Pool weight and Task stage share units are bounded to 0..1,000,000.
- `TaskAllocationGroup.budget` becomes nullable and `budgetSource` defaults to `TASK_FIXED`. Existing rows stay fixed-budget. `STAGE_PREVIEW` requires work, positive quantity, and null budget/currency. No partial unique Work index was added.
- `Task_allocation_complete` is replaced with explicit `IS NULL`/`IS NOT NULL` branches. Legacy rows preserve their existing physical units and amount requirement. A grouped row may use a non-null nonnegative fixed amount or a null amount with an explicitly non-null stage share. The CHECK avoids nullable `UNKNOWN` acceptance.
- A protected pool requires a project ID, nonempty legacy payroll IDs with no null elements, timestamp, and null rate; other states have no legacy metadata. The sole data INSERT creates deterministic product-specific protection rows using actual `PERCENT_PROJECT` payroll entry IDs. It does not rewrite legacy payroll, task quantities, money snapshots, schemes, roles, or passwords.
- Settlement and conversion records use RESTRICT FKs and append-only triggers. Only new PayrollEntry rows with a settlement share are immutable; legacy entries remain mutable under existing behavior. Currency/rate and nonnegative amount checks follow the approved design.

## RED/GREEN and local validation

The new static test was run before schema/DDL edits: 0/4 passed, failing on absent enums/models and absent migration. After implementation, `pnpm exec tsx --test tests/product-engineering-schema.test.ts` passes 4/4; `pnpm exec eslint tests/product-engineering-schema.test.ts` and `git diff --check` pass (Git printed only LF/CRLF advisories for working files). `prisma validate` passes and `prisma generate` completed with `DATABASE_URL=postgresql://unused:unused@127.0.0.1:1/not_used`; these commands validate/generate locally and do not connect to a database. No SQL, migration, app runtime, seed, browser, SSH, commit, or push was run.

## Boundary

This evidence proves Prisma schema validation/generation and static source invariants only. The SQL has not been applied or tested by PostgreSQL. Root must review the migration and separately authorize any future application; no production or staging action is implied.

## Follow-up DDL review

Root review found three static issues; new RED checks first reproduced all three (the earlier four checks stayed green). The Work pool and PayrollEntry indexes now follow their `ADD COLUMN` statements; static ordering guards cover those indexes and every index on the newly created pool, settlement, and share tables. `ProductStageSettlementShare.stageShareUnits` now permits 0..1,000,000 while physical `quantityShareUnitsSnapshot` remains 1..1,000,000; zero financial shares are valid. Payroll settlement rows now require nonnegative, non-NaN `amount`, `bynAmount`, and `projectAmount`, plus supported `currency`/`projectCurrency`. Settlement and settlement-share numeric snapshots explicitly reject PostgreSQL `NaN`; exchange rates must be positive and not NaN. Added tests reproduced failures before SQL edits; afterward the static suite passes 7/7, ESLint and `git diff --check` pass. No database was contacted.

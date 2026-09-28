# Engineering core and CRM consistency evidence (2026-09-28)

Scope: `apps/web/src/server/product-stage-pay/{core,actions,post-commit,preview,quote}.ts` and `apps/web/tests/product-engineering-core.test.ts`.

- Initial TDD began with failing imports and missing task-share API; later review tests were red for the exact ledger scheme, paid Work/Task guard, standard audit/outbox types and notifications before implementation.
- `pnpm exec tsx --test tests/product-engineering-core.test.ts tests/product-engineering-completion.test.ts`: 23 passed. DI tests cover role and revision gates, null/zero rate, explicit Work/Task allocation, already paid PIECE Work/Task rejection, FX fingerprint invalidation, zero-fund settlement, idempotent replay, exact `PRODUCT_ENGINEERING` scheme, complete transactional write set and exact `payroll.accrued`/`product.statusChanged`/`product.engineeringSettled` event types. Completion tests cover absence of PIECE for ENGINEERING.
- `pnpm exec tsc --noEmit --pretty false`: passed. Scoped ESLint on core/actions/post-commit/tests passed without warnings.
- No database, migration, SSH, browser or hosted runtime was used. DI tests establish call order and guards, not PostgreSQL concurrency or rollback behavior.

Configuration writes ChangeLog old/new rate, Work weights and Task shares with IDs and revisions in the same transaction. Compound Work/Task creation writes both create logs and `task.created` plus `task.assigned` outbox events. Settlement writes positive payroll lines, per-recipient `payroll.accrued` events with numeric JSON amount, ordinary product status audit/event, the engineering receipt and settlement event in one transaction. Actions invoke plugin dispatch and standard task/status/payroll notifications after the transaction; failed notification delivery does not change the committed result. Repeated close receipt sends no events or notifications.

# ACL and task integration evidence (28.09.2026)

Scope: code and unit/DI checks in isolated worktree. No database, migration, seed, runtime, browser, staging, production, commit, or deployment was run.

## Access rule

`resolveVisibilityActor` reads current ENGINEERING task assignments and grants participant product IDs only when Task.productId, Work.productId, Task.projectId, Work.projectId, and Product.projectId match. It also records verified task IDs for execution. No role or pay scheme is required for a participant, and a zero stage share does not remove membership. Product/project/work/file/technical predicates apply the participant grant only to DESIGN products. Manager/accountant/field grants remain separate. The resolver runs inside the shared task transaction for split and completion, and at entry to read queries, upload validation, notifications, time, and relevant actions. The root owns the page and product action callsites and was given the resolver contract.

The engineer filter is primary engineer OR verified ENGINEERING participant, including products in later statuses; ordinary visibility still scopes what a non-manager can see. Both product and project filters use the verified IDs rather than a relation that could accept inconsistent Task/Work links.

## Task guards and DTO

Ordinary create/update/delete actions reject ENGINEERING Work/tasks, leaving financial allocation to the stage-pay flow. Split and completion run under `withTaskTransaction`, resolve membership there, and increment the DRAFT pool revision in that transaction. A settled or non-DESIGN pool fails before the task mutation commits. ENGINEERING recipients may have any role combination or none, subject to active status and DESIGN. Legacy recipient behavior remains unchanged.

`mapTaskDetails` emits `paymentKind`, physical and financial units, preview amount/currency/reason, and settled source. It never calls `taskPieceAmount` for ENGINEERING. Split options expose the same source and separate financial preview. `engineeringPreview.workAmount` sums server-computed task previews in cents, with the entire sibling stage-share vector, so the UI can recompute largest remainders after simulated split. An FX/config failure yields a reason and null preview bundle without blocking the physical/financial split.

## Verification

- `pnpm --dir apps/web exec tsx --test tests/product-engineering-access.test.ts tests/product-engineering-split.test.ts tests/product-engineering-completion.test.ts`: 18/18 passed. The new access tests cover invalid cross-product/project links, no-role/zero-share membership, DESIGN gating, manager/field grants, active recipients, DONE/paid split guards. Completion also tests settled-pool and inconsistent-link rollback plus one revision bump on duplicate completion.
- `pnpm --dir apps/web exec tsx --test tests/engineer-access.test.ts`: 15/15 passed (run in the combined earlier command).
- Initial split/completion run after adding pool revision checks failed because the in-memory DI fixture did not implement `ProductStagePayPool`. The fixture now models the DRAFT pool/revision and the tests set explicit pool IDs. The later strict context check also exposed a missing nested pool product in the fixture; this was corrected and 15/15 split/completion scenarios passed.
- `pnpm --dir apps/web exec tsc --noEmit --pretty false`: final rerun exited 0 after the root-owned UI nullability fixes landed.
- `pnpm --dir apps/web exec eslint src/server/access src/server/tasks src/server/products/queries.ts src/server/projects/queries.ts src/server/files src/server/time/actions.ts src/server/communications/actions.ts src/server/clients/actions.ts src/server/warehouse/queries.ts tests/product-engineering-access.test.ts tests/product-engineering-completion.test.ts tests/helpers/task-share-fixture.ts`: exited 0.

No live PostgreSQL race, direct HTTP, or browser checks were performed; those remain separate acceptance gates.

# Release coordination — approved scope, result check pending

Owner's explicit approval on 01.10.2026 covers exactly three functions: `universal-work-shares` (`614ec23`), `manager-cash-advances` (`3f6da0d`), and `product-hero-images` (`c3c58a0`). It supersedes the 28.09.2026 staging-only HOLD for this exact set. It does not claim this release candidate has been pushed or deployed.

The source feature revision `614ec23128de83f16833a56443354c2707e87c60` passed local and staging acceptance; see [evidence](evidence.md), [local receipt](local-acceptance.json), and [staging receipt](staging-acceptance.json). These receipts do not establish acceptance of the selective backport candidate in the release branch. Root completed local checks for the release candidate and is expected to push it to main. A feature-branch push alone does not trigger CI: main CI runs its test gate, successful gate publishes the image, and the normal watcher deploys it. The owner explicitly accepts production result verification. No production SQL, SSH, runtime read, or result check was performed for this release.

## Rollback source checkpoint

Root created and pushed annotated Git tag `codex/pre-crm-three-features-20261001` at exact old-main revision `2cac6f3c3fa83ef9eac8a43dde6d9a7524951480`. This is a source-code checkpoint only, not a database/storage backup or a verified current production image.

Root confirmed old-main `apps/web/src` and Prisma schema match the previously accepted production-functional source baseline `a1123c5`; the difference from that baseline is docs/QA tooling only. This is source comparison information, not a current production server check.

## Migration

The universal work shares migration is [20260928140000_universal_work_shares/migration.sql](../../../apps/web/prisma/migrations/20260928140000_universal_work_shares/migration.sql), SHA256 `65058910bdeec05482a9881c4f83a015cd1e86c32e0ffc352278ac3aa378f0a6`. It is additive: creates `TaskAllocationGroup`, adds nullable allocation snapshot fields and `splitRevision` defaulting to 0, and adds indexes/checks/FKs. Its SQL has no UPDATE/DELETE or backfill of existing tasks, work, payroll or payouts. The second release migration is `20260929120000_manager_cash_advances`; hero images have no migration.

## Rollback behavior

Before any new allocation-group or cash-advance records are written, returning to old code while retaining the additive migrations is expected to be safe. After such records exist, old code is unsafe: it can miscalculate split allocations and overstate cash available because it does not understand the new records and rules. Preserve compatible readers and calculations; if writes need to stop, use a compatible forward-fix that disables new writes or another forward correction. No feature flag is currently claimed to exist. Do not drop/downgrade migrations, delete data, or claim a whole-database rollback is safe.

The owner performs production result verification after the normal main CI/watch deployment. This document does not report that verification as done.

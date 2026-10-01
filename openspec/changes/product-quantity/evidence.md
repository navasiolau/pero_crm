# Evidence

## Baseline

- Рабочая копия: отдельная managed worktree product-quantity.
- Ветка: codex/product-quantity; база — origin/staging a899e8e679a6a7d97674ee6250fa84e6cafb0424.
- В базу включены product-percentage-pay, universal-work-shares и общий task allocation lock.
- Исходная папка D:/Projects/pero_crm_v2 и её незакоммиченный CRM_IMPROVEMENTS_PLAN.md не изменяются.
- Main не является целью push/merge/deploy.

## TDD

- RED: tsx --test tests/product-quantity.test.ts — 12 сценариев, 4 PASS / 8 FAIL на сохранённом поведении без множителя. Например, 200.00 вместо 1000.00; дробные нормы и общий объём также не умножались.
- Новые сценарии: сумма партии/услуг, точность, null/zero, валидация, единичный процент, сдельная партия, допустимое/запрещённое уменьшение и групповое распределение.

## Acceptance

Реализация и проверки продолжаются. Результатов миграции, native UI, live партии и staging пока нет.

## Local acceptance — 01.10.2026

- GREEN: 543 web tests; TypeScript passed; ESLint 0 errors (1 existing warning in cleanup-uploads.ts); production build passed.
- Guarded local migration: exact existing pero_crm_pg bf45c761... / 127.0.0.1:5433 / pero_crm. Only product_quantity pending. Consistent pg_dump with exported snapshot; archive TOC checked, not a restore test. Pre/post fingerprints of all 42 business tables match; all old Product quantities = 1, normal Work/ProjectMaterial norms match previous totals.
- Native password login on two scoped QA accounts; createProduct via UI produced one chair card quantity5, unit price200, batch1000. Both boards and details checked at 360/390/1440; table quantity sorting and project1100 with delivery100 checked.
- Native addWork norm1 → qty5/budget150; material norm4 → need20; issue8/return2. Qty6 → work6/budget180, need24; reductions below allocated volume/issued fact reject without partial changes.
- Native ENGINEERING 5% captures unit price200, fund10; quantities6/5 preserve completion and PayrollEntry. Physical group volume4 counted once for two participants; 70/30 budgets84/36; first completed participant receives actual PayrollEntry84. Quantity changes preserve this entry.
- Native existing-data validation: 1307 Product rows including 2 QA; all prices/counts valid, no negative StockMovement quantities. Two-connection DB test proves Product lock wait, rejection of need16 below temporary issued18, no partial Work updates; both test transactions rolled back.
- QA cleanup first hit existing append-only protection; full transaction rolled back. Existing engineering QA approach applied: exclusive table locks, only three named immutable triggers suspended inside one transaction, restored with identical definition/enabled hash before commit. Exact manifest cleanup deleted97 owned rows; all42 original tables match, triggers restored exactly.
- Mobile visual review identified pre-existing project tab label overlap; this touched screen now uses horizontal tab scrolling. Updated visual captures follow before staging release.

## Staging preflight

- Existing crm-staging / database volume crm-staging_pgdata / isolated S3 bucket pero-crm-staging verified through the reviewed W07 guard. No production connection.
- Baseline revision a899e8e679a6a7d97674ee6250fa84e6cafb0424; protected native dump1452417 bytes and fingerprints42 tables retained before deployment. Baseline run596a419b-af6c-4fcb-8a6e-5afd5afc63b5.
- Production/main remote ref recorded read-only: 7c51972d4264bd10fb779638cc94c13d6533d6b7. No main push or production migration.
- Deployment and native staging acceptance are pending.

## Final local gate

- 543/543 web tests and 9/9 bot tests; TypeScript web/bot pass, ESLint no errors, Next production build pass. Deploy safeguards:66 tests pass, 2 existing skips.
- Second native run after responsive tab fix: all create/boards/details/work/material/recalc/percentage/group/accrual/return/table/project scenarios PASS; zero page errors. Mobile labels no longer overlap. Visual screenshots inspected; 5 chairs200, batch1000, delivery100, project1100.
- Second rolled-back lock race PASS; no partial writes. Second exact QA cleanup deleted81 own rows; all42 previous tables and three trigger definitions/enabled states match. First run's97 rows were also cleaned with the same guarantees.

## First staging run / necessary corrections

- ebdb055 deployed and healthy: image sha256:01e5fc169083b9a4142cfd5ea0a74576f5b6d20b4adcef850b5e39e2dec430c2, started2026-10-01 10:40:12 UTC.
- Preflight stopped before QA on an ApiToken fingerprint difference. Read-only extraction of ApiToken COPY from the original dump proved all3 IDs/scopes/hashes/creation/revocation fields exact; only lastUsedAt of one existing identity changes under background API use. Full original baseline retained. Protected-field projection added to QA; no ApiToken data is edited/restored by tests.
- Native staging functionality PASS: real password login via HTTPS Basic Auth, create5 ×200, mobile boards/detail, normal work5/budget150, material20/issue8/return2, atomic q6 and lower-bound rejection, actual percent10 and piece PayrollEntry84 preserved, shared physical allocation4 counted once, table sorting and project1100.
- Three React418 hydration errors surfaced on timestamp-bearing UI. Linux SSR UTC and desktop browser Europe/Moscow formatted the same dates differently; a shared explicit Europe/Moscow datetime formatter now keeps the existing user-visible time consistent. New UTC/Moscow regression PASS; web tests544/544, TypeScript/lint pass; rebuilt image awaiting staging retest.
- Existing one QA set on staging is retained for bounded resume, not duplicated. W07 window released after stop; no cleanup or history edits claimed yet.

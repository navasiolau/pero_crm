# Tasks

## 1. Согласование и baseline

- [x] 1.1 Согласовать с Root allowlist и one-pass Map дизайн, проверить OpenSpec strict; до GO production-код не менять. Охват: queries.ts, один summary-read-model.ts, preview settleAll в actions.ts и композиция finance/payroll/page.tsx после auth.
- [x] 1.2 После Root quiet-release подготовить own frozen dependencies/source-only Prisma generate при необходимости; выполнить существующие BYN/payroll/combined-role/engineering/cash-mixed-writers/month suites и сохранить actual current result (47PASS); before-source baseline из old WIP не заявляется. Новых БД, reset/seed/dump не выполнять.
- [x] 1.3 Сохранить oracle прежних payroll selectors/группировки и измерить same-snapshot baseline actual Prisma SQL-count на existing5433 с exact target guards и единым read-only snapshot; результаты и source/delegate counts разделить. Запуск согласовать с Root отдельно от planning.

## 2. Линейные чтения

- [x] 2.1 Реализовать один typed Map-агрегатор с exact Decimal/unknown/hasRows, fixed employee/period buckets и отдельным global payout accumulator. Проверить смешанный oracle: BYN, saved foreign, unknown, explicit0, signed adjustments, missing currency fallback, empty/present0, HALF_UP, неизвестность вне selected. Детерминированно подтвердить O(R+U) row visits и отсутствие U×R filters; данные вне requested selectors не конвертировать.
- [x] 2.2 Заменить private aggregate/group helpers и устранить повтор selected reads getMyPayroll. В FinancePayrollPage переиспользовать один scoped readonly snapshot с проверенными month/user keys, сохранив предварительный auth, user membership/order, details/creators/DTO/CSV. Проверить standalone и shared-input parity/query-count, personal scope, NONE/deactivated/combined roles и current/past/future periods; aggregate history inputs страницы читать ровно2раза, без global cache.
- [x] 2.3 В settleAll создавать свежий preview перед каждым debtor и переиспользовать inputs только внутри одной итерации. Сохранить свежие org/cash/debt reads, executeCashPayout/core locks/limits/receipt и partial-result semantics. Проверить interleavings между выплатами, недостаток денег/unknown/частичный успех и неизменный guarded writer; ни одному следующему debtor не передавать старый snapshot.

## 3. Проверки и доставка

- [x] 3.1 Выполнить прежние suites плюс новые meaningful aggregate/preview regressions, TypeScript strict, scoped ESLint и OpenSpec strict; source diff подтверждает отсутствие schema/migration/history/FX/UI/ACL/core-lock changes.
- [x] 3.2 На existing5433 выполнить ROOT-approved OWN4 rollback native BEFORE/AFTER DTO/Decimal/null parity и actual Prisma SQL-count, только createMany own UUID fixtures в singleRR/sentinelrollback, безoriginalDML/paymentwriters/settlements; сравнить same snapshot/versions и private outputs без PII. Записать сокращение повторных history reads, отсутствие зависимости SQL-count от U, bounded10× benchmark timings и честный LOC/JS delta без обещания deployed bundle savings.
- [x] 3.3 Получить независимое review и Root commit GO, создать атомарный commit задачи. До Root integration обеспечить staging-приёмку131; Root ordinary merge/CI и actual staging SHA/image/health плюс finance/personal/CSV/preview сценарии подтверждают завершение149. Main/production запрещены.

Actual local6239015c PASS: old selectors8→shared2, fullfinance14constant,160→1600native parity, all64/schema b373same/OWN0/source94cd/awaitedclose. IndependentFINAL+ACTUAL_GO получен; stage pending. Atomic commit включает only4prod+4existingtests+6ownOpenSpec paths.

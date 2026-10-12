# Design

## Context

Мотивация и scope — в proposal.md. На базе d121f079 groupPayroll/groupPayout вызывают rows.filter для каждого userId. FinancePayrollPage независимо запрашивает summary, dues и listPayrollUsers, причём последняя вновь читает dues. Это повторные чтения, не N+1 внутри группировщика. Статические29 Prisma delegate calls всей страницы не равны измеренному SQL-count: include может добавить SQL. Baseline и native evidence ещё не выполнены.

## Goals / Non-Goals

**Goals:** один проход по каждому набору history для фиксированного числа периодов, переиспользование readonly request inputs, точные прежние DTO/unknown flags и свежий preview каждой выплаты. Сохранить Decimal до прежних границ округления, финансовые данные и права.

**Non-Goals:** SQL aggregation/новый query framework, глобальный cache, изменение cash-core/locks/limits, FX/reconversion истории, schema/migrations, CSS/видимые строки UI, данные пользователей или infrastructure. Передача raw rows остаётся O(R), карта сотрудников O(U).

## Decisions

1. **Один узкий Map-агрегатор.** summary-read-model.ts принимает типизированные payroll/payout rows и выбранный/current month; создаёт только нужные buckets: selected accrued/paid/advance, past accrued, current estimate, selected PERCENT_TURNOVER, all payouts. Для каждого bucket хранятся exact Decimal sum и unknown/hasRows; absent=0, present unknown=null, present0=0. historicalByn из неизменного lib/history-byn.ts остаётся единственным конвертером доказанного эквивалента. После unknown bucket не читает поздние суммы, сохраняя fail/short-circuit смысл прежнего sumHistoricalByn. Одни и те же строки могут входить в фиксированные overlapping periods; это O(R), не фильтрация истории по каждому сотруднику.
2. **Прежние денежные границы.** Saved bynAmount != null, включая0, побеждает; иначе явный BYN из currency/payrollCurrency, иначе unknown. Signed adjustments включаются. Каждая employee/period сумма округляется HALF_UP до2 перед прежним subtractByn. Итоги summary остаются sumByn отображаемых rows. Global payout total складывается отдельно из исходных Decimal, не из округлённых employee totals; unknown любой глобальной строки делает org balance unknown. Existing turnover accruedAmount absent остаётсяnull, тогда как zero known остаётся0. Причины недоступности неизменны.
3. **Явные request inputs.** FinancePayrollPage после прежнего auth/FINANCE_ROLES/month validation один раз читает typed input snapshot и передаёт его readonly summary/dues/estimates/turnover/listPayrollUsers/orgBalance. Не вводится cache, memoization уровня процесса или React cache. Keys selected/current/userScope проверяются при передаче; персональный read ограничен session userId. Старые export signatures/обычные самостоятельные вызовы сохраняются. Подробные payout rows, creators, sort и membership active/scheme/settlement/debt остаются прежними. При неизвестном эквиваленте membership и hasRows нельзя вычислять из суммы0. В getMyPayroll selected totals берутся из уже прочитанных detailed rows, остальные суммы — scoped input.
4. **Fresh payment preview.** Начальное чтение debtors сохраняет порядок. Перед КАЖДЫМ debtor создаётся новый scoped payroll/all-payout input, заново читаются org payments и cash balance; snapshot используется только внутри этой одной preview-итерации, затем отбрасывается. Не вычитать выплаты из старого начального остатка. executeCashPayout и issuePayoutCore по-прежнему читают актуальные данные под теми же locks и проверяют debt/org/cash ceiling, receipt/rollback. Успех, неизвестный исход и конкурирующий writer не позволяют reuse preview следующего debtor. На early unknown соблюдаются прежние partial result/error/shortPaid semantics. Пустой или отсутствующий debtor сейчас due0.
5. **Небольшой производственный allowlist.** queries.ts заменяет private aggregate/group helpers и добавляет optional internal read-input reuse; один summary-read-model.ts; actions.ts меняет только preview композицию settleAll; finance/payroll/page.tsx меняет только получение данных после auth. cash-core/service/transaction, lib/history-byn/payroll-month, API/DTO/UI/CSV не меняются. SQL остаётся через прежние Prisma delegates, без rawSQL. Test scope — existing payroll/history/cash suites, один aggregate parity/query-count test и малый readonly native runner на прежних helpers/guards, без нового QA protocol.
6. **Измерение отдельно от обещаний.** Baseline/AFTER используют frozen old algorithms: historicalByn/sumHistoricalByn/subtractByn и прежние grouped selectors. Deterministic access counter подтверждает один row visit на source pass вместо U×R; bounded 10× volume сообщает measured timings/version/input size, без flaky speed-only gate. Для finance request целевой payroll/payout aggregate history read-count2 вместо повторных чтений; actual Prisma query events отдельно показывают SQL-count, отсутствие роста с U и сокращение повторов. Standalone summary/dues/getMyPayroll/settle preview имеют собственные counts. Native readonly existing5433 сравнивает DTO/Decimal/null с oracle на том же снимке; без DML и без сравнения разных времён. Future/current/past/unknown outside selected, explicit0, negative/positive adjustments, currency fallback, SALARY/ADVANCE, NONE/deactivated/DIRECTOR и rounding edge cases проверяются fixtures.

## Risks / Trade-offs

- [Большая raw history остаётся в памяти] → линейная однопроходная обработка с узким select; память O(R+U) честно зафиксирована, SQL aggregation вынесена за scope.
- [Reuse ошибочного month/user scope] → request inputs имеют явные period/user keys; недопустимая комбинация отклоняется, персональные чтения не используют общую finance history.
- [Устаревший preview или unknown смешан с0] → новый DB read перед каждым debtor, nullable amount + hasRows; денежный core неизменен и interleaving tests обязательны.
- [Сумма групп меняет rounding/global total] → independent old-helper oracle, отдельный точный global payout accumulator и тесты пограничных Decimal.
- [DI count выдан за SQL] → native Prisma query events и сценарии, результаты делятся на unit/delegate/actual SQL; до выполнения runtime evidence не закрывать пункт.

## Migration Plan

Миграций нет. После scope GO, local parity/checks и независимого review Root делает ordinary merge в staging только после приёмки131. Root проверяет фактически развёрнутый SHA/образ/health, finance/personal/CSV DTO и fresh settle preview. Main/production в этой задаче запрещены. Статус задачи остаётся pending до staging evidence.

## Current native acceptance variant

Existing payroll-month-native.ts reuses sharedtarget/snapshot/verifiedRollback. Source-onlyOWN4 proposal and exactpins/PK/method scope are in evidence.md; required Root/inert review before a freshONE. Actualread-only query code executes on legitimate own rollback fixtures; the historical readonly-only preparation below is not execution approval. No original mutation/schema/paymentwriters/settlements/outbound.

## Actual variant acceptance

Root-approved OWN4 ROLLBACK6239015c passed8→2actualselector reads/finance14constant, native160→1600parity and b373all64schema/OWN0/source94cd/clientclosed. Independent FINAL_CODE+ACTUAL_LOCAL_GO accepted. Earlier readonly-only planning is historical. Staging149 pending.

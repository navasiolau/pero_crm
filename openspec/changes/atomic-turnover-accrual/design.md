# Design

## Context

Базовый SHA4b6c2b92f9bc77deaddc5b8cc6e18a4e7a165847, веткаbugfix/130 вD:/Projects/pero_crm_worktrees/improvements-131. №131 уже интегрирована обычным merge в staging, её pure month contract используется. Старая action читает/пишет деньги вне общей транзакции; схема допускает отдельные законные top-up строки. Нативная защита требует настоящих независимых SQL-коннекций. См. proposal/specs.

## Goals / Non-Goals

**Goals:** атомарный финансовый core без Next или внешних эффектов; один Decimal-reader для UI/core; сохранение общего lock и рабочего поведения.

**Non-Goals:** обязательный command UUID/receipt134, общий ACK протокол133, переезд transaction adapter150, оптимизация сводок149, миграции/FX/исторические преобразования, UI изменения.

## Decisions

1. Новый leaf `payroll/turnover-query.ts` принимает month и explicit payment database, возвращает Decimal BYN aggregate/count/полуоткрытые границы. `queries.getMonthTurnover(month,db)` делегирует ему и сохраняет существующий number DTO. Новое ядро не преобразует сумму или процент в JS number до Decimal-арифметики; сохранённая денежная строка и audit amounts точны. Это сохраняет один SQL filter activePaymentWhere, не повторяет month logic.
2. Новый `payroll/turnover-core.ts` принимает trusted DomainActor/month/TaskTransaction. Проверяет FINANCE_ROLES и прошлый канонический month до DB; внутри переданного existing transaction перечитывает turnover, active PERCENT_TURNOVER users с текущими roles/payPercent, prior same-month scheme history. Вся unknown BYN история проверяется перед writes. Положительные deltas создаются последовательной короткой транзакцией; при любом throw все сотрудники команды откатываются.
3. Transaction adapter остаётся прежним:18435/55001,ReadCommitted,maxWait5s,timeout15s. Разделение locks по месяцам/пользователям и UNIQUE(userId,month,scheme) запрещены этим change. Первый вариант job вне lock воспроизводит defect; Serializability без общего lock добавляет ретраи и не сохраняет mixed-writer контракт.
4. Каждая новая payroll row получает audit с реальным row ID и snapshot(границы, totalByn,count,percent,prior,expected,delta), а event payload сохраняет прежние поля плюс payrollEntryId. Новые basis суммы не рассылаются сотрудникам/плагинам сверх прежнего payload. История записей не меняется; schema не нужна.
5. Action сохраняет `accrueTurnover(month)` и `{ok,error,accruedCount}`; вызывает core через withTaskTransaction. После подтверждённого commit вызывает прежние уведомления и dispatch outbox. Каждый post-commit эффект изолирован от ответа; cache exceptions тоже не скрывают подтверждённое начисление. Неподтверждённый commit не объявляется успешным; общий unknown-outcome/retry интерфейс остаётся133. Receipt/UUID здесь не требуется: stale read устранён reread под общей блокировкой, и повтор проверяет положительную дельту по актуальной истории. Десять команд считаются независимыми вызовами, без искусственной новой UUID-схемы.
6. Existing tests адаптируются к transaction/DB delegates вместо удаления assertions. Добавляются deterministic concurrency, fault-at-payroll/audit/outbox, unknown/history, live rate reread и post-commit regressions. Native test запускается только после отдельно reviewed protocol и root GO; default dry-run не подключает БД.

## Exact allowlist

- apps/web/src/server/payroll/turnover-query.ts (новый)
- apps/web/src/server/payroll/turnover-core.ts (новый)
- apps/web/src/server/payroll/actions.ts (только accrueTurnover wrapper/связанные imports)
- apps/web/src/server/payroll/queries.ts (только делегирование turnover reader)
- apps/web/tests/turnover-accrual.test.ts (новый concurrency/atomicity/action-effects test)
- apps/web/tests/turnover-accrual-native.ts (новый reviewed guarded runner)
- apps/web/tests/combined-engineering-turnover.test.ts (adapter, прежние assertions сохраняются)
- apps/web/tests/crm-byn-domain-payroll-actions.test.ts (adapter, прежние assertions сохраняются)
- apps/web/tests/payroll-month-writers.test.ts (adapter,131 assertions сохраняются)
- openspec/changes/atomic-turnover-accrual/*

## Native protocol to review before SQL writes

Две реальные коннекции должны видеть подтверждённое первое начисление. Полностью rollback-only positive job не даёт этого свидетельства, поэтому native протокол требует временно committed owned fixtures/results и последующего exact cleanup. Это отдельный gate: реализация runner не разрешает его исполнение.

- Existing local target только через existingLocalCrmDatabaseUrl, exact verified containerID/running/bind127.0.0.1:5433/dbpero_crm/userpero. Schema/guard mismatch—STOP, без seed/migration/new DB/dump/restic. Принимается эксклюзивное native окно оркестратора.
- Перед setup read-only snapshot защищённых tables/constraints и guard: нет outside eligible payees и нет outside active INCOME выбранного прошлого периода. Если реальные кандидаты/обороты есть—STOP; не менять их ради QA. Никаких remote/prod targets.
- Owned runId UUID; actor ACCOUNTANT/NONE и payee MANAGER/PERCENT_TURNOVER3%, одна QA касса и приход10000 с exact IDs, disabled-login credentials, без web/bot/outbound calls. Зафиксировать created IDs и pre/post captures без PII/секретов.
- Два отдельных PrismaClient используют createTaskTransaction, десять independent core calls одновременно. Проверить one positive300 payroll + matching audit/outbox, затем отдельный owned income2000→60 top-up; повтор/снижение не переписывают original300. Raw/core effects не отправлять внешним получателям.
- Fault injection payroll/audit/outbox использует настоящую transaction с savepoint/forced throw и owned-only write delegates. При failures проверить no partial owned row set/fingerprints; unknown outcome требует capture/STOP, не слепого повтора.
- До cleanup проверяются exact owned rows/refs/actor/month/event payload IDs и отсутствие unexpected effects. Только reviewed exact IDs удаляются в одной transaction; no broad prefix/other real rows. Перед/после fingerprints всех protected original rows совпадают; при anomaly STOP и state/evidence сохраняются для root, без автоматического восстановления/широкой очистки.
- Если local runtime имеет активный outbox worker/другие writers, не останавливать неизвестные процессы: native gate отклоняется и докладывается root. Staging отдельная приёмка actual SHA/health/roles/clock/same query+rollback-only core smoke с guarded data policy; local concurrency не выдаётся за hosted runtime.

## Risks / Trade-offs

- [Вся команда держит общий lock до окончания short DB writes] → никаких внешних эффектов внутри, заданный timeout сохраняется, bounded candidates/native checks и measurement.
- [Unknown BYN либо fault после первого сотрудника] → upfront validation + единая transaction, fault cases на вторую строку тоже проверяются.
- [Temporary committed native data] → отдельно reviewed root gate/exclusive window, exact owned manifest/capture/cleanup, нулевая persistent fixture разница; при mismatch STOP. Без этого native критерий остаётся NOT_RUN.
- [Stale role/rate изменились до lock] → reread внутри tx; audit сохраняет фактически использованную ставку/базу. Настройки/history не переписываются.

## Migration Plan

Schema/migration отсутствуют. Local RED→GREEN, typing/lint по координации, native только reviewed GO, независимый code review, atomic commit, обычный merge в staging и фактическая приёмка. Main/production запрещены. При необходимости вернуть приложение на прежний совместимый образ без восстановления старого dump поверх новых данных.
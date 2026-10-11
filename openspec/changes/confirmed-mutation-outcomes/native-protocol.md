# Native protocol133

Worktree D:/Projects/pero_crm_worktrees/improvements-133, bugfix/133, base cd38cb745759becd58dbbad4d6d37afa03f0ab7a. Runner apps/web/tests/mutation-outcomes-native.ts. RunId d2a3378e-4798-42b8-821b-6130a01b848b. Один root-approved local запуск завершён NATIVE_PASS, session73839/exit0. Это local SQL proof; staging133 NOT_RUN, новые коммиты HOLD.

## Approval and target

До independent PROTOCOL_GO и нового root EXECUTE_ONCE допускался только --describe. Настоящий запуск использовал root-owned JSON с operation=execute, точными runId/sourceHash/containerId, exclusiveLocalWindow=true/localOutboxInactive=true и независимым актуальным наблюдением root04:34:17Z: нет Next/listener/queue runtime/5433clients, dispatcher flag отсутствует. Один env flag не считался доказательством. Все остальные DB/DDL/runtime writers были HOLD.

Точная существующая цель: pero_crm_pg, container bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5, running,127.0.0.1:5433, database pero_crm, user pero. existingLocalCrmDatabaseUrl сверил Docker identity/port/DB/user, credentials остались в памяти. Runner проверил actual SQL identity, ветку/base, отсутствие dispatcher flag и exact enabled plugin IDs ['file-stages']; закреплённый registry не регистрирует этот ID/hook. Любое изменение этих условий — STOP. Plugin state/config не менялись.

Закреплены66источников: физический esbuild production closure task/payment core+transaction+registry, runner/target guard, schema/config/packages/lock, own Prisma runtime/generated schema и demo/SDK registry. Reviewed/executed hash698c39fe152642c2adeb293310f00b61cd0e5f8ec084e3abfa6664ed3c9aa398 включает P1 cleanup correction. Прежний4b873603 hash устарел, не разрешал execution и не подменяет executed proof. Неизвестные/virtual inputs запрещены; объявленный synthetic import entry полностью порождён закреплённым runner. Pins совпали перед setup и перед cleanup. --describe сам не создаёт PrismaClient/подключение, manifest или baseline.

## Immutable ownership and PRE

MUTATION_NATIVE_MANIFEST перечислил каждый PK:3User,Client,Project,Product,Work,7Task,CashAccount, допустимые TimeEntry/PayrollEntry/Payment/ChangeLog/DomainEvent IDs и все receipt UUIDs. START/DONE используют одну задачу; остальные фазы — отдельные. Номера2000013300/2000013300.1 и все manifest IDs были свободны. Синтетические login-disabled users/строки имеют qa133-runId identities. Не использовались MAX allocator, existing-user изменение, seed/migration или чужие связи.

SET TRANSACTION READ ONLY до записей проверил identity/plugin policy/payrollCurrency BYN-default/fresh IDs. Два actual клиента подключились независимо; initial/per-transaction pg_backend_pid подтвердили отдельную fresh proof connection. Для всех public таблиц сохранены только counts/ordered row-JSON digests и constraint definitions digest. Immutable manifest/source pins/root approval и полный PRE сохранены wx/fsync/byte readback ДО setup writes. Дампа или raw real-user payload нет.

## Actual execution and fault boundaries

Production createTaskTransaction сохранил lock18435/55001, ReadCommitted, maxWait5s/timeout15s. QA facade делегировала actual SQL клиенту, присваивала exact reviewed IDs, проверяла write model/relation/amount/raw timer UPDATE, запрещала unexpected writes/raw commands. Business logic/visibility/receipt/fingerprint/audit/outbox не заменены. Payment использовал actual public createPaymentCore и actual preparePayment/createPaymentInTransaction; task — actual changeTaskStatusCore. Fixtures созданы отдельной owned transaction.

- Worker START: callback и настоящий SQL COMMIT завершились, затем adapter бросил injected ACK delivery error. Fresh readonly client2 взял тот же lock и прочитал exact actor/type/payload receipt, подтвердив исходный task resultId. Это injected response loss после наблюдённого COMMIT, не утверждение о настоящем TCP/Prisma lost packet.
- Lawful worker DONE создал stopped timer/100.00BYN payroll/один mandatory status audit/outbox. Старый START UUID вернул historical ACK, не изменив таблицы/timer/payroll/current status. Stale expectedActorId отклонён до DB call.
- Legacy без UUID подтверждён только немедленным exact actor/type/generated eventId/payload proof; новый retry receipt ему не приписан.
- Expected task/payment proof-read fault оставил UNKNOWN после actual commit. Сначала read-only owned capture, затем явная проверка того же UUID без новых writes: оба исходных ID подтверждены до cleanup. Unexpected/unresolved UNKNOWN означал бы STOP/HOLD.
- Четыре task late faults (payroll/status audit/event/receipt) подтвердили actual SQL predecessors внутри transaction до throw: task DONE/time/payroll/status audit/event. Fresh same-lock fence завершилась, полный fingerprint равен pre-fault. Payment event fault подтвердил существующие payment+mandatory audit в transaction, после чего обе строки откатились. Всего5latefaults PASS.
- Confirmed payment100.25BYN остался успешным при6faults declared dispatch/org/cache adapters; повтор UUID вернул исходный paymentId без новой transaction/write. Adapters — inert injected IO, не native proof настоящей notification/cache delivery. fetch/node:http/https запрещены, outbound attempts0.

Absence/read failure не объявлялись automatic rollback; callback completion не объявлялся commit. Swallowed rollback error pinned Prisma runtime не использовался как proof: нужны fresh same-lock fence, abort phase и actual SQL fingerprints. Confirmation helper не повторял mutation автоматически.

## Cleanup and STOP

Все успешные owned rows сохранены private capture. Full table fingerprints excluding только exact manifest IDs равны PRE. Под shared lock сначала deterministic SELECT exact owned PK ORDER BY id FOR UPDATE для всех owned родителей: FK KEY SHARE writers не могут вставить новую ссылку до DELETE. Затем outside-original FP/all incoming FK checks/exact owned capture. PostgreSQL FK перечислены целиком, включая composite/cascade/SetNull; любой child вне exact manifest IDs или неизвестное owned изменение означали бы STOP.

Child-first DELETE использовал id=ANY(exact immutable table IDs), без prefix и без cascade для поиска детей. После DELETE полный originals fingerprint сравнен с PRE ВНУТРИ той же cleanup transaction ДО COMMIT; mismatch откатил бы cleanup. Внешний post-commit full fingerprint тоже равен PRE; во всех manifest tables0owned rows. Durable cleanup proof подтверждает unchanged originals/source hash/0fixtures/0outbound/2clients; mandatory protected-finally=true.

При unexpected failure протокол запрещает cleanup/retry: closed QA133 code/phase, owned-only capture, mandatory protected fingerprint inspection. Credentials/raw error/PII не выводятся. Оба клиента отключаются и IO adapters восстанавливаются даже при inspection/evidence failure. Unconfirmed preservation — STOP, не NATIVE_PASS; recovery требует нового root/reviewer решения. В данном успешном запуске STOP/retry/recovery не было.

Private evidence C:/Users/admin/AppData/Local/Temp/pero-crm-qa133/d2a3378e-4798-42b8-821b-6130a01b848b: manifest.json/before.json/expected-unknown-inspection.json/final-capture.json/cleanup-proof.json/protected-finally.json. SQL/runtime больше не запущены. SAFETY D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md: STOP при target/source mismatch. Main/production/restic/dumps/reset/seed/new DB запрещены.

# Design

## Context

См. proposal.md. Задача132, fresh bugfix/132@cd38cb745759becd58dbbad4d6d37afa03f0ab7a, D:/Projects/pero_crm_worktrees/improvements-132. Только planning, source0. Reviewed133 и130 остаются в своих worktree; их код/receipts/outcome не переносятся.

Readonly actual source показал четыре формулы закрытия: time/actions.ts autostopExpired(неtransactional,stoppedAt=now), stopTimer(read→update безCAS/cap), startTimer(transaction+uncapped raw UPDATE), tasks/completion-core.ts start/stop(transaction+uncapped raw UPDATE). Старый raw WHERE stoppedAt!=null/minutes=0 затрагивает также ранее закрытые нулевые записи. updateTask stop вызывается только из reassignedEngineering, но engineering guard запрещает смену assignee раньше; actual lawful ordinary reassignment сохраняет IN_PROGRESS и старый таймер не закрывает. UI уже предлагает start для незакрытой задачи, поэтому новый исполнитель не нуждается в reset статуса.

Штатные task/timer starts защищены существующим createTaskTransaction: advisory18435/55001, ReadCommitted, maxWait5s/timeout15s. Task soft-delete проверяет активный таймер под тем же lock. TimeEntry.source — timer/manual; manual создаётся закрытым. Основной spec inventory содержит access/dashboard/mobile/list/deploy, timer capability отсутствует. Сохраняются related change contracts: production-worker-task-allocation, field-work-editing, product/project-soft-delete и universal-work-shares.

## Goals / Non-Goals

**Goals:** одна authoritative timer snapshot formula и один close mechanism, короткая atomic current-state проверка каждого пути, CAS закрытия, deadline720/clock tests, zero historical closed writes, RoleUnion/office manual bounds и actual multi-client SQL proof.

**Non-Goals:** UI/DTO/role/schema/package/lock changes, новый cron, исправление engineering allocation/reset, начисления/receipt/outcome133/134/165, миграция/backfill/очистка существующих таймеров, реструктуризация общего transaction coordinator150. Нет новых public completion arguments: future133 optionalcontext не конфликтует с clock injection. Native/state mutations не разрешаются planning.

## Decisions

### 1. Общий time/timers.ts без server-action контекста

Новый модуль содержит pure timerStopSnapshot(startedAt,instant), stopTimers(tx,scope,instant,expiredOnly=false) и startTaskTimer(tx,taskId,userId,instant). Только caller передаёт уже защищённую transaction/current role scope. Pure snapshot считает elapsed в milliseconds, floor/minimum1, cap720; expired получает stoppedAt ровно start+12h/autoStopped=true. Closed source=manual/history не выбираются. Instant фиксируется один раз внутри существующей transaction и передаётся всем timer operations/startedAt/doneAt этого command.

stopTimers читает только source=timer/stoppedAt=null в explicit user/task/id scope, затем закрывает каждую выбранную строку через updateMany с тем же scope/current permission predicate/id/stoppedAt=null/source=timer. Count0 не считается новым сохранением и не ведёт к переписыванию closed row. Нет UPDATE для всех прежних stoppedAt/minutes0. Альтернатива bulk raw SQL устранила бы read, но усложнила бы ACL/predicate reuse и truthful targeted adapters; короткий список активных строк сCAS проще и сохраняет financial transaction boundary. Пустого/глобального scope у approved callers нет.

startTaskTimer сохраняет ID/startedAt уже живого same-task таймера, закрывает другие активные timers этого пользователя и не создаёт второй. Если same-task expired либо активного same-task нет, все прежние открытые automatic timers закрываются единым close и создаётся один новый сexplicit startedAt=instant. Это фиксирует повторный start и clock/duration consistency. Task status repeated branch сохраняется и не создаёт новый timer; UUID semantics133 не внедряются здесь.

### 2. Exact caller/lock/permission matrix

| Путь | Текущий grant | Transaction / общий механизм | Сохраняемый результат |
|---|---|---|---|
| getActiveTimer/auto-stop | auth user+resolved taskExecutionWhere | перенести resolve/expire/read вwithTaskTransaction;stopTimers(userId+taskscope,expiredOnly),read active source timer | прежний task DTO либоnull |
| explicit start/switch | currenttaskExecutionWhere,own assignee либоMANAGER_ROLES,notDONE | прежнийwithTaskTransaction;startTaskTimer(userId=auth.id) | прежнийok/error,/my cache |
| explicit stop | auth user+currenttaskExecutionWhere | новыйwithTaskTransaction;прочитать own active иstopTimers(exactid+user+scope) | прежнийok/minutes/error;позднийnoactiveне переписывает closed |
| task NEW→IN_PROGRESS | actualcompletion currentexecution/dependencies/photo guards | existingprovided TaskTransaction;startTaskTimer(assignee) | status/audit/outbox/piece contracts прежние |
| task→DONE | actualcompletion currentexecution/manual gates | existingprovided TaskTransaction;stopTimers(taskId) передspent/pay/status | cappedtimer;officemanual>720unchanged |
| ordinaryreassignment | existingMANAGER_ROLES/currenttask/recipient/quantity/dependency/no-payroll gates | existingupdateTask transaction;stopTimers(taskId) после всехchecks доassigneeupdate; прежнийmandatory update audit внутри тойжеTX | IN_PROGRESSkeep,noautostartnewuser,mandatoryauditrollback |
| engineeringreassignment | actualguard rejects доtimerwrite | прежнийreject | no writes;unreachable resetнеиспользуем |
| addManualTime/spentMinutes | прежниеOFFICE_WRITE_ROLES/execution/visibility | sourceunchanged |1–1440manual/агрегат unchanged |

Auto-stop только own currently executable task; revoked/deleted/read-only contexts не обновляются. Switch разрешённой новой задачи сохраняет прежнее закрытие собственных старых timers поuserId; новых title/read grants это не даёт. Manual office record и completed legacy1200 никогда не ограничиваются задним числом. После lawful reassignment новый исполнитель видит прежнюю кнопку start; task status менять наNEW нельзя.


UpdateTask обязательный action=update audit сейчас находится после transaction. В132он переносится после task/dependency/pool mutations, перед transaction return, черезtx.changeLog.create. ActorType/userId/name/field/entity=task/entityId/action=update/source=web остаются прежними. OldValue={title,type,assigneeId,dueAt,status}, newValue={...parseddata,status:newStatus}; оба нормализуются темже JSON.parse(JSON.stringify(...)), включая Date→ISO и удалениеundefined. Exact1audit, никаких дополнительных visible rows. Audit fault откатывает task/timer/dependencies/pool changes. Notifications/cache и прежняяtask.assigned внешняядоставка остаются после transaction; новый ACK/outcome/outbox контракт здесь не заявляется.

### 3. Native and testing contract

Таблица719/720/721/1200минут,0/59sec иmicro-boundary проверяет snapshot и все approved paths с injectedclock. Для actualmodules clock фиксируется test-only средством Node, public signature не меняется. Actualaction/core tests сохраняют ACL/RoleUnion, deleted/revoked, noauth, office721/1200/1440vs1441, manual-role denies, closed0/1200unchanged, ordinaryreassign/auditrollback/engineeringreject. Старые role/delete tests KEEP; invocation-count assertion заменяется strongerclosed-old/new-active state assertion.

Native отдельно после concrete runner/manifest/review/rootGO на existing5433:2actualclients, fixedowned IDs, actualsharedlock/helper/core; concurrent start/switch/stop/autostop/complete/reassign, oneactive/per-timer<=720, lateCAS afterclosedpreservesexactsnapshot, mandatoryaudit rollback, historicalclosed0/1200/manual1200unchanged. Clock injection обозначается именно injection, не20часовphysicalwait. Immutable durablePRE/sourcepins/rootfreshquiescent+outbounddeny доsetup; exact parentPKFORUPDATE/all-FK/outsideFP/insideafterDELETEbeforeCOMMIT+postFPcleanup, ownrows0/disconnect. Unexpectedoutcome STOP/noautocleanup/retry, source/targetmismatch STOP. Нет seed/reset/newDB/dumps/restic.

### 4. Exact proposed allowlist

Source4 (все пути относительно worktree):
1. apps/web/src/server/time/timers.ts (new: pure snapshot/central close/start)
2. apps/web/src/server/time/actions.ts (толькоgetActiveTimer/startTimer/stopTimer/imports;manual/spent unchanged)
3. apps/web/src/server/tasks/completion-core.ts (timer delegates/oneinstant/doneAt, financial/status/receipt contracts неизменны)
4. apps/web/src/server/tasks/actions.ts (толькоupdateTask actualassignee-change stop/import/instant и перенос существующего mandatory update audit втотжеTX;engineeringguard/newStatusformula unchanged)

Tests6:
1. apps/web/tests/timer-stop-cap.test.ts (new: pure/helper/currentstate/CAS/cap/history/path clocks)
2. apps/web/tests/time-actions-timer.test.ts (new: actualactions/roles/manual/stop/switch/race)
3. apps/web/tests/time-autostop-role-boundary.test.ts (existingKEEP;transaction/querycapableadapter,currentpermissionchecks)
4. apps/web/tests/product-delete-timer.test.ts (existingKEEP;exact stop/start state вместоinternalSQLcount)
5. apps/web/tests/helpers/task-share-fixture.ts (existing:timerfindMany/CAS/source defaults;otherdomains unchanged)
6. apps/web/tests/timer-stop-cap-native.ts (new:inert guardedrunner,reviewedseparately)

OpenSpec толькоopenspec/changes/transactional-timer-stop-cap/**. Другиеpaths требуютexplicitreview/rootscopeGO; чужиеизменениянеоткатывать. Tests фикстуры соответствуют actual requiredsource timer; usefulnegativecontracts не удаляются.

## Risks / Trade-offs

- New serialization of getActiveTimer→короткая transaction/read+bounded timerwrites; сохраненыобщиеlock/timeouts, noexternalcallsinside.
- Historical closedminutes0/rawupdates→centralwherealwaysstoppedAtnull/source timer; native fingerprints сравнивают exacthistory.
- Stale stop/autostop→currentreadunderexistinglock+CAS predicate; native2clients иlate-update0 проверяютimmutablefact.
- Ordinary reassign changes timefact→толькоapproved132bugfix, no statusreset/auto-start/newpayroll; mandatoryauditfaultrollsbackassignment/time.
- Concurrent completion/start→sameglobaltransaction; sourcebaseне133WIP, normalintegration потребует reviewermerge+rerun обоихaffectedcontracts иновогоactualstageSHA.
- Code reduction metric→4inlineformulas→1centralformula,0legacyraw broadTimeEntryUPDATE; productionJS/LOC измерятьчестно, обязательнаякорректностьвышеобщейчисленностиtests.

## Migration Plan

Schema migration/backfill отсутствуют. Source толькопослеindependentDESIGN_GO/rootRELEASE. RED cap/race/closedhistory/ordinaryreassign, GREEN centralmechanism/actualpaths/Rolematrix; relevantcompletion/engineering/work/softdelete/manual suites, agreedtsc/scopedlint/diff/OpenSpec. Nativeprotocol/executeapproval отдельно. CommitHOLD доownerexplicitpermission; normalmergestaging/rootcoordination/CI затемactualdeployedSHA/image/health/W07 иreviewedHTTP/browser/native checks. UImarkup/classes не меняются; sameviewports1440×900/390×844/360×800 безunexplaineddifferences. Main/production запрещены.

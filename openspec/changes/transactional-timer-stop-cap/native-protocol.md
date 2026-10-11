# Native protocol132

Статус PREPARED/NOT_RUN. Worktree D:/Projects/pero_crm_worktrees/improvements-132, bugfix/132@cd38cb745759becd58dbbad4d6d37afa03f0ab7a. Runner apps/web/tests/timer-stop-cap-native.ts, runId9704db7f-d2e2-47c1-b1fb-aba2043ed65d, current prepared hashd4bf594c574d5c74307af845b9effffccb73b679cb790e2fc82aefbdcc9a0d65/56pins. Это не разрешение на SQL. Предыдущие dry-run hashes487d/0876/6cd55 устарели и никогда не исполнялись; отдельный independent PROTOCOL_GO/root EXECUTE_ONCE привязывается к окончательно reviewedhash.

## Target and source

Только existinglocal pero_crm_pg/CIDbf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5/127.0.0.1:5433/pero_crm/userpero/public/primary. Docker identity/running/port/DB/user/credentials проверяет existingLocalCrmDatabaseUrl, пароль остаётся в памяти. В memory URL добавляется connection_limit=1 для каждого из2клиентов, исходные env/config не меняются. Начальные и per-command backend PIDs фиксируются и различаются.

Approval требует source=root-reviewed, operation=execute, exactrunId/sourceHash/CID, exclusiveLocalWindow/localOutboxInactive=true и свежую независимо наблюдённую root no-runtime/listener/client/dispatcher evidence. Сам env flag не доказательство. Branch/base/pins сверяются; enabled plugin policy — ровно ['file-stages'], source-pinned registry не содержит его manifest/hook. Изменённая цель, роли/ids/плагин/runtime/источники означают STOP. Restic/dumps/reset/seed/newDB/DDL/main/production запрещены.

Source hash включает физический production closure4модулей/core/transaction/registry, runner/target guard/pure negative tests, schema/config/packages/lock, ownPrisma runtime/generatedschema и demo/SDKregistry. --describe читает/компилирует эти источники без конструкции PrismaClient, Docker/DB/SQL, записей или реального clock injection. Синтетический import entry полностью задаётся закреплённым runner; неизвестные virtual inputs запрещены.

## Owned manifest and PRE

TIMER_NATIVE_MANIFEST перечисляет все exactPKIDs до записей:4login-disabledsyntheticUser,Client,Project2000013200,Product2000013200.1,Work LEGACY64×100BYN, main/matrixTask,3historicalTimeEntry, все scenario/newtimer/possibleaudit/event/payrollIDs. Nativefixtures не являются разрешением менять существующих сотрудников/данные. Все fresh IDs/номера проверяются; TimeEntry.userId и audit/event actors — scalar snapshots без полного FK, поэтому отдельно проверяется отсутствие чужих строк сown user/actor IDs.

Перед setup SET TRANSACTION READ ONLY проверяет identity/primary/plugin/currency/freshids/logicalrefs. Полный public table count+orderedrowJSONdigest и constraint-definitiondigest сохраняются как PRE; raw real-user rows не пишутся. Immutable manifest/sourcepins/rootapproval/PRE сохраняются wx/fsync/byte readback ДО fixturewrite. History0/1200/manual1200 специально owned fixtures; их exact snapshots сравниваются после всех операций.

## Actual scenarios

Actual serveractions time/actions/updateTask и completion core используют actualPrismaSQL и неизменённый createTaskTransaction18435/55001/ReadCommitted/maxWait5s/timeout15s. Scoped Prisma facade присваивает only manifest IDs и запрещает неожиданные модель/write/raw commands. Auth — объявленный per-command owned actor context через AsyncLocalStorage, без настоящего login/JWT/HTTP claim. Cache/notification/assignment-delivery adapters inert, их доставка не считается native proof. Actual mandatory audit/statusoutbox/PIECE создаются SQL и проверяются. fetch/node:http/https deny, outbound0.

Clock=2026-10-11T12:00:00Z вводится test-only Node Date mock после guard/PRE/setup. Не заявляется20часов ожидания в реальном времени.

- 10concurrent same-task starts на2клиентах: всеok, ровно1созданный TimeEntry, unchanged liveID/startedAt и одинactive.
- 10mixed switches между двумя tasks: не более1active, cappedclosedfacts. Ранее закрытые строки сохраняются после последующих stop/read.
- 2concurrent explicitstop плюсread и отдельный expired20h stop-vs-autostop race: итог720/deadline/autoStopped, noactive/no overwrite.
- 20matrixcases719/720/721/1200 поstop/switch/read/completion/ordinaryreassign, одинactive capworker передкаждымcase. Read719сохраняетlive, затем явныйstop закрывает; switchновыйtimer легальноостанавливаетсяштатнымstop. Reassign сохраняетIN_PROGRESS/noautostartrecipient. Capworker payNONE, не подставляет ложные payroll side effects.
- Start удерживает actual advisory lock на client2 внутри явного bounded barrier. Completion начинает actual SQL lock на client1; owner transaction через pg_locks проверяет exact holder/granted=true и waiter/granted=false, разные actual backend PIDs, same database/classid18435/objid55001/objsubid2/ExclusiveLock. Только после SQL witness barrier освобождается; release обязателен в finally/HALT, deadline5sec и максимум100 чтений. JS-флаг/задержка не считаются proof. Immutable lock-overlap-witness сохраняется до release. После completion/replay ровно1PIECE100.00BYN и0active timers DONEtask.
- Late reassignmentaudit fault проверяет actualSQL timerclosed720 и task.assigneeRecipient ВНУТРИtransaction передthrow. Fullpre-faultfingerprint равенafterrollback. Затемштатный worker stop закрывает rollback-preservedтаймер; скрытойfixturecleanup/перезаписи послеfaultнет.
- CAS legacy-writer injection: послеactualSELECT client1, доactualhelperupdate, client2 закрывает только exactowned casTimer720/deadline безadvisorylock. Client1CASнепереписываетconfirmed row. Это controlledold-writer experiment, не утверждение, что новыеAPI обходятsharedlock.

## Cleanup and STOP

Успешные owned captures/pidtrace/matrix результаты сохраняются. Полный outside-owned fingerprint равенPRE. Cleanup подsharedlock сначала deterministic SELECT exactownedPK ORDER BYid FOR UPDATE; проверяются всеincomingFK, включаяcomposite/cascade/SetNull, иscalar logicalrefs. Любая чужаяссылка или непонятноеизменение — STOP. Exactownedcapture/outsideFP повторно совпадают передDELETE.

Толькопослеguardchild-first DELETE id=ANY(exactimmutabletableIDs), безprefix/cascadeпоиска. FulloriginalsFP сверяется сPRE ВНУТРИcleanuptransaction ДОCOMMIT, затемвнешняяfullFP==PRE/ownrows0. При mismatchcleanupоткатывается. Persistentфактыстарогоproduction/local/stagingнепереклассифицируются.

Unexpectedfailure устанавливаетHALT: новые/queued writesотклоняются, ужезапущенныеcommandpromisessettleдоSTOPcapture, никакихretry/cleanup. ClosedQA132code/mutationStarted/owncapture сохраняются, rawerrors/credentials/PIIневыводятся. MandatoryfinallyпроверяетprotectedFP, восстанавливаетclock/IO/cache иdisconnect2clients; unconfirmedinspection — STOP. Recovery требуетотдельногоroot/reviewerрешения. Privateevidence%TEMP%/pero-crm-qa132/9704db7f-d2e2-47c1-b1fb-aba2043ed65d пока не создавалась, actualnativeSQL0.

## Scope limitation

132не меняет прежний deleteTask HARDdelete incompleteordinaryTask/time/dependencies (tasks/actions.ts:475–503). Это явно запрошенноеудаление, не close/minutesформула; activeproduct/projectsoftdeleteпо-прежнемуreject. Engineeringassignee/resetнедостижимпослеearlyguard. ВовнеcentralstopclosingUPDATE/формулнет; closedmanual/historicalfactsобычныхоперацийнеизменны. Combined132+133/stagingacceptance остаётсяNOT_RUN.

SAFETY D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; СТОП при guard mismatch.

Independent review отклонил прежний JS-only overlap witness как P2: COMMIT мог завершиться раньше finally flag. QA-only correction и negative capsules реализованы, production4 неизменны. Targeted3/3 guard/source/SQL-witness capsules PASS без DB connection; новый cold hash указан выше. Actual native NOT_RUN, final typing/lint10 и revised PROTOCOL_GO/root EXECUTE_ONCE ещё ожидаются.

Final typing31695/lint10/3pure QA capsules PASS. Independent revised PROTOCOL_GO принято; actual native ещё NOT_RUN и root execution permission отсутствует. Prepared hashd4bf594c…/56pins не является executed proof.

## Actual root execution

Root consumed one-shot reviewed9704/d4 approval and session4834 returned NATIVE_PASS. Exact immutable PRE/manifest/pg_locks witness/finalcapture/cleanup/finally находятся в declared Temp output namespace;56currentpins verifiedequal.2actual backendPIDs/20matrix/protectedFP/own0/outbound0 подтверждены, rootpostclients0. Fixed Date clock is explicit QA injection; production/real12h behavior notclaimed. Author did not rerun/cleanup. Source remains frozen, independent finalactualreview pending; stagingNOT_RUN.

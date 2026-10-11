# Design

## Context

См. proposal.md. Base и worktree: cd38cb745759becd58dbbad4d6d37afa03f0ab7a, D:/Projects/pero_crm_worktrees/improvements-133, bugfix/133. Source0 до первоначального DESIGN_GO; после root RELEASE реализуются только25approvedsourcepaths; reviewed130 WIP остаётся в другом worktree и не копируется.

Проверенные действующие contracts:
- tasks/completion-core.ts атомарно пишет время/status/payroll/audit/outbox под withTaskTransaction, повтор того же current status — no-op. tasks/actions.ts443–476 после его return допускает исключения dispatch/notify/cache.
- **SUPERSEDED rationale:** первоначальная narrow проверка поздней newStatus формулы306–310 предполагала reachable engineering reset. Полный guard255 раньше безусловно запрещает изменение assignee/quantity исторической ENGINEERING работы, поэтому эта ветка публично недостижима. Запрет сохраняется. Live status flow допускает START→DONE; поздний прежний START intent должен получить historical ACK, а не новый статус или ошибочный rollback. Обычное переназначение сохраняет IN_PROGRESS; DONE/начисленные задачи закрыты для правки. Dead branch не используется как fixture proof.
- payments/receipts.ts уже связывает optional clientMutationId с actor, command payload fingerprint и реальным Payment; transaction.ts сохраняет money/audit/event/receipt вместе. core.ts пока превращает любой transaction reject в ok:false, а revalidate может упасть после commit.
- **Pinned Prisma Client6.19.3**, runtime/library.js `_transactionWithCallback`: await callback, затем await engine commit; catch вызывает engine rollback(...).catch(()=>{}) и бросает исходную ошибку. Поэтому callback return ещё не proof commit, а callback throw alone не является rollback ACK. В документации current Prisma встречается новый db.transaction API; его не переносим в pinned6 код.
- removeWork и projectMaterial add/update/delete пишут обязательный audit после transaction. Эти четыре audit записи переносятся в ту же существующую transaction; их нельзя превратить в optional effect.

## Goals / Non-Goals

Goals: один небольшой outcome механизм, один исполнитель optional effects, exact intent replay статуса задачи, сохранённый payment receipt и успешный ACK после confirmed commit faults; фактические сценарии UI/bot/native/staging с независимым review.

Non-Goals: mandatory money UUID134, createTask165, timer cap132, queue claims135/subscriber receipts136, изменение schema/миграций/денег/FX/ролей/вида, универсальная receipt миграция всех writers. Unreceipted product/work/norm legacy commands не называются recoverable: здесь их исправление касается только confirmed posteffects и указанного mandatory audit boundary. Cash post-commit образец/его тесты сохраняются.

## Decisions

### 1. Outcome зависит от фазы и доказательства

Новый pure confirmation helper принимает существующий transaction, callback и строго SELECT-only verification. Он не импортирует глобальный Prisma/Next и не меняет withTaskTransaction lock18435/55001, ReadCommitted/maxWait5000/timeout15000.

| Наблюдение | Исход |
|---|---|
| Transaction promise resolved | COMMITTED с detached result |
| Callback ещё не вызывался; app writes не начинались | ROLLED_BACK/no business mutation; исходная ошибка сохраняется |
| Callback бросил до возможности отправить COMMIT | Пока неподтверждённый abort; только успешная fresh same-lock fence подтверждает окончание прежней transaction и ROLLED_BACK; failure fence→UNKNOWN |
| Callback completed, но transaction rejected | UNKNOWN; candidate value/id никогда не трактуется как commit |
| Fresh same-lock read подтверждает exact owned receipt или exact candidate durable event/record | COMMITTED с тем же result ID; без повторной mutation |
| Verification отсутствует, отказала, вернула отсутствие/несоответствие proof | UNKNOWN, не automatic rollback, не automatic rerun |

Helper не угадывает исход по тексту Prisma error/code. Callback fault сохраняет настоящую ошибку; неподтверждённый исход получает отдельный typed UNKNOWN. Verification после failed transaction открывается заново и ждёт тот же advisory lock, не вызывает mutation повторно. Исполнитель UNKNOWN возвращает безопасное сообщение, outcome и retrySafe только при действующем request receipt; никогда не отдаёт raw driver errors/URL/PII.

### 2. Task status receipt закрепляет исходное намерение

Public changeTaskStatus сохраняет прежние3args и принимает optional4th TaskStatusContext={clientMutationId,expectedActorId}. Action и core сравнивают expectedActorId с auth-derived/server DomainActor.id до receipt reads и любых writes. Несовпадение возвращает closed actor-changed rejection этой новой попытки без чтения чужой receipt; оно не доказывает rollback прежней UNKNOWN команды. Client actor hint — только precondition, не authority; роли/данные по-прежнему проверяются на сервере. Core сохраняет прежний injected transaction argument и получает optional request identity отдельно. Новый status-receipts.ts содержит shared wire type, validation/fingerprint/strict receipt read/write без Next-effects.

UUID канонизируется lowercase, command kind=`task.status`, fingerprint server-owned содержит actorId, taskId, разрешённый toStatus и actualMinutes(integer либо null). Проверяется actorType/user, actorId, entity/task, entityId, action/task.status.request и fingerprint. Чужой actor/type/payload/подменённый context — отказ без mutation. Запись receipt происходит внутри одной transaction с status/time/payroll/audit/event, в том числе acknowledged no-op; повтор того же UUID не создаёт ни business writes, ни второй audit/receipt/event.

Receipt содержит compact ACK(resultId=taskId, requestId, status/eventId) и server-only context для cache; payroll amounts/user money туда не дублируются. Оригинальному актуальному авторизованному actor возвращается только минимальный ACK своей уже committed команды, даже если после неё произошло законное переназначение; это не разрешение новой правки и не выдача текущих/чужих данных. Новая команда проходит прежнюю taskExecutionWhere/role union/business проверки. Повтор receipt не запускает timer и не возвращает stale status как текущую карточку.

Immediate lost commit ACK сверяется только с exact receipt либо exact candidate eventId+actor+type+payload в fresh locked read. Persisted server receipt остаётся действующей после потери client response, загрузки страницы и дальнейшего законного перехода DONE; active UI retry сохраняет исходный UUID. Полная загрузка страницы не является автоматическим повтором старой команды, а читает актуальное состояние. Stable taskId resultId сам по себе не идемпотентный ключ нового intent. Legacy без UUID сохраняет вызов; unresolved UNKNOWN не auto retry и не утверждение об обратном переходе/rollback.

### 3. Семь web вызовов используют одну pinned-intent реализацию

Новый use-task-status-command.ts получает обязательный actorUserId из auth-derived server prop, переиспользует createRequestId и хранит pending intent по (actorId,taskId) с toStatus/actualMinutes/UUID. Wire всегда содержит expectedActorId. Для MyTasksView это my/page.tsx session.user.id; для TasksKanban — tasks/page.tsx→TasksPageView; для TasksTab используется уже существующий prop из product page и добавляется forwarding из project page. Родители передают actorUserId в ActualTimeDialog. Никакого нового SessionProvider или клиентского authority. UNKNOWN/transport loss сохраняет тот же payload и UUID; попытка поменять payload до разрешения не отправляет новую команду. Confirmed ACK или confirmed rollback завершает intent. Новый легитимный переход получает новый UUID. Historical ACK включает replayed=true и не содержит current status: hook только подтверждает прежний intent и refresh,7handlers не применяют старый requested status и не говорят о новом timer. Для unresolved UNKNOWN доступна «Проверить» на error toast с тем же immutable intent; обычный UI не меняется. Четыре файла содержат7callsites: actual-time-dialog1, tasks-kanban1, my-tasks-view3, projects/tasks-tab2. Все проходят через один helper; markup/classes/text штатных состояний сохраняются.

Два optimistic DnD callers откатывают локальное значение только при confirmed rejection/rollback. При UNKNOWN показывают неопределённость и запрашивают актуальное состояние; refresh не называется подтверждением прежней команды. Actual-time dialog сохраняет прежнее число минут/intent. Общий browser-only controller хранит pending intents в активной странице и переиспользуется четырьмя wrappers; SSR не использует общую mutable actor map между запросами. ObserveActor(newActor) очищает старые pending intents при смене аккаунта, а generation фиксируется до await: stale old-actor start/ACK возвращает null и7handlers не применяют toast/local state. При server actor-changed hook возвращает null и router.refresh; это защищает старую вкладку после login другого user, даже без её rerender. Такой отказ не объявляет прежнюю UNKNOWN операцию откатившейся.  React remount не генерирует новый UUID того же unresolved intent. Полная загрузка страницы не запускает автоматическую mutation; повтор с известным прежним UUID всегда защищает серверная receipt.

### 4. Payment сохраняет существующий контракт и fingerprints

Обязательность clientMutationId не меняется. До сети/preparation и под transaction повторно проверяется существующий receipt; validated replay возвращает исходный paymentId/resultId и COMMITTED. Существующий paymentFingerprint, UTC FX asOf, money snapshots, deleted-payment запрет и changed-payload конфликт сохраняются; существующие receipts не переформатируются и не переписываются.

После ambiguous transaction outcome verification использует exact existing receipt(actor/type/fingerprint/activePayment) либо exact generated candidate paymentId+actor+eventId/type/payload, созданные текущим atomic callback. Amount/byCurrency/document/context proof соответствует его результату. Absence/read failure оставляет UNKNOWN. UUID-backed retry повторяет прежний intent; unreceipted UNKNOWN возвращает retrySafe=false и не исполняется helper повторно.

Web PaymentDialog уже сохраняет UUID при отказе/потере ответа; bot finance engine хранит dialog и тот же UUID до ok:true. Эти действующие поведения проверяются actual component/route/engine tests. Bot task-status route сейчас отсутствует; не создаём фиктивный endpoint ради scope. Additive outcome/resultId/paymentId поля проходят через существующий POST bot/payments; HTTP200 envelope и текущие ACL/Bearer/scopes сохраняются.

### 5. Effects отделены от обязательного сохранения

Новый post-commit helper выполняет каждый effect в отдельном try/await/catch, включая sync throw, async rejection и fault diagnostic sink. Параметры diagnosis ограничены closed operation/effect code и resultId, без message/stack/title/amount/recipient/credentials. Durable event после failed dispatch остаётся в существующей очереди; exactly-once subscriber/notification delivery136 не заявляется. Отказ одного effect не блокирует последующие и не меняет сохранённый result/outcome.

Подключаем только:
- changeTaskStatus: event, payroll/org/person notifications и каждый cache path; repeated receipt не повторяет notifications.
- createPaymentCore: существующие event/org notification и каждый cache path.
- products actions create/update/changeStatus: confirmed cache/effect boundary; settlement остаётся business follow-up с прежним financeState/PENDING_FX semantics, не проглатываем его financial preconditions как effect.
- works actions add/update/remove: confirmed cache; removeWork audit перенесён tx.changeLog.create перед return.
- warehouse actions projectMaterial add/update/delete: тот же audit payload/source внутри существующего tx; после confirmed return только cache.
- warehouse movement-service: прежние event/org notification/cache, no accounting/receipt изменения.

Shared product/warehouse revalidate helpers дополнительно согласованы root/reviewer: readonly caller map содержит34directcalls,0lexicaltransactionancestors и0modulecycles. Helpers сохраняют порядок/args/null/void и один productSELECT; early/middle cache fault не останавливает следующие пути. Product lookup fault пропускает только зависимые пути. Обязательные upload/current-sketch cleanup/business checks вне helper остаются throwable; audit/payroll/financial core не становятся best effort.

Остальные task create/update/delete, каталог категорий/материалов, product patch/delete, stock purchase и финансовые каталоги не меняются в133. Их completion нельзя выводить из этой задачи; расширение exact allowlist требует review.

### 6. Exact proposed source/test allowlist

Все пути относительно worktree. Source25:
1. apps/web/src/server/operations/confirmation.ts (new)
2. apps/web/src/server/operations/post-commit.ts (new)
3. apps/web/src/server/tasks/status-receipts.ts (new)
4. apps/web/src/server/tasks/completion-core.ts
5. apps/web/src/server/tasks/actions.ts (только changeTaskStatus/imports)
6. apps/web/src/server/payments/core.ts
7. apps/web/src/server/payments/contracts.ts (additive result type, input UUIDoptional unchanged)
8. apps/web/src/server/payments/actions.ts (return type)
9. apps/web/src/server/products/actions.ts (указанные3wrappers)
10. apps/web/src/server/works/actions.ts
11. apps/web/src/server/warehouse/actions.ts (только projectMaterial3wrappers/imports)
12. apps/web/src/server/warehouse/movement-service.ts
13. apps/web/src/components/use-task-status-command.ts (new)
14. apps/web/src/components/actual-time-dialog.tsx
15. apps/web/src/app/(app)/tasks/tasks-kanban.tsx
16. apps/web/src/app/(app)/my/my-tasks-view.tsx
17. apps/web/src/app/(app)/projects/[id]/tasks-tab.tsx
18. apps/web/src/app/(app)/my/page.tsx (только actorUserId prop)
19. apps/web/src/app/(app)/tasks/page.tsx (только actorUserId prop)
20. apps/web/src/app/(app)/tasks/tasks-page-view.tsx (только scalar forwarding)
21. apps/web/src/app/(app)/projects/[id]/page.tsx (только actorUserId в TasksTab)
22. apps/web/src/server/changelog/queries.ts (exact internal taskreceipt exclusion доtake200)
23. apps/web/src/server/payments/receipts.ts (typed PaymentReceiptError/2throw replacements; IDs/fingerprint/messages unchanged)
24. apps/web/src/server/products/revalidate.ts (каждый cache path и один lookup изолированы, прежний порядок/args/null/void)
25. apps/web/src/server/warehouse/revalidate.ts (прежние6roots/project/product paths; independent optional cache delivery)

Tests6:
1. apps/web/tests/mutation-outcomes.test.ts (new: pure phase/fence and shared effect faults)
2. apps/web/tests/task-status-receipts.test.ts (new: actual core + protected cycles/receipt/replay)
3. apps/web/tests/confirmed-action-effects.test.ts (new: actual wrappers/payment/route DI, mandatory audit rollback)
4. apps/web/tests/task-status-command.browser.test.ts (new: actual helper/component and PaymentDialog UNKNOWN same UUID)
5. apps/web/tests/mutation-outcomes-native.ts (new: inert guarded runner, concrete protocol reviewed separately)
6. apps/telegram-bot/test/finance-engine.test.mjs (extend UNKNOWN JSON branch with sameUUID/payload)

OpenSpec scope: openspec/changes/confirmed-mutation-outcomes/** only. No schema/lock/package/config/env/QA secret/private artifacts. Старые protective suites KEEP; если потребуется адаптация fixture contract, exact additional path согласовывается до правки.

## Risks / Trade-offs

- Generic Prisma rejection не даёт commit outcome → classification наблюдает фазы и выполняет fresh exact proof; rollback swallowed runtime учтён, read failure fail-closed UNKNOWN.
- После lawfulDONE поздний START retry должен подтвердить только прежний intent → durable task-status receipt и pinned UUID, minimalhistoricalACK+refresh; currentDONE/timer/audit/payroll не меняются. Engineeringreassignmentreject и ordinaryreassignmentIN_PROGRESS проверяются как действующие contracts.
- Actor switch/cross-tab old intent → server expectedActorId precondition доDB, actor-scoped browser map reset/generation и stale ACK ignore; tests включают новый UUID без прежней receipt от старой вкладки после auth swap.
- Own receipt после смены доступа → только minimal own operation ACK, никакие текущие карточки/payroll/файлы не возвращаются; чужие actor/payload proofs отклоняются.
- Side effect может потеряться → safe diagnostics и сохранённый event; новые subscriber delivery guarantees остаются136, не объявляются достигнутыми.
- New helper/receipt adds code → replaces actual repeated exception handling и7independent intent implementations; отдельно измеряются добавленные protection lines и eliminated repeated implementations, type-only DTO перенос не считается JS saving.
- Broad change temptation →25source paths с ограниченными functions, source0 до DESIGN_GO/RELEASE; paymentmandatory/createTask/queue/timer соседних задач не захватываются.

## Migration Plan

Schema migration отсутствует. До implementation RED отдельных dispatch/notify/cache faults, before-commit failure, after-commit-ACK-loss, failed proof и lawfulSTART→DONE→oldSTART_UUID/retry. Затем GREEN actual modules + relevant payroll/cash/percentage/history/task/work/warehouse/route/bot regressions, scheduled tsc/scoped lint/diff/OpenSpec.

Native только после concrete runner/manifest/guards review и root execution GO на existing local5433: реальные две connections, controlled owned IDs, current source pins, outbound deny, root quiescent/exclusive window, durable baseline before writes, exact cleanup after readback/fingerprints. Lost ACK через adapter after real committed SQL обозначается injected response-loss, не реальным TCP drop; rollback проверяется actual SQL/fingerprints. Никаких reset/seed/new DB/dumps/restic.

После local и независимого FINAL_CODE_REVIEW_GO — только разрешённый владельцем commit, normal merge staging оркестратором, CI, actual deployed SHA/image/health/W07 и reviewed native/runtime/browser role/receipt/UNKNOWN/component cases. Сравнить те же viewports1440×900/390×844/360×800 с zero unexplained visual differences и protected money/history/ID fingerprints. Main/production запрещены. Stage acceptance остаётся NOT_RUN до actual evidence, pure/DI не подменяют HTTP/browser/SQL.

## Reviewed scope refinements

Root и independent reviewer согласовали25paths: новая task-status receipt исключается только exact(entity=task AND action=task.status.request AND id startsWith task-status:) в global ADMIN reader доtake200; реальные/старые audits сохраняются, UIкомпонент не меняется. PaymentReceiptError различает два прежних business rejects от IO; before/fresh receipt-read IO остаётся UNKNOWN, fresh matching ранееcommitted receipt подтверждает исходный ACK. Successful callback-abort fence не стирает prior committed proof.


Concrete native133 protocol находится в native-protocol.md; actual native и staging пока NOT_RUN. P1 independent review cleanup race закрывается exact owned parent PK FOR UPDATE перед all-FK checks и full originals fingerprint после DELETE внутри cleanup transaction до COMMIT; external postcheck сохранён. Изменяется только QA runner, source/hash пересматриваются до GO.

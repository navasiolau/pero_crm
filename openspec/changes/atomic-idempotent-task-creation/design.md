# Design

## Context

См. proposal.md и ordinary-task-creation-intents/spec.md. Ветка bugfix/165 создана от origin/staging d121f0798e963f32d13f52c9bde57c0aa82b7929, после fetch обычным FF merge обновлена до принятого c6508448450813450b5dbb6a67d77494c37f6cdb. Реализация и local факты отражены в evidence.md; стадии native/staging завершаются отдельно.

Фактические исходники этой базы:
- tasks/actions.ts97–199: createSchema strict, один withTaskTransaction сохраняет Task/dependencies; затем writeChangeLog, emitDomainEvent, notifyPerson и cache могут бросить после commit. Результат только {ok:true}, UUID и receipt нет.
- Единственный production createTask caller — projects/[id]/tasks-tab.tsx449. Форма открывается для конкретной работы изделия, quantity берётся из остатка; UUID/payload не удерживаются после неопределённого ответа.
- withTaskTransaction использует прежний advisory lock18435/55001, ReadCommitted, maxWait5000/timeout15000; он уже сериализует writers графа и количества. Блокировку/настройки не менять.
- checkWorkQuantity, estimateFromHistory, expandDependencies и updateTask используют общие private functions в actions.ts; не копировать их в новый core. Предшественники групп долей и прежние financial guards сохраняются.
- ChangeLog.id уже является уникальным primary key; schema/новая таблица receipt не нужны. worker-allocation-core и status-receipts используют namespace receipt, но различаются payload и authority: worker-allocation не превращать в management command.
- Зависимость №133 принята на staging и включена обычным merge. Переиспользуются operations/confirmation.ts и operations/post-commit.ts; use-task-status-command остаётся специализированным status API. Production source WIP не копируется.

## Goals / Non-Goals

**Goals:** один durable UUID на одно обычное создание, atomic Task/audit/outbox/receipt, минимальный historical ACK, корректный UNKNOWN, сохранение payload при reopen/remount, фактические local/native/browser/staging доказательства.

**Non-Goals:** изменение work quantity/долей/цен/начислений, worker-allocation, update/delete/status semantics, schema/миграций, универсальный receipt framework, обязательный money UUID134, subscriber exactly-once136, durable offline очередь или автоматическое восстановление намерения после полной загрузки страницы. №167 и qualification native163 не исправляются в165.

## Decisions

### 1. Принятая зависимость и прежний business callback

До source implementation parent принимает №133 на staging; затем обычный merge принятого origin/staging в bugfix/165. При пересечении WIP/conflict STOP, чужие правки сохраняются. Используем confirmMutation(transaction, mutation, verify) и deliverPostCommit; helper confirmation не расширяем. В post-commit добавляем ровно один closed operation code task-create. Правила createTask остаются в actions.ts, чтобы не дублировать shared quantity/dependency functions и не подменять native callback отдельной тестовой реализацией.

### 2. Canonical UUID и server-owned fingerprint

createSchema получает обязательные clientMutationId=z.uuid() и expectedActorId. UUID canonical lowercase; отсутствие/повреждение отказывает до writes, сервер не генерирует fallback UUID. Server auth-derived actor обязан совпасть с expectedActorId до receipt read; expectedActorId только precondition, не источник прав. В transaction заново проверить active/current MANAGER_ROLES, сохраняя role union и productVisibilityWhere текущего actor.

Новый узкий creation-receipts.ts содержит wire input context/ACK, normalization/fingerprint и strict read/write этого namespace. Fingerprint — SHA256 стабильного объекта с commandKind=task.create, actual actorId, project/product/work/assignee IDs, прежними title/type semantics, canonical dueAt ISO, requested quantity в decimal atoms либо null-сентинелом «весь остаток», estimateMinutes либо null, requiresPhoto и deduplicated/sorted dependencyIds. Mutable роли, текущий остаток и выведенная средняя оценка в fingerprint не входят. Не переименовывать payload, не подменять quantity null уже вычисленным новым остатком при replay; исходная команда закрепляется независимо от последующего состояния.

### 3. Receipt раньше новой quantity проверки

В существующей locked transaction после actor validation ищем ChangeLog.id=task-create:<UUID>. Проверка exact actorType=user, actorId, entity=task, action=task.create.request, fingerprint, UUID, entityId/resultId и закрытой структуры ACK обязательна. Collision другого actor/payload/action или malformed receipt — typed conflict без mutation. Запрос того же подтверждённого intent возвращает только resultId/UUID/COMMITTED/replayed=true; не повторяет business validation остатка и Task writes.

Historical ACK не загружает текущую карточку/деньги другого владельца и не выдаёт старую quantity/status как текущую. После законного изменения, завершения или удаления Task повтор возвращает минимальное подтверждение первоначального ID; Task не воссоздаётся. Потеря текущих management прав отказывает до replay; это отказ новой попытки, не доказательство rollback старого UNKNOWN.

При отсутствии receipt выполняется прежний createTask callback с теми же принадлежностью Project/Product/Work, active recipient, LEGACY снимком/валютой, quantity/estimate/dependency rules и executorShare1. Сразу после Task/dependencies в этой же transaction сохранить прежний обычный audit payload {title,project}, durable task.assigned и internal receipt с resultId/UUID/fingerprint. Отказ любой из этих записей бросает и откатывает всю transaction; ошибка не проглатывается как optional effect. Две одинаковые команды с разными UUID остаются двумя задачами при достаточном остатке.

### 4. Фактический commit и optional delivery

confirmMutation оборачивает прежний withTaskTransaction без правки общего133 helper. Его verify открывает fresh same-lock SELECT-only read только если callback уже started; ветка !started возвращает ROLLED_BACK текущей попытки без receipt read. Это не подтверждение исходного intent, который мог ранее COMMIT при потерянном ACK. Creation-specific read фиксирует exact actor-bound matched receipt либо successful absence под тем же lock; IO/refused actor/malformed proof не подтверждают намерение. Правильный durable receipt возвращает исходный historical ACK; ambiguous completion остаётся UNKNOWN. Failure wire различает intentResolution=verified-absent и attempt-only и связывает распознанный canonical UUID. verified-absent разрешён только при actual same-lock absence и подтверждённом отсутствии записи этой команды: no-write business rejection после receipt read либо successful fresh abort fence. Не выдавать этот marker для !started/preflight/IO или generic UNKNOWN после completed callback.

ACK: success={ok:true,outcome:COMMITTED,resultId,clientMutationId,replayed?}; failure содержит closed kind/outcome/retrySafe/error, распознанный clientMutationId и intentResolution, без driver message/stack/payload. Любой ROLLED_BACK, включая verified-absent, относится к текущей попытке: исходный UNKNOWN запрос мог ещё не дойти до блокировки. После прежнего UNKNOWN UUID освобождает только matching COMMITTED ACK. Первый непосредственно подтверждённый отказ без прежнего UNKNOWN разрешает новый draft; терминальные tombstones не вводятся. После confirmed commit deliverPostCommit выполняет dispatch, прежнее person notification и каждый cache effect независимо. Повтор receipt не отправляет повторную notification/event; обновление отображения допустимо. Точная доставка подписчикам остаётся136, durable event не теряется при отказе dispatch. Audit и outbox никогда не передаются best-effort helper.

Internal receipt исключить из global audit reader до take200 только exact(entity=task AND action=task.create.request AND id startsWith task-create:), добавив его к точному исключению status receipt №133. Другие/старые audit rows не скрывать. Пользователь видит один прежний business audit.

### 5. Один create-specific client intent

Новый use-task-create-command.ts использует существующий createRequestId и shared outcome contracts №133; он не импортирует server crypto/runtime в клиент. Browser-only controller хранит frozen payload/dependency copy по actor+project+product+work и UUID, coalesces in-flight clicks. SSR не хранит shared mutable actor map. observeActor/generation guard не позволяет позднему old-account ACK очистить/изменить новое намерение; actor-changed приводит к refresh, без чтения чужого результата. Unresolved intent остаётся под исходным actor key и скрыт от нового аккаунта; при возвращении того же actor в активной странице доступен прежний UUID, а поздний ACK другого generation не освобождает intent.

TasksTab уже имеет actorUserId и forwarding №133. При обычном открытии создаётся draft; UUID фиксируется на первом submit. При UNKNOWN/transport rejection controller сохраняет exact payload. Close/reopen или React remount в активной странице восстанавливает pending payload; mount/open не выполняют mutation. UNKNOWN режим блокирует поля и даёт «Проверить» прежний запрос. До первого UNKNOWN непосредственно подтверждённый отказ завершает попытку. После UNKNOWN intent освобождает только matching COMMITTED ACK: в том числе verified-absent не исключает поздний исходный запрос. При возвращении прежнего actor его скрытый intent сохраняется, stale ACK другого generation не меняет текущий диалог. Success ACK требует непустой resultId и того же canonical UUID; mismatch остаётся UNKNOWN. Полная reload очищает client memory и читает актуальное состояние; durable client recovery не заявляется. Независимое DESIGN review выявило гонку delayed original → retry absence → fresh UUID; root согласовал удержание прежнего UUID без новых tombstones.

### 6. Exact proposed allowlist

Production6:
1. apps/web/src/server/tasks/actions.ts — только createTask/createSchema и нужные imports; остальные functions не переписывать.
2. apps/web/src/server/tasks/creation-receipts.ts — новый узкий receipt/fingerprint/wire helper.
3. apps/web/src/components/use-task-create-command.ts — новый create-specific pinned intent/controller/hook.
4. apps/web/src/app/(app)/projects/[id]/tasks-tab.tsx — только create dialog handlers/pending state и imports.
5. apps/web/src/server/operations/post-commit.ts — только один task-create operation code после normal merge133.
6. apps/web/src/server/changelog/queries.ts — только exact receipt exclusion, обычные filters/order/take200 прежние.

Tests5:
1. apps/web/tests/task-creation.test.ts — новые pure receipt/action/rollback/outcome/effect/actor/access и exact audit-reader cases.
2. apps/web/tests/task-creation-command.browser.test.ts — реальные React/TasksTab click/reopen/remount/lostACK/actor switch и viewports1440×900/390×844/360×800; missing Chromium означает BLOCKED/failure, не fake PASS.
3. apps/web/tests/task-creation-native.ts — inert runner реального createTask и PostgreSQL; concrete producer/ownership/target protocol отдельно reviewed до SQL.
4. apps/web/tests/task-work-required.test.ts — только fixture UUID/actor/receipt/effects adaptation; сохранить все прежние value assertions/names.
5. apps/web/tests/work-shares-settlement.test.ts — только fixture UUID/actor/receipt/effects adaptation; сохранить quantity/Decimal/historical assertions, не переносить WIP161 helper копированием.

Artifacts: openspec/changes/atomic-idempotent-task-creation/**. Private receipts/builds/fixtures живут ignored, не входят в commit. Нет package/lock/CI/schema/migrations/env/Docker/config edits, HTTP/bot createTask callers отсутствуют.

### 7. Проверка действия и сохранности

RED на действующем actual createTask: audit throw после Task quantity1/work10 плюс повтор даёт две задачи quantity2. Зафиксировать fault seam как injected audit failure, не называть VM/mock native SQL. GREEN actual action должен атомарно откатывать audit/outbox/receipt faults, возвращать один ID для10sameUUID, конфликт changedUUID payload/actor, давать два IDs для2newUUID и сохранять весь прежний quantity/roles/dependencies/financial test matrix. Отдельный обязательный сценарий: original действительно COMMIT→client ACK-loss/UNKNOWN→sameUUID retry не начинает transaction и отвечает attempt-only ROLLED_BACK→controller не освобождает intent/не создаёт fresh UUID→следующий matching replay подтверждает один originalTask. Preflight typed rejection/read IO после предыдущего UNKNOWN проверяются аналогично;133 generic IO/status caller не объявляется регрессией этим наблюдением.

Native протокол использует два отдельных PrismaClient/наблюдаемых backend PID на существующей разрешённой БД; реальный createTask, Task/ChangeLog/DomainEvent и shared lock, а auth/external delivery явно изолируются. Десять concurrent calls, sequential replay и confirmed real commit→injected ACK-loss→receipt recovery проверяются раздельно. Для каждой late audit/outbox/receipt fault нативно увидеть предшествующие uncommitted owned rows, затем отсутствие partial rows и protected fingerprint equality после rollback. Не подменять SQL DI-копией callback.

До writes — root target/source/catalog/ledger guards, quiescent window и durable owned parent IDs/command UUIDs/baseline. Generated effect IDs фиксируются в reviewed ownership journal до разрешения COMMIT; unknown сохраняет evidence/PRE и требует inspect, без автоматической mutation/cleanup. Использовать уже reviewed lifecycle/ownership primitives133/163. Exact cleanup возможен лишь по observed owned IDs после full outside-owned fingerprints, narrow PK locks/all incoming FK checks и повторного fingerprint сравнения под lock; никакого широкого prefix delete или original financial-row mutations. Local76/staging revision/catalog не угадывать по историческому74/75 count; concrete target qualification/rootGO отдельные. Пока native/browser/staging NOT_RUN.

## Risks / Trade-offs

- Mandatory UUID ломает stale direct callers → один production caller обновляется вместе; legacy caller без UUID получает отказ до writes, existing тесты получают новый UUID для намеренно отдельных вызовов.
- Исторический ACK при изменённой Task может выглядеть как новая запись → compact replayed ACK и refresh, без установки старых fields/current status.
- Закрытие UNKNOWN диалога может потерять intent → actor/work-scoped browser store, reopen/remount proof, frozen payload и in-flight coalescing. Полная reload не называется recovery.
- Дополнительные receipt/helper lines нужны для гарантий → честно измерить добавленный protection code и удалённый post-transaction audit/event path; TypeScript type-only сокращение не выдавать за уменьшение executed JavaScript.
- Native fixtures/ACK loss могут быть ошибочно названы production network proof → маркировать injected seam, реальные SQL/PID/rollback и actual browser/HTTP приёмку отдельными rows.

## Migration Plan

Schema migration отсутствует. DESIGN_GO и root source release, accepted133+ordinary merge, scoped local RED→GREEN/typing/lint/strict, отдельные reviewed native/browser windows, независимый code review и atomic commit. Parent выполняет ordinary merge staging/CI API и принимает actual SHA/image/health/runtime/browser/protected snapshots. Push/build/DI не заменяют приёмку. Main/production запрещены; при regression вернуть совместимый application image без восстановления dump поверх новых данных. Никаких seed/reset/newDB/local-staging dumps/restic/warehouse initialization; SAFETY-RULES обязательны, guard mismatch — STOP.

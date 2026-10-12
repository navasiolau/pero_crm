# Design

## Context

Planning task147 в отдельном `D:/Projects/pero_crm_worktrees/improvements-147`, `bugfix/147`, HEAD `cd38cb745759becd58dbbad4d6d37afa03f0ab7a`. Planning snapshot: source/install/DB/runtime0 до revised DESIGN_GO/ROOT_RELEASE. Текущий local source/check status — evidence.md. Прочитаны actual AGENTS/README/план, schema, visibility/live-entities, все callers, инженерные/производственные/draft specs и relational tests. SAFETY `D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md`: СТОП при guard mismatch.

Старый eligibility выполняет SQL JOIN Task→Work→Product→Project, возвращает Task.id и дополнительно AND-ит `taskWorkspaceBindings`. Он требует ненулевые productId/workId/assigneeId, совпадение projectId и productId у всех связанных строк, живые Project/Product и либо Work.priceSnapshot IS NOT NULL, либо Task.allocationGroupId/shareAmount IS NOT NULL. Цена0 является известной. Task без изделия/работы исключён даже при frozen share; его запись и финансовые обязательства сохраняются. Main specifications не разрешают ослаблять эту согласованность или ACL.

Полный inventory без extension glob:8externalcallers — project list `_count.tasks`, project detail, product detail, `/api/search` task branch, worker-allocation, dashboard, `/my` и `/tasks`; плюс wrapper delegate в tasks/queries. Packages/bot callers0. Только worker-allocation уже передаёт точный scope. Initial v1 inventory ошибочно использовал `*.ts` и пропустил3TSXpages; independent P1 review остановил дизайн до source edits, этот inventory SUPERSEDED.

`getProjectFor` принимает внутренний projectId; `getProductFor` принимает id либо number. Search использует title/project.number, insensitive contains, отдельный office/own-assignee, updatedAt desc/take6. `/my`: own-assignee, status/dueAt/createdAt order, take100, active/done10 projection, прежние getActiveTimer/preference calls. `/tasks`: original OFFICE_ROLES gate до task read, тот же order/take300. Dashboard: homePathForRoles gate, liveChild/nonDONE/dueAt<=todayEnd; taskVisibilityWhere там НЕТ, новый scoped eligibility не должен добавлять такой grant filter или затягивать count.

Task count не участвует в project sorting; особая сортировка по видимым product counts сначала получает unpaged rows, сортирует и затем делает slice. Новый task groupBy обязан выполняться только ПОСЛЕ этого final slice.

## Goals / Non-Goals

**Goals:** убрать массивы Task.id из eligibility; не читать foreign Product coords для карточки; сохранять разрешённые задачи, порядок, pagination, counters и маскирование. Размер фильтра зависит от изделий выбранной области, а не количества посторонних задач.

**Non-Goals:** нет UI/schema/DDL/view/migration, write behavior, денежных/временных расчётов, новых ролей, копирования WIP130/132/133 или обхода приёмки. Legacy project-level Task без Product не вводится в workspace. Main/production/restic/dumps/reset/seed/new DB запрещены, SQL/stage/commit пока0.

## Decisions

### 1. Mandatory scoped coordinate read-model

`TaskWorkspaceScope` — обязательный union с различением по собственным ключам: `{projectId, productId?}`, `{productKey}`, `{projectIds}` либо `{tasks:Prisma.TaskWhereInput}`. Это сохраняет нынешний worker-allocation вызов без source правки. Scope ветки взаимно исключаются; default unscoped вызова нет. Empty selected IDs и непригодный/пустой контекст возвращают explicit deny без DB read. Явный `{tasks:{}}` означает authorized global task operation после прежнего office/home gate, а не отсутствие scope. Unknown/ambiguous runtime shape fail-closed.

Eligibility читает только `{id,projectId}` из Product под `liveProductWhere` и текущим scope, с deterministic id order. Scope project+product проверяет оба значения. Scope productKey использует тот же OR id/number, что actual card. Task predicate создаётся caller-ом один раз; он используется в Product.tasks.some selector и итоговом Task where. Wrapper taskWorkspaceWhere передаёт существующий task ACL в optional internal candidateWhere третий аргумент helper и оставляет отдельный final AND. Scope остаётся обязательным; третий аргумент ограничивает candidate lookup, а не заменяет final ACL. Direct dashboard helper сохраняет только свой current predicate/homeRole gate и прежнюю eligibility, не добавляя отсутствовавший ACL. Bindings и координаты всегда независимы от authorization.

Для каждой пары J/P итоговый Prisma OR содержит `Task.projectId=J`, `Task.productId=P`, `Work.is.projectId=J/productId=P`, `Product.is.projectId=J`. AND с неизменным `taskWorkspaceBindings` проверяет assignee, priced/frozen и живых родителей. Relation filters превращаются Prisma в SQL EXISTS/joins. Product.projectId/live проверяются повторно в финальном запросе: reparent/soft-delete между lookup и read не превращаются в grant. Пустой результат координат даёт explicit deny; Task.id не загружается и не переносится в IN.

ACL не копируется в raw SQL и не заменяется eligibility; он сохраняется там, где применялся раньше. Helpers не сериализуют координаты в ответ и не используют productVisibilityWhere вместо taskVisibilityWhere. Broad WORKER read изделия не разрешает чтение чужой задачи, ACCOUNTANT не получает новый operational grant, а union инженерных/производственных/офисных ролей сохраняется. Dashboard original homeRole gate/organization-level counter сохраняется отдельно.

### 2. Card and allocation scope

Project detail передаёт exact projectId. Product detail передаёт actual id/number key. Worker-allocation сохраняет существующий projectId/productId и свои creator/recipient/dependency ограничения. Общие task mapping, reward/currency, files/dependencies, masks и financial history не меняются.

### 3. Project list counts after original selection

Первый project query сохраняет прежние where/orderBy/skip/take/includes, `_count.files/products`, но не вызывает глобальный eligibility ради tasks. Общий addProjectTaskCounts применяется к final selected rows во ВСЕХ branches listProjects: ordinary paged, unpaged и manual visible-product sort AFTER rows.slice. Один Task.groupBy(projectId) использует eligibility только final selected projectIds и прежний task ACL. `_count.tasks` добавляется в прежний DTO, включая0. Empty rows пропускают eligibility/groupBy; return types сохраняют прежний DTO контракт.

Остальные денежные scopedProjectAmounts, financialProducts, product masking и shortages не меняются. Сортировка по числу видимых изделий и pagination выполняются в прежнем порядке. Unpaged list охватывает реально выбранные доступные проекты; никакой фиксированный cap не отбрасывает законные строки.

### 4. Global search

Search route строит прежний title/project.number OR +office/own-assignee predicate один раз и передаёт его как explicit task scope вместо unscoped call. Он повторно используется обеими SQL queries без нового источника поисковой семантики. Insensitive contains (`%`, `_`, Unicode), trim<2 response, updatedAt desc/take6/projection/auth guard сохраняются. Eligibility selector читает coords только matching candidates; финальный Task SQL применяет отдельный ACL. Первые ineligible candidates не заполняют take6: исключение связей происходит в SQL до ORDER/LIMIT.

### 5. Reachable task pages and original dashboard policy

`/my` передаёт own-assignee predicate; `/tasks` после прежнего office gate передаёт explicit global task scope, wrapper продолжает исходный task ACL. Порядок/лимиты100/300, active/done10, mapper/roles/preferences/timer API не меняются. Dashboard создаёт original liveChild/nonDONE/dueAt<=todayEnd predicate один раз и передаёт direct eligibility без task ACL, сохраняя homePath gate до reads и organization-wide count. Current local-server day/setHours semantics и остальные dashboard stats не меняются.

### 6. Exact proposed allowlist

Source8:
1. `apps/web/src/server/tasks/workspace-contract.ts`: scope/read-model/eligibility; `taskReward` unchanged.
2. `apps/web/src/server/tasks/queries.ts`: scope argument и ACL composition only; mapper/include unchanged.
3. `apps/web/src/server/projects/queries.ts`: selected-row task counts и detail scope only.
4. `apps/web/src/server/products/queries.ts`: detail scope only.
5. `apps/web/src/app/api/search/route.ts`: task branch scope/predicate delegation only.
6. `apps/web/src/app/(app)/page.tsx`: reuse original tasksToday predicate/direct scope only; homeRole/current day/statistics unchanged.
7. `apps/web/src/app/(app)/my/page.tsx`: explicit own-task scope only; order100/done10/timer/preferences unchanged.
8. `apps/web/src/app/(app)/tasks/page.tsx`: explicit global task scope only; office guard/order300/workers/preferences unchanged.

Tests7 approved:
1. NEW `apps/web/tests/scoped-task-workspace.test.ts`: pure semantic/query observer contract.
2. NEW `apps/web/tests/task-workspace-readers.test.ts`: actual project/list/product/search readers + DTO/counters/masks.
3. `apps/web/tests/task-reward-workspace.test.ts`: сохранение reward/history assertions, обновление eligibility adapter без textual implementation mirror.
4. `apps/web/tests/helpers/visibility-fixture.ts`: meaningful `_count` groupBy и lte/null/date adapter для actual readers; не удалять ролевые tests.
5. NEW `apps/web/tests/task-workspace-native.ts`: inert reviewed readonly SQL/query observer/EXPLAIN protocol, исполнение только по отдельному GO.
6. NEW `apps/web/tests/task-workspace-pages.test.ts`: actual dashboard/my/tasks pages/gates/counts/order/100/300/done10, declared inert timer/preference/IO adapters.
7. `apps/web/tests/worker-allocation-payment-privacy.test.ts`: ROOT_ALLOWLIST_EXTENSION_GO на scoped Product coordinate delegate/select assertion; прежние WORKER privacy и WORKER+ACCOUNTANT200.00 сохраняются.

Own OpenSpec files допустимы. Worker-allocation source не требует правки, его existing signature остаётся совместимым. Если concrete implementation потребует другой source path, RELEASE scope надо уточнить до правки.

### Рассмотренные альтернативы

Глобальный Task.id SQL не выполняет критерий ограничения. Простая передача scope оставляет перенос массива Task.id и отдельные глобальные callers; координатная модель устраняет сам этот механизм. Raw SQL с копией RoleUnion/ACL создаёт второй источник политики. SQL view/DDL требует несогласованной миграции. Чтение take6 с последующим JS фильтром связей теряет разрешённые строки и меняет счётчики. Координаты выбранной области позволяют сохранить проверку связей в финальном SQL при одном общем механизме и прежнем ACL.

## Risks / Trade-offs

- Product-coordinate OR имеет O(current products) predicates. Это не constant-time SQL и не обещание latency; метрики фиксируют coords/parameters/bytes, не только LOC. Карточка с очень большим числом изделий всё ещё требует большой фильтр. Не вводить произвольный cap, который меняет результат; approved EXPLAIN должен показать выбранный план/индексы.
- Project list получает отдельный aggregate (+1 query относительно прежнего sequence), но не переносит Task.id. При нетранзакционных чтениях old eligibility уже имел два statement snapshots; новая модель не обещает stronger snapshot consistency. Dynamic matching/live guards остаются в финальном SQL.
- Tests с синтетическими relational adapters не доказывают реальный PostgreSQL план; native/actual staging фиксируются отдельно. Нельзя выдать observer mocks за native PASS.
- Запрет Task.id arrays относится к preliminary eligibility, а не mapTaskDetails IDs реально возвращённых rows или существующим engineeringParticipantTaskIds в resolveVisibilityActor. Эти ACL-проекции не меняются:10k назначенных тому же инженеру посторонних engineering tasks всё ещё могут увеличить actor-resolution cost. Observer разделяет этот existing grant lookup и targeted eligibility; весь app объявлять TaskID-free нельзя.
- У прежнего dashboard нет draft/task ACL; organization tasksToday может учитывать eligible DRAFT. Это existing policy limitation относительно общего draft privacy spec, а не новый grant. Root явно требует сохранить original count и не исправлять политику в147; ordinary card/list/my/task/search draft ACL остаётся прежним. Baseline tests отражают это различие, не скрывают его.
- `/my` вызывает прежний getActiveTimer с auto-stop effects. Actual readonly stage page acceptance требует отдельного root-approved safe profile/history readiness либо комбинированного accepted132; source-only/page DI не разрешает поход на живую `/my` и не заменяет timer acceptance.

## Migration Plan

RED на actual readers и старом unscoped contract → ROOT_RELEASE revised8source/7tests → GREEN → meaningful relevant tests/typing/scoped lint → independent code review → readonly native protocol/pins/reviewer/root GO → EXPLAIN/query proof. Human explicit commit permission теперь получена, но для147 local/review/native prerequisites остаются; parent normal merge staging → image/SHA/health/W07 → actual scenarios/counters/UI. Main запрещён. Данных/DDL изменение не пишет; отмена кода отдельной согласованной задачей, без восстановления/перезаписи бизнес-истории.

## Open Questions

ROOT_RELEASE_IMPLEMENTATION147 получен после revised DESIGN_GO; реализуется только approved8source/7tests. SQL/native/EXPLAIN имеют отдельный protocol/root gate. Конкретные sample scopes существующей approved DB и read-only/PII-free EXPLAIN operator binding фиксируются отдельным native artifact до SQL; они не меняют алгоритм или политику результата. Все выбранные координаты участвуют в фильтре без произвольного cap.

## Native decisions — 12.10.2026

Existing local5433 `pero_crm` содержит пользователей, но bootstrap старого eligible JOIN вернул0. Root разрешил отдельный OWNED_ROLLBACK intent вместо повторения READONLY: только новый UUID, eight exact fixture tables Client/User/Project/Product/Work/ProductStagePayPool/TaskAllocationGroup/Task, одна RepeatableRead TX и обязательный sentinel ROLLBACK после успеха или ошибки. Existing `nativeSnapshot` сравнивает все62 public tables и schema до, внутри с exact-owned exclusions и после; отдельные readonly COUNT подтверждают отсутствие own-prefix rows. No original row writes, settlement/payroll/payment/stock/audit/events, HTTP, new DB, seed, dumps или restic. Каждый actual intent получал отдельный Root ONE и independent protocol GO; HOLD receipts сохраняются.

Work fixture обязан соблюдать текущий `Work_stage_payment_complete`: LEGACY имеет priceSnapshot/total, ENGINEERING — own DRAFT stage pool/product/weight. Nullable snapshot/frozen branches проверяются ENGINEERING works; group fixed/orphan/preview и shareUnits/stageShareUnits удовлетворяют текущим CHECKs. Это test metadata внутри rollback, app/schema/constraints/helpers не ослаблялись.

Native case18 (WORKER/product-key DESIGN) выявил несовпадение Prisma с fixture matcher: при0coordinates вложенный empty OR не обеспечил deny в AND. Исправление — explicit `id:{in:[]}` при invalid scope и0coordinates; остальные bindings/ACL/roles/callers unchanged. CODE_GO2bc81c предшествовал final SQL; PASS48a245b2 подтвердил WORKER и WORKER+ACCOUNTANT DESIGN0/0, ACCOUNTANT/empty roles0 и остальные31scope-role паритеты. Нельзя принимать unit matcher OR semantics за PostgreSQL proof.

Final local source pins: helper7109d0849085500597b3aed103d1ea6339eee6b666cc8ef6fe41b9135817a338, nativecf45b5263c7b51053de81abfb62f59513d6d36d70166f8a678b8349960708820, exact9file digestc9955be6f2e390e3bee62b1ed5c492439d81d16f9fc9a1d364574890ed9dc361. Native ACTUAL_LOCAL_GO + FINAL_CODE_GO cfba7d получен; atomic commit/staging integration остаются отдельными этапами. Source/native PASS не является actual deployment/staging acceptance.
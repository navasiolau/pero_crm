# Evidence — задача142

## Current Status

LOCAL_CANDIDATE_CODE_GO, ветка `bugfix/142` от принятого `cd38cb745759becd58dbbad4d6d37afa03f0ab7a`. Независимые DESIGN_GO и ACTUAL_BEFORE_GO получены до source changes; root разрешил ровно три production файла. Main/production запрещены. Владелец напрямую разрешил необходимые коммиты по всему плану; preliminary local candidate commit возможен только после component checks/CODE_GO, а staging integration — после всех metric/visual checks.

OpenSpec context/list/root/status/artifacts/apply instructions прочитаны; planningHome — этот worktree. Pure rendering refactor, skip_specs:true; требования persistent-list-state, имеющихся navigation/focus deltas сохраняются. Source128/145 не копировался; их обычная интеграция и совместная регрессия ещё требуются.

## Accepted performance baseline141

Receipt `c5e07edf36a632254351d06fb7f11a6638edddb8645b9497323732a292ea5e8a`, authority CLOSED_VERIFIED_RUNTIME_V2:20серий/400trusted keys, full genuine interaction coverage.500 проектов/437видимых изделий при500raw rows. Normal EventTiming p95:72/64мс; production profiler root p95:42.10/41.60мс. На20клавиш:10 000/8 740 вызовов неизменных Draggable/common-card bodies. Independent ACTUAL_BASELINE_GO; original141old14/new4/6ace/JS/CSS/PNG не редактируются.

Это available-PC component fixture. Полное Next/CRM, staging performance и физический iMac не измерены. iMac недоступен;141 BLOCKED_DEVICE_UNAVAILABLE.

## Immutable visual BEFORE142

Actual v2 receipt `568c2cf3b9376510c01e1359ce2bbb84a8aa2ff147b110bc4c3914247b74c38e`:
`apps/web/test-results/render142-protocol/before/39ead009-b3c2-42e6-a66d-c706606c0f4d/receipt.json`.

6/6 PNG, authority CLOSED_PROVEN; source/dependency/artifact postproof PASS,692pins. Reviewed caller eb91e424…/packet19c9f5c…; frozen141 normal JS/CSS/build6ace, same MANAGER rows, computed font `Arial, sans-serif`, DPR1, reducedMotion reduce.2boards×1440×900/390×844/360×800. Исходники142 при capture ещё не менялись; браузер/contexts/localhost server закрыты и awaited до authoritative receipt. Typing/SQL/Next/stage0.

| Board | Width | PNG SHA256 |
|---|---:|---|
| projects |1440|be6641390cc1c6a59e716b2ee93afe57dd2a435bb7f84efa4bda0526070e61c5|
| products |1440|1a941fefd98fdfc12cbb5807abec1d1dcd297125c84d28b8d05bcbff6db49d64|
| projects |390|2d0b87a16e88a85709baca896b79c48e6a984d368097f5385df2ed62e4fd704d|
| products |390|ef4b310c0b86214148ce9d632f61f56147200a7e1586b5d823eb28b44d3ca352|
| projects |360|d299829068db0a236076f48a515ddbe0af3ee3b56ad258315e25eac1ba3a3c0e|
| products |360|2c71a306c0b479a20b3d842215d9b9c06132c5cb1cb269095bf7f914703285d1|

Все6 PNG просмотрены. Frozen141 App имеет фиксированный desktop margin-left;390/360 изображения являются crop этого standalone fixture. Они приняты только для identical-fixture bytes/full column/card geometry comparison. Полноценная responsive mobile CRM/Onest приёмка требует отдельного actual component harness и staging; её эти кадры не заменяют. На desktop поле поиска1/empty; mobile closed Sheet0/null, открытие Sheet этим протоколом не выполнялось.

Первый run6200fb18… завершился INVALID/2PNG/NOT_CREATED: test-only null.value в closed mobile Sheet. Source/cleanup/postproof flow сохранён, исходный TypeError не скрыт, old run/caller/packet не переписаны. Новый v2 и9negative capsules прошли review до единственного нового запуска. Исходные18stage PNG128 и3local PNG145 не менялись.

## Production implementation

Только:
- `src/app/(app)/projects/kanban-board.tsx`: shallow memo StageColumn/DraggableCard, cached grouped arrays, stable onOpen, прежние PointerSensor options distance8 со стабильной identity.
- `src/app/(app)/products/products-kanban.tsx`: то же для StatusColumn/DraggableProduct; visible statuses и canDrag callback зависят от актуальных roles, onOpen читает current query.
- `src/lib/list-params.tsx`: stable getQuery() читает существующий controller.getSnapshot().query при событии; lifecycle/CAS/debounce/reset не менялись.

Diff50insertions/33deletions, net+17LOC. Нет custom comparator, CSS/DOM markup/server/SQL/schema/API/lock changes. Контекстные объекты прав сохранены;128 исправляет assignment независимо.145 исправляет readiness независимо, его код в142 не добавлялся.

## Local checks

Один own `pnpm install --frozen-lockfile --offline --ignore-scripts`:PASS11.4с,724packages/downloaded0; root/branch/cd38/reparse guards PASS. Package/lock/workspace не изменены. Один own `pnpm --filter @pero/web exec prisma generate`:PASS, Prisma6.19.3/437ms, schema/lock hashes неизменны, DB не открывалась.

Первый targeted run:51/55PASS;4identity-query before hooks остановились на отсутствующем own generated `.prisma/client/default` после ignore-scripts. Это dependency setup failure, не принятое поведение. После static generate повтор:

    pnpm --filter @pero/web exec tsx --test --test-concurrency=1 tests/global-product-thumbnail-navigation.test.ts tests/product-draft-boards.test.ts tests/product-preparation-boards.test.ts tests/list-state-controller.test.ts tests/product-return-navigation.test.ts tests/product-return-navigation-ui.test.ts tests/product-card-navigation.test.ts tests/kanban-identity-search.test.ts tests/product-percentage-ui.test.ts

55/55PASS,0skip. Включены actual cached row/cover callbacks, которые без нового SSR render используют обновлённый query.

    pnpm --filter @pero/web exec node --test tests/kanban-render-observer.test.mjs

3/3PASS: actual4source/8authored functions, memo expression parser, missing/duplicate fail-closed и выполнение counter внутри тела с сохранением directive/return.

    pnpm --filter @pero/web exec tsc --noEmit --incremental false

Один согласованный slot/session3716:PASS. Production source после него не менялся.

Scoped eslint3production/4test paths и git diff --check:PASS.

    pnpm --filter @pero/web exec node tests/kanban-render-isolation.test.mjs --fixture-compile-only

TEST_FIXTURE_COMPILED_ONLY,61physical inputs под текущим web,8authored bodies, genuine React19/DnD/BaseUI/Tailwind и7closed memory Next/server seams. JS6201cf3d…/CSS7d170221…; unknown server/external browser imports запрещены. Functional browser PASS (см.следующую секцию); это development component test, не production profiling/полный Next/SQL/iMac. Public observer согласован с tests owner: готового reusable161/163 surface нет, common163 не менялся.

## Still required

Preliminary CODE_GO получен, владелец разрешил atomic local candidate commit; фактический commit ещё предстоит; новая strict clean-candidate AFTER compilation/runtime recipe с independent review и root quiet window; matched5×20metrics0card bodies/rootp95≤16ms; full responsive/preservation comparison; ordinary root staging merge/CI/exact deployed SHA/image/health/data/role/query acceptance и joined128/145 regressions. Все эти пункты пока NOT_RUN/PENDING; задача142 не завершена.

SAFETY D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP при guard mismatch. Restic/dumps/reset/seed/newDB/production не затрагивались. Другие авторы/рабочие деревья сохранены.
## Actual functional browser and preliminary review

    pnpm --filter @pero/web exec node --test tests/kanban-render-isolation.test.mjs

Session62456:1/1PASS,16.0с,17actualcontracts,0skip. Output `test-results/kanban-render-isolation/8a29919c-46bd-4263-bfb8-2da84ba35c58/`.
Receipt raw SHA256 `e72901331e12f1eba0cc4624c48e87cac26751cb448368ab020726bac1d2ffd9`;
source-manifest raw SHA256 `63414a5802c1b3808218a378981756bbd5b6772df84f37e2eca2abbff2700597`, logical declaration hash `f17e350976a5dedc5b97826d46b1537fc7f83abb07ec2adf331fe623343b1853`.

Реальные React19 Views/list controller/DnD/BaseUI/Tailwind;61physical source inputs под текущим web,8authored bodies. Набор immediate/post-debounce до замены rows исполняет0 неизменных card/column bodies; callback/getter identity остаётся прежней, desktop caret18. Новые DTO/title/price/quantity/amount visibility, роли/union/current-engineer columns/DRAFT и canManage обновляют интерфейс. Настоящие PointerSensor/overlay/Escape/refusal rollback/success выполнены для обеих досок. Actual hook getter проверен на pending save/coalescing/external navigation/настоящем history-popstate+RSC/late prior reply и отдельном reset; row returnTo использует текущий query. Клик по cover и cached callbacks отдельно проверены SSR.

Fullwidth mobile harness имеетpadding16 без sidebar offset;390/360 для обеих досок открывают реальную Sheet, вводят draft без card-body calls и закрывают её.4PNG просмотрены: projects390 b3dc946a…, projects3606723fff7…, products390b33ede02…, products3604e0ba1cb… . Это дополнительный functional responsive fixture, не baseline500 и не полноценный Next/Onest/staging. Исходные6 before PNG не заменялись.

Харнесс до запуска прошёл independent protocol review b24f5854…; исправлены test-only PASS-before-finally и back-reset masking. Каждая попытка пишет вfresh UUID; authoritative receipt создан после успешных awaited browser/server cleanup и повторных61physical source hashes. Actions/preferences/navigation — controlled memory fixtures; все unknown server imports/HTTP requests отвергаются. SQL/реальные business writes отсутствуют. Это не evidence100ms SLO/physical iMac/native constraints.

Независимый PRELIMINARY_CODE_REVIEW_GO: source3/test4, actual61pins0mismatch/17checks/cleanup приняты, runtime findings0. Root разрешил atomic LOCALcandidate commit после documentation update. Source иtests после проверенного packet не менялись; последние изменения только этот evidence/tasks. AFTERmetrics/pixelcomparison на том же500fixture, joined128/145 и realstaging остаются PENDING. Stagingpush/merge не выполняет автор до этих gates; main/production запрещены.

Общий source guard163 изменён отдельно на33c0a…(Next config/Docker pins); frozen9c/c915 bytes+provenance сохранены tests owner. Accepted старые6ace/c5e/568c historical CLOSED anchors не переписываются. Их старые absolute caller нельзя запускать с заменённым shared helper. AFTER142/new143 используют fresh reviewed source/context/helper seals и явную связь с historical anchors.
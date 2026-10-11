# Evidence — задача142

## Current Status

LOCAL_VALIDATION_PASSED_STAGING_PENDING. Ветка `bugfix/142` от принятого `cd38cb745759becd58dbbad4d6d37afa03f0ab7a`; локальный candidate commit `f49baaee0a59a31dfc0e672e68935d3db30d5819` после preliminary CODE_GO. Независимые DESIGN_GO и ACTUAL_BEFORE_GO получены до изменений трёх production файлов. Actual AFTER assets, measurements и visual comparison прошли независимую приёмку на доступном ПК. Main/production запрещены; ordinary root staging integration, совместная регрессия128/145 и фактическая staging-приёмка ещё требуются.

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

Финальные independent METRICS_VISUAL_GO и LOCAL_DOC_REVIEW_GO получены; root разрешил отдельный documentation commit только evidence/tasks после освобождения quiet window. Измеренная ревизия f49 сохраняется как source anchor; documentation commit не меняет production source/tests/66 QA controls. Root фиксирует SHA документационного коммита отдельно. Ещё требуются ordinary merge задачи, CI и приёмка реального staging SHA/image/health, desktop/mobile search/returnTo/focus/DnD/role/data preservation и совместная регрессия128/145. Эти integration/staging пункты PENDING; задача142 не завершена. Physical iMac недоступен, полный Next/runtime приложения этим компонентным замером не покрыт.

SAFETY D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP при guard mismatch. Restic/dumps/reset/seed/newDB/production не затрагивались. Другие авторы/рабочие деревья сохранены.
## Actual functional browser and preliminary review

    pnpm --filter @pero/web exec node --test tests/kanban-render-isolation.test.mjs

Session62456:1/1PASS,16.0с,17actualcontracts,0skip. Output `test-results/kanban-render-isolation/8a29919c-46bd-4263-bfb8-2da84ba35c58/`.
Receipt raw SHA256 `e72901331e12f1eba0cc4624c48e87cac26751cb448368ab020726bac1d2ffd9`;
source-manifest raw SHA256 `63414a5802c1b3808218a378981756bbd5b6772df84f37e2eca2abbff2700597`, logical declaration hash `f17e350976a5dedc5b97826d46b1537fc7f83abb07ec2adf331fe623343b1853`.

Реальные React19 Views/list controller/DnD/BaseUI/Tailwind;61physical source inputs под текущим web,8authored bodies. Набор immediate/post-debounce до замены rows исполняет0 неизменных card/column bodies; callback/getter identity остаётся прежней, desktop caret18. Новые DTO/title/price/quantity/amount visibility, роли/union/current-engineer columns/DRAFT и canManage обновляют интерфейс. Настоящие PointerSensor/overlay/Escape/refusal rollback/success выполнены для обеих досок. Actual hook getter проверен на pending save/coalescing/external navigation/настоящем history-popstate+RSC/late prior reply и отдельном reset; row returnTo использует текущий query. Клик по cover и cached callbacks отдельно проверены SSR.

Fullwidth mobile harness имеетpadding16 без sidebar offset;390/360 для обеих досок открывают реальную Sheet, вводят draft без card-body calls и закрывают её.4PNG просмотрены: projects390 b3dc946a…, projects3606723fff7…, products390b33ede02…, products3604e0ba1cb… . Это дополнительный functional responsive fixture, не baseline500 и не полноценный Next/Onest/staging. Исходные6 before PNG не заменялись.

Харнесс до запуска прошёл independent protocol review b24f5854…; исправлены test-only PASS-before-finally и back-reset masking. Каждая попытка пишет вfresh UUID; authoritative receipt создан после успешных awaited browser/server cleanup и повторных61physical source hashes. Actions/preferences/navigation — controlled memory fixtures; все unknown server imports/HTTP requests отвергаются. SQL/реальные business writes отсутствуют. Это не evidence100ms SLO/physical iMac/native constraints.

Независимый PRELIMINARY_CODE_REVIEW_GO: source3/test4, actual61pins0mismatch/17checks/cleanup приняты, runtime findings0. Root разрешил atomic LOCALcandidate commit после documentation update. Source иtests после проверенного packet не менялись; последние изменения только этот evidence/tasks. AFTER metrics/pixel comparison на том же500 fixture выполнены (см.ниже); joined128/145 и realstaging остаются PENDING. Stagingpush/merge не выполняет автор до этих gates; main/production запрещены.

Общий source guard163 изменён отдельно на33c0a…(Next config/Docker pins); frozen9c/c915 bytes+provenance сохранены tests owner. Accepted старые6ace/c5e/568c historical CLOSED anchors не переписываются. Их старые absolute caller нельзя запускать с заменённым shared helper. AFTER142/new143 используют fresh reviewed source/context/helper seals и явную связь с historical anchors.

## Actual clean-candidate AFTER compilation

Source candidate: `f49baaee0a59a31dfc0e672e68935d3db30d5819`. Root compile session90193/exit0; `test-results/render142-protocol/after/build/7b83b76b-40f4-4f43-9d18-086f1fad2700/compiled-receipt.json` SHA256 `25c1a0a0eff61eb3b501043ca5a933848a1ce781bea01ee21b1f8c0690085188`. CLOSED: full source/dependency/artifacts pre/post PASS;725 source pins, own frozen dependency inventory50513/digestabdf0…, common source guard33c0a… с Next config/Docker pins.

Обе sealed IIFE имеют2120 actual compiler inputs и2049 фактических dependency inputs, логически и побайтно совпадающих с historical141 build. Production closure72→74 отличается только тремя согласованными f49 source файлами и двумя новыми обязательными config pins; normal7/profiling11 reviewed virtual inputs. React/ReactDOM19.1.0, scheduler0.26.0, production normal/profiling; authored body bindings normal0/profiling8. Перед actual operation reviewed AST-derived resolver направляет только React/ReactDOM/JSX-runtime импорт точного historical entry в own frozen dependencies, сохраняя guard остальных imports. Failed прежняя сборкаbff/INVALID сохранена; повтор не выдан за исходный PASS.

JS normal1070935/gzip204168, profiling1084611/gzip206868: каждый вырос на410 байт (gzip+152/+146); снижение bundle size не заявляется. CSS170815 вместо170783: ровно одна добавленная утилита `.row-1 { grid-row: 1; }` из synthetic test ID, отсутствующего вsrc/packages/frozen fixture. Globals CSS source SHA одинаковый6727419d…; before CSS87a8a3de…/after7d170221… . CSS/source/fixture/golden не менялись ради совпадения; actual6PNG comparison ниже совпал. DOM selector count отдельно NOT_RUN.

Независимые COMPILE_PROTOCOL_GO, ACTUAL_ASSETS_GO и separate CAPTURE/BENCH_PROTOCOL_GO получены для packete7e31e…/preparedf35d8c…/metadata662107…;66 QA producer pins сохранялись на протяжении операций. Root выдавал отдельный one capture и quiet benchmark; renderer/binary/cadence/observer semantics исходного141 сохранены.

## Actual AFTER available-PC measurement

Команда: существующий reviewed `node apps/web/test-results/render142-protocol/after/after142-caller.mjs <root-approved benchmark args>`; root session38146/exit0, отдельное quiet window. Output `test-results/render142-protocol/after/benchmark/46a10c97-7c7e-494f-87bc-a8467402aaa8/`.

Authoritative accepted-receipt SHA256 `a0aff4af83c0ac11c27c67074417cb6364201ad4f11ff8abcb5e9cdf7341592b`; provisional raw receipt `dd2ec4c5a248beb13c90fdba3b0e3ffc42ef6779232d9c582a472d0368654f55`. Final CLOSED с full source/dependency/artifacts postproof PASS; authoritative PASS после own browser/server cleanup. Ровно20 серий,400 trusted keydown/keyup/input,5×20 клавиш для каждой из двух досок в normal и profiling cohorts. Dataset500raw/500projects/437visible products; MANAGER,1440×900,DPR1,Arial,sans-serif,Chrome153.0.8010.12,Windows10/i9-10900F/32GB,без throttling. Enqueue80±20мс: максимальный jitter15.1867мс; caret active20/20 во всех сериях; long tasks внутри записанных серий0. Никакие медленные samples не отброшены.

| Метрика | Проекты | Изделия |
| --- | ---: | ---: |
| Profiling React root actualDuration p95 before → after, мс | 42.10 → 2.10 | 41.60 → 1.90 |
| Profiling after observations / max, мс | 200 / 3.10 | 200 / 2.60 |
| Каждая Draggable/common-card body на20клавиш before → after | 10000 → 0 | 8740 → 0 |
| Каждая Draggable/common-card body post-idle before → after | 1000 → 0 | 874 → 0 |
| Normal Event Timing observed / expected | 78 / 100 | 85 / 100 |
| Normal missing или censored | 22 | 15 |
| Normal observed-only latency p95 / max, мс | 40 / 48 | 40 / 56 |

React actualDuration описывает длительность React commit в отдельном profiling cohort; это не keyboard-to-paint/input latency. Root p95 снизился примерно95.01%/95.43%, бюджет≤16мс выполнен. Колонки также имеют0 authored-body calls на ввод и после idle, пока rows не заменены. Board bodies продолжают выполнять21/20 вызовов на ввод и2 после idle; утверждения «вся доска больше не рендерится» нет. Normal build не инструментирован, его body counters не выдаются за нули.

Event Timing имеет threshold16мс и granularity8мс;37 из200 normal interactions отсутствуют либо censored. Полный p95 для всех100 клавиш каждой доски неизвестен (null), пропущенные записи не считаются нулями или гарантированно быстрыми. Только observed subset имеет p95=40мс; per-repetition p95 projects40/40/48/40/40, products48/40/40/56/40. Доказательства не устанавливают полный100мс SLO CRM и не решают инцидент на недоступном iMac. Счётчики keyboards полны независимо от Event Timing coverage.

Независимый METRICS_VISUAL_GO получен: raw20 samples/400trusted/cadence/0cards/React summaries повторно проверены reviewer. Дополнительный readonly пересчёт frozen metrics141 каждого sample и aggregated summaries сохранён в root visualization `after142-final-verification.json` SHA256 `702bcc75e06941105eb225be0147ff26f5fd49da1b3aacb1ca13bf8c5103ddfd`.

## Actual AFTER immutable visual comparison

Root capture session71525; `test-results/render142-protocol/after/capture/f21d3b58-1bd7-4177-afa0-cad838ca852b/accepted-receipt.json` SHA256 `2c344d42411cb9ea6f2bd4d3cd4f20612a17c8a5f2bececfe14b99ac7cbc99b3`, CLOSED/awaited cleanup/full source/dependency/artifacts proof.6/6 PNG hashes и полная geometry exact равны before568c2…: projects/product1440×900,390×844,360×800. В benchmark дополнительно4 normal/profiling desktop screenshots byte-equal исходным141 screenshots. Ни один before anchor не обновлялся.

Mobile500-fixture сохраняет historical desktop sidebar offset; это byte/geometry comparison того же cropped fixture. Отдельный fullwidth mobile functional harness4PNG/Sheet/drafts принят ранее. Полная responsive приёмка реального Next/Onest/staging остаётся отдельным integration gate. Physical iMac BLOCKED_DEVICE_UNAVAILABLE; fullNext/staging/joined128145 PENDING. Production source/tests и66 frozen controls после измерений не менялись; настоящих business writes/SQL/RESTIC/dumps/reset/seed/newDB не было.

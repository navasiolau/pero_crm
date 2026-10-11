# Design

## Context

Мотивация — proposal.md. Планирование задачи156 идёт в feature/156 от fresh origin/staging d121f0798e963f32d13f52c9bde57c0aa82b7929, own worktree improvements-156. Зависимость159 принята root ранее; её карта требует отделять obsolete UI tests от исторической финансовой совместимости. Этот контекст описывает frozen baseline; текущая реализация exact6paths и фактические локальные проверки находятся в evidence.md.

Readonly inventory охватил apps/web/src, tests, scripts, apps/telegram-bot, packages, deploy и .github: 1236 текстовых файлов, из них1199 TS/JS AST. Parser — уже установленный TypeScript5.9.3; приложение не исполнялось, зависимостей в156 нет. Для двух target modules найдено три runtime test imports, ноль production imports/reexports, ноль найденных literal dynamic consumers. В production-коде не найдено неизвестных вычисляемых import()/require() для этого обхода; createRequire scripts отдельно читают esbuild/tsx, plugin lazy imports именуют собственные slots. Текстовое отрицательное упоминание EngineeringFund в product-single-page.test.ts — guard отсутствия старого UI, не потребитель; сохранить.

Actual product page импортирует SinglePercentageRow из product-percentage-panel и рендерит ENGINEERING/ASSEMBLY/INSTALLATION. Старые модульные tests не доказывают, что EngineeringFund всё ещё доступен пользователю.

## Goals / Non-Goals

**Goals:**

- Удалить ровно два подтверждённых orphan source modules: 108 physical LOC и девять exports.
- Удалить десять blocks, которые обслуживают только эти targets, сохранив обе живые части mixed fallback file и UUID regression без ослабления assertions.
- Не менять действующий SinglePercentageRow, его controllers/ACK/dirty/null-zero/frozen semantics или финансовые readers/snapshots.

**Non-Goals:**

Новая расчётная формула, реорганизация shared helpers, изменение прав, исходных финансовых записей/моделей/миграций, удаление compatibility DTO/readers/preview, новые зависимости, оптимизация production bundle или исправление iMac. Root stage-приёмка — отдельный этап после local/review/merge; main/production не разрешены.

## Decisions

### Exact file allowlist

Только следующие шесть source/test paths:

| Path | Action | Boundary |
|---|---|---|
| apps/web/src/lib/inline-percentage-projection.ts | DELETE | Весь orphan module, 20 physical LOC, только три exports. |
| apps/web/src/components/engineering-fund.tsx | DELETE | Весь orphan readonly UI и его четыре helper exports, 88 physical LOC; всего шесть exports. |
| apps/web/tests/inline-percentage-projection.test.ts | DELETE | Все три blocks обслуживают удаляемый target. |
| apps/web/tests/product-engineering-fund-ui.test.ts | DELETE_AFTER_MOVE | Сначала дословно сохранить block createRequestId; остальные семь blocks — old component/helpers. |
| apps/web/tests/inline-engineer-fallback.test.ts | MODIFY | Убрать только import canRebaseSuggestedParticipants и зависимую assert.equal на baseline line23; оба test blocks и остальные query/helper assertions сохранить. |
| apps/web/tests/request-id.test.ts | ADD | Три необходимых imports плюс дословно перенесённый live UUID block; request-id implementation неизменен. |

Source deletion использует literal абсолютные пути внутри improvements-156, lstat/realpath/reparse guards и сверку source pins. Не применять recursive glob cleanup или удаления каталогов; при mismatch STOP согласно D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md. Любой обнаруженный новый production consumer исключает target из автоматического удаления до root review.

### Source exports and consumers

| Module | Exports | Actual outside consumers |
|---|---|---|
| inline-percentage-projection.ts | projectedPercentagePrice, canRebaseSuggestedParticipants, projectedPercentageTotal | Runtime imports только в inline-percentage-projection.test.ts:3 и inline-engineer-fallback.test.ts:6. Production/bot/packages/scripts consumers не найдены. |
| engineering-fund.tsx | parseFundRate, conversionRequestKey, parseFullStageMapping, initialConversionTaskPercents, EngineeringFundSummary, EngineeringFund | Runtime import только в product-engineering-fund-ui.test.ts:7. Component internal Summary/WorkDetails calls остаются внутри orphan module; это не внешний entry point. |
| engineering-fund-view.ts | EngineeringTaskView/EngineeringWorkView/EngineeringFundView, percentToStageUnits | KEEP: server/products/engineering-view.ts использует DTO type-only; product-engineering-view.test.ts использует percentToStageUnits runtime. Не смешивать этот контрактный модуль с orphan component. |

Альтернатива с удалением whole engineering-view chain отвергнута: исторические settlement names/quantities/weights и legacy preview требуют отдельного совместимого решения. Альтернатива с удалением всех смешанных tests отвергнута из-за живых query и cryptographic UUID contracts.

### Exact test-block classification

Строки относятся только к baseline d121f079; имена/AST hashes дополнительно сохранены в planning-inventory.json.

| File / baseline lines | Block | Decision |
|---|---|---|
| inline-percentage-projection.test.ts:4–7 | DRAFT uses newly acknowledged unit price, including zero/null; frozen snapshots unchanged | REMOVE_ORPHAN_HELPER: действующие null/zero/frozen проверки остаются на single-product-percentage-ui и SinglePercentageRow. |
| same:8–12 | only pristine suggested receiver follows acknowledged engineer; explicit recipients and drafts stay | REMOVE_ORPHAN_HELPER: текущие dirty/receive/conflict/ACK checks остаются в single-percentage-controller. |
| same:14–17 | DRAFT total follows acknowledged unit price and existing rate; no quantity multiplier or frozen rewrite | REMOVE_ORPHAN_HELPER: формулы v1/v2/v3 и frozen states проверяются действующим single helper. Не переносить старую общую формулу в текущий UI. |
| inline-engineer-fallback.test.ts:10–16 | query explicitly distinguishes fallback member from real configuration even when revision0 | KEEP_LITERAL: живой getProductPercentageView query и hasConfiguration/revision0 assertions целиком. |
| same:17–26 | real query fallback follows new acknowledged engineer while configured/frozen members stay | KEEP_MIXED: сохранить query/initialProductPercentageParticipants/new recipient/configured/frozen assertions; удалить только orphan canRebase assertion line23 и соответствующий import line6. |
| product-engineering-fund-ui.test.ts:16–24 | SSR summary distinguishes unset, zero, paid and legacy-protected states | REMOVE_ORPHAN_UI: не удалять current SinglePercentageRow null/zero/frozen tests или historical readers. |
| same:26–32 | mapping requires exact membership and 100 percent; accepts explicit zero without normalization | REMOVE_ORPHAN_UI_HELPER: parseFullStageMapping не используется действующим UI/сервером; financial stage/core tests сохраняются. |
| same:34–37 | single conversion task defaults to 100 but multiple tasks require explicit financial mapping | REMOVE_ORPHAN_UI_HELPER: initialConversionTaskPercents не имеет production consumer. |
| same:39–44 | fund rate accepts unset and explicit zero, and refuses a third decimal | REMOVE_ORPHAN_UI_HELPER: старый parseFundRate не является текущим rate validator; действующие limits/zero tests не менять. |
| same:46–54 | conversion idempotency key is stable for identical mapping and changes with revisions or shares | REMOVE_ORPHAN_UI_HELPER: conversionRequestKey нигде не отправляется в действующие writers; server idempotency/ACK/requestID tests сохраняются. |
| same:56–59 | request id falls back to cryptographic random bytes when randomUUID is unavailable | MOVE_LITERAL: сохранить exact AST text/sha0e048375cc22dd78f4f66f510470f2275f7635e888c9d5c8c1c46f1281c1c2e3 в request-id.test.ts; active lib/request-id.ts сохраняется. |
| same:61–76 | fund component remains readonly even for management and old editable draft flags | REMOVE_ORPHAN_UI: это закрытый component, реальный UI role/privacy checks остаются. |
| same:78–102 | readonly historical fund keeps physical quantity and exact amounts without task share percentages | REMOVE_ORPHAN_UI_ONLY: historical dataset/readers и product-engineering-view tests остаются byte-identical. |

### Protected code and tests

Не менять source shared product-percentage-ui.ts, request-id.ts, engineering-fund-view.ts, server/products/engineering-view.ts, server/product-stage-pay/preview.ts, server/product-percentage-pay/*, SinglePercentageRow/product-page и financial schema/migrations. Даже если отдельный retained helper пока имеет только тестового потребителя, он не расширяет утверждённый allowlist156.

Сохраняются действующие suites: single-percentage-controller (7 blocks), single-percentage-action-transport (3), single-product-percentage-ui (4), product-percentage-visibility (7), global-percentage-defaults-ux (5), product-engineering-view (2), single-product-percentage-schema, single-product-percentage-core, product-stage-pay, product-percentage-pay, product-single-page. Null/zero, dirty drafts, exact lost-ACK replay, frozen retry and totals, own/foreign privacy и исторические snapshots продолжают проверяться здесь, а не в отключённом UI.

### Metrics and verification

- Production target source: 20+88=108 physical LOC / 8447 UTF-8 bytes, девять exports → ноль target modules. Это source footprint, не executed-JS savings.
- Исходные candidate test files: 17+26+102=145 physical LOC и13 blocks. После planned operation два mixed blocks остаются в24-line file, UUID block переносится в новый8-line file: expected source/test footprint32 physical LOC /3 blocks; net test LOC−113 и obsolete blocks−10. Фактические counts проверить после implementation; число выполненных tests сейчас не измерялось.
- Удалённые старые названия могут остаться в документации и negative guards; required result — отсутствие source module и executable/type/dynamic consumer edges к нему, а не бессмысленный запрет каждого текстового упоминания.
- Implementation сначала revalidates baseline pins/consumer graph, сохраняет exact UUID block и обе mixed query portions. После этого проверяет actual allowlist, целостность protected source/test bytes, typecheck/lint и targeted current suites. Не создавать зеркальные tests удаляемых helpers.
- Whole source/type graph проверяется typecheck; production chunks можно сравнить только отдельным actual build/manifest с зафиксированным SHA. Пока NOT_MEASURED, обещания JS/latency экономии запрещены.
- Root staging принимает actual revision/image/health и read-only product card в management и ограниченной employee роли: тот же внешний вид/own amounts/null-zero/frozen отображение; никаких финансовых записей или их пересчёта ради QA.

## Risks / Trade-offs

- Mixed test удалён целиком → exact block/import/assertion allowlist и независимый diff review, первый query block literal hash неизменен.
- Live UUID regression исчезла вместе с fund test → MOVE_LITERAL до удаления, body AST hash сравнить и execute один перенесённый test.
- Candidate financial source цепочка случайно расширена → protected pins и запрет scope роста без root approval; raw Prisma fields/settlement DTO/models/rows/migrations исключены.
- Новый production consumer появился после baseline → fresh inventory на candidate/integration revision; STOP, не перенаправлять callers ради cleanup.
- Source LOC выдан за browser performance → executed-JS/chunks NOT_MEASURED до actual build, инцидент iMac эта задача не закрывает.
- DOM regression при прочих интегрируемых задачах → actual staging SHA и affected card scenario принимает root; source inspection не заменяет runtime/visual приёмку.

## Migration Plan

Миграций нет. После planning scope-review и отдельного ROOT_RELEASE_IMPLEMENTATION: feature/156 → local checks → independent CODE_GO → разрешённый atomic commit → root normal merge staging/CI → actual staging acceptance. Main/production запрещены до прямого указания владельца. Implementation выполнена после independent DESIGN_GO60cc и отдельного ROOT_RELEASE. Local checks — по evidence.md; независимое CODE review пройдено, root разрешил atomic commit; staging acceptance NOT_RUN.

## Reviewed map maintenance156

Перед staged integration фактический --check affb39 упал ENOENT на удалённом inline-percentage-projection.test.ts: validateMatrix читает каждый active disposition.file, включая RETIRE. Minimal data-only scope: docs/testing/contract-matrix.json плюс proposal/design/tasks/evidence и retired-test-dispositions.md этой задачи. Ровно два resolved RETIRE rows убраны из active18→16 и сохранены исторически; UUID KEEP перенаправлен на фактический request-id.test.ts. Все19contracts/27targets/CI/baselinePolicy и прочие active rows семантически неизменны. Validator и source guards не ослаблены/не редактируются; fresh current --check отдельно от frozen3819coverage, полный baseline не повторять.

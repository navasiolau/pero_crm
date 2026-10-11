# Verification

Дата: 11.10.2026. Ветка feature/163, база d121f0798e963f32d13f52c9bde57c0aa82b7929 после обычного FF merge. Статус: LOCAL_SOURCE_READY; кандидат ещё не закоммичен. Полная приёмка №163, Linux standalone и native-сценарии остаются NOT_RUN. Main и production не менялись.

## Текущий scope

Протокол связывает declaration, source manifest, bundle и настоящий raw result с revision, target, runId, scenarioId, producer/version и identity. При отсутствии обязательного доказательства результат остаётся NOT_RUN/BLOCKED; UNKNOWN сохраняет intent/raw и требует inspect без автоматического повторения или cleanup. Runtime, HTTP, browser и native PostgreSQL — разные уровни доказательств.

После фактического app-scoped package UNAVAILABLE согласован один production hunk: apps/web/next.config.ts добавляет literal zod к существующему serverExternalPackages. SHA:20b55110a23e0619f00dd045f7f894f7659fe8892037d180efbd0e84c5bc7ff1. Версии, lockfile, исходный Dockerfile, contracts, валидаторы и стандартная локаль не меняются. Прежнее обещание QA-only уточнено в planning. Source implementation этого hunk не является Linux/runtime приёмкой.

Source guard SHA:33c0a02f8015c4962c5b6436daa173cae7d3d8bdae94b5137e648a1e0b778479. Required inputs дополнены только двумя literal paths: next.config.ts и Dockerfile. Старые 9c8e/c915 bytes и historical path mapping сохранены после подтверждённого IDLE всех производителей. Завершённые старые receipts исторически действительны; их callers не получают разрешение на новый запуск с изменённым control path.

## Actual local checks

- Fresh targeted pure/source/cold run после FF130 и config hunk:61/61 PASS,31.8s. Это protocol15, coordinator14, actual esbuild/Git/physical source10, V8 regressions8, native cold/preservation/prerequisites14. БД, Docker, network и native operations не выполнялись.
- Fresh полный strict web TypeScript: tsc --noEmit --incremental false, session72012, exit0. Scoped ESLint через настоящий неизменённый pnpm-generated shim:17 QA files +next.config.ts, exit0.
- Source tests отклоняют manifestA/declarationB до transport, неверные actual ABI и raw identity, физический WIP import из другого worktree и bytes drift до onLoad. Local normalized CID не может подменить сохранённый raw CID.
- Native safety source получила независимое CODE/NATIVE_PROTOCOL_GO: exact owned IDs/UUIDs, outer fsync PRE, readonly inspect, narrow PK locks, incoming/composite FK checks и original fingerprint ДО первого delete. Rollback/falsy/dual failure и текущие constraints/indexes/triggers проверены локальными fault cases. Это не actual SQL proof.
- V8 interval extraction сохраняет exact accepted cd38 function body d1823e4b… и8 meaningful regressions. Исторический159 raw capture от3819 не проходит source-content guard противcd38; raw сохранён, новая coverage текущегоSHA не заявляется.
- Dependencies устанавливались frozen/offline/ignore-scripts, без обновления lock/version. Environmental tsx/ESLint/Temp access failures исправлялись разрешёнными source-only invocations; критерии не ослаблялись.

## Immutable readonly attempts

Root выполнил старый limited inspect a8d4…/cd38/local74 один раз: UNKNOWN / EXECUTION_HOLD_INSPECT_REQUIRED. Сохранились intent/source/receipt, raw отсутствует, stderr пуст. Это не доказывает SQL0, INSPECT_PASS или полный original fingerprint. Повторения и использования старого plan/PRE не было.

Отдельный bounded readonly diagnostic98582127-9f57-4109-8044-a4e918d434cd получил21 cold и19 operator cases. Root выполнил один reviewed run: DIAGNOSTIC_HOLD, warehouse-readiness / ACTIVE_WAREHOUSE_REQUIRED. Пройдены target, module, constructor, SET TRANSACTION READ ONLY, DB identity, count74 и existing unit. Catalog queries не получили PASS; owned graph/PRE не создавались. Source manifest до/после6a94039e… совпал, sanitized raw receipt28b967… сохранён. Это диагностика prerequisite, не полная приёмка.

После отдельно разрешённой миграции135 текущий local catalog имеет75 migrations. Old74 bundles не повторяются и не переобозначаются. Для будущего full local native необходимы exact known135 compatibility qualification, fresh catalog/protected fingerprint и новый runUUID. General drift acceptance запрещена. warehouse_main не инициализируется ради QA.

## Zod и packaging B

Original percentage bundle389763 bytes превышал неизменённый лимит262144. Full actual metafile показывает79 Zod ESM inputs; причиной удержания public namespace/locales является contracts import{z}, а не SDK. A named QA shim388536 иC UTF-8 code generation332168 остались size HOLD. D с7 public factories/13calls собрал135745 bytes, но в двух fresh runtimes22 vectors дали7 valid same/15 invalid different: потерялись default English errors. D не перенесён в production; ручной config(en), проекция валидаторов/локалей и повышение лимита не применялись.

Local full PUBLIC CJS source closure: Zod4.4.3, treeShaking:false, package.json+79 actual imports=80 files, digest2161130fa17bc3c3b26053f36e4b45775d7bd57f96dafa272984ec8cdede1b60. File proof не является validator/native acceptance.

Root app-scoped readonly baseline1437fe7e-f30c-49da-97d4-3b6336f94647 наactuald121/imagec7: BASELINE_PACKAGE_UNAVAILABLE, public-cjs-resolve / MODULE_NOT_FOUND. Node22.23.3, appAnchorVerifiedtrue, packageResolvedfalse, filesChecked0, libraryEvalfalse, SQL0. Source before=after33b069…, raw SHA:d487e1491819452207f5ae83e9d2d267b7f5add7e87d7834be66e6768d43e994. Независимое ревью приняло этот фактический baseline; он разрешил conditional B source prerequisite, не полный163 PASS.

Новый один pure CJS reader bfaaa9c0… иwrapperv2 d49e814d… имеют только два fixed modes: app-runtime/standalone-build. Source node_modules fallback изstandalone отказывает доfile reads; package/version/root/link/pre/post80 guards сохранены.18/18 DI/cold PASS иSOURCE_CODE_GO. Original aca0/test/builder snapshot иcompleted1437 не изменены; новых stage probes не было.

## Linux preparation

Root read-only facts: cached Linux/amd64 node:22-alpine RepoDigest16e22a55…, desktop-linux/docker driver BuildKit0.31.1,54 cache entries. Immutable external Dockerfile frontend cache NOT_VERIFIED. Exact installed v0.31.1 source не поддерживает master BUILDKIT_SYNTAX builtin override. Непроверенный флаг не используется; --network=none ограничивает RUN и сам по себе не запрещает registry resolver.

Разрешён только private QA Dockerfile derivative с удалением одной первой #syntax строки. Все остальные instruction bytes совпадают: originalb416f3b4… остаётся неизменным, derivative5fa5a065…. Compiler label — builtin BuildKit0.31.1, originalCIRecipe:false.2 source capsules PASS. Target build не исполняет runner CMD/prisma migrate deploy. Inspection container требует отдельного source/protocol GO, entrypointnode/networknone/read-only и exact own lifecycle.

Первый source-only context draft2124f27f… содержит2203 inputs/digest470347…, private variants0, physical pins до/после иone app config delta. Build/containers не запускались. Draft не executable: producer32872d76… перенёс tracked иactual untracked check-attr ДО git status; после final source freeze нужен fresh context. Финальный packet требует installed CLI prefer-local proof, exact base image ID/selected NODE_VERSION и root ONE_BUILD_GO. Offline cache miss → STOP без автоматического registry/pull/network/daemon change.

## Оставшиеся проверки

Независимое ревью current source candidate перед локальным commit; exact Linux source/context/derivative/operator packet; actual standalone80 без source fallback и полная22-vector schema/default-English parity в fresh contexts. Затем reviewed literal dependency loader/compiler binding с прежним cap262144 и source/run/image/dependency hashes до/после.

Actual warehouse/percentage на existing guarded target — после fresh identity, квалификации schema, durable outer PRE и индивидуального root window. Supporting129/131/frontend сценарии остаются у доменных авторов; unit/DI/identity не подменяют native/HTTP/browser.

Root normal merge/CI API → actual new staging SHA/image/health и meaningful runtime receipts. FULL163 остаётся NOT_RUN/BLOCKED до всех required rows.159 read-only smoke принят отдельно; его задачи/evidence не изменены. Main, production, restic, dump/reset/seed/newDB иwarehouse initialization запрещены.

## Qualification HOLD: migration history

Root обнаружил семантическое расхождение четвёртой staging migration nonempty_rates: applied SHA d0948074ff79ac17f365490440c851650550910a6909d952ca278464b3f80a62 соответствует старому SQL с двумя NULL→0 UPDATE, а текущий Git277540… добавляет INSERT для трёх отсутствующих zero ProductPercentageConfig. Это не CRLF-only отличие. Alias/checksum normalization не разрешены. Владелец отдельно разрешил исправление167 у финансового автора; оно не входит в25path scope163. Native qualification163 остаётся HOLD до exact исправления/нового ledger proof и fresh protected fingerprint. Local checksums не предполагаются по staging данным: необходима новая root readonly observation в отдельном window. Linux packaging/file-only work не доказывает исправление history и не закрывает native.

## Shared18 source preparation

Только source/local-cold, actual SQL/session/HTTP/browser/setup0. feature163 a509 является исходной точкой, а актуальный deployed SHA/catalog назначает Root после167/135. Новая группа не объявляется принятым stage75/76 до отдельной qualification.

- Original29 existing117 cold cases PASS (tool468fb4). Расширенная final matrix37/37 PASS (tool3c41d8), concurrency1: V1/V2 HMAC/registry, восемь IDs/четыре роли, single row blueprint, prefix arrays, exact ledger/checksum/catalog refusal, compiled Bell closure, own detail GET и manager-only preference boundary. Реальный Next15 compact ACK codec сохранён.
- Первый restricted-token run8d2acd завершился os.userInfo/uv_os_get_passwd ENOMEM до cases; сохранён как environment failure. Elevated targeted run использует те же pinned dependencies без install/version/env changes.
- Source grammar и git diff --check PASS (133384). Application/config/dependencies/schema/transport source0diff в cohort дополнении. Common33c source helper, old CLOSED artifacts, local c665/80CJS/full22 proof не изменяются и не повторяются.
- Code/protocol review, accepted closure build и actual cohort lifecycle пока NOT_RUN. Статус/DnD actions остаются failclosed до конкретного audited effect registry; frozen money assertions не подменяются row blueprint или browser evidence.

Final shared18 source delta: actual handoff body regression проверяет fresh engineer profile после known manager ACK и refusal manager mint при nonempty current preferences. Final38/38 PASS f5346e, scope — cold QA body / genuine Next codec, не SQL/native/session. Scoped lint da4a4d PASS0warnings через уже установленный own .pnpm plugin resolution с finally-restored NODE_PATH, без reinstall/version changes. Strict/diff51aa0a PASS. Previous37/source-packet-v1 сохраняется как история. Actual accepted-source bundle/catalog/lifecycle/status-effect registry по-прежнему NOT_RUN.

Shared18 detail-navigation v3: accepted own product GET позволяет только returnTo с canonical own products query либо exact own project ?tab=products; project detail допускает только tab=products. Actual source lib/product-return-navigation.ts подтверждает эти две формы. Foreign/finance/external/missing-own-filter/duplicate query отказ сохраняется. Final39/39 cold PASS9e80f2. Actual app navigation по-прежнему NOT_RUN. Source-v2 immutable, use v3 for review.

Integration162 dependency: product-draft-stage-wire imports existing helpers/qa-private-primitives.mjs (529b3c835400553eb632ee057315c0c0784e7645d06f7d7ebcc6815e99a9499b). Ordinary dependency merge162 preserves history; RootKit adds only this exact producer path, common33c guard unchanged. New cold case proves unreviewed import refusal, explicit physical pin acceptance and outsider refusal; actual stage cohort remains NOT_RUN.

CI portability correction163: actual d7e9 CI38170415209 test40 exposed physical CRLF529b vs LF917a on the same accepted helper. Expected source identity now checks exact canonical Git/LF bytes with quoted/code content unchanged; LF and CRLF fixtures pass, changed body rejects. Runtime producer pins remain SHA of ACTUAL physical bytes and are verified pre/post; unreviewed/outsider paths remain denied. No production helper/wire/common33 changes, no CI/env/version changes. Previous failed CI/source artifacts preserved; d7e9 is not staging accepted.

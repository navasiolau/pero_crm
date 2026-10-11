# Design

## Context

Ветка feature/163 от cd38cb745759becd58dbbad4d6d37afa03f0ab7a. См. proposal.159 имеет принятую контрактную карту/genuine baseline и фактическую readonly HTTP-приёмку cd38; это не native proof163. qaTransport и crm-modernization-staging.py обеспечивают reviewed transport, full revision/image/DB/W07 identity и deadline внутри контейнера. Их frozen guards остаются действующими. Supporting129 принадлежит files author,131/130 — finance, UI/prefs baseline — frontend. Последний QA128 восстановлен, stage calls пока закрыты root.

Старый warehouse-concurrency-native требует count0, создаёт/удаляет main. product-percentage-adjustments-native повторно исполняет migrations и открывает Prisma на import. Эти prerequisites несовместимы с текущим окружением.

## Goals / Non-Goals

**Goals:** Компактный проверяемый общий receipt/requirements contract, source-pinned execution/provenance, честная агрегированная готовность, безопасные текущие native entrypoints, действительная native+runtime приёмка163/159.

**Non-Goals:** Не писать domain application fixes/fixtures129/131/130; не дублировать transport/session/HMAC/CAS protocol; не менять watcher/infra/main/production/CI policy; не строить новую универсальную test framework. Coverage процентов и автоматического promotion нет.

## Decisions

1. Protocol разделяет declaration (обязательные scenario IDs/level/risk/source producer), genuine execution receipt и readiness. Каждая строка связывает task/requirement, full revision, target/runId/scenarioId, producerId/protocolVersion, bundleSha256, sourceManifestDigest, actual identity, status/checks и private artifact hashes. Receipt сам по себе с полем PASS не является execution proof: coordinator принимает результат только reviewed source-pinned adapter и проверяет его закрытый ABI/assertions, raw artifact digests и verified cleanup/rollback. Missing остаётся NOT_RUN; stale/wrong-target/unknown outcome — BLOCKED; известный failure — FAIL. Identity/CI отдельно не закрывают scenario.

2. Production provenance проверяется от clean integration D:/Projects/pero_crm_worktrees/modernization-staging на accepted full SHA либо git-show/blob comparison всех фактических production inputs. Bundle metafile плюс явные schema/lock/config dependencies определяют manifest. Git attributes учитываются через read-only git hash-object --path: clean CRLF checkout не считается WIP; незаявленные filters/непрослеженные dynamic production imports отвергаются. Проверяются actual production bytes каждого imports tree даже из worktree автора: queries130/events135/schema WIP не могут доказать staged131/129. Новые QA producer bytes допустимы после review, их source/version/hash явные. Source pins проверяются pre/post bundle и pre/post run; изменение даёт BLOCKED до нового эффекта. Image label не заменяет этот proof.

3. Coordinator использует существующий qaTransport; wrapper/source pins не ослабляются. CLI по умолчанию verify/report и import-inert. Execute требует явных local/staging/fullSHA/run/scenario и reviewed producer declaration; от production отказывает. Shared QA window/PUSH_HOLD и exclusive native lease согласует root. Stage calls только после root GO. Private artifacts находятся в .playwright-mcp/revision-acceptance; нельзя автоматически принять file-supplied PASS. Public summary исключает secrets/cookies/raw manifest/PII.

4. Domain producers дают reviewed adapters, а не копии бизнес-кода. Frontend supporting protocol v2 ACK/HMAC/source pins/exact CAS/UNKNOWN inspect-HOLD переиспользуется после его GO; old v1 session не обходится.129 owned HTML/SVG/file graph и exact version cleanup создаёт files author. Finance создаёт actual CSV/month/native clock/turnover cases. Их receipts должны включать agreed scenario IDs/levels, same candidate identity, producer/bundle/source manifest и preservation proof. Если конкретный producer ещё не готов, его строка NOT_RUN.

5. Native guards общие: physical target до Prisma client, local container identity + loopback5433/pero_crm/userpero либо stage proof injected reviewed wrapper/db/crm. Cold import не подключает DB и не конструирует client. Actual schema/prerequisites подтверждаются read-only; отсутствие блокирует. Общий fingerprint helper сравнивает protected original rows/Decimal facts/schema/functions, не превращая checksum в доказательство native scenario. Native runner запускается только в согласованном lease; secrets передаются в память/env, не argv/log.

6. warehouse-concurrency-native сохраняет действующий ACTIVE state/runId и snapshot main неизменным. Создаёт только nonce UUID actor/client/project/product/material/need, двумя независимыми Prisma connections с различными backend PIDs проверяет issue race, receipt replay и concurrent return. Cleanup revalidates target/state/run/actor/material/exact IDs/foreign references и удаляет только доказанно собственные записи в dependency order; при unknown ownership HOLD. Original warehouse balances/valuations тоже сравниваются, они не исключаются существующим warehouse_protected_snapshot. Нет global main create/delete/freeze/activate или fake recovery fields.

7. product-percentage-adjustments-native удаляет migration replay, проверяет наличие текущей схемы/constraints/triggers и существующую payroll currency prerequisite. Все прежние v4 суммы/unit-vs-batch/replay/immutable/adjustment/rollback assertions сохраняются внутри rollback-only transaction. Dynamic imports/client открываются после guard. Обработка отсутствующего BYN prerequisite — BLOCKED, не изменение OrgSetting или FX фактов. После rollback все original rows/schema/functions неизменны.

8. Для meaningful stage159 tooling fixture выделить существующий чистый mergeV8FunctionCoverage в один маленький coverage-v8-intervals.mjs; core импортирует/реэкспортирует тот же implementation. Stage runtime entry сможет исполнять реальные split/sparse/nested/wholezero fixtures в Node без упаковки TypeScript9MB. Это reuse, без duplicate algorithm; existing8 tests продолжают тот же export. Runtime protocol negative fixtures, реальный HTTP /api/health и reviewed domain HTTP/browser сценарии дают разные evidence levels. Native163 proof выполняется реальным existing PostgreSQL, не synthetic protocol fixture.

## Exact files / Ownership

- Новые apps/web/tests/acceptance-evidence-protocol.mjs и acceptance-evidence-protocol.test.mjs.
- Новые apps/web/tests/acceptance-source-manifest.mjs и acceptance-source-manifest.test.mjs.
- Новые apps/web/tests/acceptance-evidence-runner.mjs, acceptance-evidence-runner.test.mjs, acceptance-runtime-entry.mjs.
- Новые apps/web/tests/helpers/native-acceptance-target.ts и native-acceptance-snapshot.ts.
- Reviewed modernization apps/web/tests/warehouse-concurrency-native.ts и product-percentage-adjustments-native.ts.
- Новая apps/web/tests/coverage-v8-intervals.mjs и import/re-export change coverage-baseline-core.mjs; сохранение единственной реализации.
- docs/testing/acceptance-evidence.md и точечная ссылка README/matrix после реального proof.
- OpenSpec revision-bound-acceptance-evidence. Package script при необходимости только для явного verify/report, существующий test/CI entrypoint неизменен.
- Единственный production prerequisite: apps/web/next.config.ts добавляет literal zod к serverExternalPackages после baseline output проверки и отдельного source release. Dependency versions/lockfile/contracts/locales/application src не меняются.
- apps/web/Dockerfile не меняется и входит в required source pins вместе с next.config.ts.
- crm-acceptance-transport.mjs, crm-modernization-staging.py/domain fixtures не меняются. Dependency preflight/compiler меняются только в owned QA modules после reviewed API release.

## Уточнения после независимого review

- manifest revision и actual closed ABI сверяются до/после транспорта; raw bindings не заполняются непроверенными declaration values. Saved source manifest повторно проверяется verifier.
- Physical production imports разрешены только из accepted sourceRoot; FIRST onLoad компилирует проверенные bytes. Explicit virtual descriptors связывают accepted originals, reviewed transformer и границы эффектов; неизвестные virtual inputs отказывают.
- Warehouse двухэтапный: read-only inspect → fsync outer PRE exact graph/все UUID/baseline/state digest → reviewed native bundle с plan SHA и original inspect receipt. Container PRE является дополнением. UNKNOWN оставляет оба checkpoint, без автоповтора/cleanup.
- Cleanup использует narrow exact PK FOR UPDATE, existing warehouse lock, all incoming FK включая composite и Serializable tx. Full original fingerprint исключает только exact own keys и сверяется ДО firstdelete, внутри tx после delete и после commit. Lock timeout5s; allpublic table locks не используются.
- Percentage native prerequisites включают validated constraints/valid unique indexes/enabled trigger masks. Unexpected failure всегда вызывает postrollback original snapshot, сохраняя исходную ошибку.
- Дополнительные собственные files: helpers/native-acceptance-journal.ts, helpers/native-percentage-prerequisites.ts и native-acceptance-preservation.test.mjs. Они реализуют согласованные root/reviewer safety fixes, без domain fixtures129/131/130.

## Серверная упаковка неизменённой зависимости

Исходный percentage bundle389763 bytes; QA shim A388536; UTF-8 recipe C332168. Все превышают cap262144. Counterfactual D дал135745, но два свежих независимых runtime показали различие15 invalid vectors: Invalid UUID стало Invalid input. D не переносится в application src. Compression, chunk reconstruction, повышение cap, locale/validator projection и ручная config(en) запрещены.

Фактическая цепочка: patch-core → contracts.ts import{z}fromzod → public zod/index.js → classic/external.js → core/locales. Причина — полный namespace, не plugin SDK. Версия4.4.3, все factory/instance contracts и стандартная локаль сохраняются.

### Минимальная упаковка

Установленный Next15.5.20 поддерживает serverExternalPackages/native Node require. Если baseline standalone не содержит пригодное whole public closure, единственный app delta: ["@node-rs/argon2"] → ["@node-rs/argon2","zod"]. Нет dependency/lock/version/tracing-glob изменений, package copy/install на staging. Сначала проверяются actual output и настоящий application scope. Старый stdin resolver cd38 не доказывает отсутствие пакета в любом app scope; прежние HOLD сохраняются и не повторяются.

Windows build не подтверждает standalone: текущая конфигурация выключает его на Windows. Linux build выполняется в согласованном root window с frozen lock/current Dockerfile. Default CMD не запускается для package inspection: он содержит prisma migrate deploy. Проверка использует literal resolver/file validation, затем actual library; никаких SQL/DDL/seed/reset/dump.

### Публичное замыкание и семантика

Полный PUBLIC CJS достаточен; ESM ради QA не требуется. Literal zod разрешается из фиксированного actual application anchor server.js/package scope. Произвольные пути/fallback/deep-import locale subsets/arbitrary externals API запрещены.

До library eval проверяются version4.4.3, package.json, все реально используемые CJS export/require files и physical hashes/root/reparse/escape boundaries. Замыкание определяется actual Node export/require graph и trace, не только lock/package.json. ESM80 map не считается CJS proof. Dependency manifest связывается с source/config/compiler/bundle/target/image/run/scenario; file hashes повторяются после исполнения.

Отдельные свежие runtimes сравнивают целую public library и неизменённый productPercentagePatchSchema: все valid/invalid data+issues, UUID/discriminator/strict extras/nullable/bounds и стандартные English errors совпадают. Baseline Zod не импортируется заранее в candidate context. Никакого schema/DTO substitute.

### Закрытый QA loader

Reviewed literal public zod dependency загружается после target/package guards, настоящий production validator сохранён. Source manifest включает next.config.ts и apps/web/Dockerfile. Dependency descriptor связывает format/version/closureDigest/fixed app anchor/все loaded file hashes. Missing/changed package, другой target/revision или неполное замыкание отказывают до business functions. Compiler/metafile разрешают только точный zod и прежний Prisma external, без произвольного option.

New percentage artifact обязан фактически укладываться в262144 raw UTF-8 bytes. Candidate-only packaging build с неизданным config не обозначается accepted deployed proof. Actual native/staging receipts требуют новый accepted SHA/source/config/package manifest; cd38 не приписывается изменённым bytes.

### Результат и приёмка

Измеримый результат: unchanged whole public library доступна в standalone app scope; cap соблюдён; schema data/issues/default locale совпадают; actual native proof не подменён. Before/after server chunks/trace count/bytes/cold startup измеряются без обещания ускорения. UI/domain source diff0; client labels/navigation/roles/validation behavior сохраняются, необъяснённых визуальных регрессий0.

Independent packaging/dependency design review → отдельный source release → frozen local tests/Linux standalone/whole-CJS/fresh schema proof → owner/root commit → normal merge staging/CI API → новый actual SHA/image/health → reviewed readonly dependency preflight → отдельно разрешённые native scenarios с new run/fresh baseline. Старый UNKNOWN a8 и failed size/dependency attempts сохраняются; PRE/baseline не переиспользуются. Missing receipt сохраняет NOT_RUN/BLOCKED, не full163PASS.

## Risks / Trade-offs

- [Self-declared PASS выглядит достоверным] → producer provenance/closed ABI/artifact digest/actual adapter execution; injected bare receipt/CI metadata не закрывает native.
- [WIP closure подтверждает другую staged версию] → metafile-aware accepted Git blob comparison и pre/post physical hashes.
- [Native guard/schema drift] → BLOCKED до эффекта, STOP mismatch, reviewed prerequisite update; никакого обхода.
- [Unknown ACK/cleanup конфликт] → inspect/HOLD и сохранение checkpoint, без нового intent/автоматического восстановления.
- [Полный DB fingerprint ловит чужие legitimate writes] → root exclusive QA window/lease; не маскировать financial rows и не удалять чужую работу.
- [Pipeline меняет candidate после proof] → affected evidence invalidated и повтор на новом SHA.
- [iMac недоступен] →141 BLOCKED/device отдельно, без ложного PASS от другого ПК.

## Migration Plan

Миграций нет. Packaging меняет только серверную упаковку по отдельному release; actual Linux standalone/package checks обязательны. Default Docker CMD для QA не запускается. Local meaningful protocol/source/fault tests + typecheck/lint/native только после review/lease. Independent review всех runner/source/target/cleanup changes. Обычный merge163 в staging выполняет root, затем CI API и actual image/identity/native/HTTP/browser accepted scenarios.1593.2 закрывается только после relevant tool runtime/HTTP proof. Main остаётся3819f17 и не выпускается.

## Shared18 core cohort implementation

Root-approved registry связывает run/revision/exact image/webCID/DBCID/volume/W07, восемь UUID, producer/source digest и exact catalog policy digest. plan117 V2 выводит четыре роли и nonce labels из registry, без real user lookup. fixtureRows117 является единственной спецификацией writer; она не включает immutable monetary rows. Signed PRE/checkpoint/observation/ACK/certificate включают registry digest. Другой registry при том же run/revision не проходит HMAC boundary.

Existing whole-row/schema/clock fingerprints исключают только восемь ID и две manager composite preference keys. Incoming composite FK/typed-reference guards и exact row-hash CAS deletion переиспользуются; собственные users/products представлены несколькими IDs. Native117 всегда вызывает existing verifiedRollback, включая unexpected/falsy errors. Existing117 table-lock policy не расширяется: фактическая lease/lock/timeout policy требует отдельного Root/native protocol GO.

guardStageContext переиспользует nativeAcceptanceBinding и сравнивает exact approval identity/provenance. qualifyStageSnapshot принимает READONLY metadata после actual identity query: полный ordered ledger id/name/checksum/finished/rolledBack и schemaHash. Policy получает Root после167 и135 из actual deployed environment; local76 и прежний stage74 не являются alias. SQL collector не дублируется в adapter.

RootKit actorProfile возвращает fresh actor handoff только в защищённой памяти. Cookies/basicAuth не сохраняются в public artifacts. Перед и после transport проверяются producer files/accepted production manifest; source compiler переиспользует existing163 reviewedBundle с physical production imports только из accepted sourceRoot. Actual metafile/manifest/bundle связываются с registry и same accepted revision. Import не вызывает SSH/DB/browser.

Browser V2 допускает bounded own-prefix queries только с mandatory own client/project filter, exact owned detail GET/HEAD, manager preference POST и отдельно registered compiled getBellData/args[]. Foreign engineer и accountant не получают preference grant. Статус/денежный POST, неизвестный export/path/payload, новые profile roles/IDs и неучтённые побочные строки блокируются. Текущие source checks не подменяют actual navigation, financial/native128 или staging closure.

Source allowlist: apps/web/tests/kanban-search-owned-{protocol,fixtures,entry}.mjs, kanban-search-root-runner.mjs, kanban-search-stage-browser.mjs, helpers/staging-acceptance-qualification.mjs; four existing117 tests. Existing native target/snapshot/rollback/local-db helpers и transport используются без изменений.

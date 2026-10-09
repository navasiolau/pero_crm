# Staging acceptance

## Source-only adapter

Приложение задачи 117 заморожено в `4a297aeeb499e823c48b7c93fe5817ac6e39c84b`. Следующие новые QA-файлы не изменяют его поведение: `apps/web/tests/kanban-search-stage-browser.mjs` и `kanban-search-stage-contract.test.mjs`. Импорт не запускает браузер/сеть/БД; actual stage entry вызывается только оркестратором в согласованном окне. Здесь пока зафиксированы исходники и controlled проверки, а не фактическая staging-приёмка. Adapter импортирует настоящие pure TypeScript normalizer/encoder; Root entry запускается существующим `pnpm --config.verify-deps-before-run=false --filter @pero/web exec tsx <private-entry.mjs>` или эквивалентным locked tsx loader. Обычный Node без TS loader не является поддерживаемым entry.

## Handoff

Root использует отдельный fresh117 lifecycle и передаёт в `runKanbanSearchStagingBrowser` настоящий подписанный producer handoff в памяти. Это не расширяет scope113/115/116 и не меняет111 fixture. Старый `staging-browser-session.prepare` запрещён для этой проверки: он выбирает существующих пользователей. JWT/AUTH_SECRET, cookie values, basic credentials не выводятся в tool/chat/logs.

Обязательные поля:

- `authorized: true`, `origin: https://staging-crm.peromebel.by`, `expectedRevision` полного SHA фактически развёрнутого кандидата; physical receipt с `hostname: crm-staging`, тем же SHA, `databaseVolume: crm-staging_pgdata`, исходным `outerW07Sha256`.
- Проверенный Root целиком signed checkpoint: `scope: fresh-owned-qa`, UUID runId, тот же revision, `signature`, `originalPreSha256`, `actor` и наборы фактически созданных actor/client/project/product/file IDs. Root сохраняет original PRE/HMAC. Перед boot обязателен source-reviewed `verifySignedCurrent` callback, который вызывает actual guarded producer и повторно проверяет HMAC, текущие own rows, оригиналы и compiled manifest; отсутствие callback или несовпадение current certificate останавливают браузер. Наличие строки signature само по себе этого не доказывает.
- `profile`: один свежий QA MANAGER или ADMIN, id/roles в checkpoint, scoped cookies. Два `originalPreferences` этого актёра для `projects.list` и `products.list` должны быть отсутствующими (`value: null`). Другие пользователи и сохранённые real preferences не используются.
- `subjects`: readonly текущие owned client (`id`, `name`), project (`id`, `number`, `title`, `clientId`) и product (`id`, `number`, `title`, `description`, `projectId`). `tokens` — четыре уникальных 12–100 ASCII-символьных значения `projectTitle`, `productTitle`, `client`, `technical`, фактически присутствующие в соответствующих owned fields и отсутствующие в собственных identity fields отрицательных сценариев. Root подготовит эти значения в owned fixture lifecycle.
- `action`: фактический compiled `saveListPreference` из `src/server/list-preferences-actions.ts`, 42-hex id установленного Next15, candidate revision, SHA256 source-reviewed manifest. Другие server actions не передаются.
- Абсолютный `outputDir`: новый `.playwright-mcp/search117/staging-<runId>` внутри task117 worktree; existing/reparse output directory останавливает запуск. `basicAuth` допускается только как private runtime input, если stage этого требует.

Родительский номер закономерно входит в собственный номер изделия. Actual negative parent assertion использует только уникальный parent title token, отсутствующий в собственном номере/названии. Его числовой префикс не объявляется ложным совпадением.

## Boundaries and durable journal

GET/HEAD разрешены только для scoped канбанов: projects с exact own client, products с exact own project; обе оси кодируются через настоящий `encodeListFilterValue([ID])` как JSON-array, затем весь URL/query проходит `normalizeListQuery`. View=kanban, active=0, известный own query и `_rsc` сохраняются. Scalar и неканонические значения не пропускаются. Дополнительно разрешены фиксированные health/session/static routes и только перечисленные own image IDs. Prefetch блокируется. Любые другие POST abort до upstream, включая background bell actions. Единственный пропускаемый POST — compiled saveListPreference с exact section/canonical query/expected prior value и фиксированным Origin. Ни business CRUD, ни загрузки, ни печать, ни `/my`, ни DB/storage APIs здесь не вызываются.

До браузера fsync immutable `before.json` с original null preferences, signed PRE binding и compiled action metadata. Перед каждым preference POST fsync immutable INTENT; только после genuine Next15 compact action promise с `ok:true`, точным version2/revision/query fsync ACK. Response bytes передаются браузеру неизменными; fetch выполняется один раз, redirect/retry запрещены. Собственные cookie refresh metadata Next15 допускаются; path/tag revalidation, full RSC/module refs и CAS conflict останавливают проверку. UNKNOWN не становится ACK, дальнейшие mutation запросы блокируются, retry отсутствует. При отказе journal до INTENT upstream не выполняется.

Service Worker блокируется в isolated QA context; перед boot используется проверенный `disableKanbanQaServiceWorkerApi` из114, чтобы Serwist не читал Playwright void-stub. Descriptor failure и любые page errors являются отказом; application source и production SW не меняются.

## Actual scenarios queued

На1440/390/360 обеих досок:

1. Реальный серверный поиск собственного номера и собственного title token. До точного номера доска вручную поставлена на противоположную границу относительно target, поэтому нужен измеримый реальный переход даже для продукта в первой колонке.
2. Карточка приходит к ближайшему достижимому центру, нижняя полоса синхронна, ширины/порядок колонок и относительный порядок найденных карточек сохраняются. Desktop input остаётся active с caret; mobile Sheet остаётся открытым до нажатия «Показать результаты», до полного закрытия board position сохраняется.
3. Реальный ввод client/technical/related-title tokens даёт пустой список. Title query находит own card и не запускает номерное центрирование. Каждый query проходит actual preference action и RSC response, а не подмену browser rows.
4. В DOM допускаются только Root-created fixture cards. Screenshot выполняется только после этого guard, без customer/foreign cards; нет trace/HAR/storageState.

## Cleanup and final acceptance

Браузер сначала запрещает новые mutation запросы, дожидается всех existing fetch/ACK captures и закрывает контексты; fsync `browser-ended.json` содержит exact last successful own values для двух keys. `BROWSER_CHECKS_PASSED_CLEANUP_REQUIRED` означает только завершённые browser сценарии.

Prisma `UserPreference` не имеет FK на User: удаление QA actor не удалит эти строки. Root читает только две собственные keys и выполняет `buildKanbanPreferenceCleanup` внутри reviewed guarded transaction: absent current→noop; current===last exact ACK→deleteMany по userId/key/value с count1; любое другое current→STOP/rollback. Равенство query или предполагаемая revision не авторизует удаление. После этого Root проверяет отсутствие этих keys и очищает остальные own111 fixtures/последствия по их exact manifest; сохраняет оригиналы и проверяет нулевой остаток owned rows.

`finalizeKanbanSearchAcceptance` принимает PASS лишь после actual CAS_RESTORED, drained outcomes, checked2/remaining0 и физически подтверждённого ORIGINALS_MATCH_OWNED_CLOSED с исходным PRE SHA/full deployed SHA. Planned cleanup, browser-only PASS, guessed hashes и чужой run не принимаются. При неопределённом результате Root сначала выполняет reviewed discovery/recovery; автоматического повторения mutation нет.

## Controlled source verification

`pnpm --config.verify-deps-before-run=false --filter @pero/web exec tsx --test tests/kanban-search-stage-contract.test.mjs` —15/15 PASS: fixed stage/fresh-own/compiled action guards, owned canonical GET/POST, genuine installed Next Flight ACK and forbidden module/RSC/error metadata, durable intent before single upstream and ACK before forwarding, failed journal→0fetch, uncertain→no ACK/no retry, sequential CAS, exact cleanup ownership and fail-closed finalization. Синтетические только owned fixture/store значения; действуют настоящий `createListPreferenceService`, его normalization/CAS, `ListStateController.start()` и следующий поисковый save. Проверяется автоматический startup save с null original, отсутствие startup navigation, точный JSON-array query и передача last real ACK как expected следующего CAS. Positive ACK создаётся настоящим service и genuine Next encoder — существующим local helper; stage и DB не вызываются. Дополнительно handcrafted scalar ACK и normalized backend ACK против scalar intended-query обязательно отклоняются.

Независимое ревью обнаружило P2 старого QA adapter: он строил scalar client/project, а приложение нормализует JSON-array. RED двух actual-service startup тестов показал `%5B%22qa-client%22%5D`/`%5B%22qa-project%22%5D` вместо scalar. Исправлен только QA query builder; application source не изменён. GREEN15/15 фиксируется после исправления.

Полный local unit-набор после QA P2 исправления —1492/1492 PASS; TSC/lint/strict OpenSpec/diff-check PASS. Actual deployment/session/scenarios/cleanup ещё не запускались.


## Separate Root117 lifecycle source

`kanban-search-owned-protocol.mjs`, `kanban-search-owned-fixtures.mjs`, `kanban-search-owned-entry.mjs` и `kanban-search-root-runner.mjs` образуют отдельный source-only набор. Только Root вызывает actual transport; worker не запускал DB/SSH/стадж/браузер. Разрешённый local ordinary merge fresh origin/staging0ab дал feature117 merge d2e529; incoming task source не копировался. Dependency junction к111 runtime сохранён, Prisma generate не выполнялся.

Producer создаёт ровно четыре записи: новый MANAGER с NONE/disabled-password, новый client, проект LEAD и изделие DRAFT с настоящим отличающимся technical token. Никакие существующие пользователи, финансовые/складские записи, файлы, S3, модули, миграции или schema не изменяются. Для0/1/2 own preferences предусмотрен actual PostgreSQL outer-rollback prerequisite до committed prepare; signed native proof нельзя заменить caller boolean. Все таблицы/schema fingerprint сравниваются; accepted shared API-token lastUsedAt и bot updatedAt clocks допускаются только при фактически неизменных stable fields и monotonic evidence свежего PRE.

Actual manifest читается только внутри verified web из `.next/server/server-reference-manifest.json`. Требуется один exportedName `saveListPreference` с точным actual filename `server/list-preferences-actions.ts`, двумя workers `app/(app)/products/page`/`app/(app)/projects/page`, string moduleId, async=false и layer=action-browser. Filename нормализуется в public `src/server/list-preferences-actions.ts` до HMAC. ID не hardcoded. Raw manifest/encryptionKey никогда не записываются/не выводятся; остаются только SHA/два public references.

Root API: `createSearch117RootKit` в памяти, basicAuth передаётся из уже разрешённого private context. Методы вызываются последовательно и явно: native → plan (fsync signed PRE) → prepare (fsync intent, один commit) → browser (memory JWT/current producer verification) → capture (exact ACK journal/coherent current state) → cleanup (durable observation и own-row/pref value CAS) → closed (новый post-commit readonly proof). Browser native/source-only успех не даёт PASS без actual cleanup/closed.

Локальный Root-only пример вызова после review и принятого runtime window:

```javascript
import {createSearch117RootKit} from './tests/kanban-search-root-runner.mjs';
// options: authorized, full deployed revision, fresh UUID runId,
// outputDir=<repo>/.playwright-mcp/search117/owned-<runId>, private basicAuth.
const kit=createSearch117RootKit(options);
await kit.native();
await kit.plan();
await kit.prepare();
await kit.browser();
await kit.capture();
await kit.cleanup();
const accepted=await kit.closed();
```

Не запускать эту последовательность автоматически после ошибки. Prepare outcome неизвестен → только явный readonly `recoverPrepare`, затем capture/cleanup; recovered prepare никогда не считается functional PASS. Browser journal с UNCERTAIN/неполным ACK останавливает обычную очистку и требует reviewed discovery. IDs/FKs/scalar backrefs проверяются до удаления, exact UserPreference(userId,key,value) удаляются отдельно (у модели нет FK), четыре rows удаляются по ID+whole-row SHA. Последние исходники/сертификаты удерживаются до closure; source drift запрещён.

Source controlled verification:20/20 tests на actual-manifest shape/privacy, реальном HMAC/tamper, distinct fresh plan, canonical journal, обязательном actual-producer callback certificate и прежнем actual service/controller/genuine Flight; lint PASS. Compile-only injected bundle70009 B — PASS, никаких stage/DB вызовов. Native PostgreSQL rollback, committed fixtures и actual browser ещё не запускались; эти пункты принимает Root после независимого review.

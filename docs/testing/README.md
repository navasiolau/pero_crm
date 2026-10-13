# Проверки действующих контрактов CRM

Карта [contract-matrix.json](contract-matrix.json) связывает критические денежные, ACL, file, timer и queue требования с точными suite/блоками и дальнейшей приёмкой. Для отсутствующей защиты указан номер задачи. KEEP/REWRITE/CONSOLIDATE/RETIRE описывают блок, а не разрешают удалить весь смешанный файл.

База исследования: staging3819f175dca3f69f40da92760cf746bad430f4bc. Сам JSON является перечнем требований: его native/browser строки остаются NOT_RUN/BLOCKED до отдельного фактического evidence. Статическая ссылка на test не доказывает его успешный запуск.

## Команды

Из корня:

    pnpm --filter @pero/web test:coverage:baseline --check
    pnpm --filter @pero/web test:coverage:baseline

Check проверяет contract IDs/domains, пути, выбранные test blocks, evidence levels и соответствие существующему web test entrypoint. Полный baseline повторяет все tests/*.test.ts и tests/*.test.mjs через Node22/tsx с test-concurrency=2. Это отдельный измерительный прогон: CI по-прежнему выполняет pnpm -r --if-present test, включая бота; его команда не меняется.

Артефакты находятся в ignored .playwright-mcp/coverage-baseline/<UUID>/:

- coverage.json — Git HEAD, хеши фактических source/test/helper/package/QA inputs до и после, runtime, команда, Node summary, статусы каждого целевого production-модуля.
- v8/ — оригинальные V8 JSON с sourcemaps для воспроизводимой проверки.
- tests.json — структурированный Node reporter; tests.private.log — private TAP/диагностика.

Runner не читает env-файлы, не передаёт DATABASE_URL/AUTH_SECRET/S3/Telegram/GitHub secrets или inherited Node hooks в child, не подключает PostgreSQL/production/staging и не создаёт БД. Chromium components самого suite работают с собственными подставными HTTP boundaries. Native checks этим запуском не выполняются.

## Что измерено

Метрики — наблюдаемые authored V8 functions/ranges, привязанные встроенным SourceMap к подлинному содержимому production TS и AST function body. Transpiler helpers/export wrappers, tests/helpers/vendor не входят в знаменатель. Raw V8 snapshots сначала группируются по точному generated variant (source map + line lengths) и span функции. На общей сетке границ вложенный override сильнее outer count; отсутствующий child наследует outer count. Затем интервалы исполнения объединяются между snapshots до привязки к TS. Разные generated variants остаются явными. Effective interval counts не являются процентом всех TS branches; invocation counts не суммируются.

Количество observed функций/диапазонов не является полным количеством ветвей TypeScript. Ненагруженный модуль имеет NOT_RUN; отсутствующий или несовпадающий source map — BLOCKED. VM-transpile, browser/esbuild bundles и дочерние runtime без корректной исходной привязки могут не попасть в Node observations; для них нужны отдельные тестовые доказательства.

Метрики TS lines/branches и общий процент покрытия приложения намеренно отсутствуют. Контрольная настоящая функция с одной выполненной navigate ветвью показала ложные100% во встроенном Node test:coverage с tsx, включая generated helpers. Raw V8 и authored mapping обнаруживают невыполненные dragging/fullscreen диапазоны. Публиковать этот встроенный summary как100% покрытие исходного TS нельзя.

PASS отчёта означает полный успешный measured Node suite, неизменность его inputs и наличие корректных authored observations. Из него нельзя вывести PASS PostgreSQL lock/rollback, browser layout, HTTP или staging. Даже зелёный измерительный прогон сохраняет individual module gaps. При падении тестов/изменении inputs получается FAIL; при неполном reporter/coverage — BLOCKED.

## Уровни evidence и сохранение тестов

- unit — чистая функция; DI — настоящий module с подставными DB/effects; SSR — настоящий rendered HTML.
- source-guard — текст/AST защиты миграций, схемы, deployment/operator protocol; полезные guards сохраняются.
- Chromium-component — настоящий Chrome/DOM component с подставными server boundaries. Это уже есть в CI, например project-client-contact-component.
- native-PostgreSQL — реальные constraints/triggers/locks и независимые соединения существующей разрешённой БД.
- HTTP-runtime — настоящий серверный route/action; staging-browser — фактически опубликованный SHA и пользовательский сценарий.
- device — измерение на самом проблемном устройстве; iMac141 остаётся BLOCKED, пока недоступен.

У work-shares-settlement/task-share-fixture queue заранее сериализует fake transaction. Тамошний concurrent test сохраняет value для бизнес-ветвей, но не доказывает PostgreSQL lock. Старая warehouse-concurrency-native prerequisite создаёт accounting main при count0 и не подходит существующему учёту: guard не обходится, обновление рассматривается в163.

При обслуживании тестов сохраняются: live FileGridView; реальная revision0/fallback конфигурация; cryptographic UUID fallback; fixed40+60/historic settlement; SQL/migration/operator guards. Orphan helpers удаляются только после доказательства runtime graph и передачи действующей защиты. Изменение Node count само по себе не является выигрышем.

## Обновление и staging

Изменение production-контракта обновляет соответствующий stable ID, точные тесты и gaps; новый negative/rollback/concurrency сценарий появляется в его атомарной задаче. Перед приёмкой фактические revision/target/scenario/status и source inputs сверяются заново. Старый PASS другой ревизии не считается приёмкой кандидата.

Задача163 связывает evidence с реально развёрнутым staging image/identity и собирает native/runtime receipts. Используется существующий qaTransport и reviewed crm-modernization-staging wrapper с W07/DB/S3 guards. Одноразовый first-wave coordinator для `a1123c5` выведен из эксплуатации в №168; его команды больше не поддерживаются. Main разрешается только отдельным приказом владельца.

В №168 также закрыты cash staging diagnostics старых `8ed4838`/`3f6da0d`, cash local release/migration CLI, engineering local migration CLI и одноразовые work-shares/engineering/quantity runners прежних worktree/seals. Их исторические receipts и OpenSpec evidence сохраняются без повторного исполнения. Действуют денежные DI/native API, shared guards, owned fixtures и актуальные browser/stage workflows; локальные миграции выполняются только по согласованной задаче штатными `pnpm db:migrate` / `pnpm db:deploy`. Local/staging дампы для задач запрещены AGENTS.md; nightly refresh и W07 сохраняются.

Продолжение №168 вывело из эксплуатации cash stage операторы старого seal, завершённый engineering комплект и work-shares/quantity QA с новым split 30%, который действующая логика запрещает. Оставшиеся self-only guards `work-shares-local-migrate` и closed cash browser operators также retired; действуют содержательные cash/finance/payroll/domain и UI проверки. Исторические before/after producer CLI миграций 111/118/120 закрыты; текущая warehouse-unit CRUD приёмка продолжает проверять ранее принятый frozen migration descriptor. Historical receipts сохраняются, старые operator команды не поддерживаются.

Закрытые modernization/project/product/attachments session и UI-coordinator namespaces выведены из эксплуатации вместе с unused graph; актуальный allowlist и сохранённые business/UI guards находятся в `openspec/changes/test-basis-reduction/reduction-map.md`. Current integration/native и реальные component/browser проверки сохраняются. Текущий qaTransport и физически закреплённый `crm-modernization-staging.py` продолжают обслуживать Root inspector с DB/S3/W07 guards; historical session/recovery receipts не переписываются.

После принятия ранних QA-выпусков закрыты отдельные modernization/inline/description/attachments stage и recovery CLI, а также завершённый unit110 DB fixture coordinator. Browser-функции и их действующие кейсы сохраняются; unit110 оставляет только нужные browser descriptors/signature/journal функции, без plan/prepare/DB cleanup. Старые команды относятся к сохранённым historical receipts и не являются текущими entrypoints.
Закрытые manual native bundlers project/product-inline, description/attachments и их borrowers retired после полного consumer closure; действующие business/data/security cases сохраняются в current integration suites. Current native target/snapshot/journal/preservation и physically pinned qaTransport/W07 guards продолжают использоваться; historical native/migration receipts не переписываются и не объявляются новым SQL PASS.

Закрыты также восстановление единственного corrections run `62c498d2…`, старые inline V1 reconciliation/diagnostic команды, одноразовые file113 cleanup alias/finance-upload bridge и kanban117 V1 recovery. Текущие generic recovery guards, file113 core, RootKit117 и все прикладные native/browser сценарии сохраняются. Неиспользуемый generic declaration/readiness CLI163 удалён; accepted source manifest и его точные canonical hashes остаются в существующих shared primitives. Действующий порядок описан в [acceptance-evidence.md](acceptance-evidence.md).

## Навигация карточек (160)

product-card-navigation-browser.test.mjs исполняет настоящие ProductsTab/ProductsKanban/shared card и PointerSensor в Chromium. Синтетические rows/PNG, закрытые Next/server-action boundaries и loopback server не доказывают server ACL или staging. Missing browser даёт failed/BLOCKED gate, silent skip отсутствует. CI уже устанавливает Chromium; workflow не меняется.

Baseline и formatting проверяют trusted cover и отдельный body/title click: ровно один product.number/returnTo route без fullscreen. Реальный drag создаёт disabled overlay; trusted gesture и native disabled-button DOM click() не вызывают переход или fullscreen (DOM click() сам не выдаётся за trusted input). Реальные mobile tables защищают CardNumber. Два faults проходят source provenance/build/mount и отвергаются только после trusted click через NAVIGATION_MISSING/TARGET_MISMATCH; build/hash ошибки не считаются mutation-killed. Browser/server всегда закрываются, PASS artifact сохраняется после cleanup.

В №168 перекрывающиеся handler/SSR tests объединены с реальным Chromium gate; уникальный RecentProjects link/client/title/CardNumber case сохранён в project-kanban-card-layout.test.ts. Migration/source guards и исторический baseline159 сохранены. Runtime receipt содержит browser/version, actual source/metafile hashes pre/post, отдельные action/fault rows и честный staging NOT_RUN.

    pnpm --filter @pero/web exec node --import tsx --test tests/project-kanban-card-layout.test.ts
    pnpm --filter @pero/web exec node --test tests/product-card-navigation-browser.test.mjs

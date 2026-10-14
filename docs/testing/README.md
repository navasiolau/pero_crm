# Проверки действующих контрактов CRM

## Карта реализованных возможностей — глубокий кандидат после61f9bc14

Это навигация по действующим сценариям, а не утверждение полного line/branch или UI покрытия. `*.test.ts`/`*.test.mjs` основного набора исполняются автоматически; `integration/*.test.ts` — в разрешённом owned CI PostgreSQL/S3. Само присутствие entrypoint не подтверждает PASS нового кандидата: актуальные результаты привязаны к отдельным CI/staging receipts. Ручные native/browser workflows и Playwright E2E не выдаются за автоматические gates.

| Возможность | Автоматические действующие сценарии | Ручное покрытие / граница |
|---|---|---|
| Авторизация, текущие роли и права | `auth-security.test.ts`, `engineer-access.test.ts`, `management-dashboard.test.ts`; integration file-responses `credentials/login`, `credentials/revoke`, `bearer/scopes`: actual provider, sensitive PostgreSQL updates/cookie revoke, scopes. | Новый runtime кандидат NOT_RUN до CI; full browser login/restore отдельно; кодирование JWT в DI не доказывает credentials login. |
| Проекты, клиент и реквизиты | integration `files-crud.test.ts` inline/project-field-atomic-roles-history и product/contact CAS; `project-client-contact-component.test.mjs`: настоящий DOM, dirty/read-only/IME. | Authenticated full-page edits и внешние уведомления отдельно. |
| Изделия, количество, статусы и начисления | integration `domain-postgres.test.ts` quantity/work/task/current roles и `percentage-postgres.test.ts`: default/draft, роли, количество, Decimal, snapshots/rollback/replay. | Полный маршрут каждого статуса в browser не выводится из DB PASS. |
| Списки, поиск, канбан и карточки | `project-filter-component.test.mjs`, `list-state.test.ts`, `kanban-render-isolation.test.mjs`, `product-card-navigation-browser.test.mjs`: фильтрация, focus/Tab, актуальный query, trusted navigation/drag. | `e2e/list-filters.spec.ts` — MANUAL/NOT_RUN без owned authenticated fixture/preferences. |
| Задачи, доли и выплаты | `task-creation.test.ts`, `task-status-receipts.test.ts`, `task-status-command.browser.test.ts`: shared actual CSS/browser, nine creation/status cases; integration `domain-postgres.test.ts`/`finance-postgres.test.ts`: FK/locks/replay/settlement. | Fake transaction queue не доказывает настоящий PostgreSQL lock. |
| Таймеры и учёт времени | `timer-stop-cap.test.ts`, integration domain all-stop/parallel timer cases: caps/atomic stop/replay/concurrency. | Полный long-running browser timer и device sleep отдельны. |
| Календарь, длительности и напоминания | `calendar-core.test.ts`, `calendar-reminder-worker.test.ts`; integration domain calendar duration/CAS/MSK/totals/analytics и file-responses actual calendar HTTP/owner/disabled. | Новые native/HTTP cases source-ready, фактический запуск подтвердит combined CI; old calendar manual CLI retired. |
| Финансы, касса, зарплата и история | integration finance/percentage/payroll-cash PostgreSQL cases и retained finance workspace/math guards: реальные деньги, fixed FX/NULL vs zero, immutable snapshots, guards. | Production/history migration proof и полнота отчётов отдельны. |
| Склад и материалы | `warehouse-*.test.ts`, integration domain unit/real-weighted-movements и finance paid-receipt-cascade-delete: actual weighted money/returns/rounding/receipt/replay/rollback; shared cash lock обоих порядков. | Новый native кандидат NOT_RUN до CI; existing native/operator entries имеют собственные ручные receipts. |
| Логистика, рейсы, ТТН и кассовое распределение | `logistics-trips.test.ts`, `logistics-cash-allocation.test.ts`, `logistics-workspace-render.test.ts`; integration finance logistics/real-posting-correction-CAS-history-budget-and-SQL-rollback. | Новый native кандидат NOT_RUN до CI; full browser trip/TTN требует отдельного receipt. |
| Файлы, эскизы, документы и печать | integration `file-responses.test.ts`/`files-crud.test.ts`/`sketch-replacement.test.ts`: actual HTTP/S3 bytes/ACL/CAS/version cleanup; safe-file DI сохраняет denial до чтения storage; actual stock/deletion/document geometry и формы — в двух existing Chromium component suites. | CRM handler, original bytes/load, window.print и resource/error cleanup проверяются existing file-list-printing.test.ts; native printer preview/physical print не выдаются за automated PASS. |
| Отчётные документы и exports | `report-document-access.test.ts`, `finance-documents-http.test.ts`, workspace/render tests: доступ, безопасная выдача и отображение. | Формат каждого downloadable report/full browser print — отдельная ручная приёмка. |
| Telegram | Bot package engine/recovery/finance/stock/calendar/document tests: диалоги, long polling/health, retry/CAS; integration file-responses telegram/link-session-unlink: actual expiry/replay/disabled/session/unlink. | Новый runtime кандидат NOT_RUN до CI; fake Telegram HTTP не подтверждает live Telegram connectivity. |
| Plugins и очередь | `plugin-context-events.test.ts`, `plugin-sync-noop.test.ts`, integration queue и file-responses plugins/commands: actor/audit/delivery, actual permissions/run-log/success/error. | Новый runtime кандидат NOT_RUN до CI; внешние side effects сторонних plugins отдельно. |

Кандидат после259f объединяет107 pure files в24 retained suites (379 registered test calls сохранены), task command browser2→1 (девять cases/65 assertions) и lifecycle семи Chromium suites с actual CSS/browser reuse и fresh contexts. Unique native app cases перенесены в existing169 suites; exact paths/IDs и закрываемые20 manual/flat sources находятся в `openspec/changes/test-basis-reduction/reduction-map.md` и169 adoption-map. Auth monotonic/no-op/token-owner/fault child, warehouse two-connection, percentage status/settlement, queue subscriber и file/cover UUID/CAS/rollback — source-mapped, новый native/CI/staging **NOT_RUN**. Logistics TTN document reads используют injected BufferMap (DI), не actual MinIO/HTTP; file/cover source проверяет actual PostgreSQL/MinIO pending/retry и controlled remove fault, без actual HTTP wrapper. Baseline static NOT_RUN/BLOCKED и historical receipts сохраняются; общего100% coverage claim нет.

№168 follow-up удаляет duplicate sessionVersion labels, self-only print helper, непереданный local legacy object, completed preparation migration CLI и legacy watcher model. Existing runtime/security/files guards и historical receipts сохраняются; точные disposition находятся в `reduction-map.md`.

Карта [contract-matrix.json](contract-matrix.json) связывает критические денежные, ACL, file, timer и queue требования с точными suite/блоками и дальнейшей приёмкой. Для отсутствующей защиты указан номер задачи. KEEP/REWRITE/CONSOLIDATE/RETIRE описывают блок, а не разрешают удалить весь смешанный файл.

База исследования: staging3819f175dca3f69f40da92760cf746bad430f4bc. Сам JSON является перечнем требований: его native/browser строки остаются NOT_RUN/BLOCKED до отдельного фактического evidence. Статическая ссылка на test не доказывает его успешный запуск.

## Команды

Из корня:

    pnpm --filter @pero/web test:coverage:baseline --check

Существующий entrypoint теперь выполняет только thin static map-check: contract IDs/domains, paths, test blocks, evidence levels, current package web entry. Прежний вызов без --check также проверяет карту. Он не запускает suites/V8/Git/DB/HTTP/browser и не создаёт отчёты; PASS означает только корректную статическую карту. Runtime/native/staging результаты подтверждаются отдельными receipts.

Optional authored-V8 measurement/report/collector и их selftests закрыты в текущем №168; прежние ignored отчёты и OpenSpec evidence не удаляются. Line/branch/global проценты и новое100% покрытие не заявляются. Existing validateMatrix/checkedPath и прежний negative path test сохранены.

## Уровни evidence и сохранение тестов

- unit — чистая функция; DI — настоящий module с подставными DB/effects; SSR — настоящий rendered HTML.
- source-guard — текст/AST защиты миграций, схемы, deployment/operator protocol; полезные guards сохраняются.
- Chromium-component — настоящий Chrome/DOM component с подставными server boundaries. Это уже есть в CI, например project-client-contact-component.
- native-PostgreSQL — реальные constraints/triggers/locks и независимые соединения существующей разрешённой БД.
- HTTP-runtime — настоящий серверный route/action; staging-browser — фактически опубликованный SHA и пользовательский сценарий.
- device — измерение на самом проблемном устройстве; iMac141 остаётся BLOCKED, пока недоступен.

У work-shares-settlement/task-share-fixture queue заранее сериализует fake transaction. Тамошний concurrent test сохраняет value для бизнес-ветвей, но не доказывает PostgreSQL lock. Прежний warehouse native reset/archive/restore operator и его count0 prerequisite закрыты по exact map; historical receipts сохранены. Current warehouse94 guards и existing accounting lifecycle не обходятся; новый owned-CI two-connection case требует actual native PASS.

При обслуживании тестов сохраняются: live FileGridView; реальная revision0/fallback конфигурация; cryptographic UUID fallback; fixed40+60/historic settlement; SQL/migration/operator guards. Orphan helpers удаляются только после доказательства runtime graph и передачи действующей защиты. Изменение Node count само по себе не является выигрышем.

## Обновление и staging

Изменение production-контракта обновляет соответствующий stable ID, точные тесты и gaps; новый negative/rollback/concurrency сценарий появляется в его атомарной задаче. Перед приёмкой фактические revision/target/scenario/status и source inputs сверяются заново. Старый PASS другой ревизии не считается приёмкой кандидата.

Задача163 связывает evidence с реально развёрнутым staging image/identity и собирает native/runtime receipts. Используется существующий qaTransport и reviewed crm-modernization-staging wrapper с W07/DB/S3 guards. Одноразовый first-wave coordinator для `a1123c5` выведен из эксплуатации в №168; его команды больше не поддерживаются. Main разрешается только отдельным приказом владельца.

В №168 также закрыты cash staging diagnostics старых `8ed4838`/`3f6da0d`, cash local release/migration CLI, engineering local migration CLI и одноразовые work-shares/engineering/quantity runners прежних worktree/seals. Их исторические receipts и OpenSpec evidence сохраняются без повторного исполнения. Действуют денежные DI/native API, shared guards, owned fixtures и актуальные browser/stage workflows; локальные миграции выполняются только по согласованной задаче штатными `pnpm db:migrate` / `pnpm db:deploy`. Local/staging дампы для задач запрещены AGENTS.md; nightly refresh и W07 сохраняются.

Продолжение №168 вывело из эксплуатации cash stage операторы старого seal, завершённый engineering комплект и work-shares/quantity QA с новым split 30%, который действующая логика запрещает. Оставшиеся self-only guards `work-shares-local-migrate` и closed cash browser operators также retired; действуют содержательные cash/finance/payroll/domain и UI проверки. Исторические before/after producer CLI миграций 111/118/120 закрыты; текущая warehouse-unit CRUD приёмка продолжает проверять ранее принятый frozen migration descriptor. Historical receipts сохраняются, старые operator команды не поддерживаются.

Закрытые modernization/project/product/attachments session и UI-coordinator namespaces выведены из эксплуатации вместе с unused graph; актуальный allowlist и сохранённые business/UI guards находятся в `openspec/changes/test-basis-reduction/reduction-map.md`. Current integration/native и реальные component/browser проверки сохраняются. Текущий qaTransport и физически закреплённый `crm-modernization-staging.py` продолжают обслуживать Root inspector с DB/S3/W07 guards; historical session/recovery receipts не переписываются.

После принятия ранних QA-выпусков закрыты отдельные modernization/inline/description/attachments stage и recovery CLI, а также завершённый unit110 DB fixture coordinator. Browser-функции и их действующие кейсы сохраняются; последний unit110 browser/fixtures/wire/private-primitives namespace также retired в глубокой итерации после current unit native/Chrome keeper mapping. Старые команды относятся к сохранённым historical receipts и не являются текущими entrypoints.
Закрытые manual native bundlers project/product-inline, description/attachments и их borrowers retired после полного consumer closure; действующие business/data/security cases сохраняются в current integration suites. Current native target/snapshot/journal/preservation и physically pinned qaTransport/W07 guards продолжают использоваться; historical native/migration receipts не переписываются и не объявляются новым SQL PASS.

Закрыты также восстановление единственного corrections run `62c498d2…`, старые inline V1 reconciliation/diagnostic команды, одноразовые file113 cleanup alias/finance-upload bridge и kanban117 V1 recovery. Текущие generic recovery guards, file113 core, RootKit117 и все прикладные native/browser сценарии сохраняются. Неиспользуемый generic declaration/readiness CLI163 удалён; его historical source manifest/canonical receipts сохраняются как evidence; закрытый source-manifest/token-clock producer и selftests retired, current OCI/source binding и pinned Root inspector остаются. Действующий порядок описан в [acceptance-evidence.md](acceptance-evidence.md).

## Навигация карточек (160)

product-card-navigation-browser.test.mjs исполняет настоящие ProductsTab/ProductsKanban/shared card и PointerSensor в Chromium. Синтетические rows/PNG, закрытые Next/server-action boundaries и loopback server не доказывают server ACL или staging. Missing browser даёт failed/BLOCKED gate, silent skip отсутствует. CI уже устанавливает Chromium; workflow не меняется.

Baseline и formatting проверяют trusted cover и отдельный body/title click: ровно один product.number/returnTo route без fullscreen. Реальный drag создаёт disabled overlay; trusted gesture и native disabled-button DOM click() не вызывают переход или fullscreen (DOM click() сам не выдаётся за trusted input). Реальные mobile tables защищают CardNumber. Два faults проходят source provenance/build/mount и отвергаются только после trusted click через NAVIGATION_MISSING/TARGET_MISMATCH; build/hash ошибки не считаются mutation-killed. Browser/server всегда закрываются, PASS artifact сохраняется после cleanup.

В №168 перекрывающиеся handler/SSR tests объединены с реальным Chromium gate; уникальный RecentProjects link/client/title/CardNumber case теперь исполняется существующим product-card-navigation-browser; старый project-kanban-card-layout.test.ts retired в глубокой итерации. Migration/source guards и исторический baseline159 сохранены. Runtime receipt содержит browser/version, actual source/metafile hashes pre/post, отдельные action/fault rows и честный staging NOT_RUN.

    pnpm --filter @pero/web exec node --test tests/product-card-navigation-browser.test.mjs

## Принятый текущий результат CI266 /61f9bc14

[CI266](https://github.com/navasiolau/pero_crm/actions/runs/38583170771) и actual staging61f9 приняты `FINAL_GO_61f9`: web1441/native91/bot38/watch53/guards2 PASS, same tested/promoted OCI/GET200/DB-W07 unchanged/full cleanup. Web30586/64722 (−52,74249869%), prefix31663+385grossoutside = ALL32048/69662 (−53,99500445%);349prefixfiles/198flat. Receipt `.playwright-mcp/application-improvements/dead49-delivery-61f9bc14/acceptance.json`. Подготовительные candidate NOT_RUN выше сохранены как история; baseline static NOT_RUN/BLOCKED и manual E2E/device/full-page gaps остаются, 100% coverage не заявляется.

Auth qualifiers: email/password/manual sessionVersion отзывают WEB session, не меняя API Bearer; roles/active применяют Bearer revoke. Personal O(1) —6 query vectors:2Payroll+2Payout+CashAccount+User. CI196 с (−78vs264/−42vs265/+14vs260),3metadata COPY CACHED/no420MB metadata transfer; **≤180 NOT_MET**, без cold/warm guarantees.

## Глубокая итерация после61f9 — кандидат

Closed source-manifest/token-clock/description-Flight/zoom и whole unit110/kanban/private-wire namespaces вместе с selftests retired по exact reduction-map; текущий Root inspector/c37/7b02 и warehouse94 guards сохранены. Standalone sandbox38/price-transport46 закрыты; исторические private/evidence не удаляются. Новая native/staging приёмка пока NOT_RUN. Все mapped79 manual contours retired по exact keeper source ACK владельцев169; полезные native/HTTP/Chrome ветви находятся в существующих наборах. Actual acceptance нового кандидата требует одного combinedCI/staging; все перенесённые строки входят в finalnet.

Ручная проверка после обновления Chromium: открыть системный preview печати для загруженного оригинала. Встроенный chrome://print/OS-dialog и физическая печать не являются отдельным CRM automated gate; закрытый headful operator не поддерживается.

Глубокий candidate source freeze: exact closures/keepers находятся в reduction-map. Перенесённые current роли/деньги/история/rollback, bot-stock и financial HTTP adapters, calendar owner/MSK/CAS, image/document/download/printing и responsive dialogs сохраняют свои evidence levels. Targeted Chrome PASS не заменяет forthcoming combined native/HTTP/CI/actualStage. Текущая политика инженера DESIGN+assignedPRODUCTION и field statusmatrix сохранена; старые DESIGN-only/mounter-PRODUCTION expectations и старый PDF button→iframe UI retired как obsolete, app не менялся ради прежних проверок.

Текущий combined source после ordinary merge168→169: A15 flat files заменены8existing keepers; B14whole+19partial иC16whole+25partial заменяют только описанные fake/duplicate/closed ветви действующими native/HTTP/Chrome проверками. Exact literal causes/keepers и оставшиеся mixed-file guards — в existing reduction-map/adoption-map, без двойного учёта D104/manual79. Сохраняются unique client UNKNOWN/lateACK/effects, typed/parser/FS/symlink/Decimal/NULL/fixedhistory guards; plain-file-adapters сохраняет servergrant independentcanEdit и FinanceTab INCOME callerwiring.

Author-local UI/pure/syntax результаты не являются новым native/HTTP/CI/staging PASS. Новый inclusive census/проценты/actual native count и CI speed будут только из Root receipts; принятый CI266/61f9 выше остаётся historical acceptedcheckpoint, ≤180с для нового кандидата не объявляется. Contract matrix23/14 сохраняет requirements/gaps/staticstatuses/revisionnull, меняются только текущие source refs. Полные manual E2E/device/physicalprint/externalTelegram/TTN-storage gaps не скрываются.

C final: production-worker-work-ui.test.ts сохраняется original25LF/no diff и3/3SSR PASS — unique TasksTab create/allocate/remaining/noProduct/fieldgate не заменяются nativewriter. task-workspace-pages.test.ts retired после actualHTTP tasksearch positive7eligible→exact6results с earlierorphan/foreign/order/hardlimit6 в existing media.access; source ready/syntaxPASS, actual native/CI/Stage NOT_RUN. Это bounded keeper correction, не новоеcoverage claim.

Final tiny source alignment: existing task-search keeper seeds7 valid eligible rows and asserts exactly expectedTaskIds.slice(0,6) (hardlimit6); earlier orphan/foreign remain excluded. Syntax-only/native NOT_RUN. C own raw net−2021LF includes product-hero EOF-only−1; B product-engineering-core/product-percentage-ui/product-stage-pay EOF-only−3 total is separate from previous author ledger and receives no new semantic reduction credit. All46C paths/old25LFSSR keeper unchanged; committed globalcensus remains Root.

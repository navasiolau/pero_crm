# Verification

## Feedback 09.10.2026: новая приёмка ожидается

Уточнение владельца: DRAFT виден только ADMIN/DIRECTOR, включая все точки чтения. Предыдущие проверки ниже не доказывают этот новый контракт и сохранены как исторические результаты. Текущая база исправления — origin/staging 3f4c0d9ccd4c90c6002e8168c50d5bff01d648a8; после feedback она не является новым принятым checkpoint. Main/production не разрешены.

## Local feedback checks 09.10.2026

- Новые RED ACL/UI: 6 ожидаемых падений из 9 на прежнем коде (видимость менеджера, связанные task/work/file, прямые queries, status targets, notification content и колонки).
- GREEN первой области и прежних grants/create/contract/status regressions: 50/50 PASS в шести целевых test-файлах.
- После независимого review уточнены direct norm/movement/retry guards и финансовая вложенная ссылка. Целевые тесты этих guards: 31/31 PASS; финансы сохраняют расход 60 и количество 3 при скрытом product reference, итог проекта 667266 при скрытом DRAFT.
- Последний дополнительный work picker guard использует тот же productVisibilityWhere; canAddProductWork закрыт для DRAFT без ADMIN/DIRECTOR. Его целевой файл: 9/9 PASS, ESLint двух модулей PASS.
- ESLint собственных runtime модулей и новых guard модулей — PASS. OpenSpec strict validate и git diff --check — PASS. Полный unit suite, миграции, БД и staging этим субагентом в feedback не запускались.
- Независимое read-only review review113_files: прежние P1 обходы norm/movement/retry закрыты, итог NONE. Проверка общего integration candidate и фактической staging-ревизии остаётся pending у оркестратора.
- Создание изделия уже выполняет router.refresh в проекте без redirect на скрытую карточку; этот поток и core создания/договора не изменены. Финансовые факты, количества, free-text история и расчётные формулы не переписаны.

## Feedback staging acceptance

Старый product-draft-stage-browser.mjs проверяет видимость DRAFT менеджеру и сохраняется как исторический helper: для нового контракта не запускать его без уточнения. Использовать guarded root cookies/owned fixture и существующий preference journal с обычными browser/API наблюдениями после exclusive runtime lease.

Проверить ADMIN и DIRECTOR: первая колонка DRAFT, собственный черновик доступен. Проверить MANAGER и MANAGER+ENGINEER: первая колонка PREPARATION в общем и вложенном канбане, черновика нет в канбане/таблице/сохранённом DRAFT-фильтре, прямые id/number дают 404, /api/search не возвращает изделие, original/thumb/image preview файла дают 404. Затем создание менеджером остаётся в проекте; после перевода в CONTRACT изделие появляется в PREPARATION. Прежний денежный итог совпадает. Фактический SHA/образ, здоровье и результат записать после исполнения; task 5.4 пока не принят.

## Historical verification before feedback


Local candidate прошёл независимое review, 1383 unit tests, PostgreSQL rollback/backfill и фактическую конкуренцию в двух сессиях. Последний concurrency run завершился PASS с полным совпадением исходных данных всех 53 таблиц, схемы и default после удаления собственных QA-записей. Снимок staging до миграции успешно принят для 55 целевых изделий; проверка после миграции и staging runtime/browser приёмка остаются впереди. Владелец прямо разрешил коммит задачи 111 и обычный merge/push в staging; выпуск в main не разрешён.

## Candidate

- Задача 111, ветка feature/111, worktree crm-task-111/pero_crm_v2.
- База ветки: свежий origin/staging 20a049b2 (полный SHA определяется Git).
- Коммит, push, merge, staging deploy и production этим субагентом не выполнялись.
- Functional diff прошёл независимое read-only review агента review110_111.

## Local checks

- RED до реализации: product-draft-core — 5/9 падений (создание, служебная история, договор, ручной обход, список статусов); product-draft-boards — 2/2 падения из-за отсутствующей колонки.
- Отдельный RED: latest imported confirmed fromStage поверх старого ESTIMATE — DRAFT вместо PREPARATION.
- После исправлений полный suite: pnpm --filter @pero/web exec tsx --test tests/*.test.ts tests/*.test.mjs — PASS 1383/1383, fail/skipped 0.
- pnpm --filter @pero/web exec tsc --noEmit — PASS.
- ESLint затронутых runtime модулей — PASS, 0 warnings.
- Prisma validate — PASS (локальная placeholder DATABASE_URL использована только для синтаксической проверки, соединение с БД не открывалось).
- openspec validate product-draft-before-contract --strict — PASS.
- git diff --check — PASS.

## Native PostgreSQL

Первоначально подготовлены; фактические local результаты ниже:

- tests/product-draft-native.ts: explicit local/staging guards, actual DB identity, создание всех stage/history сценариев, real SQL denial назначенных задач/файла, договор/CAS/replay, точный SQL backfill для всех статусов/soft-delete, сохранность всех финансовых и бизнес-полей, rollback и полные fingerprint всех public tables.
- tests/product-draft-concurrency-native.ts: оба порядка двух concurrent transactions, подтверждение ожидания через pg_blocking_pids, distinct suffixes при concurrent create. QA fixtures создаются с собственными random UUID, целевая БД проверяется; их outbox IDs помечаются processed внутри транзакции, чтобы не вызвать внешних subscribers. Cleanup ограничен QA actor и точными project/product/client/user ID с проверкой владения и отсутствия денежных записей; общий fingerprint должен вернуться к исходному.
- Enum/backfill миграции разделены на 20261008111000_product_draft_enum и 20261008111100_product_draft_backfill. SQL backfill атомарен и не фильтрует мягко удалённые строки.

Запуск на существующей local5433/staging только в последовательном окне оркестратора. Local/staging dump/reset/seed не используются.

## Staging acceptance

Пока не выполнена. После разрешённой интеграции проверить фактические SHA/образ/health, обе колонки «Черновики», singular «Черновик», сохранённые partial filters, disabled drag/status раннего DRAFT, договор и исходные данные при 1440×900, 390×844 и 360×800. Проверить переход проекта через общий web/bot core. Записать фактический принятый SHA и результаты; статус приёмки заранее не отмечать.

## Guarded local enum prerequisite

Root-only подготовка для существующей pre-migration local БД:

- tests/product-draft-local.ts enum-only привязывает exact CRM_LOCAL_CONTAINER_ID к running/healthy pero_crm_pg, context desktop-linux и его local pipe, volume pero_crm_v2_pgdata, loopback5433, user pero, database pero_crm, public/primary и ожидаемому data_directory.
- Только первый SQL-файл 20261008111000_product_draft_enum: точное single-statement сравнение перед standalone ALTER TYPE в autocommit. Никакого backfill или записи ledger. Полные public-table fingerprints (включая _prisma_migrations) и default сохраняются; DRAFT стоит перед PREPARATION.
- rollback-native mode проверяет уже committed DRAFT и передаёт проверенный DATABASE_URL только в память текущего процесса перед dynamic import harness. Soft-deleted QA fixture создаётся explicit DRAFT; реальный default DRAFT проверяется после точного backfill внутри rollback.
- Error output ограничен name/code/static LOCAL111 guard token, без driver URL, пароля, stdout inspect или реальных записей.
- Контейнер read-only сверён 08.10.2026: bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5, running=true, volume pero_crm_v2_pgdata → /var/lib/postgresql/data.
- На этапе подготовки субагент не выполнял SQL/DDL и не подключался к БД. Последующая отдельно разрешённая READ ONLY диагностика и фактические исполнения root описаны ниже. Команды здесь сами по себе не являются подтверждением выполненной проверки.

~~~powershell
Set-Location -LiteralPath 'C:\Users\admin\.codex\worktrees\crm-task-111\pero_crm_v2'
$env:CRM_LOCAL_CONTAINER_ID='bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5'
$env:CRM_MODERNIZATION_TARGET='local'
pnpm --filter @pero/web exec tsx tests/product-draft-local.ts enum-only
if($LASTEXITCODE -ne 0){throw 'STOP: local111 enum prerequisite failed'}
pnpm --filter @pero/web exec tsx tests/product-draft-local.ts rollback-native
if($LASTEXITCODE -ne 0){throw 'STOP: local111 rollback native failed'}
~~~

Enum остаётся физически committed после успешного prerequisite. Это не означает применение backfill или завершение Prisma миграции задачи111; default и бизнес-строки должны остаться прежними до разрешённого полного rollout.
- Native compatibility проверена offline: исходные top-level awaits вызвали RED для tsx/CJS; runners переведены в exported async функции со standalone entry detection. Все три scripts проходят CJS source transform, TypeScript и lint. Динамическая загрузка actual tsx named runProductDraftNative дала PASS без вызова harness (harnessCalled=false).
- До exact backfill в rollback-native отдельно проверяются два собственных изделия soft-deleted ESTIMATE проекта с explicit PREPARATION и PRODUCTION; после SQL оба должны стать DRAFT, deletedAt проекта сохраняется. Уже-DRAFT fixture не подменяет этот перенос.

## Factual local native and owned lifecycle

DB mutation/execution ниже выполнял root; субагент — source/offline и отдельно разрешённую READ ONLY диагностику.

- Enum-only root PASS: DRAFT physically committed, backfillExecuted=false, all53 tables/default/_prisma_migrations unchanged. SQL SHA aa26a2d37c3a10a84a36ddbbe0b2c812e37e681ad6aebf5bef92167aec464fdf. Это prerequisite, не ledger/full rollout.
- Первый rollback-native STOP backfill, rowsRollbackVerified=true/schemaRollbackVerified=true. Harness parser делил SQL по semicolon до удаления line-comment; sentinel validator маскировал driver error в ERR_ASSERTION. Исправлены только test parser/error propagation/checkIds, runtime/migration unchanged.
- После reviewed correction root rollback-native PASS: все stage/history создания, real SQL grants/manualdeny, contract/history/outbox/CAS/replay без денежных записей, return/skip, actual backfill всех statuses/softdeleted preserving business/finance. Полный53 rows/schema/default rollback verified.
- First concurrency STOP cleanup P2003, chunk a5ab85, 2.7335641 s. Actual RESTRICT FK ProductPercentageConfig_productId_fkey и12own configs блокировали Product.deleteMany.38own QArows retained. Phasecleanup означает scenario checks дошли до cleanup, но functionalPASS не подтверждён.
- Scope только exact rootcall call_4aedc185af5b44ad979a8f836a87fb62/window2026-10-08T18:43:40.859Z–18:43:51.532Z, graph/CAS/disabledQAhash. DiscoverySHA9b7fe47045929585dff8c1e2f77ef39dba31b31ac243703a453d0f98c52f171d. Namespace alone не является ownership.
- Recovery prepare oldsource70dd… STOP inbound-fk-shape CalendarEntry_ownerId_fkey, chunk8e6d4e, no manifest/delete/commit. Readonly exact actor CalendarEntry refs0; pg name[] OID1003 decoded strings, attname::text gives text[] OID1009. Fixed casts + strict arrays/identifiers + primary/directory guards; allowlistunchanged.
- Reviewed frozen recovery source62bc73523e93ffae9337b93b31e3fb8b0eacffe64e3dbc5fc518b655d7cfa4ee: root readonly prepare SUCCESS689665, manifest task111-owned-recovery-manifest-1791490408355.json SHAcfc304393dc6c3329892b4de67fed16cf83e77e009a2f3097543d98c087cd775.
- Root exactcleanup SUCCESS714fd3 exit0 after actualmanifest review. Delete12configs/5producthistory/4products/2projecthistory/3events/7audit/3projects/1client/1actor. All38ownclosed; currentForeignRowsPreserved=true all53/schema/default, commitAcknowledged=true. Receipt task111-owned-recovery-receipt-1791490519427.json SHA5a7ce2bd2aa5b31f2d69112d0f740190e9a34de9971cc834ee2abb28ff83158d.
- Original pre-run baseline lost: recovery preRunBaselineAvailable=false/functionalAcceptance=false; нет restoredOLDMATCH/functionalPASS claim.
- На этом этапе новый meaningful concurrency ожидал durable precommit manifest, baseline всех 53 таблиц/схемы, config-first CAS cleanup и независимого review. Последующий фактический результат root записан в Accepted local native result. Субагенты не создавали новые fixtures и не выполняли native mutation.

## Durable concurrency lifecycle

После фактической очистки прежнего запуска подготовлены только два новых test source:

- tests/product-draft-concurrency-native.ts — SHA 3b361ded97d030b96632151dd03362a1aee59039303b476d1190b715e1d4b545.
- tests/helpers/product-draft-owned-native-lifecycle.ts — SHA 4a462af33ca52e8cb7bdad411f3eaed25b4a636c8cf7c43889eccfd34d2673b0.

Runtime, обе миграции и recovery helper с SHA 62bc73523e93ffae9337b93b31e3fb8b0eacffe64e3dbc5fc518b655d7cfa4ee сохранены без изменений.

PRE manifest содержит точные запланированные UUID, source hashes и исходные fingerprints всех 53 таблиц, схемы и default. Он публикуется после fsync до первого fixture commit. Семь транзакций сохраняют отдельные immutable intent/proof/outcome; generated IDs, xmin, timestamps, revision и row hashes проверяются до commit. Lease запрещает новый запуск при незакрытом предыдущем.

Обе очередности create/contract и два параллельных create подтверждают разные backend PID и конкретный PID блокирующей транзакции. Если доказательство блокировки не удалось, ещё открытые транзакции получают отмену и rollback. Успешная очистка требует семи ACK и точного графа из 38 собственных строк; сначала удаляются 12 ProductPercentageConfig. Все входящие FK и текстовые/JSON ссылки вне точного графа должны отсутствовать. До и после удаления сверяются исходные данные всех 53 таблиц, схема и default.

При ошибке manifest, receipts и lease сохраняются; повторный запуск с новыми fixtures запрещён. Отдельный cleanup-only требует прочитанный и согласованный digest журнала, закрытый прежний PID и повторную проверку исходного baseline. Сам cleanup-only не заявляет функциональную приёмку.

Final source-only checks после guards отмены и committed DRAFT prerequisite:

- TypeScript — PASS, exit 0, chunk b93cac.
- ESLint — PASS, exit 0, chunk 92f80d.
- Offline CJS/parser/publish controls — PASS 22, chunk 9d9a85; sqlCalls=0, artifactWrites=0, nativeHarnessExecuted=false.

На момент подготовки этих двух source фактический повторный native concurrency run ещё не выполнен. Root запускает его только после независимого source review в согласованном окне существующей local5433. Исходное состояние прежнего неудачного запуска не восстановлено по потерянному baseline: recovery подтвердил только точное удаление собственного графа и сохранность текущих чужих данных. Это отдельное доказательство от нового функционального native запуска.

### Observer drain correction

Независимое ревью обнаружило один отказной сценарий только в test runner: observer promise в Promise.race не ожидался в finally. Если вторая транзакция отказывала раньше, наблюдатель мог продолжать запросы после закрытия соединений. Native запуск этого кандидата не выполнялся.

Точечное исправление сохраняет observerPromise, проверяет сигнал отмены до и после запроса и ожидания следующего опроса. Finally отменяет опрос, освобождает первую транзакцию и ждёт allSettled для обеих транзакций и наблюдателя до disconnect. Backend cancellation не используется.

Итоговый runner SHA c1335f5f2e88fb6efbdd163a6eaae459cee6eab435e31206db60ed685f30b9b5. Lifecycle helper с SHA 4a462af33ca52e8cb7bdad411f3eaed25b4a636c8cf7c43889eccfd34d2673b0 и recovery с SHA 62bc73523e93ffae9337b93b31e3fb8b0eacffe64e3dbc5fc518b655d7cfa4ee сохранены без изменений.

- Offline controls извлекают actual deferred/waitForExactBlocker/paired из runner: PASS 2, chunk 5c8581. Early second rejection при pending query и pending sleep завершает наблюдателя до fake disconnect; activeTimers=0, reconnects=0, actualSqlCalls=0, artifactWrites=0, nativeHarnessExecuted=false.
- CJS source parse — PASS в том же контроле.
- Targeted ESLint — PASS, exit 0, chunk 2d9541.
- TypeScript — PASS, exit 0, chunk 4cb5e7.

После исправления требовались повторное независимое ревью и фактический root native run; сам source-only результат не является native PASS. Их завершённый результат записан ниже.

## Accepted local native result

Оркестратор выполнил именно reviewed frozen runner c1335f5f2e88fb6efbdd163a6eaae459cee6eab435e31206db60ed685f30b9b5 и lifecycle helper 4a462af33ca52e8cb7bdad411f3eaed25b4a636c8cf7c43889eccfd34d2673b0 через guarded product-draft-local.ts concurrency-native. Результат e1cfb7: exit 0, status PASS на существующей локальной PostgreSQL на порту 5433.

Все три фактических сценария подтвердились:

- create-first: создание DRAFT удерживает project lock; CONTRACT ожидает его и затем переводит созданный черновик в PREPARATION.
- contract-first: CONTRACT удерживает project lock; создание ожидает его и после commit сразу создаёт PREPARATION.
- number-first: два одновременных создания под project lock получают разные suffixInt 1 и 2.

В каждом сценарии exactBlockerObserved=true для двух разных backend PID 283874 и 283882. Это фактическое ожидание конкретной блокирующей сессии, а не проверка только конечного статуса.

PRE сохранён до первого fixture commit: test-results/task111-native-owned-80502171-fcf9-4189-a3f8-c8a77e94efad/pre.json. SHA 983348566bc18d5cf7f4ff98ea4634a45d9fe693bde46bdf28273dad63f32a97. Этот private ignored artifact содержит только собственные planned IDs и fingerprints; бизнес-строки/пароли/URL не публикуются.

Удалены все 38 собственных строк: 12 ProductPercentageConfig, 5 ProductStatusHistory, 4 Product, 2 ProjectStageHistory, 3 DomainEvent, 7 ChangeLog, 3 Project, 1 Client и 1 User. Конфигурации удалены до изделий с точными row-hash/timestamp/revision guards и проверкой отсутствия чужих backlinks.

Фактический отчёт подтвердил одновременно:

- originalFullBaselineMatched=true для всех 53 таблиц;
- schemaDefaultsMatched=true;
- commitAcknowledged=true;
- cleanupVerified=true;
- originalBaselineAvailable=true;
- functionalAcceptance=true.

Прежний запуск с утраченным исходным baseline остаётся previousLostBaselineRunFunctionalAcceptance=false. Его ранее успешная точечная recovery очистка подтверждала сохранность текущих чужих данных; новый PASS не подменяет и не переписывает это ограничение.

Вместе с ранее завершённым rollback-native это закрывает local PostgreSQL приёмку: exact migration перенос всех статусов и soft-deleted, сохранность business/financial facts, core/CAS/replay/permissions и реальную конкуренцию. Пункт 4.1 завершён. Пункт 4.2 остаётся открытым до проверки фактически развёрнутой staging-ревизии. Коммит, merge и staging task111 ещё не выполнялись; production не затрагивался.

## Staging readonly proof preparation and failures

Для проверки фактических данных до/после миграции добавлены только product-draft-staging-readonly.mjs, product-draft-staging-runner.mjs и их pure test. Reader использует существующий qaTransport/physical wrapper с workflow lock/W07, exact deployed SHA до и после каждого чтения, внутреннюю транзакцию RepeatableRead READ ONLY. Никаких fixtures, migrations, roles/tokens или финансовых операций reader не создаёт.

Chronology неудачных root чтений сохранена:

- 5de299: generic TASK111_READONLY_CAPTURE_STOP, stageMutationExecuted=false. Private output draft111-stage-2b994b8d-3524-4fac-a9ed-9b357ecf7724, transport stderr 0 bytes, BEFORE receipt не создан. Исходный catch отбросил подробности исключения; конкретный PG cause неизвестен.
- После добавления только безопасной диагностики 0ed8d3 показал QUERY_ORG_BOT/P2010, stageMutationExecuted=false. Outer Python не передаёт Node stderr; детали SQLSTATE не сохранились. Это не является доказательством какого-либо конкретного SQLSTATE.
- Source inspection выявил точную ошибку API binding: raw WHERE t.key=$1 получал одним параметром массив с ключом. Strict mock RED f97cc7 подтвердил вложенный массив; аргумент заменён на одну строку без изменения SQL/predicate. GREEN 50 pure tests 084e51. QUERY_ORG_BOT/P2010 поддерживал этот вывод, но фактический SQLSTATE не установлен и не заявляется.
- 0f6afc после scalar fix прошёл query groups и остановился на COMPACT_OUTPUT_LIMIT_WIRE_OUTPUT; stageMutationExecuted=false. Снимок не передан; его реальные размеры и количество строк не сохранены и не утверждаются.
- По согласованному compact design v2 удалены карты отдельных изделий/историй. Их заменяют точные count/SHA256 fingerprints. Размер передаваемого доказательства зависит от количества таблиц, а не от числа исторических строк. Physical wrapper и лимиты не изменялись.

Version 2 сохраняет все исходные invariants. BEFORE вычисляет внутри БД точный target tuple {id, oldStatus, canonicalBusinessHash} для всех LEAD/ESTIMATE non-DRAFT изделий, включая мягко удалённые. Business hash исключает только status/statusChangedAt; updatedAt, цены, количества и все остальные поля входят в него. AFTER восстанавливает те же tuples из точных новых history/audit pairs с deterministic IDs, известными полями reviewed SQL, null changedById, совпадающими датами и проверкой backfill ledger interval. Их count/hash обязан совпасть с BEFORE.

Полные fingerprints остальных изделий и прежних history/audit сравниваются после исключения только точных VALID pair IDs. Неизвестные новые строки, изменения и удаления остаются в защищённом complement или приводят к ненулевым invalid counters. BEFORE tags должны отсутствовать, AFTER counts соответствовать числу targets; ранних non-DRAFT изделий после миграции не остаётся. Все остальные модели, включая финансовые и ApiToken.lastUsedAt, защищены полностью. Допустима только согласованная монотонная дата telegram.botUsername при неизменном значении/остальных полях, прочитанная в той же транзакции.

Итоговый frozen source:

- Reader SHA bcd8adc913002218f6594e1e619ae34a1cd94a342146e36544dad951b242b659.
- Runner SHA 993274838528630e4da72888365ed4f46aec3327e60f81b93ed455f6490baf21.
- Pure tests SHA 2b3c50ea60272744519d5206ebdb501c44e32b118debbcd8c464fe229fafecc8.
- 55 pure tests — PASS, 16d010; targeted lint — PASS, 0 warnings, 8c5013; diff check — PASS.
- Dry bundle — 27,559 bytes, SHA 248d779f2f6451b9c439a9d7c377c391dc14c7245bfa090a06bf0cb447b8a270, c9c3f3; stageExecuted=false/dbExecuted=false.
- Независимое source/SQL review review110_111 — ACK для точных трёх SHA, включая tuple canonicalization, exact pairs и защищённые complements.

## Accepted staging BEFORE result

Оркестратор выполнил один guarded readonly BEFORE run e07312db-7c2b-4255-baba-6ee9ed4bf6de после закрытия предыдущего QA lifecycle112. Root result ccd417: BEFORE_CAPTURED, stageMutationExecuted=false, fixturesCreated=false. Принят фактически работающий staging SHA 322bd3d542e9d503e955127dc4c1f32644646bc4; это ревизия до интеграции задачи 111.

Version 2 coherent snapshot охватил все 53 public tables. Target count = 55: это исходные изделия проектов LEAD/ESTIMATE с non-DRAFT статусом, подлежащие переносу по точному SQL111. Никаких исходных строк, цен, комментариев или credentials snapshot не сохраняет; только schema metadata, counts и hashes.

Private ignored artifact: apps/web/test-results/draft111-stage-e07312db-7c2b-4255-baba-6ee9ed4bf6de/before-proof.json. SHA 4fc34425fef36323731fc34ba6c13945afa455e31ba5a7a3d3aa826c4df76ff6. Bundle SHA 248d779f2f6451b9c439a9d7c377c391dc14c7245bfa090a06bf0cb447b8a270.

Это baseline до миграции, не AFTER proof и не завершённая staging-приёмка. После разрешённого commit/обычного merge/push требуется принять exact deployed SHA111 и сравнить AFTER с этим manifest; затем отдельно проверить фактические runtime/browser сценарии. Пункт 4.2 остаётся открытым. Работы110/113 не смешиваются с этим migration delta до завершения приёмки111. Main и production этим разрешением не затрагиваются.

## Последующее staging-доказательство миграции и API clocks

Раздел Accepted staging BEFORE выше фиксирует состояние до интеграции111; его baseline и frozen reader/runner/tests сохранены. После этого root создал commit d8b643e44931e66ed3ad504807517ab6cb30f3c5 и обычным merge интегрировал111. На фактически развёрнутой87c404846bdb659a2f9f45e3b9d7a0a98c5ad17a AFTER сначала остановился (11815d); исходный CLI скрыл CamelCase имя таблицы.

Отдельный reviewed forensic readonly capture a4b094 сохранил private aggregate receipt SHA944c555da3e04de2485f4e37d35dfbbf0fa428c25f8f9cea9dcdbf3bcb9e4101 до неизменённого comparator. Он подтвердил все55 target tuples, сохранность business полей/цен/количеств/FK,55 точных новых history/audit пар, прежних history/audit и финансовых моделей; schema/default/enum и две ledger миграции соответствуют approved SQL. Единственная неожиданная полная byte-разница — ApiToken: count3→3, изменён full hash.

Первоначальный all-public byte guard остаётся STOP ORIGINAL_TABLE_CHANGED_ApiToken. Его comparator/BEFORE не заменялись, исключение lastUsedAt задним числом не добавлялось. Изменение только lastUsedAt в точном первоначальном BEFORE→AFTER не доказано.

Root отдельно проверил неизменность всех stable ApiToken полей по независимому более раннему подписанному accepted112 PRE на322: count3/legacy stable MD5 c3e20487b86c6ab8784656a510201b4c. Guarded readonly capture1f567f на87c дал signatureVerified=true/stableFieldsEqual=true; private receipt SHA d6caa09e35f82b1cd8e6cc501622dda7db9a4f4e8187636f698ae67d0f221c11. Это независимое доказательство322→87c stable facts, а не восстановление точной старой clock-декомпозиции или исправление full-byte STOP.

Для новых QA baselines применяется отдельный reviewed common token-clock helper: полная проекция stable полей исключает только lastUsedAt, token IDs хешируются, clocks должны быть монотонными и не позже capturedAt; остальные поля и набор IDs/counts обязаны совпадать. Исходные111 proof файлы остаются неизменёнными.

## Фактические свежие browser QA lifecycles

Runtime выполнял только root. Каждый новый run имеет отдельный signed PRE, durable intent/journal, короткоживущий private manager handoff в памяти и exact own graph. Closed runs не переиспользуются; ручной повтор prepare/browser после неизвестного ответа запрещён. Root проверяет current protected-data/schema fingerprints и удаляет только собственные записи с CAS; natural API clock разрешён лишь по новому заранее captured stable/clock baseline.

| Run | Фактическая ревизия / результат | Подтверждённое завершение lifecycle |
| --- | --- | --- |
| 7a171eae-d77b-4eb3-ad81-0fe9897896a6 | Запрошен cfd065314024fd448c5989964e0cbc7790b196da;815502 WEB_REVISION_MISMATCH до bundle execution. | PRE/fixtures/actors не создавались; cleanup не требовался. |
| 0fd01856-0b74-4c51-be3e-3e17006d3c81 | Readonly preflight c1627a PRE_DURABLE на87c; prepare не выполнялся. | Созданы только технические private artifacts; actors0. При новой ревизии требуется свежий UUID/PRE. |
| b67a2311-6bbf-4635-81af-0c714bc41f39 | 0ab5c954d6e5d832c742e54e9500c508768bc0fb; prepare0417bc3own rows; browser714914 DRAFT111_TECHNICAL_PLAIN_VALUE_REQUIRED. | Оба journals empty. Причина маскировки: producer возвращал scopegraph undefined до первой ownGraph; первичная ошибка не сохранилась. Capture4a075f exact3/current originals preserved; cleanup79d32e CLOSED User1/Client1/Project1, остальные0. functionalAcceptance=false. |
| 5a29f494-45e1-4abd-a00a-08c9c3f843de | 0ab; STOP PROJECTS_BOARD, HTTP200, pageErrors0/actions0. Root readonly DOM b24d70 доказал два nested main и strict generic-main отказ. | Capture3dafbd original54 preserved; cleanup28d52d CLOSED exact3, остальные0. functionalAcceptance=false. Исправлен только QA unique inner-main locator. |
| 182f813e-f914-4e72-933c-62a0ab958ebf | 0ab; STOP PRODUCT_DIALOG/TIMEOUT, HTTP200/pageErrors0; два ACK: preference/project-create, products0. Readonly probes da50d0/6a5565/af6a55 показали валидный dialog/payload без forwarded business POST. | Capture16bac/e481 originals preserved; cleanupf667e9 CLOSED12 own rows: User1/Client1/Project2/ProjectHistory1/ChangeLog1/DomainEvent1/Notification4/Preference1. functionalAcceptance=false; broad step ещё не выделял действие. |
| d0833b5e-c97a-467b-bde5-1aebd0219430 | 37f882f69a2d76901b98321ff7824d0d04db4db8; STOP PRODUCT_DIALOG_TITLE/TIMEOUT. Own path/tab products и trigger visible/enabled, dialog/fields hidden; product0. | Capturece7981 original54 preserved; cleanupebc077 CLOSED exact12; functionalAcceptance=false. Root разрешил bounded повтор только локального idempotent OPEN до fill, без повторения submit/server action. |
| fdf0927a-8fb9-4fee-b9c1-c29cab3a3752 | 37f; LEAD_create_DRAFT_disabled_status_and_global_drag фактически PASS: product1 DRAFT, modalOpenAttempts2. Затем STOP DRAFT111_CLIENT_ERROR на PROJECT_STAGE_PAGE, HTTP200/pageErrors1, ERROR без кода. | Capturebd945b originals preserved; cleanup193633 CLOSED19: User1/Client1/Project2/Product1/Config3/ProductHistory1/ProjectHistory1/ChangeLog2/DomainEvent1/Notification4/Preference2. functionalAcceptance=false; известен только частичный сценарий, полный browser PASS отсутствует. |

Во всех закрытых live runs root сообщил сохранность всех54 original public tables/schema по fresh baseline с допустимым natural API clock; это не означает full-byte equality старого111 миграционного baseline. Для79d32e root отдельно сообщил botClockChanged=false; неподтверждённые clock подробности других запусков здесь не выводятся. Субагент не выполнял DB/SSH/HTTP/browser runtime, cleanup или создание QA actors.

После193633 закрытия добавлена только безопасная диагностика в два QA source файла: bounded React code/family и SHA256 сообщения, фиксированный этап, RSC/action-response флаги и последний recognized RPC phase/HTTP/ACK-durable/fulfilled. Raw message, headers, payload/args, URL, stack, HTML, cookies или финансовые строки не сохраняются. Все page errors по-прежнему приводят к STOP; отсутствующие/конфликтные ACK запрещают следующий бизнес-запрос.34 offline controls282747, lint0 084a76, diff check0, independent review review110_111 NONE.

Полный пункт4.2 остаётся открытым. Partial LEAD PASS и безопасное закрытие отказных fixtures не заменяют остальные этапы/контракт/replay/skip/PAUSED/REFUSED/mobile сценарии. Main/production не изменялись; дампы/restic для этих проверок не использовались.


### a348 — доказанная длительность actual ACK и ожидание UI

Root выполнил run a3482000-b25e-4823-8cb9-21b20f9d23cb на37f и остановился в PRODUCT_DIALOG_WAIT_CLOSE при pageErrors0. Local read-only проверка exact CLOSED технического receipt614211 установила: product-create intent06:21:12.623Z, ACK06:21:28.036Z, длительность15413ms; ACK durable и route fulfilled подтверждены. Preference180ms/project-create258ms. Ранее UI close assertion имел default5s и завершался раньше real ACK; глобальный catch дожидался queue, поэтому сохранённая более поздняя provenance уже показывала FULFILLED, а modal state был снят в момент более раннего отказа.

Для own runner onJournal — локальный fsync; remote capture вызывается после успешного закрытия dialog. Следовательно, задержка15413ms доказана для actual route.fetch/full response/RSC пути, но не приписывается SSH capture внутри ACK callback. Исходный run остаётся functionalAcceptance=false.

Root93f00c подтвердил current originals, а5a9204 выполнил CLOSED. Exact cleanup receipt содержит18 собственных строк: User1/Client1/Project2/Product1/Config3/ProductHistory1/ProjectHistory1/ChangeLog2/DomainEvent1/Notification4/Preference1; freshOriginalsPreserved=true/cleanupCommitted=true. Никаких live fixtures этого run не осталось.

По reviewed Root design после единственного submit QA ожидает exact matching product intent с durable ACK и завершённым route.fulfill, ограниченно65s, затем строго проверяет modal hidden с timeout65s. Известная route/page failure немедленно остаётся STOP; submit/server action не повторяется. Failure diagnostic дополнен только busyVisible boolean/null. Offline regression моделирует ACK позже5s, отсутствие повторного submit, немедленный отказ known failure и фиксированный deadline; это не новый actual browser PASS.

## Принятая staging-приёмка задачи 111 — 09.10.2026

Оркестратор принял все девять обязательных runtime-сценариев задачи и точное закрытие собственного QA lifecycle. Пункт 4.2 завершён. Фактически проверенная ревизия: `37f882f69a2d76901b98321ff7824d0d04db4db8`; исходники браузерного harness закреплены QA-only коммитом `afab829d5db4f6d92c4de79036c3cee0c35590c7`. Предыдущие локальные проверки, native migration/concurrency proofs и независимое review повторно не запускались.

Run `b35adc2a-e806-46de-a115-873fb9a14b94` выполнил субагент finish111_acceptance под эксклюзивным runtime lease оркестратора. Файловой Parent113 fixture был приостановлен и входил в защищённые исходные данные. Не выполнялись main/production release, дампы, restic, изменения сервисов или расписаний.

| Фактический сценарий | Результат |
| --- | --- |
| `LEAD_create_DRAFT_disabled_status_and_global_drag` | Новое изделие — DRAFT; ручной селект и drag раннего черновика недоступны. |
| `ESTIMATE_create_DRAFT` | Новое изделие в «Просчёте» — DRAFT. |
| `CONTRACT_promotes_DRAFT_postcontract_create_PREPARATION` | Договор переводит оба черновика в подготовку; последующее новое изделие сразу получает PREPARATION и штатно переводится в DESIGN. |
| `return_preserves_nonDRAFT_denial_and_contract_promotes_only_DRAFT` | Возврат в LEAD сохраняет прежние статусы; сервер отказывает в ручном выводе нового черновика. Повторный договор переводит только DRAFT, оставляя DESIGN. |
| `actual_deployed_stage_replay_and_noop` | Повтор исходного запроса и переход CONTRACT→CONTRACT не меняют собственный граф записей и событий. |
| `PAUSED_REFUSED_without_ordinary_history_default_DRAFT` | PAUSED/REFUSED без обычной истории создают DRAFT. |
| `skip_CONTRACT_no_autopromotion_active_create_PREPARATION` | Пропуск договора при переходе в IN_WORK сохраняет три черновика; новое изделие получает PREPARATION. |
| `PAUSED_REFUSED_latest_ordinary_stage` | После IN_WORK новые изделия в PAUSED/REFUSED получают PREPARATION по последнему обычному этапу. |
| `actual_global_and_nested_columns_desktop_mobile` | На общей и вложенной досках при 1440×900, 390×844 и 360×800 первая колонка — «Черновики», следующая — «Подготовка». |

Фактический browser-result: `apps/web/test-results/draft111-functional-b35adc2a-e806-46de-a115-873fb9a14b94/0155-browser-result.json`, SHA256 `110cfb202d96cae21635daf1514c0a4e38b021a19f5dff2facf4e501cb7fcc6f`. Все 28 запросов имеют durable ACK; pageErrors=0, blockedWrites=0, journalPersistFailures=0, closeFailures=0. Это доказательства именно работающего staging, а не только локального рендера или совпадения исходников.

### Ограничение дополнительной проверки фильтра

Общий расширенный harness закончился `STOP_CLOSED`, browserStatus=STOP и wholeEndToEnd=false. Девять перечисленных сценариев были завершены до отказа на `OWN_GRAPH`, последовавшего за записью частичного фильтра статусов. Последний реальный preference ACK200 был durable и fulfilled; сохранённый query содержит ровно `status=["DESIGN","PREPARATION"]`, без добавления DRAFT.

Дополнительные DOM-проверки отсутствия черновиков после применения этого фильтра и после повторного открытия сохранённого списка не завершены в данном actual run. Это дополнительные проверки совместимости harness, а не отдельные требования delta-spec111. Они не выдаются за actual PASS и не нужны для повторного выполнения уже принятых девяти сценариев; локальные проверки фильтра были завершены ранее.

Failure mapping сохранил только `DRAFT111_BROWSER_UNKNOWN`/ERROR, failureStep=OWN_GRAPH. Точный native capture checkId не сохранился; `transport-inspect-unknown.stderr.private.log` пуст. Причина отказа не установлена. Возможная гонка поздней записи preference и capture не объявляется доказанной причиной или дефектом приложения.

### Точное закрытие QA и сохранность данных

Signed PRE `0002-pre.json` имеет SHA256 `992ebb7b55770cf77bc040f26ba7e207453cdf669cea8a8ef27ebad8ee588e46`. Финальное подписанное observation `0157-observation.json` имеет SHA256 `8092d5200f02b8f44258b082b980395fe8f231a73134174550d16f260b08a666`.

`0160-cleanup-result.json`, SHA256 `9e69bdc6c9bd31a8341c677d6447fe0ce4dac3f64667604f811c87bee5561a21`, подтвердил CLEANED, cleanupCommitted=true, originalsPreserved=true и freshOriginalsPreserved=true. Удалены ровно 174 собственные строки: ProductPercentageConfig30, ProductStatusHistory14, ProjectStageHistory10, ChangeLog24, DomainEvent14, Notification66, UserPreference2, Product10, Project2, Client1, User1. Чужие записи не удалялись.

Guards сохранили исходные данные всех 54 public tables, schema/defaults и финансовые факты. В защищённый complement входили в том числе живые File/FinanceDocument и остальные записи Parent113; их fingerprints сохранились. Этот run не читал и не менял S3 и не является отдельным S3 proof Parent113. Допустимый natural ApiToken clock изменился, botClockChanged=false; поэтому fullOriginalByteMatch=false честно сохранён и не подменяется заявлением о полной byte equality прежних token clocks. Сохранность stable original facts и CAS-восстановление собственных записей подтверждены.
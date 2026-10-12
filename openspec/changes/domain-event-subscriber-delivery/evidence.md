# Evidence

## Scope and policy

Feature136 от freshaccepted f479; Root policy accepted12.10.2026: legacycompleted не переоткрываются, oldpending firstprocessing freeze enabledregistered snapshot; неизвестный прежний success не выводится изPluginRunLog. Неподтверждённый disabled/removed → terminalSKIPPED с причиной. Consumers требуютidempotency поevent.id; effect-beforeACK может повториться, exactly-once не обещается. Перед production/legacyreplay этот риск явно сообщить; новых businesssubscribers/активации нет.

Два additive models/таблицы DomainEventDeliveryPlan и DomainEventDelivery;13physicalDomainEventcolumns/старыеSQLmigrations не меняются. Migration20261012190000_domain_event_subscriber_delivery толькоCREATE/constraints/BEGINCOMMIT, SHА4d0cc5df129665ecc5aa1824fb885c023cc9373ef6bcfa36c78d67de140b762b. Общий budget/lease/worker135 остаются. Receiptstore lock→DBclock→work→finalclock; expiry вызываетrollback. Hook/receipt/ACK mutations дополнительно active/ensureOwned. SDK изменён толькокомментарий гарантий.

## Initial core checks before SQL

Actual olddispatcher RED7efdbf exit1: successfulA invoked2 вместо1 приretryB. GREEN539113/607cbf exit0: оба порядкаA/B, successfulA/ctx.emitchildonce, новыйC не добавляется, disabledB skipped, oldcompleted/internalcleanup receipts не получают. Actualcontext/events тест152 тожеPASS сfaithful sharedreceipt fixture;2existingadapters изменены безослабленияassertions.

Compatibility607cbf21/21PASS (19existingqueue+2context/subscriber), включая50failures→healthyprogress, timeout/ownership/backoff/replay/observer. Дополнительно2store tests a357f8 PASS: actualproduction store boundary проверяетlock-beforeclock/finalexpiredrollback сcontrolledtransaction (НЕPostgreSQL), memoryempty snapshot/activeclaim/terminalimmutability. Fakefixtures не являютсяnative uniqueness/fencing proof.

Scopedlint3d3b62/a357f8 PASS0warnings. Prisma6.19.3 generate539113 PASS безDB. Перваяschema validate остановиласьP1012 из-за отсутствияDATABASE_URL; повтор56f23a сdummyunusedURL толькодляget-config parserPASS, connections0. OpenSpec/diff56f23a PASS. Initialfullwebtyping67869/5584fb exit0; finaltyping94567 после2newtypedtests такжеexit0. SQLmigration/native/staging136 НЕвыполнялись, Source136 не включён вRootintegration465.

## Actual migration qualification

По Root ONE выполнена ровно одна qualification/deploy, runId `a980ce32-aece-4a95-ad52-5be92c2c32c8`, receipt54b135. Guard подтвердил существующий контейнер `bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5`, `pero_crm/public`, `127.0.0.1:5433`, HEAD `f479f46fe0bb30491f649e52a6962a5b1a7962d1` и единственную pending migration `20261012190000_domain_event_subscriber_delivery` с SHA256 `4d0cc5df129665ecc5aa1824fb885c023cc9373ef6bcfa36c78d67de140b762b`.

Prisma deploy добавил только две пустые таблицы, шесть constraints, три indexes и одну запись ledger (76→77). Старые строки, весь исторический ledger, колонки, constraints/indexes старых таблиц, функции и triggers совпали. Baseline до DDL: `6f82f00e5ddec0fdf0daf766913e8c387724752ead4e0a9d23d958a5880c3671` (62 таблицы); после DDL: `b373ec8ec1ab293abc175e1e2e89b9f99f84e4a331dfd22be2b39e0d62fee6d4` (64 таблицы). Точные private before/catalog/ledger/post-DDL/closed receipts сохранены в `.playwright-mcp/revision-acceptance/a980ce32-aece-4a95-ad52-5be92c2c32c8/`.

## Actual subscriber native

Первый разрешённый native run `d8564f8b-d4e6-4a34-a0a5-1a163cd81b70` завершился HOLD после восьми сценариев. Его receipts неизменны: cleanupComplete=true, cleanup-ack remainingOwned=0, rowsAndCatalogMatch=true, digest равен post-DDL baseline. Два lease-сценария тогда не считались пройденными. В QA caller исправлен возврат PostgreSQL void: оба `pg_sleep(0.55)` теперь возвращают скалярный столбец. Delay/lease/assertions и production-код не менялись; добавлена безопасная диагностика исходной фазы ошибки без raw messages/SQL/stack. Qualification/DDL не повторялись.

После отдельного Root ONE и exact-delta review9a793e выполнен один новый native run `d670d083-c77e-48d8-a916-f13ea95deb95`, receiptd193bf, status `QA136_SCOPED_CLOSED`. Перед любыми owned mutations read-only nativeSnapshot совпал с post-DDL baseline. Две настоящие PostgreSQL sessions подтвердили десять сценариев: конкурентный frozen snapshot с фактическим lock wait; composite/position uniqueness; durable EMPTY; actual dispatcher A ACK→B retry с единственным ctx.emit; late C не добавляется; completed не переоткрывается; идемпотентный literal consumer после effect-before-ACK; старый token отклоняется; post-lock expiry отклоняется; фактический plan INSERT откатывается при final expiry.

Все pending native operations и hooks завершены до cleanup. Exact keys/static identity/current observation/FK guards проверены внутри cleanup transaction. После commit owned events/plans/receipts=0; все прочие строки и каталог совпали с baseline `b373ec8ec1ab293abc175e1e2e89b9f99f84e4a331dfd22be2b39e0d62fee6d4`. Оба клиента закрыты до terminal receipt; global worker=false, outbound providers=0. Private pre/verified/cleanup-intent/cleanup-ack/closed сохранены в `.playwright-mcp/revision-acceptance/d670d083-c77e-48d8-a916-f13ea95deb95/`; filesystem readback505090 и source-post9a0dd8 подтвердили receipts и неизменность reviewed pins.

Final caller SHA256 `427111529ac7053199f54f609aba0e5dce6de39c95af58d85101a5f191cc2930`; qualification SHA256 `0bd02bab27df96a6d92331691e6bf350ea32ccb34e9e0d12b3d515a40c84de04`. Caller-only inert2973f7, strict TSf6ba5d, lint811c9b — PASS; core checks повторно не прогонялись. Independent final review eece87 — FINAL_CODE_GO + ACTUAL_LOCAL_GO. Restic/dumps/seed/reset/new DB/settings/W07/main/production не затронуты.

## Remaining work

Local136 принят независимым reviewer. Staging136 — NOT_RUN; задача2.3 остаётся открытой до обычного merge, CI и приёмки фактически развёрнутой ревизии. Main/production не разрешены.

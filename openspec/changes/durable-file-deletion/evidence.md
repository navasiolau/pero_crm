# Evidence

## Scope

Bugfix137 от fresh origin/staging `cfc4f91a8be070b8f160b3c9de6abeb2af8fce83`; только ordinary deletion. Новый intent использует existing DomainEvent135 и единственный ChangeLog receipt/audit. Schema/SQL migrations/lockfile/исторические строки не меняются. Эскизы/обложки остаются138; worker/hooks/settings/main/production/restic/dumps не трогаются.

## Initial controlled checks before native

Actual old action RED8e20f5: три ожидаемых отказа — audit failure оставил File удалённым, storage failure не сохранил intent, повтор UUID вернул missing вместо прежнего результата. Green5827cb:11/11 action tests после tx core/current User roles+active/file ACL/advisory UUID lock/receipt+intent. Controlled adapter сохраняет настоящие action/core/ACL/queue/executor, но не является доказательством PostgreSQL rollback/concurrency.

Targeted compatibility114ea3:34/34 (19 existing queue + 11 action + 4 storage). Local owned tempfiles/junction проверены фактически: selected original/ENOENT, соседний файл и outside target сохранены, traversal/reparse отказали. S3 provider controlled: используется только ordinary DeleteObject, purge запрещён; identity/reference/ownership/forged-key guards дают ноль effects, новая ссылка между ключами блокирует thumbnail.

Receipt хранит hash полного server-created intent; executor сверяет его до effects, чтобы изменённый payload не мог переназначить target после удаления File. После этого изменённые action/storage tests3c815a:15/15. Новый processor de2e67:12/12 action tests PASS, продолжение pending intent не создаёт второй аудит. Faithful engineer/task-file adapters d39e79:11/11 PASS; роли, hidden/status grants и сохранение cached filename не ослаблялись. Final strict web typing24527e и scoped source/tests/adapters lint92a6b0 PASS. Native/staging — NOT_RUN; fake queue не доказывает настоящие native uniqueness/rollback/рестарт.

Один thin native caller `tests/file-delete-native.ts` подготовлен на existing nativeAcceptanceBinding/nativeSnapshot/nativeJournal/FK helpers. Он объявляет exact собственные User/Client/Project/File/ChangeLog/DomainEvent IDs и local keys до fixtures; baseline должен совпасть с post136 `b373ec8ec1ab293abc175e1e2e89b9f99f84e4a331dfd22be2b39e0d62fee6d4`. Один local run должен проверить реальные tx rollback, двух-session UUID replay, pending storage fault/new live binding/новый processor и awaited exact cleanup. Inert d43abd: DB/storage effects0; caller-only TS338cd8 и lintcde39b PASS. Actual SQL137 не выполнялся.

## Same-key reviewer correction

SOURCE_HOLD: между live-reference check и remove существовал TOCTOU, предыдущий between-keys fixture не доказывал защиту этого интервала. Native старого caller5183 НЕ запускался. Read-only runtime inventory нашёл ровно три File.create writers (ordinary/product-sketch/project-cover upload), единственный upload route задаёт fresh server UUID storedName; projectId/storedName runtime не обновляются, registered demo не пишет File.

После Root и independent STRATEGY_GO добавлен общий canonical tx storage-binding fence для delete и всех трёх creators. Creators до File.create проверяют permanent internal tombstone, включая COMPLETED, с полной валидацией payload, event ID/actor и receipt intentHash. Runtime completed tombstones не удаляет. Нет network effects в DBtransaction, schema/UI/ACL/CAS и ordinary DeleteObject не менялись.

Конкретный actual-creator RED dfebae: REAL persistOrdinaryUpload внутри remove callback после live-reference check вызвал File.create1 вместо0. GREEN c8b5c1: тот же creator отказал FILE_STORAGE_KEY_RETIRED до File.create. Изменённые deletion/action guards070ff9:17/17 PASS; три затронутых creator sets39b7b5:26/26 PASS без ослабления исходных assertions. Это controlled contract proof; реальный peer transaction в критическом интервале и проверка COMPLETED tombstone добавлены в единственный thin native caller, actual SQL всё ещё NOT_RUN.

Final same-key scoped lint409d4e и strict web typingded67f PASS. Updated caller inert8d059b: DB/storage0; SHA256 `d1902e145cecea6eacc846a1c8242749382f0fe194767e26f237033a5e2e7dc0`, source pins14 включают все supported creators/fence. OpenSpec4ec1b4 valid; schema/migration/lock diff0. До final CODE/protocol GO и нового Root ONE caller не выполнять.

## Actual local native

После SOURCE_CODE_GO/INERT_EXEC_PROTOCOL_GO и отдельного Root ONE выполнен ровно один native run `6324c394-a2dc-4904-ac87-47092377e9cd`, receipt `0e1109`, exit0, status `QA137_SCOPED_CLOSED`. Точный local binding: existing container `bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5`, `pero_crm/public`, `127.0.0.1:5433`, source revision `cfc4f91a8be070b8f160b3c9de6abeb2af8fce83`. Read-only pre snapshot:64 таблицы, digest `b373ec8ec1ab293abc175e1e2e89b9f99f84e4a331dfd22be2b39e0d62fee6d4` до любых own mutations.

Две настоящие PostgreSQL sessions (PID741544/741545) подтвердили семь сценариев: фактический rollback File при audit failure; фактический rollback File/ChangeLog при intent failure; concurrent UUID replay с единственным receipt/event; storage fault оставляет durable pending; новая уже существующая live reference сохраняет bytes; новый processor завершает pending без второго аудита; REAL peer creator в интервале reference check→remove и после COMPLETED tombstone отказывает до File.create.

Native использовал только объявленные own User/Client/Project/File/ChangeLog/DomainEvent IDs и local QA bytes. Cleanup проверил текущую observation, статические owner identities, incoming FK и full-original snapshot внутри transaction; после commit own DB=0 и весь исходный rows/catalog snapshot совпал с baseline. Exact filesystem allowlist очищен, QA storage folder отсутствует, own storage=0. Effects завершены перед cleanup, оба клиента await-disconnected до closed receipt; global worker=false, outbound providers=0. Source14 pins совпали до constructors и после disconnect, filesystem/source readback `cbc9a8`/`f2fb5d` подтвердил результат.

Private pre/verified/cleanup-intent/cleanup-ack/closed сохранены в `.playwright-mcp/revision-acceptance/6324c394-a2dc-4904-ac87-47092377e9cd/`. Independent FINAL_CODE_GO + ACTUAL_LOCAL_GO подтверждены. Schema/migrations/lockfile не менялись; DDL/dumps/restic/new DB/seed/reset/settings/main/production не выполнялись.

## Remaining work

Local принят. Actual staging и реальный S3 — NOT_RUN: controlled S3 tests доказывают command/guard contract, не удалённую storage-приёмку. Задача2.3 остаётся открытой до normal Root merge/CI и actual staging identity/scoped runtime/cleanup; push/интеграцией владеет Root.

# Evidence

## Feedback09.10.2026 — новая политика удаления

Владелец отменил сохранение вытесненных эскизов при будущей замене: old File + physical original/thumbnail, включая versions/markers, должны исчезать после успешной операции. Proposal/design/tasks и delta в том же change112 обновлены. Local RED→GREEN, independent review и новая actual staging-приёмка будут зафиксированы здесь; сейчас новая staging-приёмка PENDING.

Все следующие receipts и заявления о сохранности прежних own originals относятся к датированной прежней политике. Они сохраняются как исторические факты и не подтверждают новое удаление; raw pins, старые QA файлы и receipts не переписываются.

## Local feedback verification — 09.10.2026

Уточнение удаления реализовано в прежней ветке112 от `3f4c0d9ccd4c90c6002e8168c50d5bff01d648a8`. Один focused RED показал retained old File (`true !== false`); GREEN подтвердил атомарное удаление ровно baseline File, audit и один DomainEvent.

Итоговая focused проверка:52/52 PASS — domain CAS/ACL/shared cover/alias/историческое стороннее вложение14, exact cleanup/recovery/live refs4, physical S3 versions/markers/pagination/postcheck5, actual POST route19, mounted upload/client recovery7, sketch interaction3. Route tests реально вызывают POST/core с контролируемыми storage/transaction границами: rollback сохраняет old bytes, unknown COMMIT не удаляет до подтверждения, committed503 и same-nonce replay завершают старую очистку, superseded replay и concurrent winner сохраняют текущий файл. Существующий test adapter thumbnail key исправлен на настоящий суффикс `.jpg`; это не изменение storage-схемы.

Команды: `pnpm --filter @pero/web exec tsx --test --test-reporter=spec tests/product-sketch-cas.test.ts tests/product-sketch-cleanup.test.ts tests/s3-delete-exact.test.ts tests/upload-route-reliability.test.ts tests/upload-new-selection.test.ts tests/sketch-upload-interaction.test.ts`; `pnpm --filter @pero/web db:generate` (только Client); `pnpm --filter @pero/web exec tsc --noEmit --incremental false` — PASS; scoped ESLint —0 errors/0 warnings после одной правки unused local; `git diff --check` и OpenSpec strict — PASS.

Физический S3 helper никогда не использует marker-only DELETE для cleanup. Его contract сверён с [AWS DeleteObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObject.html) и [ListObjectVersions](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectVersions.html): только exact Key + VersionId, отдельный postcheck versions/markers и HEAD. Проверка версии с ID `null` включает unversioned bucket; matching-prefix соседний ключ остаётся нетронутым.

Independent review actual diff перед коммитом — NONE: проверены atomic oldFile/outbox, postcommit exact versions/markers, replay/current-pointer, committed503/dispatcher/UI retry и неизменная ordinary file-delete ACL. Reviewer не запускал runtime и не заявлял actual staging/S3 PASS. Новая actual staging DB/S3/browser acceptance — PENDING; local DI не подтверждает deployed image или physical staging bytes. Historical backend3 harness/raw pins/receipts сохранены. Subagent не выполнял staging/production/infra DB/S3 мутации, дампы или restic.

## Historical evidence — 08–09.10.2026, прежнее retention-поведение superseded

08.10.2026, задача112, ветка `bugfix/112`, базовый staging `20a049b2`.

- Прослежен полный путь `ProductCoverLayout → PhotoUploadButton → sketchUploadForm → POST /api/files/upload → authorizeProductCoverUpload → resolveUploadContext → persistUploadedProductCover`.
- Назначенный инженер и ENGINEERING-участник допускаются только на DESIGN. Кнопка замены не зависит от `canDeleteCover`; old file author/legacy null не ограничивает замену. Старые вложения не удаляются.
- Исходные focused тесты:54 PASS,0 FAIL. Новый POST regression с синхронизированным storage boundary и последовательным моделированием Product row lock:13 PASS,1 FAIL; две повторные физические загрузки остаются, `deletes=0` при требуемом2.
- Минимальный functional diff: repeated upload компенсирует только свои randomUUID storage keys; org notify выполняется только для первого success. После fix:56 PASS,0 FAIL (те же54 и2 новых). Новые QA guard/bundle tests:5 PASS,0 FAIL. Эти controlled boundary проверки не являются real PostgreSQL/S3/staging evidence.
- Локальный TypeScript `tsc --noEmit --incremental false`:PASS. OpenSpec strict:PASS. Targeted ESLint проверяется без ошибок и предупреждений; точный итог после финализации harness записывается ниже.
- Own pnpm offline/frozen install и Prisma generate завершились в отдельном worktree, без подключения к БД. Отсутствуют migrations, ACL/публичные API изменения, commit/push/merge, restic или дампы.
- Task-specific compiled-runtime harness собран без execution. Результат dry build и его SHA сохраняются приватно в `apps/web/test-results`; actual staging2.2 и cleanup2.3 остаются открыты до root-reviewed запуска на фактически развёрнутом task112 SHA.

Итог финальной локальной версии:61 focused PASS (56 functional/POST/UI +5 QA guards/bundle),0 FAIL; повторный TSC PASS; targeted ESLint0errors0warnings; `git diff --check` PASS; strict OpenSpec PASS. Dry bundle17137B, SHA256 `826a0e6642c979f40ef661e3bfe247d1e7d9949f74d6dea568c090e1688c6ce1`. Root-reviewed execute БД/HTTP/S3 не выполнялся. Независимый functional review координатора сообщил actionable findings NONE.

## Standalone QA dependency repair

Root попытка `prepare` на actual staging `8f48aafc` с runId `845349e1-8dba-4193-b2a2-aca9e570be96` завершилась `ACCEPTANCE_MODULE_DEPENDENCY_MISSING`. Exact-image readonly module probe подтвердил: `@auth/core/jwt` → `ERR_MODULE_NOT_FOUND`, отсутствует `@auth/core`; Prisma/S3 SDK/sharp загружаются из existing `/app/node_modules/.pnpm`.

Это static import прежнего QA-bundle, поэтому Node не начал evaluate entry, `main/prepare` и создания data clients. Дополнительная физическая проверка в `SET TRANSACTION READ ONLY`/RepeatableRead дала0 строк по run marker во всех9 требуемых областях: User/Client/Project/Product/ProductPercentageConfig/Participant/File/ChangeLog/Notification. Cleanup/restore и повтор prepare не выполнялись; старый intent сохраняется для аудита. Отдельный первый count diagnostic содержал SyntaxError в SQL literal до импорта; исправлен `String.raw`, syntax проверен локально перед успешным read-only выполнением. Этот diagnostic не менял БД.

QA-only fix включает locked Auth.js JWT/Jose/HKDF в bundle и оставляет внешними только3 фактически проверенных runtime packages. ESM `createRequire(import.meta.url)` обеспечивает builtin crypto для CJS-зависимостей. Load-only preflight с фиксированным dummy secret/token подтверждает JWT roundtrip, не читает реальные credentials, не создаёт Prisma/S3 clients и не посылает HTTP. Не устанавливать packages на сервер, не менять приложение/образ/политику доступа.

Новая packaging regression: RED4 PASS/1 FAIL (external Auth import), GREEN6/6, включая дочерний standalone ESM CPU-only roundtrip даже с deliberately-invalid mutation input. Bundle65310 B, SHA256 `e1d51c17a0680cf9804eee1630123e212a643a708fb9bc9b714eb35cf40ac6aa`. Stage нового bundle до root review не исполнялся. Следующая подготовка разрешена только root с новым runId/директорией; old845 intent не удалять и не повторять.

Root-reviewed new bundle выполнен на actual staging `8f48aafc` только в load-only режиме: `QA_BUNDLE_PREFLIGHT_PASS`, cryptoRoundTrip=true, dbInstantiated=false, s3Instantiated=false. Exact web/image/DB identity и W07 сохранены. Base bundle65310B SHA `e1d51c17a0680cf9804eee1630123e212a643a708fb9bc9b714eb35cf40ac6aa`; transient probe payload SHA `5e3f437ee4ddb072b00bee3c89a651a531a54b9edf3cf6ff5405fb3e2ea72aa1`. Fresh runId `ae9ce4bb-b574-400b-8fff-30c22f9eec58` подготовлен локально; write prepare/runtime/cleanup исполняет только root отдельно с probe flag ABSENT. Старый845 marker0 и intent сохранены. Targeted QA ESLint0errors0warnings, OpenSpec strict PASS, diff check PASS; никакого app/server/image изменения или install.

## Partial runtime outside drift

Root prepare freshAE succeeded; runtime STOP ORIGINAL_DATABASE_CHANGED after2 acknowledged compiled uploads before first replay. Readonly diagnosis matched schema/all original tables except OrgSetting count2 unchanged, MD5 bc390140…→c77deabc…; telegram.botUsername.updatedAt18:25:25.859Z changed. Existing bot/register upserts value/timestamp on startup and6h cadence. Previous per-row valueHash was not stored; equal value or timestamp-only change is NOT proven. Current designer manager file preserved, engineer file is current pointer;3QAactors,2files,6audits,9notifications,1config/participant,0preferences. Source awaited all upload/storage/postcommit callbacks; actual docker top verified0 active QA stdin Node processes. No mutation retry/cleanup occurred.

Prepared separate AE-only partial recovery wrapper keeps normal guards strict, preserves full current OrgSetting rows by explicit expected fingerprint and signed state CAS, forbids any OrgSetting write, restricts file IDs/keys/versions, checks all other baseline data/schema before/after. New guard tests9/9; dry bundle69967B SHA `424e6a0a870389cd0b80c222228eea926ce3e560f977a0974887212f5232fa18`, ESLint0/0. Root/reviewer execute only after reviewing exact recovery commands. This remains PARTIAL/STOP, without full original match or runtime pass.

AE recovery выполнен только root после независимого ACK: PARTIAL_CAPTURED → PARTIAL_CLEANED. Actual receipt exact8f48 подтверждает Notification9/ChangeLog6/File2/Participant1/Config1/Product1/Project1/Client1/User3, cleanupCommitted=true; allotheroriginals at/afterCommit match, originalStorage MATCH. currentOrgSettingPreservedAtCommit=true, laterOrgSettingChange=false. runtimePass=false/fullOriginalMatch=false остаются честными; частичный lifecycle завершён, full engineering acceptance ещё не достигнута.

Дляfreshrun QA-only BEFORE evidence добавлено в signedprepare: exactkey/count/valueHash/allnon-datefieldsHash/beforeupdatedAt +hash прочихOrgSettingrows в томжеSerializable snapshot. Capture допускает исключительно verifiedmonotonic timestamp при неизменности value/fields/key/count/прочихrows, rawbaseline не переписывает; безbefore/приrealvaluechange/прочемdrift —STOP. Cleanup проверяетsignedCAS и удерживаетexactbotkeylock черезownstorage/data cleanup; postcommit unexpectedoutsidechange явноотражается. Replay сравниваетvalidatedownrows+storage послеoriginalclassification, чтобыслужебныйClock невыгляделown повторной записью.11guardtestsPASS,ESLint0/0;dry72307B SHA `1173b20a5a11c43e5b39004e1d1a1c4fb76d10a2b247695d869b50035b17ca5b`. Новаяfullstageпопытка не запускалась доroot/reviewerACK.

## P2 consistent snapshot refinement

Independent review rejected fresh packaging72307B before execution: bare client normalcapture/postcommit read global fingerprint and per-row OrgSetting evidence in separate database versions. A bot tick could pair rawMATCH with a laterclock; an outside value revert could falsely appear timestamp-only. Newfresh run did not start.

QA-only fix routes normalcapture's entiregraph/fingerprint/evidence through one RepeatableRead READ ONLY callback, with SET TRANSACTION READ ONLY and innerdatabaseidentity. Cleanup/prepare continue their existingSerializable transactions and call the innercapture directly; no nestedtransactions. Normal postcommit classifier and partialpostcommit snapshot now share the same coherent readonly boundary. Narrow key/value/non-datefields/count/otherrows predicate and oldstrict checkpoints remain unchanged; AE completedcleanup is not rerun.

Controlled fake transaction concurrency tests: RED11 PASS/2 FAIL on former splitread, GREEN13/13 on coherent snapshots; one case detects inconsistentMATCH clock, another refuses realvaluechange despite a laterrevert. These are controlled boundary tests, not nativeDB evidence. ESLint0/0, node syntaxPASS; newdry72643B SHA256 `efe9c15cec172fddef2a65a0dc25e714c3cfc6fad08238806b8eea070564c97b`. No actualDB/HTTP/S3 execution for this refinement; root/newreviewACK required beforefresh lifecycle.

## Fresh8c participant visibility failure and narrow fix

Fresh8c prepare succeeded; runtime STOP COMPILED_UPLOAD_ACK_REQUIRED after exactreplay/stale/fake/unassigned checks, when an ENGINEERING participant replaced a manager/engineer sketch while primaryengineer=NULL. OriginalHTTP response requestId/body was not journaled; mappedHTTP404 is explicitly sourceinference. Exactreadonly DB authorization reproduced membership=true/DESIGN but kind=not-found «Исходный эскиз не найден» beforebytes/storage. Technicaledit acceptedparticipant, assignedProductVisibilityWhere omitted DESIGNparticipantread and therefore fileVisibilityWhere hid baseline. Rawschema/alloriginalhashes MATCH.

Root strictnormal capture/cleanup completed8c: CLEANED/fullOriginalMatch=true, originalDatabase/Storage MATCH; removed3QAactors,2files,6audits,9notifications,1config/participant/product/project/client. No runtime retry, residualQA or functionalPASS claim. Fresh correctedapp needs a newreviewedSHA/run.

Meaningful permission regression RED4 PASS/1 FAIL exactactualcore not-found; minimal3-line appfix unions existing DESIGN engineeringProductWhere only for ENGINEER with verifiedparticipantIDs into assignedread. PrimaryDESIGN/PRODUCTION return policy, roles/finance/status/deleted grants unchanged. Negatives cover foreign/deleted/non-engineer/allpostDESIGN statuses. Updated two oldreadexclusion assertions; approved prior `product-engineering-pay` design48/spec51/tasks3.5 require participantDESIGN read/tech/files. `engineer-production-return` constrains participant STATUS transitions, not DESIGNtechnicalfileaccess.

Existingengineerfilter remains responsible OR participant strictly AND rolevisibility; queries.ts notchanged. Fullunit initially failed one oldproduct5 exclusion fixture (membere1/primarye3/DESIGN). Expectedupdated plus meaningful e1/e2/e3-only/status/deletion/accountant matrix; root withdrew mistakenprimary-only premise after currentpredicate/spec evidence. A reporterpath ENOENT failed beforetests and was fixed with absoluteignoredreportpath; it is notfunctionaltest evidence. Fullrepeat outcome recorded separately below. Relevant77 PASS, TSC PASS, targetedESLint0/0, strictOpenSpec PASS. SourceSHA visibility06fe1f692e34fb6d1122827ac114e60e95a55cf2f3198c84ad39def92585194c; no selfcommit/deploy/stageuploads.

## Final local and private browser bridge readiness

Локальная итоговая app/permission проверка: весь web unit suite1388/1388 PASS; relevant access/cover regressions77 PASS; TypeScript noEmit PASS; targeted ESLint0errors0warnings; OpenSpec strict и diff check PASS. Эти результаты относятся к локальному кандидату и не заменяют deployment/runtime/browser acceptance. Branch112 appfix закоммитил и интегрировал root; main/production не выпускались этим субагентом.

Private read-only browser IPC bridge проходит15 targeted QA/guard/pure tests и ESLint0/0. Независимое review3 exactQA source SHA — findings NONE. Bundle74790B SHA `185e2b73c523d65c1c92487c608473d9046ce3af6c0335d4137f362bb272d574`; никакого actualhandshake/114browser вызова субагент не делал. Bridge использует existing qaTransport, verifiedphysicalrevision +signedcheckpointHMAC, текущее id/roles/active/sessionVersion собственного QAmanager, serverderivedownnumber/paths/currentownedsketch и nullablecurrentownprojectcover. Cookies возвращаются только через private IPC в process object; не передаются в argv и не пишутся в receipt/profile files, log/trace/HAR или пользовательский stdout. Token/secret значения не выводятся.

Порядок: root проверяет точную фактически развёрнутую итоговую SHA; свежие own prepare и полноценный112 runtime должны завершиться с acknowledged currentownsketch и signed observation; затем root отдельно вызывает privatehandoff и reviewed GET/HEAD-only114 browser helper; после него — exactcleanup112 по сохранённому runtime observation и свежему strict CAS. Отдельный capture нужен только после failed runtime, когда подписанное observation не было сохранено и подтверждено завершение upstream requests. Handoff сразу послеPREPARED намеренно отказывает при пустомэскизе. Browser блокирует все nonread/preferences requests, screenshots ограничены собственными synthetic image regions; projectboard измеряет только numeric geometry, безpixel proof/чужихданных. Не создавать дополнительные114 fixtures и не назначать projectcover без отдельногоreviewedscope.

На этапе готовности bridge новый фактический stage PASS ещё не был получен. Первый deployment probe для промежуточного7aba дал WEB_REV_MISMATCH; это не доказывало применение новой ревизии. Старые AE partial и8c strict lifecycle root очистил, их actors/UUID/intents не переиспользуются. Итоговая приёмка следующего кандидата приведена ниже; локальные тесты/публикация/подготовленный helper сами по себе не подтверждают CI green или runtime/browser PASS.

## Фактическая staging-приёмка 09.10.2026

Координатор принял задачу112 на фактически развёрнутой полной ревизии `322bd3d542e9d503e955127dc4c1f32644646bc4`, runId `fa98ed24-49a0-419e-b03d-09422a7625df`. Это новый UUID; предыдущие845/AE/8c не повторялись. Root-reviewed bundle74790B SHA256 `185e2b73c523d65c1c92487c608473d9046ce3af6c0335d4137f362bb272d574` исполнялся через существующий guarded transport. Доказательства находятся приватно в `.playwright-mcp/task112-stage-322/qa-fa98ed24-49a0-419e-b03d-09422a7625df`; ниже только обезличенные поля.

Runtime и cleanup receipts подтверждают одну физическую identity:

| Поле | Проверенное значение |
|---|---|
| Hostname / OCI revision | `crm-staging` / `322bd3d542e9d503e955127dc4c1f32644646bc4` |
| Web container | `b5c5106176d3e97843e2dbd5ba7addd1944b7bcc7354b2844998b76f3db700d8` |
| Image ID | `sha256:2dc4043eb6c5ce0840ff841a1617160659a21e0278a69e49ba0b022caa60debd` |
| DB container / StartedAt | `27b8f7342b9d722ab8788e137b37b03a3037442da038c5b8b98dbb30245b8b6a` / `2026-09-23T11:42:14.649193151Z` |
| DB volume | `crm-staging_pgdata` |
| W07 SHA256 | `27e3bcd727d9e83170c76a254806fde42590da76cea30c9e1441d873df680139` |

Guarded исполнение проверило running/healthy web и DB, общую backend network, `db:5432/crm`, endpoint `http://192.168.0.33:9000` и bucket `pero-crm-staging`; workflow lock и nightly refresh/W07 сохранились. Ни dump, ни restic, ни инфраструктурные изменения не выполнялись. Direct GitHub CI green здесь не заявляется: публикация/исходники не заменяют приведённую фактическую проверку deployed application.

`receipt-runtime.json`: status `PASS`, exitCode0, все10 actual compiled/PostgreSQL/S3 сценариев завершены:

1. MANAGER загрузил исходный original и thumbnail.
2. Серверная страница доступного ENGINEER показала замену независимо от права удаления старого файла.
3. Назначенный ENGINEER заменил manager sketch; exact replay сохранил один результат.
4. Stale expected sketch и foreign/fake context получили отказ; недоступный инженер также не допущен.
5. ENGINEERING-участник заменил эскиз на DESIGN независимо от primary engineer.
6. ENGINEER заменил legacy sketch с `uploadedById=NULL`.
7. Право DESIGN повторно проверено на текущем состоянии изделия.
8. Две разные одновременные замены дали ровно одного победителя, второй получил конфликт.
9. Одновременная доставка одной mutation дала один file/receipt без повторных notification/storage effects.
10. Реальный S3 подтвердил сохранение bytes всех прежних own originals и отсутствие активных storage orphans.

После runtime root выполнил read-only privatehandoff и reviewed browser114. Первую попытку с проблемой инициализации service worker не приняли; повтор только браузерного чтения прошёл9 geometry checks,0 page errors и0 upstream writes. Upload/runtime не повторялись, UserPreference не менялась. Projectboard проверен по numeric geometry, снимки ограничены собственными synthetic image regions; это не pixel proof всех существующих клиентских карточек.

Дополнительный normal capture вернул удалённо `CAPTURED`, exitCode0, но локальный runner завершился `TASK112_STOP_PRESERVE_STATE`: после сохранения `receipt-capture.json` запись с `flag:wx` встретила уже существующий `observation.json` успешного runtime (`EEXIST`). Read-only локальная диагностика установила полное каноническое равенство fresh capture и runtime observation, одинаковую подпись/checkpoint hash и original DB/S3 MATCH. Observation не перезаписывали, intents/receipts не удаляли и capture/upload не повторяли. Cleanup использовал исходное подписанное runtime observation и свежий HMAC/current-state CAS. Без AUTH_SECRET локальная диагностика сравнила подписи, а их криптографическую проверку выполнил server cleanup.

`receipt-cleanup.json`: `CLEANED`, exitCode0, `cleanupCommitted=true`; originalDatabase и originalDatabaseAtCommit — `MATCH`, `fullOriginalMatch=true`, originalStorage — `MATCH`. Точно удалены только own Notification29, ChangeLog18, File6, Participant1, Config1, Product1, Project1, Client1, User3 и captured own storage versions по точным keys/VersionId. Сохранённый observation содержал20 own storage versions; файл31436B, SHA256 `8fe6347bd75e1c18101cb59c131e1125b0a54d5e747db123487dd9d43088985b` остался неизменным. Жизненный цикл fa98 закрыт; новых app/test/DB правок для документирования приёмки не делали. Main/production не выпускались.

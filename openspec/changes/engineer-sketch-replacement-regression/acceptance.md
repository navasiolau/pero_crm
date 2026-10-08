# Staging acceptance112

Исполняет только root после чтения `engineer-sketch-qa-entry.mjs` и `engineer-sketch-stage-runner.mjs`. Обязательные правила: `D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md`; guard mismatch означает STOP. Коммит и интеграция принадлежат root; проверка прежнего deployed baseline не подтверждает новый fix. Итоговая фактическая ревизия и закрытый lifecycle записаны в конце документа и в `evidence.md`.

## Guards and scope

Transport `crm-modernization-staging.py` проверяет hostname `crm-staging`, full OCI revision, работающий/healthy web+DB, exact DB ID/StartedAt/volume/network/URL, staging S3 bucket и неизменный W07 watcher; держит existing workflow lock без изменения refresh. Старые backup gates не используются. Сам task entry повторно проверяет container identity, переданный proof, DB name/schema/options, exact S3 endpoint/bucket и credentials до соединения.

Разрешённые записи:3 QA-актора (MANAGER, назначенный ENGINEER, ENGINEER-участник),1 QA-клиент/CONTRACT-проект/DESIGN-изделие,1 engineering config+participant без начислений; реальные files/uploads от manager/engineers; только собственные audit/Notification effects. Direct fixture updates меняют engineerId/status/uploadedById исключительно собственных QA-строк. Production, существующие данные, user preferences, реальные назначения, задачи, платежи, payroll, outboxes и внешние провайдеры не меняются. Runtime route `notifyOrg` пишет только Notification; неожиданный provider/outbox effect даёт fingerprint mismatch и STOP.

Все public-таблицы, schema columns/constraints/indexes и migrations защищены hashes. Единственное volatile поле — `ApiToken.lastUsedAt`. Metadata всех versions/delete markers S3 сверяется до/после; никакие старые blobs не скачиваются. Download bytes только собственных новых originals сравнивается с исходным PNG.

## Commands

Из корня worktree. Сначала dry build; он ничего не подключает:

```powershell
node apps/web/tests/engineer-sketch-stage-runner.mjs build apps/web/test-results/engineer-sketch-112-qa.mjs
```

Root подставляет `<accepted-full-112-sha>`, один `<uuid-v4>` и абсолютный приватный `<output-dir>`; последовательно, без автоматических retries:

```powershell
node apps/web/tests/engineer-sketch-stage-runner.mjs prepare <accepted-full-112-sha> <uuid-v4> <output-dir> --authorized
node apps/web/tests/engineer-sketch-stage-runner.mjs runtime <accepted-full-112-sha> <same-uuid-v4> <same-output-dir> --authorized
node apps/web/tests/engineer-sketch-stage-runner.mjs cleanup <accepted-full-112-sha> <same-uuid-v4> <same-output-dir> --authorized
```

SCP переносит root-reviewed wrapper в файл по SHA, затем `ssh … python3 /root/…py` принимает structured JSON на stdin. Нет сложных inline SSH или host/service mutations.

Prepare возвращает signed ownership checkpoint, сохраняемый приватно. Runtime проверяет actual signed sessions, реальную серверную кнопку замены, manager→assigned engineer, exact duplicate replay, stale/fake context refusal, unassigned refusal, participant, legacy null-author, current DESIGN guard, два разных конкурирующих запроса и concurrent same-mutation delivery. S3 active keys обязаны равняться keys accepted files; originals сохраняются byte-for-byte. Успешный runtime сам сохраняет HMAC-signed `observation.json`; после отдельной read-only браузерной проверки root использует именно его для cleanup со свежим current-state CAS. Runtime показывает compiled HTTP/server page; этот результат не выдаётся за самостоятельную браузерную проверку инженерной кнопки на desktop/mobile.

Cleanup требует неизменного HMAC-signed observation и current CAS, удаляет только captured свои versions/delete markers по точным keys+VersionId, затем собственные File/audit/Notification/participant/config/product/project/client/user IDs транзакционно. По окончании исходные DB/schema/S3 hashes совпадают.

## Failure and recovery

Каждый mutation intent создаётся эксклюзивно; потеря ответа не разрешает повторять prepare/runtime/cleanup. При STOP сохранить output directory; root диагностирует известные fixture IDs и receipts. `capture` — отдельное root-reviewed чтение состояния по signed checkpoint, затем точная cleanup по observation; это не повтор upload и не broad cleanup:

```powershell
node apps/web/tests/engineer-sketch-stage-runner.mjs capture <same-full-sha> <same-uuid-v4> <same-output-dir> --authorized
```

Capture разрешён только после failed runtime, если подписанное observation не было сохранено, и после подтверждения, что upstream requests завершены. При успешном runtime дополнительный capture не нужен: сохранённое observation неизменно, browser выполняет только чтение, cleanup заново проверяет HMAC и strict CAS. Непредвиденный own key, чужая связь, changed original hash или неизвестный исход запрещают cleanup. Нельзя ослаблять guard ради завершения, перезаписывать доказательства или повторять operation после эксклюзивного intent.

113 позже удаляет category API/схему; если root меняет порядок интеграции, он обязан обновить поле multipart harness под принятый113 контракт и повторить проверки. Functional repeated-compensation/notify guards112 сохраняются при обычном merge.

## Module preflight before a new run

Standalone runtime не обязан экспортировать все packages, доступные Next-сборке. JWT/Auth.js теперь включён только в QA-bundle; Prisma/S3/sharp остаются existing deployed modules. Родительский transport/target guard не изменён. Перед fresh prepare root проверяет новый65KB bundle через operation `readonly`, установив `CRM_TASK112_DEPENDENCY_PROBE=1` только в временном Node-процессе. Вывод обязан быть `QA_BUNDLE_PREFLIGHT_PASS`, `cryptoRoundTrip:true`, `dbInstantiated:false`, `s3Instantiated:false`. Это проверка загрузки/dummy crypto, а не инженерная/S3 приёмка.

Failed run845 `intent-prepare.json` сохранить. Его0-fixture marker state физически подтверждён readonly. Новый UUID разрешает новый prepare только после root review этого QA-only packaging fix и exact-image preflight; не использовать old intent, не ослаблять runtime/target guards и не выполнять blanket cleanup.

## PARTIAL run AE recovery

Actual runtime `ae9ce4bb-b574-400b-8fff-30c22f9eec58` остановился на первом original fingerprint capture после двух успешных upload ACK. На стадии остались3 QA-актора,1 клиент/проект/изделие/config/participant,2 files,6 audits/receipts и9 точных Notification. Schema и все original tables кроме OrgSetting совпали. OrgSetting сохранил count2, но общий hash изменился; setter `POST /api/v1/bot/register` меняет value и служебный updatedAt, bot вызывает его при старте и каждые6ч. Старый checkpoint не содержит per-row valueHash, поэтому неизменность старого value не доказана. Это PARTIAL/STOP, не runtime PASS.

Recovery имеет отдельные режимы, только для AE и двух конкретных file IDs; обычные capture/cleanup сохраняют строгую исходную проверку. Root явно принимает сохранение нынешних ОБЕИХ OrgSetting rows по конкретному count/hash, не исправляет или переписывает исходный checkpoint. `partial-capture` работает в RepeatableRead READ ONLY, снова проверяет все остальные исходные таблицы/schema, precise own file graph и full original S3 metadata, затем подписывает текущие QA rows/versions и полные OrgSetting rows. Неизвестный key/version, другие original changes или changed OrgSetting fingerprint останавливают процесс.

`partial-cleanup` требует HMAC/current graph+version CAS, берёт FOR UPDATE только двух известных OrgSetting ключей и НЕ выполняет в них create/update/upsert/delete. Под блокировкой сверяет current captured rows, удаляет только signed own S3 versions/delete markers и собственные9 модельных областей транзакционно; сравнивает все остальные original rows/schema с old baseline, OrgSetting с нынешним signed capture. Следующее внешнее изменение после COMMIT отражается отдельно, не затирается. Итог всегда `runtimePass:false`, `fullOriginalMatch:false`, PARTIAL_CLEANED; это завершённая утилизация QA, а не функциональная приёмка.

Root перед исполнением читает актуальный `partial-policy.json`, со сверенными2 file IDs и нынешним OrgSetting count/hash. Подготовленные команды из112 worktree после независимого review:

```powershell
node apps/web/tests/engineer-sketch-stage-runner.mjs partial-capture 8f48aafc39e7db98be03421df20bc2b5466ae978 ae9ce4bb-b574-400b-8fff-30c22f9eec58 "C:\Users\admin\.codex\worktrees\crm-task-112\pero_crm_v2\.playwright-mcp\task112-stage-8f48\qa-ae9ce4bb-b574-400b-8fff-30c22f9eec58" --authorized
node apps/web/tests/engineer-sketch-stage-runner.mjs partial-cleanup 8f48aafc39e7db98be03421df20bc2b5466ae978 ae9ce4bb-b574-400b-8fff-30c22f9eec58 "C:\Users\admin\.codex\worktrees\crm-task-112\pero_crm_v2\.playwright-mcp\task112-stage-8f48\qa-ae9ce4bb-b574-400b-8fff-30c22f9eec58" --authorized
```

Intent prepare/runtime сохраняются; повтор uploads или обычный capture/cleanup для AE не выполняются. Субагент recovery не исполнял. Для fresh run требуется отдельное BEFORE evidence значения/служебной даты telegram.botUsername и остальных OrgSetting rows; без него нельзя объявлять timestamp-only drift.

## Fresh signed operational evidence

В новой подготовке ДО HTTP-запросов, в томже Serializable snapshot, HMAC-checkpoint сохраняет только для `telegram.botUsername` exact key/valueHash/hash всех недатовых полей/updatedAt, total count и hash всех прочих полных OrgSetting rows. Старые checkpoints не получают эти данные задним числом и сохраняют строгий original fingerprint guard.

Если raw OrgSetting hash затем отличается, допускается только при прежнем valueHash/всех прочих полях/key/count, неизменном hash остальных OrgSetting rows и монотонном обновлении даты; schema и все прочие original table hashes остаются точными. В evidence это `MATCH_EXCEPT_VERIFIED_BOT_REGISTRATION_TIMESTAMP`, а не raw full match. Новое значение username, новая/удалённая строка, другой ключ, любые чужие поля/настройки или отсутствие BEFORE-proof вызывают STOP.

Normal cleanup включает signed whole-state CAS и блокировку ровно известного bot key на время собственных S3/data deletes, проверяет исходные прочие данные и verifiedclock policy до/после. Следующее изменение после COMMIT отражается отдельно. AE partial-records уже очищены; новыеfresh prepare/runtime/cleanup требуют новогоUUID, отсутствующего dependency-probe flag и root/reviewer review пакета72307B. Субагент их не запускает.

Consistent snapshot refinement: normalcapture reads own graph, original whole-table fingerprints and current OrgSetting evidence in SAME RepeatableRead READ ONLY transaction. Postcommit verification uses the same readonly boundary. Insideprepare/cleanup the existingSerializable transaction is reused; nested transactions are not opened. This prevents pairing different database versions into MATCH or timestamp-only claims. Fresh bundle72643B SHA `efe9c15cec172fddef2a65a0dc25e714c3cfc6fad08238806b8eea070564c97b` supersedes unreleased72307B; nativefresh execution waits for root/reviewerACK.

Fresh8c failed at participantreplacement and was safely cleaned through strictnormal mode with fulloriginal/storageMATCH. Do not rerun that runtime/UUID. Actualreadonlycore reproduced DESIGNparticipant fileinvisibility; next deployment must include the narrow assignedread repair before fresh fullacceptance. Initial runtimeACK helper did not retain failing requestId/body; do not invent them or equate mapped404 with capturedHTTP. Exactown manager→assigned, replay and refusals were reached; legacy/concurrency were not reached, and full PASS remains pending.

## Final private IPC/browser order

Передfresh lifecycle root принимает фактически развёрнутую ПОЛНУЮ итоговую SHA/образ/health/guards. Local appfull1388, relevant77, TSC, ESLint0/0 и bridge15 targeted/purechecks PASS; independentbridge reviewNONE являются готовностью исходников, не stageacceptance.

После own112 runtime с acknowledged synthetic currentSketchFileId и сохранённым signed observation, ДО cleanup root вызывает экспорт `requestSketchBrowserHandoff({revision,checkpoint,outputDir,authorized:true})` из112 stage runner в своём приватном Node-процессе. Helper через SAME qaTransport/read-only transaction проверяет HMACcp/fullSHA/currentownmanagerroles+active+version, derivesownproject/productpaths и номера, currentownedsketch +nullableownprojectcover. Caller не выбирает другойuserID/URL. Returned profile.cookies остаются только в memory/privateIPC; не печатать object, не писать argv/files/log/trace/HAR/receipts. Browser origin фиксирован `https://staging-crm.peromebel.by`; frontend114 helper получает этот trustedhandoff и existingprivateBasicAuth только в памяти.

Reviewed114 helper допускает только GET/HEAD, блокирует все mutation/preferences requests и делает screenshots лишь ownsyntheticcard/detailimage regions. Existing projectboard — numeric geometry only без IDs/names/text/src/HTML/body/screenshots, не pixel acceptance. Не создавать114 fixtures, не назначатьобложку и не менять UserPreference. После завершения readonlybrowser root запускает exactowncleanup112 по исходному signed runtime observation со свежим strict CAS и сохранением originalDB/S3 facts; неизвестный ответ/guarddifference → STOP, не retryuploads.

Handoff до появления эскиза (сразу PREPARED) намеренноSTOP. Старые failedUUID AE/8c закрыты cleanup и не переиспользуются. Промежуточный7aba metadata probe вернул WEB_REV_MISMATCH, и до подтверждения exactfinalrevision новая приёмка не начиналась. Субагент не выполняет stagehandoff/runtime/cleanup или Git/main/production operations.

## Принятый staging и завершённая очистка

09.10.2026 root принял112 на full deployed revision `322bd3d542e9d503e955127dc4c1f32644646bc4`, physical image `sha256:2dc4043eb6c5ce0840ff841a1617160659a21e0278a69e49ba0b022caa60debd`, hostname `crm-staging`. Runtime и cleanup receipts связывают один web container с прежними DB ID/StartedAt/volume и W07 SHA; transport подтвердил healthy web/DB, backend network и staging S3 endpoint/bucket. Полные обезличенные physical values приведены в `evidence.md`; этот результат не основан только на Git push/build.

Fresh fa98 run `fa98ed24-49a0-419e-b03d-09422a7625df`: actual runtime10/10 PASS, затем root read-only browser9/9 PASS,0 page errors/0 upstream writes после исправления инициализации service worker в браузерном helper. Замена назначенным инженером/ENGINEERING-участником и legacy null-author, отказ недоступному/foreign/stale, current DESIGN scope, concurrent winner и idempotent replay выполнены; прежние own file bytes сохранены, orphan effects отсутствуют. UserPreference и оригинальные данные браузер не менял; project geometry не объявляется pixel proof чужих карточек.

Ненужный дополнительный capture удалённо завершился `CAPTURED`/exitCode0, затем local `flag:wx` вернул EEXIST при существующем successful-runtime observation. Receipt сохранился, новая подписанная observation полностью совпала со старой; ничего не перезаписывали/не удаляли и не повторяли. После root review обычный cleanup по исходному observation и свежему HMAC/CAS завершился `CLEANED`/exitCode0/cleanupCommitted=true: originalDatabase=MATCH, originalDatabaseAtCommit=MATCH, fullOriginalMatch=true, originalStorage=MATCH. Удалены только own6files/18audits/29notifications,1 participant/config/product/project/client и3 QA users плюс captured own S3 versions. Lifecycle закрыт; intents/receipts остаются приватными для аудита. Capture wx-защиту и app/test code ради этой успешной очистки не меняли; main/production не выпускались.

# Проверки №189

Дата: 18.10.2026. Worktree `D:/Projects/pero_crm_worktrees/kp-189`, ветка `feature/189`, исходная база `d918ab860ec5aab029c466a3b3c3b1ce06f0ec98`. Текущий результат: root принял native SQL с полным rollback и отдельный source-only cloud prepare; target import/staging/cutover ещё не приняты. Точные receipts и пределы приведены в разделе Root acceptance. Начальные разделы сохраняют историю предыдущих этапов. Локальный коммит №189 отдельно разрешён владельцем; push и live R2/DB/S3 операции этим исполнителем не выполняются.

## Выполнено локально

| Проверка | Результат |
| --- | --- |
| `pnpm --filter @pero/web exec tsx --test tests/kp-archive-import.test.ts tests/kp-archive-recovery.test.ts` | PASS, 35/35: 21 прежний сценарий и 14 recovery; synthetic fixture 23 КП / 189 позиций / 6 settings / 7 DOCX |
| `pnpm --filter @pero/web exec tsc --noEmit --incremental false --pretty false` | PASS; base Prisma client сгенерирован в собственном `node_modules`, без обращения к БД |
| ESLint для archive modules, CLI, обоих helpers и unit test | PASS, без предупреждений |
| CLI `--help` | PASS, без DB/cloud I/O |
| CLI `--apply --reviewed=invalid` | Ожидаемый отказ `ARCHIVE_APPLY_ARGUMENTS_REQUIRED` до загрузки dependencies и I/O |
| `pnpm exec openspec validate kp-archive-import --strict` | PASS |
| Проверка whitespace/diff | PASS для собственных новых файлов; чужие файлы не изменены |

21 предметный сценарий проверяет допустимую разницу точности LIST/GET, сохранение исходных миллисекунд и запрет drift внутри одной секунды; fallback пустых optional endpoint/credential pair, приоритет nonempty override и запрет partial credential pair; разные local/staging DB users и отказы при cross-target identity; два разных source URL с одинаковыми JPEG-байтами; inventory всех неподтверждённых DOCX; default dry-run без I/O; исходные даты/номера/unknown fields и отсутствующий original; полную публикацию, 1-based позиции, независимую историю договоров и повтор с нулём дублей; partial I/O/неопределённый ACK; ошибку финальной публикации; source drift/missing image/foreign host; изменение байтов того же размера и с прежним LastModified после успешного copy; чужие target bytes и смену storage guard; настоящий отдельный original; manifest tampering и запрет source bucket как target; сохранность policy purge без восстановления картинок; некорректный текущий черновик договора.

Source code изучался только локально в `D:/Projects/pero_kp`, включая несохранённые в Git доработки договоров. Установлено отсутствие надёжной export UUID связи с settings и отдельного original в обычном upload. Импорт не придумывает эти факты; unlinked DOCX остаются в отчёте до reviewed map. Исторические 23/189/6/7 не объявляются новой live-инвентаризацией.

## Уточнения после review

- SQL identity guard привязан к разным пользователям существующих целей: local `pero/pero_crm`, staging `crm/crm`; остальные pinned checks сохранены.
- Keys изображений включают стабильный media ID и SHA. Одинаковые байты разных legacy URL не нарушают unique key и не теряют provenance.
- Перед reserve и непосредственно перед publish все уникальные исходные JSON/binary objects перечитываются по SHA/размеру и metadata. Финальные чтения выполняются вне SQL с повторной проверкой actor/target/lease около I/O. LastModified не заменяет bytes SHA.
- Genuine import UPLOAD_MEDIA/PENDING media используют `original:null` при реальном отсутствии original. Нужна согласованная узкая поправка SQL №183; миграции из других веток не копировались.
- CurrentMedia/VersionMedia создаются при финальной публикации. Все upload jobs остаются PROCESSING до одной финальной транзакции. Receipts и exact orphan intents согласованы с №188.
- По сообщению root, первый read-only discovery остановился до сетевого вызова с `ARCHIVE_BINDING_INVALID`: optional `CONTRACTS_R2_ENDPOINT` был пустой строкой. Ошибка воспроизведена на synthetic env (RED), затем исправлена только обработка пустых optional endpoint/credential pair через legacy `||` fallback (GREEN). Явные nonempty overrides сохранены; неполная пара ключей и невалидная binding по-прежнему отклоняются. Private env не изменялся и этим исполнителем не читался; три новые проверки не выполняют сеть.

## Исходный этап: подготовлено, но ещё не выполнено

`apps/web/tests/helpers/kp-archive-native.ts` экспортирует root-only native helper. Он требует существующий local container guard и внешний BEGIN, проверяет настоящий SQL store, actual 23/189/6/7 и повтор с нулём дублей, затем откатывает собственный SAVEPOINT и сравнивает полный DB baseline. Source/target I/O в этом helper остаются synthetic memory: даже успешный запуск не докажет live S3 импорт.

На исходном этапе **NOT RUN:** native helper, actual migration/runtime composition после обычных merges №180/183/185/186/187/188, облачный inventory/prepare, reviewed DOCX mapping по настоящим документам, реальные S3 upload/readback, apply/replay архива, browser/API/MCP, реальный staging с SHA/образом, production. Последующий root acceptance ниже уточняет выполненные native/source-only части. Task 3.2 остаётся открытым.

CLI подключает настоящие shared image/artifact writers после normal merge и останавливается с `ARCHIVE_DEPENDENCIES_NOT_INTEGRATED`, если зависимости отсутствуют. DI tests не подменяют этот runtime. Ветка не активирует UI/API/worker/skill и не содержит автоматической привязки архива к существующим проектам.

Порядок приёмки и переключения: `docs/KP_ARCHIVE_CUTOVER.md`. Исходный R2 сохраняется на весь срок приёмки; DELETE отсутствует. Production не является допустимой целью CLI.

## Сопоставление точности LIST и GET

После обычного FF merge №183 до HEAD `0b788bf9bc9f2ff43768b0a6e788a60c1c446d66` root выполнил отдельный source-only probe. По его диагностике `.playwright-mcp/kp-189/prepare-source-2ee7f7c4-467e-4e0c-b83c-6df738db7bd4/source-metadata-diagnostic.json` состав 23/6/7 не изменился, пять проверенных source bytes имеют прежние frozen SHA; R2 LIST содержит полные миллисекунды, HTTP Last-Modified из GET — ту же целую секунду `.000`. Прямое сравнение строк останавливало `--prepare` с `ARCHIVE_SOURCE_INVENTORY_CHANGED`.

Изменено только сопоставление LIST↔GET внутри `prepareArchiveManifest.load`: допустимо точное равенство либо GET в UTC без доли/с `.000Z` и LIST в его полуинтервале `[секунда,секунда+1000мс)`. Отличающиеся GET с ненулевыми миллисекундами и другая секунда по-прежнему отклоняются. Manifest.inventory не округляется, исходный full-ms LIST сохраняется буквально; завершающее canonical-сравнение повторного LIST не менялось. `apply.ts` и строгие размер/SHA/mime/GET-metadata проверки перед reserve и перед publish не изменялись.

RED воспроизведён до правки на двух новых precision-регрессиях. GREEN: **21/21** archive tests, full web TypeScript и ESLint двух изменённых source/test файлов PASS. Положительный сценарий сохраняет все 36 LIST-меток `.542Z` при GET `.000Z` и проходит synthetic prepare/apply; смена LIST `.542Z→.543Z` в конце prepare отклоняется именно при повторном inventory. Отдельно проверены несовпадающий точный GET `.543Z` и другая GET-секунда. Существующий after-copy тест усилен без дублирования: один byte меняется при прежнем размере, mime и LastModified; финальная полная SHA-проверка останавливает публикацию.

Frozen inventory и все 36 исходных локальных файлов, reviewed bindings и private env не изменялись. Подготовительный wrapper dry повторно проверил их прежние хэши, без env/child/cloud вызовов; новый reviewed plan SHA-256 `72de0eabbb80149054dd7dedf12e46fe2291703cd4b091c6e1ed05b1c11cefa1`. Успешный actual source prepare после этого исправления ещё не выполнялся данным исполнителем; root проверит и запустит отдельно. Предварительный target profile остаётся `PROVISIONAL_NOT_APPLICABLE`; окончательный staging SHA и новый manifest требуют будущей приёмки. Git/DB/Docker/S3/SSH/сеть в этой правке не запускались.

## Явно согласованное восстановление 30 отсутствующих изображений

После предыдущего evidence root сообщил фактическую source-only инвентаризацию: 225 доступных объектов и 30 object404 в `.playwright-mcp/kp-189/source-images-full-10a6bbaf-6af5-45b8-84f9-4a74468be7fc.json`. Владелец согласовал восстановление из локальных файлов/PDF с проверкой соответствия и сохранением происхождения. Этот исполнитель облачный отчёт не воспроизводил и live R2 не читал.

Root отдельно проверил и reviewed все 30 соответствий: 28 PDF_DCT и 2 LOCAL_FILE. Точный исходный upload SHA для отсутствующих R2 objects остаётся неизвестным; согласованные копии не объявляются оригинальными R2-байтами. Root-review SHA `6e312d53c9f30665b52b4a232aca82414ec7b91ec818baef048f165f619efa0a` получен из сообщения root. Candidate map, rich evidence, assets и исходные PDF этим исполнителем не изменялись.

Strict production parser локально прочитал только reviewed JSON `.playwright-mcp/kp-189/recovery-30-images-20261018-4029/recovery-map.reviewed.json`: PASS, 30 entries, 28 PDF_DCT / 2 LOCAL_FILE. SHA исходного файла сохранён `00759e5ca46fe5970950e7687a3f043d13a681a968bf8b41a044a12159733764`; канонический digest нормализованного map для manifest/provenance — `3fea772fa23904da9b778b8cb202b1d23340ffcf31f7cb6c8466bc1876f0468e`. Реальные recovery assets данным запуском не читались; их физические SHA/визуальные проверки выполнены root отдельно.

Реализованы paired CLI `--recovery-map`/`--recovery-root`, typed reviewed map, точные ссылки на все исходные document/item/slot, cloud-first GET и narrow object404 normalization. `NoSuchBucket`, `AccessDenied`, прочие404/ошибки и любой reappeared key останавливают перенос. Локальные чтения ограничены проверенным root без symlink/junction, размером, SHA и MIME. До reserve и до publish повторяются настоящий LIST/raw JSON/все SHA и локальные чтения; network остаётся вне SQL. Manifest, document receipt и immutable IMPORT snapshot сохраняют portable provenance/source binding, raw missing URL и unknown original R2 bytes. IMPORT явно `sourceStateOnly:true`, `issuedPdfAvailable:false`, `pdfArtifactId=null`; он не выдаёт state-only перенос за успешный выпуск PDF.

14 новых synthetic проверок покрывают классификацию NoSuchKey/NotFound+404 и отсутствие fallback при остальных ошибках; missing recovery с provenance и JSON roundtrip; найденные cloud objects; reappearance и same-size local mutation после readback; bounds/SHA/MIME; unreviewed/tampered map/path/profile/ссылки; перенос root без изменения manifest; настоящий Windows junction; partial I/O/resume; сохранение LIST/raw/cloud-image guards. Fake SQL store использует тот же pure provenance builder, что production SQL adapter, однако это не native DB evidence. Полный 23/189/6/7 fixture/replay сохраняется, source writes и business mutations отсутствуют.

Итог локальных проверок: **35/35 PASS**, skipped0; полный web `tsc --noEmit --incremental false --pretty false` PASS; ESLint archive source/CLI/tests/helpers PASS без предупреждений; OpenSpec strict PASS; `--help` PASS. Непарный recovery flag возвращает `ARCHIVE_RECOVERY_ARGUMENTS_REQUIRED`; recovery flags в offline dry возвращают `ARCHIVE_ARGUMENTS_INVALID`; невалидный apply digest — `ARCHIVE_APPLY_ARGUMENTS_REQUIRED`. Эти CLI отказы произошли до file/env/DB/cloud I/O.

В recovery-подзадаче **NOT RUN:** реальные GET/LIST/DB/S3, actual prepare/apply/replay восстановленного архива, native recovery provenance, staging/browser/API/MCP и production. Нет нового разрешения запускать их из unit/CLI проверок. Настоящий artifact writer №187 остаётся обязательным после обычного dependency merge; guard отсутствующей зависимости не обходился. Task3.2 остаётся открытым. Git/Docker/SSH/env/source originals в этой подзадаче не использовались и не изменялись.

## Root acceptance после обычного merge №187

Root выполнил обычный FF merge №187 до `c465290d2262a8d831fd3a6945d1670f6592e648`, frozen install, инертные Prisma validate/generate и полный web TypeScript. Production source, helpers, reviewed maps/assets при этом сохранены. По сообщению root, independent review recovery, cloud wrapper и native runner — без замечаний.

### Настоящая проверка исходного R2 — без target apply

Root выполнил source-only `--prepare` с reviewed recovery map: 23 КП / 189 позиций / 6 settings / 7 DOCX, все 30 согласованных recovery изображений, unlinkedDocx0, `actualSourceValidationPassed:true`. Manifest SHA `08d343bc1f14ef00746bf913d3c270d1ba99e5bea37adebc17737ee29bb3d12b`; сохранён в `.playwright-mcp/kp-189/prepare-source-e57d6577-7885-44e6-82f2-2bcc49d100b4/raw-manifest.PRIVATE-NOT-FOR-APPLY.json`.

Этот manifest **PROVISIONAL / НЕ ДЛЯ APPLY**: его target относится к предварительному SHA `2ff…`, а не к финально принятому staging №189. Сохранённое marker-доказательство `PROVISIONAL-NOT-APPLICABLE.private.json` не снимается. После окончательного Git SHA и реальной staging proof необходимы новый target profile и новый source-only prepare/review. Успешное чтение исходных байтов не является подтверждением target storage, БД или приёмкой импорта.

В отчёте остаются **323 unknown facts**: в том числе отсутствие отдельного original, неизвестные исторические настройки/даты и неизвестный исходный R2 upload SHA восстановленных изображений. Review30 замен не превращает эти неизвестные в подтверждённые оригиналы. Исходный R2, missing URLs, raw JSON и оригинальные локальные документы сохранены.

### Настоящий PostgreSQL metadata native под полным rollback

Root выполнил reviewed plan `6ac5504ab744cca3e4204c25273a99bdb7ee79af561d772ad4901f2512572318`; run `77818f56-9702-491c-9efe-52d394790467` — **PASS**. Receipt: `.playwright-mcp/kp-189/native189-root-77b78283-17e0-44f1-9bc4-410c63d7e719.jsonl`, SHA256 `022b06c1950b4a54ee4b93e2b53518d3ecc80eb70d57c55ce985d55939a20ed3`. Этот исполнитель локально прочитал безопасные поля receipt и сверил его SHA, не запускал DB/Docker.

Неизменённый `verifyArchiveNative` выполнил настоящий №189 SQL store/coordinator для 23/189/6/7 и повтор с нулём дублей. Дополнительный 1/8/1/1 SQL сценарий вызвал настоящий artifact writer №187 через MemoryS3 transport (1 PUT, 2 GET, 6 authorizations) и подтвердил сохранность опубликованного archive snapshot при смене source SHA. Source/изображения/DOCX в этих native сценариях синтетические, данные S3 находятся только в памяти. Это **не** проверка физических документов или cloud upload/readback.

В единственном внешнем SERIALIZABLE BEGIN выполнены 18 901 собственных DML statements; SQL fence запретил COMMIT и business DML, `forbiddenBusinessWrites:0`. После обязательного подтверждённого ROLLBACK совпали все 76 таблиц: baseline `afd3a5a3feb4e6029c8ca298804d713f6b778b05da403194380adee268ee9bec`; весь catalog `805b1dddc7a974baf129f63ba4fca19245e5a411b5756850f8cddea54f1d5738`; все83 migration receipts и четыре прежних checksum-исключения; все11 KP-таблиц остались пустыми. Нет постоянных fixture-записей и изменений Project/Product/Client/финансовых данных.

Локально подготовлены и пройдены9/9 guard/port/fence тестов native tooling, expanded web+runner TypeScript, ESLint и inert dry. Настоящий target guard не подменяется: runtime facade только синхронно делегирует прежнему guard с точным declaration/private URL/container; module cache восстанавливается. Ignored runner/plan/receipt не входят в коммит.

**Остаётся NOT RUN:** реальный target S3 import/apply/replay восстановленного архива, новый applicable manifest с окончательной staging proof, runtime-поставка CLI в standalone image, staging/browser/API/MCP/cutover и production. Task3.2 остаётся открытым. Никаких dumps/reset/seed/new containers, source R2 DELETE или привязки архива к действующим проектам не выполнялось. Авторизованный локальный коммит №189 фиксирует реализацию и эти пределы evidence; выпуск/активация не следуют из него автоматически.

## 20.10.2026 — CLI binding и сохранённый Archive25 HOLD

Root actual APPLY остановился с `ARCHIVE_TARGET_STORAGE_CHANGED`; ACK SHA256 `2a2167bec0b29fedf42ddd478169bbec619c5b0ce708d5c918513bb207e52880` сохранён в ignored delivery `archive-history-remedy-44749d57-124f-4e97-b860-e9ce403d7448/delivery-29f69760-48b7-4969-b8b2-216f3e2f2b2e/archive-apply-root-run-d8cc4603-156e-4f11-b96b-81c9779ef27c`. Старые delivery/head/AUX nonce остаются HOLD, повторный запуск не выполнялся этим исполнителем.

Причина воспроизведена на настоящих shared factories: image binding нормализует endpoint через `URL.toString()` с конечным `/`, artifact binding удаляет конечный `/`, а manifest сохраняет вариант без `/`. CLI сравнивал эти строки напрямую. Теперь обе media binding проходят один существующий `parseMediaBinding`; canonical equality сохраняет точные bucket, region и наличие region. Ошибка при отличающейся цели остаётся `ARCHIVE_TARGET_STORAGE_CHANGED`. Shared server media/artifact writers, env, ledger bindings и БД не менялись. У CLI adapter добавлен только DI loader для прямой проверки этой композиции; обычный запуск использует прежний `sharedModule`.

RED: новый положительный factory/SDK тест падает на прежнем сравнении с тем же кодом. GREEN: **37/37** archive/recovery tests, полный web strict TypeScript, ESLint двух изменённых файлов, OpenSpec strict и `git diff --check` PASS. Положительный тест использует настоящий AWS SDK с memory HTTP handler (1 Put + 1 Get/readback, без сети); изменённые endpoint/bucket/region и отсутствующий region дают отказ до Put/Get. Это не actual S3/import acceptance.

Локально сверены Root full76 receipts BEFORE `9f09ce19…` / AFTER `80fb61e2…`: reserve уже сохранил +23 CommercialProposal, +6 ProposalContract, +258 ProposalMedia, +7 ProposalArtifact, +530 ProposalJob и +30 ChangeLog. Catalog и migration history 84/83 совпали; business snapshot не объявляется неизменным. Первые семь объектов в отсортированном ledger — DOCX, поэтому нулевые actual S3 writes не заявляются: их физические SHA/readback и точные состояния требуют отдельной Root read-only проверки. Публикация архива не принята; task3.2 остаётся открытым. Старый actor/ключи не активировались, ledger не очищался, новый namespace не создавался. Исполнитель не выполнял DB/S3/SSH/Docker/env/target вызовов; main/production и текущий runtime acbd не изменены.

### Explicit ADMIN recovery — реализация, native ещё не запускался

Добавлен отдельный APPLY режим `--resume-reservation` / `--reviewed-reservation`: exact reviewed witness связывает прежний reserve, manifest/target, нового оператора, operation UUID и SHA реально исполняемого CLI. Каждая транзакция заново проверяет active ADMIN; исходные creators, payload actors и fingerprints сохраняются. Допускаются только собственные unpublished PENDING объекты, FAILED либо expired PROCESSING uploads и будущие PENDING cleanup без progress/leases/retirement/references. Иные строки, живой lease или изменение witness дают отказ до reclaim. Два exact recovery audit IDs и publication audit принадлежат новому оператору. Ранее verified объекты проверяются GET/readback без повторного Put, остальные проходят прежний immutable writer и единственную атомарную публикацию; обычный replay возвращает ноль дублей. Старые actor/ключи и HOLD не переактивируются.

**42/42 PASS**: прежние archive проверки и новые exact witness/manifest/target/operator/operation/program guards, foreign/tampered certificate, ровно два audit exclusions, семь GET-only synthetic DOCX, atomic publication/replay0 и stale verified bytes. Полный web strict TypeScript, scoped ESLint, OpenSpec strict и diff-check PASS. Тесты используют synthetic source/SQL port/MemoryS3; реальных DB/S3 операций исполнитель не выполнял.

Подготовлен root-only `verifyArchiveReservationNative(client, declaration)` для уже открытой разрешённой local5433 транзакции с обязательным внешним rollback: настоящий reserve, неактивный исходный DIRECTOR, новый ADMIN, отказ при live lease/cleanup progress/foreign payload/non-ADMIN/stale witness/unexpected refs, проверка неизменных creators/payloads и replay0. Helper не открывает подключения и не обращается к настоящему S3. **PREPARED_NOT_RUN**: native recovery, actual recovery APPLY/REPLAY и новый operational package/source commit ещё требуют Root исполнения и независимого review. Tasks2.4/3.2 остаются открытыми; текущий web runtime acbd не выдаётся за provenance изменённых CLI/store/apply модулей.

### Root: native recovery принят, Archive28 остаётся HOLD

После предыдущей записи Root выполнил настоящий local5433 native recovery: run `58d9c659-b27a-438a-887f-4bf7c49e13fd`, reviewed plan SHA256 `80d561be60b0d9b39d39f8e83cf42f11bed87e045ffe9d32b725d6076181e300`. Все девять сценариев прошли; 4104 собственных SQL statements, запрещённых business writes0. Обязательный внешний rollback сохранил все76 таблиц и catalog: baseline `afd3a5a3feb4e6029c8ca298804d713f6b778b05da403194380adee268ee9bec`, catalog `805b1dddc7a974baf129f63ba4fca19245e5a411b5756850f8cddea54f1d5738`. Все83 migration receipts и четыре прежних checksum-исключения сохранены. Native использовал MemoryS3 и не является cloud-приёмкой. Реализация recovery зафиксирована локальным коммитом `cd0558902f208e35c853f5250f0f4129b0aba59e`; task2.4 закрыта, task3.2 открыта.

Root actual recovery Archive28 выполнялся отдельным новым ADMIN по свежему SQL witness; исходный actor не активировался. Operational CJS SHA256 `98169e3a7ba12e96b12aa8ad21714b1261f39ea4eb94dce192b6fe76a134d15a` отличается от установленного web runtime `acbd164cb6e79194b7fe87a0469d60d745dead1a` и не выдаётся за его часть. Действие `48afdda4-0051-439c-a42a-f39ee00e9675` завершилось HOLD: controller `ARCHIVE_ROOT_WORKER_ACK_UNKNOWN_HOLD`, worker `ARCHIVE_ROOT_POST_PROOF_HOLD`. CLI stdout/stderr пусты, after-proof отсутствует; точное исключение и код завершения дочернего процесса не сохранены. Счётчики IO: sourceGet522, sourceList3, targetGet252, targetPut246, rejected1. Число Put-вызовов не подменяет число verified объектов или успешную публикацию.

Окно истекло в `2026-10-20T03:37:05.049Z`; deadline наблюдал11 inactive users и22 revoked keys. Root затем успешно выполнил исходный CAS finish, receipt SHA256 `6e4bbe9b2c0bdc9a47ef17188aa10433dd15ffd6f046552e37026d866aff6f80`. Неизменяемый результат deadline остаётся `OWN_CREDENTIALS_EXPIRED`, а не `ORIGINAL_FINISH_OBSERVED`. Старые delivery/head/HOLD сохранены, повтор и продление не выполнялись.

Runtime выключен штатным paired qa-off: web `0fe1f9ab4948023ff225a6b80538af4c5df271eeb0686d04b379ae8df57a808d`, все три feature flags0, собственный renderer остановлен; обычный W07 и metadata guards прошли. Полный финальный76-table snapshot сохранён с SHA256 `ddc5a3156928bddea907c5a1f418fd07410efaae4e4c3521716db06f1b65a8e3`. Это закрытие доступа и сохранение evidence, **не** приёмка импорта. Actual job/object reconciliation и успешные APPLY/REPLAY ещё обязательны; main/production не изменены.

### Ограниченные параллельные чтения архива

Для frozen174-position manifest прежний coordinator требовал803 source GET: два полных прохода по269 уникальным объектам и265 промежуточных чтений. Каждый R2 вызов создавал и уничтожал SDK client. Эти source-факты объясняют лишнюю работу, но не восстанавливают отсутствующее исключение Archive28.

Теперь два полных прохода сохранены, чтения ограничены четырьмя и128MiB admitted payload, авторизация одного pg client последовательна. Не доверенный размер manifest проходит source limit/budget/safe-integer проверки и ограничивает фактический stream. Ошибка прекращает новые чтения и дожидается всех начатых; source drift, MIME/modifiedAt/recovery provenance и inventory проверяются по-прежнему. Verified объект всегда требует настоящего target GET/SHA; пропускается только его промежуточный source GET. Клиенты переиспользуются в пределах точной конфигурации и закрываются явным CLI finally, включая recovery wrapper.

RED: из шести первоначальных новых проверок пять воспроизвели прежнее поведение. GREEN: **52/52** archive/recovery/performance checks, полный strict TypeScript, scoped ESLint и diff-check PASS. Тесты проверяют пределы concurrency/bytes, последовательную авторизацию, остановку и drain после ошибки, оба source прохода, stale source/target, конфигурацию/credentials и lifecycle. Дополнительный реальный AWS SDK с memory HTTP handler проверил сериализацию команд, тело ответа, переиспользование соединения и закрытие; сети, БД и actual S3 в этих тестах нет. Source freeze SHA256 `65e5f5da21e404e3a390c82292626b7b91d0127a213912f199b2e43ba661ce9e`. Root проверил полный implementation diff без замечаний. Время будущего actual APPLY не гарантируется локальными тестами, task3.2 остаётся открытой.

## 20.10.2026 — принятая композиция APPLY32 / genuine REPLAY36

Root принял actual product chain для frozen **23 КП /174 позиции /6 settings /7 DOCX**,
265 target objects. Исторические189 позиций не подменены: current source CP224
содержал7 вместо22, что было сверено до freeze; остальные unknown facts и30
reviewed recovery сохраняют прежние ограничения. Raw JSON, original R2 и локальные
исходники сохранены. Старый PROVISIONAL manifest по-прежнему не для APPLY.

Actual runtime был `acbd164cb6e79194b7fe87a0469d60d745dead1a`, web image
`sha256:8ef120a68e378d47b71ea5913ec8bd85391cfa4f2f8cd1ec25169151a55bd77f`,
режим OFF000 / renderer STOPPED. Operational CLI происходил из отдельного commit
`4ff64fc021105a3bb74bab208c3aa9ee0a5ed16b`; его изменённые модули не объявляются
частью runtimeacbd или будущего final image. Frozen manifest RAW
`211be131ec2434b5872a5336482d612d3dcc7d32705e957525f0d4204a8a674e`, canonical
`b58143fdda99b828d68dc6899af6b34d47073336c4d5143913f6c7b0b5b20ef1`.

APPLY32 получил настоящий ACK и публикацию23/174/6/7; 265 UPLOAD SUCCEEDED
без leases, 265 будущих PURGE PENDING сохранены. Независимый published native
RR READ ONLY capture подтвердил rows, verified objects и history; исходные
reservation/creators и две точные recovery audit rows нового ADMIN сохранены.

Точные accepted refs (в `kp-189/.playwright-mcp/kp-189/`):

- APPLY32 `archive-off-codec-remedy-c7e9cd81-5518-4d42-a199-8bb3766fe519/delivery-bound-9f12fb03-3e68-4f71-b37a-a183f4f458d9/archive-apply-root-run-93eda4dc-e0a7-4a35-9f20-1d982a760ef4/ack.private.json`,
  SHA `8cfe38dbe7d8abee9aebdc61437830c43a39bed774b4793c1ab80d6da79ad733`.
- Published native `archive32-published-native-brotli-cd223bf6-236d-4e2a-ab6c-d6d66ab05048/run-0dc5bdf0-c416-41ee-8d34-9ff4ca9fcf3f/ack.private.json`,
  SHA `235182096e365dd0c3e4161f783657b453a219d73f47d361d11a6406ff3ffc46`.
- REPLAY36 `archive36-completion-239dc8ea-3e81-4b2a-b31f-5df4b117457a/receipts-65113992-d279-4117-af0b-40245dc559e0/producer-result.private.json`,
  SHA `0b60e5008e058a57d90e84763f6abfbcce0ceb21a7e331c639d3d5ed97384ded`.
- Complete retained manifest `archive36-completion-239dc8ea-3e81-4b2a-b31f-5df4b117457a/manifest.json`,
  SHA `8d438c48dcf9e242453653ed612b6f29a5c4cfe5e7f699d2956cf6d6599de847`.

REPLAY36 дал genuine inner applied/replayed=true и все created0: 269 source GET /
3 LIST /265 target GET, PUT0/rejected0; 4174 SQL read/lock/transaction calls,
DML forwarded0. Raw CLI entry SHA `9b703bfc28a7b9df7e2565762df31f5628fc19a2cc135ab5e904bba5395e3068`
и effective compile SHA `fee192a5f758a61f977b04d8441cf90115c703b0da9562aee7f120f02cfd4e32`
различаются: QA bridge инструментировал один initializer bundled pg Client/Pool,
сохранив29-query fence. Это не byte-identical execution raw CJS.

Внутри REPLAY36 before/after FULL_NO_EXCLUSIONS BUSINESS exact
`b8a264231de008478ca6f06888fc67f78a12242767fcff5f5fc6df12377ef390`;
published archive canonical `63fd456f1aa1750cd580be300131d253e79e2bf3f062e05f1dff4f4048d55835`.
RAW сохранён: отличие ограничено прежним approved legacy ApiToken.lastUsedAt
(idHash8bb4 / withoutLastUsedAtHashe454), не новой нормализацией или межкогортной
whole-DB equality. History84/83 и pending0 migrations сохранены.

Original outer REPLAY36 остаётся HOLD/AUX_ARCHIVE_RAW_CLI_RECEIPT_REQUIRED
(SHA `f682a67c704710ac48b53479e7cc2de181ea4998141b73b1b9de343f94c97666`):
старый validator ожидал иной label, genuine worker уже дал VERIFIED_NATIVE_IN_TRANSACTION.
Композиционная приёмка опирается на inner ACK и сохранённые proofs; outer/nonce/ledger
не переписаны, producer не повторялся. Original closure36: CLOSED context SHA
`5aa77415a6de3655f9af58778f849dcdd3378f3432e12498f20ee419ee2262b0`,
finish SHA `3afb9b568bf587dbc68ded599f2b79ccd6fcc0c2b9b148c36f163c7c8db9d36b`,
terminal SHA `e3fb4cee33a5203a712bd622dcc99d09d47ce68b5232bfc7b8d5bbb0ae433f71`:
ORIGINAL_FINISH_OBSERVED/alive=false, 11 inactive/22 revoked; OFF000 сохранён.

**Остаток обязателен:** final deployed composition нового SHA/образов и cutover
ещё NOT_RUN. Принятые operational receipts4ff не релабелятся под final image;
при подтверждённой эквивалентности исходников они сохраняют собственный provenance.
Task3.2 остаётся `[ ]`; полная staging-приёмка и production/main не заявляются
и не разрешаются этой записью. Старые HOLD сохранены; новых code/тестов/target calls нет.

## 20.10.2026 — отдельная production target binding

Устранено ограничение CLI, которое направляло все apply через QA-only
`nativeAcceptanceBinding`. Production теперь имеет отдельный typed target и
fail-closed guard; сам QA helper, local/staging guards, store, writer lifecycle
и offline dry-run сохранены. До DB I/O нужны reviewed release proof и явное
разрешение UUID операции с точными manifest/target/operator/revision/CLI hash.
Runtime проверяется по настоящему hostname и hashes установленных BUILD_ID/server.js;
подключённая БД — по cluster/system identifier, server address/port, DB OID,
current database/public schema/effective+session user и отсутствию recovery.
Runtime/DB/storage/URL/срок proof перепроверяются через существующий lifecycle.

Выполнены только прежние archive/recovery/performance тесты, одним запуском:
**52/52 PASS**, skipped0. Новых тестов/cases/assertions в tests нет. Полный web
strict TypeScript (`tsc --noEmit --incremental false`), scoped ESLint трёх
изменённых TS-файлов и `openspec validate kp-archive-import --strict` — PASS.
Эти прежние regression checks не являются runtime-проверкой нового production guard.

Proof является доверенной декларацией привилегированного оператора с отдельным
review release receipt, а не криптографической подписью. Реальные production
identity/proof здесь не получались, DB/cloud/production операции не выполнялись;
**production execution/rehearsal: NOT_RUN**. `pg_control_system()` без нужного
доступа останавливает запуск, новых grants нет. Реальный production выпуск и
операция требуют отдельного согласования после ручной staging-проверки владельцем.
Task3.2 остаётся `[ ]`; старые APPLY32/REPLAY36 provenance и HOLD не изменены.

## 21.10.2026 — закрытие функциональной приёмки импорта

Пункт3.2 завершён по уже принятым actual APPLY32, published-native и genuine inner
REPLAY36, указанным выше: 23 КП /174 позиции /6 настроек /7 DOCX, 265 объектов,
повтор создал0 записей и выполнил0 PUT/DML. Исходный R2 сохранён; 30 восстановленных
изображений имеют reviewed provenance. Нового импорта и новых проверок не проводилось.
Исторические outer HOLD и отдельный CLI provenance4ff64fc остаются неизменными.

Это закрывает функциональную приёмку импорта после dependency merges. Финальная
публикация общего staging, точные SHA/образы и переключение на CRM остаются отдельной
операцией Root после единого CI; её результат фиксируется самостоятельным runtime
receipt, а не переименованием старых import receipts. До этого receipt новый образ
не объявляется принятым. Production target guard проверен только описанными52
регрессиями; его реальный production proof/restore/rehearsal/import остаются NOT_RUN
и требуют отдельно согласованного выпуска после ручной staging-проверки владельцем.
# Уточнение 26.10.2026: обычные КП

Владелец отменил отдельный архивный режим. Режим удалён из UI/DTO/API-фильтра, договоров, изображений, lifecycle/access/pricing gates. Исторический SQL-столбец остаётся неиспользуемым для совместимости, без изменения схемы; нормализация устанавливает false. История `IMPORT`, sourceId, исходные даты, S3 keys/hashes и DOCX сохраняются.

Подготовлен `normalize-imported.ts`: reviewed plan только для 23 импортированных ID, точных существующих номеров проектов и уникальных действующих номеров изделий. Меняются лишь связи CommercialProposal/ProposalItem; коммерческий save/pricing/media/render не вызываются. Хэши полных строк, глобальная/project-блокировки и транзакционный baseline защищают существующие бизнес-данные, state/revision/даты/файлы. Отсутствующие изделия при нормализации не создаются.

Фактические local-проверки:

- Core/access/lifecycle/PDF: RED 10 ожидаемых отказов → GREEN 42/42; stage/role/revision gates сохранены.
- UI/API/media/contracts: 29 unit и 14 template checks PASS. Browser подтвердил 0 PUT при открытии, предпросмотре и просмотре договора с нормализуемыми default-полями. Мобильная компоновка сохранена.
- Peer P2 о недоступности ручного курса при отказе НБРБ исправлен: отдельная browser-regression RED→GREEN для 503 → ручной курс → сохранение без повторной загрузки курса; reviewer подтвердил исправление. Диалог курса теперь открывается без GET/PUT, ошибки НБРБ показываются внутри.
- Import/recovery/normalization: 49/49, включая разрешённое последующее изменение КП/настроек и отсутствие восстановления очищенных объектов через replay.
- Общая TypeScript-проверка, scoped ESLint и diff-check PASS. Prisma client восстановлен из текущей схемы; схема изменена только комментарием, новых миграций нет.
- Нативная local5433: существующий `pero_crm_pg` / `bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5`. Run `15a692a4-e90c-4c6d-9fc2-293220c64c34`: 23 КП и 23 точных связи изделий, metadataOnly=true, replayZeroWrites=true, повтор исходного импорта принят; после обязательного полного rollback все 77 таблиц/каталог/история совпали с исходным snapshot. Source/target S3 I/O нет, fixtures существовали только внутри rollback. Первая попытка остановилась на обязательном phone синтетического Client, транзакция была откачена; исправлена только fixture, бизнес-данные не корректировались.

Операционные доказательства и reviewed mapping: `C:/Users/admin/.codex/tmp/pero-kp-normalize-20261026`. Первый staging CI `40308116594` / SHA `29d4bda2` прошёл 7/7, образ развёрнут healthy. Read-only capture на действительных 23 записях выявил P2: публикация после согласованного ADMIN recovery имеет другого автора, чем первоначальный reserve. Данных capture не менял. Проверка исправлена только для exact завершённой recovery-пары с привязкой к исходному receipt/actor/hash, новому оператору/UUID/program/witness/target и неизменяемому upload ledger; исходные creators и история не исправлялись. RED→GREEN 9/9 и 12 tamper-вариантов, TypeScript и независимый review пройдены. Исправление требует нового CI и повторной проверки staging; production-нормализация на этой точке не выполнена.

### Завершение выпуска и уточнённая нормализация 26.10.2026

Предыдущий абзац — промежуточная точка. Принят и развёрнут SHA `8987beb69e08d69385a02709142f40f9f2acac23`: staging CI `40312619548` и main CI `40321448995`, оба 7/7. Production web/renderer healthy, DB container/volume и внешние настройки сохранены. В браузере КП230 открытие диалога курса и ответ НБРБ подтверждены без сохранения; сравнение всех 17 полей/хэшей контрольного КП, проекта, изделий и позиций до/после совпало. Receipt: `C:/Users/admin/.codex/tmp/pero-kp-normalize-20261026/RATE-FIX-COMPLETED.json`.

По последнему сужению поручения владельца production-нормализация меняла только `CommercialProposal.projectId/clientId/isArchive` у 23 КП: 18 получили существующего временного клиента, 5 — клиента соответствующего проекта. State/revision/даты/изображения/договоры и ProposalItem не менялись; 76 остальных таблиц сохранились, добавлен только собственный audit receipt. Общий CLI связывания изделий не запускался. Receipt: `C:/Users/admin/.codex/tmp/pero-kp-normalize-20261026/basic-production-metadata-result.json`.

### Исправление отказа изображений при обычном сохранении

Read-only диагностика КП230 подтвердила два READY JPEG с ключами `<mediaId>_<sha256>.jpg`. Предпросмотр читал эти ключи, но `COPY_PRODUCT_MEDIA` требовал обычный `<mediaId>.jpg` и выбрасывал `KP_MEDIA_INVALID` до резервирования копии или запуска PDF. Новая регрессия воспроизвела отказ RED, после узкой правки `kp-media-core` + `kp-media-image` — GREEN 12/12. Проверены неизменные source bytes/key/hash и отдельная READY-копия; чужие proposal/media ID, hash, MIME/расширение и URL отклоняются до I/O. Ветка UPLOAD не изменена. Scoped ESLint и diff-check PASS; независимый reviewer не обнаружил P1/P2. Новый выпуск этой правки проходит отдельный штатный CI; результаты runtime фиксируются отдельным operational receipt, не подменяются этим local evidence.

### Услуги без категорий и восстановление после отклонённого сохранения

По новому поручению владельца категории удалены из формы услуг; исходные строки, цены, неизвестные поля и уже существующее `crmKind` сохранены. Сервер принимает отсутствующую/частичную/неверную разметку общей суммой услуг, очищая три альтернативных поля. Старые полные сопоставления совместимы; печатный расчёт не изменён. Pricing RED→GREEN 10/10, transport 12/12; повтор однозначного pricing400 использует исправленный state/FX/client и новый UUID, а потерянный ACK сохраняет точный старый запрос. Явный новый курс фиксируется до очереди и не теряется после успешного старого ACK. Создание, экспортные операции, договоры и общий `KP_VALIDATION` не ослаблены.

Один существующий browser-сценарий расширен настоящим `projectProposalPricing` вместо безусловного PUT ACK и `isolatedWorker` для PDF. Он подтвердил строки 135/1230 без категорий, ручной USD3.25, сохранение изменённого state/стабильных ID/неизвестных полей, общую сумму 3992.63 со скидкой, подтверждённую ревизию в PDF-команде и запрет второго выпуска при409. Финальный точечный прогон после последней правки FX: 1/1, `apps/web/test-results/kp-editor/925976c5-2089-4e15-93a0-1715d7586342/unmarked-services.pdf`, 374453 байта. До последней правки также прошли 3 затронутых browser-сценария desktop/mobile и 3 template-проверки; мобильная форма просмотрена. Scoped ESLint/diff и независимое review — PASS. Новых миграций, дампов, production save или SQL-изменений нет. Штатный CI/runtime этой правки отслеживается в `C:/Users/admin/.codex/tmp/pero-kp-normalize-20261026/services-save-fix-execution-state.json`.

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

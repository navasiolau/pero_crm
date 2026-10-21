# Перенос архива КП в CRM

Импорт №189 сохраняет архив отдельно от действующих заказов. Ранее исследованный объём — 23 КП, 189 позиций, 6 черновиков настроек договора и 7 DOCX. Это контрольная историческая величина, а не результат новой проверки облака. Фактические количества появляются только в новом frozen manifest.

## Границы запуска

До реального запуска нужны обычные merges зависимостей №180, 183, 185, 186, 187 и 188, их миграции и согласованная приёмка. CLI загружает их настоящие модули; при отсутствии возвращает `ARCHIVE_DEPENDENCIES_NOT_INTEGRATED`. Копирование feature-файлов в ветку импорта не применяется.

Самостоятельно не создавать БД, контейнеры, дампы, seed или reset. Для существующего local `pero_crm_pg` через `127.0.0.1:5433/pero_crm` и проверенного staging `crm-staging` с `db:5432/crm` сохраняются прежние QA guards. Production имеет отдельный закрытый по умолчанию guard и требует согласованного выпуска, reviewed release proof и явного разрешения конкретной операции, описанных ниже. Guards проверяют контейнер, БД, схему, пользователя (`pero` для local, `crm` для staging), SHA/образ/volume и точную приватную storage binding. Любое несовпадение останавливает запуск.

Ключи источника и CRM передаются уже подготовленным приватным окружением. Не выводить env или URL подключения. Source adapter выполняет только List/Get; он не импортирует legacy handlers и не изменяет `D:/Projects/pero_kp`, исходные объекты, настройки либо R2. Target использует общие приватные writers №183/187 с conditional put и фактическим readback.

## Подготовка manifest

Из корня согласованного worktree:

```powershell
pnpm --filter @pero/web exec tsx scripts/kp/archive-import.ts --help
pnpm --filter @pero/web exec tsx scripts/kp/archive-import.ts --prepare --source-profile=<PRIVATE_SOURCE_PROFILE.json> --target-profile=<PRIVATE_TARGET_PROFILE.json> --output=<NEW_PRIVATE_MANIFEST.json>
```

`--prepare` читает источник, но не подключается к БД и не загружает объекты в CRM. Файл создаётся с запретом перезаписи. В worktree разрешён только ignored каталог `.playwright-mcp/kp-189`; исходный `pero_kp` запрещён и после разрешения reparse points. Можно указать отдельный явно выбранный приватный каталог вне репозитория. Manifest содержит исходные JSON с персональными данными, поэтому его нельзя коммитить или публиковать в обычном логе.

Source profile содержит `public`, `contracts` — `{endpoint,bucket,region?}` — и точный `publicBaseUrl`. Target profile содержит `storage` той же формы и `database`:

- Local: `{kind:"local",containerId:<SHA64>,name:"pero_crm",schema:"public",host:"127.0.0.1",port:5433}`. ID должен совпадать с `CRM_LOCAL_CONTAINER_ID` и существующим контейнером.
- Staging: `{kind:"staging",containerId:<DB_CONTAINER_SHA64>,name:"crm",schema:"public",host:"db",port:5432,revision:<SHA40>,volume:"crm-staging_pgdata"}`. Нужны действительные `CRM_MODERNIZATION_TARGET=staging` и `CRM_MODERNIZATION_STAGE_PROOF` от разрешённого wrapper. Произвольный файл proof не является приёмкой.
- Production: `{kind:"production",containerId:<VERIFIED_DB_CONTAINER_SHA64>,name:<VERIFIED_DB_NAME>,user:<VERIFIED_DB_USER>,schema:"public",host:<VERIFIED_DB_HOST>,port:<VERIFIED_DB_PORT>,revision:<ACCEPTED_RELEASE_SHA40>,volume:<VERIFIED_PRODUCTION_VOLUME>}`. Значения берутся из отдельно проверенного выпуска; production volume не может быть `crm-staging_pgdata`. Profile и все его поля входят в frozen manifest hash; переименование staging в production не сохраняет reviewed manifest.

Source credentials берутся из `R2_*` и `CONTRACTS_R2_*`; target writers используют конфигурацию CRM. В profile и manifest нет паролей и access keys. Источник и назначение не могут совпадать по endpoint/bucket, даже если отличаются region.

Проверить offline dry report:

```powershell
pnpm --filter @pero/web exec tsx scripts/kp/archive-import.ts --manifest=<PRIVATE_MANIFEST.json>
```

Dry-run является режимом по умолчанию: он валидирует SHA, raw records, идентификаторы, media refs, даты и связи без DB/source/target I/O. Сверить реальные количества, исходные номера и состояния, контрольные суммы записей/объектов, все `unknowns` и все несвязанные DOCX. Расхождение с 23/189/6/7 требует объяснения по новой инвентаризации; CLI не выдаёт историческое число за live-факт.

## Проверенные связи DOCX и происхождение данных

Legacy generator не сохраняет `exports/<UUID>.docx` в settings record. Первичная подготовка сохраняет все обнаруженные DOCX в отчёте, включая семь файлов без доказанной связи; она не угадывает основной КП. После изучения содержимого DOCX/приложений подготовить reviewed map:

```json
{
  "exports/example.docx": {
    "primaryDocumentId": "<LEGACY_DOCUMENT_ID>",
    "reviewed": true,
    "evidenceSha256": "<EXACT_SOURCE_DOCX_SHA256>"
  }
}
```

Повторить `--prepare` с `--links=<PRIVATE_LINKS.json>` и новым выходным файлом. SHA подтверждает именно проверенные байты. Apply запрещён, пока любой DOCX не связан, не reviewed или не имеет исходной даты объекта. Снимок выпущенного договора честно отмечает отсутствие точных исторических настроек; текущие settings сохраняются независимо, включая некорректный старый черновик. История №186 доступна независимо от валидности формы.

Дата создания КП берётся из исходного `createdAt`, а при его отсутствии — из timestamp исходного ID с `IDderived`. Отсутствующие факты явно остаются `unknown`, время импорта не заменяет исходные даты. `expiresAt` — годовщина исходного создания КП. Архивные старые изображения не получают новый год хранения и могут сразу оказаться просроченными по правилам чтения/очистки.

Существующий optimized объект переносится байт в байт, без повторного кодирования. Отдельный original появляется только при доказанном исходном объекте через `--originals=<PRIVATE_ORIGINAL_KEY_MAP.json>` формата `{ "kp/optimized.jpg": "kp/real-original.png" }`. Если original нет, поля остаются null, а не копией optimized. Разные legacy URL с одинаковыми байтами сохраняют разные стабильные media IDs и ключи с media ID; повтор одной исходной ссылки внутри КП использует одну media запись. Raw source остаётся в provenance.

## Согласованное восстановление отсутствующих изображений

Если владелец отдельно согласовал восстановление из локальных файлов/PDF, для `--prepare` и последующего `--apply` указать **оба** параметра `--recovery-map=<REVIEWED_RECOVERY.json> --recovery-root=<ASSETS_DIR>`. Без map/root обычное поведение не меняется. Offline dry-run manifest не читает recovery-файлы и этих параметров не принимает. Для apply восстановленного manifest та же reviewed map обязательна до подключения к БД; её содержимое входит в manifest SHA.

Portable map имеет `schema:1`, точные `sourceProfile`, `sourceNamespace`, `reviewed:true`, `entries`. Каждая строка содержит исходный `key`, относительный `file:<sha256>.jpg|png|webp`, `sha256`, `size`, `mimeType`, полный `references:[{documentId,position,slot}]` (position от 1), `origin`, `evidenceSha256`, `reviewed:true`. Для LOCAL_FILE origin содержит SHA точной исходной копии; для PDF_DCT — SHA PDF, положительные page/object и optional imageResource. Указанный root — каталог только hash-named копий. Он не сохраняется в manifest, поэтому пакет переносится Windows→Linux; оригинальные PDF/локальные исходники и evidence остаются отдельными сохранными материалами проверки.

Это разрешение использовать **согласованную замену**, а не утверждение, что SHA совпадает с утраченным upload. Каждый GET сначала обращается к настоящему R2. Только `NoSuchKey`/`NotFound` вместе с HTTP404 разрешает чтение соответствующей локальной копии. `AccessDenied`, `NoSuchBucket`, timeout, произвольный404 или повторное появление объекта прекращают перенос. Непроверенная строка, лишняя/неполная позиционная связь, неправильный hash/MIME/размер, абсолютный путь либо junction/symlink также останавливают работу.

До reserve и непосредственно до publish повторяются полный cloud LIST/raw JSON/byte SHA и чтение recovery-файлов под действующим lease. Настоящие оставшиеся R2-изображения копируются обычным строгим путём. Map/provenance входят в document receipt и immutable IMPORT snapshot; исходный missing URL остаётся в raw JSON. Отдельный original остаётся null. IMPORT — снимок исходного состояния с `sourceStateOnly:true`, `issuedPdfAvailable:false`, без заявления о ранее выпущенном PDF. Исходные даты и годовой TTL не продлеваются.

## Применение и возобновление

Только после review конечного SHA и отдельного разрешения на реальную цель:

```powershell
pnpm --filter @pero/web exec tsx scripts/kp/archive-import.ts --apply --manifest=<REVIEWED_PRIVATE_MANIFEST.json> --reviewed=<EXACT_MANIFEST_SHA256> --actor-id=<ACTIVE_ADMIN_OR_DIRECTOR_ID> --revision=<VERIFIED_SHA40> --run-id=<UUID>
```

Для production к этой команде обязательны все три аргумента: `--production-proof=<PRIVATE_RELEASE_PROOF.json> --reviewed-production-proof=<CANONICAL_PROOF_SHA256> --authorize-production=<SAME_RUN_UUID>`. Local/staging эти аргументы отклоняют. Dry-run остаётся полностью offline; `--prepare` только читает источник и не открывает production БД.

Production proof подготавливает оператор отдельно, после ручной staging-проверки владельцем и разрешённого production-выпуска. Источником служат реальные read-only release receipts точной ревизии, установленного image, DB container/volume и приватного storage. Импортер не создаёт proof, не угадывает identity и не объявляет staging receipts production-приёмкой. Формат JSON строгий:

- `schema:1`, `kind:"KP_ARCHIVE_PRODUCTION_RELEASE"`, `releaseReceiptSha256` — SHA256 отдельно проверенного release receipt;
- `revision`, `programSha256`, `manifestHash`, `targetHash` — точный release SHA40, SHA256 исполняемого CLI entry/bundle, canonical manifest SHA и `valueHash(manifest.target)`;
- `operatorId`, `operationId` — точный actor и UUID операции; `capturedAt`, `expiresAt` — UTC ISO timestamps с окном не более часа;
- `runtime:{containerId,image,buildIdSha256,serverSha256}` — полный web container SHA64, `sha256:<IMAGE_SHA64>` и SHA256 реальных `/app/apps/web/.next/BUILD_ID`, `/app/apps/web/server.js` этого установленного image;
- `database:{systemIdentifier,databaseOid,serverAddress,serverPort}` — строки PostgreSQL `system_identifier`, OID текущей БД, реальный IP и порт сервера, снятые с согласованной production цели.

`--reviewed-production-proof` — `valueHash` всего JSON, включая ссылку на release receipt. Это доверенная декларация привилегированного оператора, как существующий staging root proof, а не криптографическая подпись внешнего authority. Review исходного receipt обязателен отдельно: SHA сам по себе не доказывает выпуск или restore. Для bundled CLI SHA должен покрывать проверенный operational пакет и его provenance; исходный TS entry hash не доказывает неизменность импортируемых модулей. Ключи и URL с паролями в proof не включаются.

До создания Pool guard требует совпадения manifest/target/operator/operation/program/revision, действующего окна и явного `--authorize-production`. Проверяются Linux Docker runtime, настоящий `hostname()` как префикс полного reviewed web container ID, `NODE_ENV=production`, hashes установленных BUILD_ID/server.js, точные DB URL host/port/name/user/public schema и текущая shared storage binding. QA wrapper markers `CRM_MODERNIZATION_TARGET`/`CRM_MODERNIZATION_STAGE_PROOF` отсутствуют. DB container/volume/image связываются отдельно проверенным release receipt; CLI не получает Docker socket и не инспектирует соседние контейнеры.

После подключения и в существующем writer lifecycle повторяется настоящий SELECT: current database/schema, effective/session user, server address/port, `pg_control_system().system_identifier`, DB OID и отсутствие recovery. Если права не позволяют прочитать cluster identity, guard останавливает операцию; автоматических grants/fallback нет. Проверки срока, runtime, URL, storage и SQL identity повторяются около I/O и перед транзакциями; прежние actor/lease/readback/publication guards сохранены.

**Production execution/rehearsal: NOT_RUN.** Новый production proof здесь не получался, production подключения и импорт не выполнялись. Реальный выпуск, разрешение операции и приёмка production остаются отдельными действиями владельца после ручной проверки staging.

Действительный actor и target проверяются в коротких транзакциях и около I/O. Сначала создаются скрытые архивные КП с `projectId=null`, `clientId=null`, PENDING media/artifacts, настоящие `UPLOAD_MEDIA` jobs и точные cleanup intents. Network I/O выполняется вне SQL. Все собственные leases и 24-часовой quarantine обновляются перед I/O. Опубликованный архив появляется только в одной финальной транзакции после всех SHA/readback и связей. Jobs остаются PROCESSING до её завершения, чтобы годовая очистка не пересекалась с незавершённым переносом.

Сбой не удаляет исходник и не открывает частичный архив. Сохранить manifest и receipts; повторить ту же команду с тем же manifest после выяснения причины. Не менять SHA вручную и не удалять ledger. Неопределённый ACK проверяется readback существующего объекта; чужие байты никогда не перезаписываются. Если cleanup уже начал/завершил удаление, importer останавливается вместо возобновления поверх удаляемых объектов.

После успешного apply повторить тот же manifest. Ожидаются `replayed:true`, нулевые `created`, неизменные ссылки/хэши и отсутствие повторных PUT. Реальная сверка проверяет исходные и целевые связи/контрольные суммы; легальная последующая policy-очистка изображений не приводит к их восстановлению. DOCX сохраняются.

Store сравнивает fingerprint всех прежних строк и catalog до/после собственных reserve/finalize, исключая только точно перечисленные строки своего архива/аудита/jobs. Проекты, изделия, клиенты и финансовые факты не создаются и не обновляются. Изменение любого существующего бизнес-данного останавливает транзакцию. Функция `verifyArchiveNative` подготовлена для root-only проверки настоящего SQL под обязательным внешним BEGIN/SAVEPOINT и полным rollback; её synthetic S3 не доказывает live-перенос.

## Приёмка и переключение

Проверить live-перенос отдельно: полный source inventory, 23/189/6/7 либо объяснённое изменение, все семь DOCX, byte SHA/readback медиа, исходные даты/номера, повторы без дублей, сохранный бизнес baseline, права и приватные download URL. Зафиксировать точный staging SHA/образ и реальное поведение editor/API/MCP. Native, DI и успешный build не заменяют эти проверки.

Привязка архива к существующим проектам выполняется отдельной явной командой/согласованной задачей только после этой сверки. Автоматическое сопоставление по номеру или клиенту отсутствует. Непроверенный архив не создаёт лиды.

Оставить старый R2 доступным на весь период приёмки; importer не содержит DELETE. Переключение editor/API, bundle skill/MCP №187 и `PERO_KP_ENABLED` — отдельное согласованное действие после сквозной приёмки. Production-выпуск, миграция и конкретная archive-операция требуют соответствующего согласования по AGENTS.md; добавленная возможность отдельного production guard таким разрешением не является.

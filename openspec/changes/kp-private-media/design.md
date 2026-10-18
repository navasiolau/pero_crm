# Design

## Context

№180 даёт ProposalMedia, ProposalCurrentMedia, ProposalVersionMedia и устойчивые ProposalJob. Обычные File используют ключ `<projectId>/<storedName>`, централизованные ACL и отдельные привязки обложек. Старый редактор сжимает изображения до 1600 px в JPEG 0.82, но передаёт в состояние публичный URL.

## Goals / Non-Goals

**Goals:** сохранить исходные и подготовленные байты, исключить неучтённые частичные загрузки, дать общий транзакционный hook для №181 и приватный reader для №184/187.

**Non-Goals:** HTTP routes, запуск фоновой очистки, облачный импорт и физическое удаление. Они входят в №187–189; выключенный флаг №180 сохраняется.

## Decisions

- Ссылки состояния — `kp-media:<id>` в полях `image`/`image2`. Проекция для редактора/рендера разрешает только сохранённые ссылки конкретного владельца; произвольный URL не загружается.
- ProposalJob с видами UPLOAD_MEDIA/COPY_PRODUCT_MEDIA и pending ProposalMedia фиксируются до S3. Точные варианты, SHA, размеры, binding, actor/revision и fingerprint находятся в payload. Отдельное ожидающее PURGE_MEDIA существует с момента резервирования и отменяется после успешной публикации/привязки.
- Сеть всегда вне транзакции. Ключи неизменяемы; условный Put `If-None-Match:*`, затем ограниченный Get и SHA-256 фактических байтов. Повтор после неопределённого ACK сверяет старый объект, не перезаписывает его.
- Каждый сетевой шаг проверяет полный binding текущей настройки S3. Fallback на диск отсутствует. Ключи и секреты не выходят в пользовательские ошибки.
- При подготовке копий стабильный item.id уже назначен; productId разрешается в общем save hook. Самостоятельные объекты File используют обычное пространство проекта и отдельные UUID. Сохранение обновляет CurrentMedia и управляемые File в одной транзакции со статусом/ревизией КП.
- Retired managed File исключаются центральным фильтром и получают точный PURGE_MEDIA intent. Ручная обложка и сторонние ссылки запрещают автоматическое удаление. Исторические факты остаются в аудите, собственные лишние изображения подлежат последующей точечной очистке №188.
- Для КП старше года новая загрузка отклоняется до I/O с `KP_MEDIA_EXPIRED` (HTTP 410). Текстовое сохранение с прежними current-ссылками использует уже существующие независимые File без чтения удалённого источника. Добавление/возврат недоступного изображения требует явного удаления ссылки либо доступного нового медиа; правила восстановления версий проверяет №185.

## Risks / Trade-offs

- Смена этапа/прав во время сети → повторная транзакционная проверка, отказ публикации, готовый cleanup intent.
- Сбой процесса в любой точке → заранее сохранённые объекты и срок cleanup, lease и неизменяемые ключи.
- Несовпадение binding → STOP операции без попытки исправить конфигурацию.
- Нативная БД и реальный S3 в этой подзадаче не трогаются → unit/DI и реальные кодеки не объявляются staging-приёмкой.

## Migration Plan

Аддитивная миграция №183 после №180 добавляет состояние медиа, виды заданий и nullable происхождение File. Сначала merge предшествующих задач обычным Git merge, затем validate/generate, targeted tests и guarded native checks координатором. Раздел остаётся выключенным до сквозной приёмки.

Основа №180 вошла в эту ветку обычным FF merge до `aff6c105bbf17c39036ff2b3d123eb5fdbba6233`; foundation-файлы не копировались из других веток. Модельные определения дополнены согласно SQL-миграции №183 и проверены собственным Prisma validate/generate:

- ProposalJobKind: `UPLOAD_MEDIA`, `COPY_PRODUCT_MEDIA`.
- ProposalMedia: `uploadState String @default("READY")`, `uploadJobId String? @unique`, `optimizedMimeType String @default("image/jpeg")`; relation uploadJob → ProposalJob с именем `ProposalMediaUploadJob`, FK uploadJobId/id, Restrict/Cascade; обратная singular `ProposalJob.uploadedMedia`.
- File scalar `proposalSourceItemId`/`proposalSourceMediaId`/`proposalMediaCopyJobId` связаны с ProposalItem/ProposalMedia/ProposalJob соответственно: имена `ProposalItemFileSource`, `ProposalMediaFileSource`, `ProposalMediaCopyJob`; Restrict/Cascade. Имена полей File: `proposalSourceItem`, `proposalSourceMedia`, `proposalMediaCopyJob`; обратные поля `ProposalItem.sourceFiles`, `ProposalMedia.productFiles`, `ProposalJob.productMediaFiles` — массивы File.

Для одной новой миграции №183 закреплён LF через `.gitattributes`; её переносимый SHA-256 находится в evidence. Прежние применённые миграции и их контрольные суммы не менялись.

Применять миграцию самостоятельно субагенту запрещено; native-helper только принимает открытую Prisma transaction от guarded координатора и сам делает SAVEPOINT/ROLLBACK. Его S3 port — память теста, поэтому реальная S3-приёмка остаётся отдельной.

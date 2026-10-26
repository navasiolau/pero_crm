# Design

## Context

Legacy documents сохраняют `{id,name,updatedAt,state}`, дата создания закодирована в ID Date.now. Browser сохраняет одну сжатую картинку; отдельного original обычно нет. Приватные contracts JSON содержат settings/sourceSnapshots/lastGeneration, но export UUID не записывается: требуется reviewed binding DOCX, не эвристический autoapply.

## Goals / Non-Goals

**Goals:** immutable manifest, идемпотентный перенос исходных байтов, PENDING ledger, readback и единая публикация партии обычных КП. По уточнению владельца от 26.10.2026 отдельный архивный режим удаляется.

**Non-Goals:** создание проектов/изделий/клиентов, изменение их коммерческих или производственных полей при нормализации, рендер/пересжатие и удаление источника. Проверенная привязка уже перенесённых КП к существующим проектам входит в текущую правку.

## Decisions

- Source adapter экспортирует только list/read и использует только ListObjectsV2/GetObject; URL картинок преобразуется в key только для точной объявленной source public base.
- Детерминированные ID привязаны к source namespace и исходному ID/key; позиции начинаются с 1, массив state остаётся обычным массивом.
- JSON-оригиналы хранятся lossless base64 вместе с SHA в import provenance. Canonical state получает стабильные item IDs и kp-media tokens; неизвестные поля сохраняются.
- До финальной публикации импортируемые CP скрыты deletedAt. Это техническая защита незавершённого переноса, а не пользовательский архивный режим. Media PENDING использует настоящий UPLOAD_MEDIA job с original:null при отсутствии original; DOCX имеет собственный PENDING artifact/upload job. До I/O существуют точные orphan intents №188.
- Append-only ChangeLog reserve/publish receipts подтверждают scope импорта. Собственные upload leases/grace обновляются до каждого I/O; финал проверяет реальные readback certificates и атомарно публикует весь batch.
- Shared image writer №183 и artifact writer №187 выполняют immutable conditional put/full readback. Их реальные зависимости загружаются после обычного merge; локальные DI-порты не объявляются live-приёмкой.
- Production использует отдельный `kind:"production"` и release guard; local/staging QA helper не расширяется. До DB I/O обязательны отдельно reviewed release proof и явное разрешение UUID операции, связанные с frozen manifest/target, actor, revision и CLI hash. Proof фиксирует реальный web container/image и hashes установленных BUILD_ID/server.js, DB container/volume/storage и SQL cluster/server/database identity. Runtime/URL/storage/срок proof и реальная current database/public schema/effective+session user/cluster OID/address/port проверяются через существующий writer lifecycle; любой отказ закрывает запуск. Proof и его значения не генерируются импортером. Реальный production запуск остаётся NOT_RUN до ручной staging-проверки владельцем и отдельно согласованного выпуска/операции.
- ContractVersion сохраняет byte-exact DOCX и честные unknown historical settings. Текущие 6 settings records сохраняются отдельно от 7 history entries; history read №186 не зависит от валидности current draft.
- Явно согласованное восстановление missing images задаётся парой `--recovery-map`/`--recovery-root`. Reviewed map привязан к source profile/namespace и точным 1-based item/slot ссылкам; включает SHA, size, MIME, relative hash filename, происхождение LOCAL_FILE/PDF_DCT, SHA исходного файла и evidence, page/object для PDF. Candidate map или неподтверждённая строка не принимаются.
- Recovery source выполняет настоящий cloud GET для каждого чтения. Только NoSuchKey/NotFound с HTTP404 нормализуется в missing-object; AccessDenied, NoSuchBucket и остальные ошибки не разрешают замену. Если reviewed key появился в облаке, импорт останавливается даже при совпадении байтов. LIST/raw JSON и все остальные R2 bytes проверяются без подмены.
- Runtime recovery-root не попадает в manifest. Каждое локальное чтение проверяет границу каталога и его предков, запрещает symlink/junction, читает ограниченный размер, сверяет SHA/size/MIME и стабильность открытого файла. Байты не перекодируются. Map и происхождение включены в manifest hash, document receipt и immutable IMPORT snapshot; raw JSON сохраняет исходный missing URL. Отсутствующий original не выдумывается.
- Перед reserve и перед publish повторно читаются реальные cloud источники и локальные копии. Сетевая работа выполняется вне SQL с действующими guards/lease. IMPORT snapshot отмечает `sourceStateOnly:true` и `issuedPdfAvailable:false`: без исходного PDF нет успешного выпуска PDF.
- Явное восстановление незавершённого reserve разделяет активного текущего ADMIN и неизменяемого исходного автора reservation. Reviewed hash-only witness фиксирует полный exact manifest-derived SQL scope, исходный reserve, оператора/operation UUID и operational program отдельно от runtime revision. Существующие creators/payload/fingerprint/binding не переписываются; допускаются только FAILED либо просроченные PROCESSING upload jobs, PENDING future cleanup без progress/retirement и неопубликованное полное семейство без refs. Проверенные ранее объекты подтверждаются GET/SHA; остальные используют прежний conditional Put/readback. Два точных append-only recovery audit IDs принадлежат новому оператору; финальная публикация остаётся одной транзакцией. Обычный import ADMIN/DIRECTOR не расширяется, старые HOLD не сбрасываются, исходный actor/ключи не активируются.
- Полные проверки источника до reserve и перед publish используют не более четырёх одновременных чтений с общим бюджетом128MiB ожидаемых payload. Каждый положительный safe-integer размер ограничен sourceLimit и становится жёстким stream limit; временные chunks/concat могут занимать до двойного payload budget. Первая ошибка прекращает выдачу новых чтений, уже начатые завершаются перед возвратом ошибки. Авторизация и lease-проверки одного pg client последовательны, их количество не сокращается. Сетевые соединения переиспользуются только внутри source instance/area/точной конфигурации и закрываются в CLI finally. Для ранее verified объектов пропускается лишь дополнительный промежуточный source GET: target GET/SHA и оба полных чтения источника обязательны, кеша данных нет.

## Risks / Trade-offs

- В source нет части исторических фактов → confidence source/IDderived/unknown и explicit review вместо домыслов.
- Ошибка после upload → ledger/cleanup quarantine сохраняются, повтор сверяет bytes; source R2 не изменяется.
- Просроченные изображения → expiresAt от исходного CP createdAt; TTL не продлевается, №188 не запускает annual cleanup незавершённого archive reserve.

## Migration Plan

Новые таблицы не требуются; нужны обычные зависимости №180/183/185/186/187/188. Импорт сначала dry-run и сверка, затем отдельный apply reviewed manifest в разрешённую цель, повтор и приёмка. Старый R2 сохраняется, feature flag включается отдельно после сквозной проверки API/skill/MCP.

## Нормализация по решению владельца 26.10.2026

- API/DTO, UI, договоры, изображения и общие серверные операции больше не используют `isArchive` как режим или разрешение. Исторический столбец допустимо сохранить с false для совместимости с уже применёнными миграциями и откатом образа; новых схемных миграций не требуется.
- Все 23 перенесённых номера проверены read-only: каждому соответствует один существующий Project, конфликтов привязки к другому КП нет. Операция связывает только CommercialProposal/ProposalItem и фиксирует собственный audit receipt; не вызывает saveProposalInTransaction, pricing/media hooks, изменение этапов или генерацию документов.
- Проекты блокируются в одном порядке, проверяются целевые ID, номера, ревизии/хэши состояния и принадлежность существующих изделий. Связь Product допускается только для точного уникального действующего номера `<номер проекта>.<позиция>`; прочие позиции остаются без productId до явного обычного сохранения. Новые Product при нормализации не создаются.
- Состояние КП, исходные createdAt/updatedAt, revision, media/artifact keys и hashes, версии и договоры сохраняются. Транзакционный контроль подтверждает отсутствие изменений в существующих Project/Product/Client и финансовых фактах. Повтор operationId возвращает прежний результат.
- Hydration редактора не сохраняет КП. Первый отсутствующий курс запрашивается только при явном действии пользователя; режим диалога курса доступен и без ранее фиксированного курса. Обычное сохранение не меняет уже фиксированный курс.
- Старые sourceId, IMPORT snapshots и append-only import receipts сохраняются. Published replay сверяет неизменяемое происхождение и принадлежность импортированных объектов, а не требует неизменности редактируемого текущего КП/настроек. Удалённые/переставленные позиции, разрешённая очистка старых версий и изменённые настройки не должны восстанавливаться повторным импортом.
- Годовой срок и точные незавершённые import/quarantine intents №188 не меняются. Названия старых receipt/job kinds остаются читаемыми для истории, без пользовательского архивного режима.
- При обычном сохранении независимая копия изображения изделия принимает два точных формата исходного optimized key: обычный `<mediaId>.<ext>` и импортированный `<mediaId>_<sha256>.<ext>`. Второй формат связывается с proposalId, mediaId, контрольной суммой и MIME источника. Проверка стандартной загрузки не ослабляется; исходные объекты, байты и история импорта не переписываются.
- Дополнительное уточнение владельца 26.10.2026 отменяет выбор CRM-категорий в редакторе услуг. Подписи, цены и печатная разбивка сохраняются. При отсутствии полного корректного служебного сопоставления вся сумма услуг после скидки и пересчёта передаётся в `servicesTotal`, три поля разбивки очищаются. Полные существующие сопоставления сохраняют прежний расчёт; названия не используются для угадывания категории. Сумма учитывается ровно один раз.
- Исправленный state не блокируется старым отклонённым PUT. Только для существующего КП однозначный HTTP400 с разрешённым кодом проверки освобождает pending-save; неоднозначные сетевые ответы/timeout/5xx сохраняют исходные body/operationId для точного повтора. Общий `KP_VALIDATION`, create/export/restore и договоры не получают ослабления.

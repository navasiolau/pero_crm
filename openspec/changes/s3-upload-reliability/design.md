# Design

## Context

route.ts пишет storage до File, ordinary audit выполняется отдельно, notify может бросить после commit. lib/s3.ts выбирает FS при неполной env. Прежняя hosted QA подтверждала seven files в stage MinIO, но не причину текущего сбоя.

## Goals / Non-Goals

**Goals:** безопасный server DTO, атомарный receipt без схемы, строгий выбор storage, сохранённые ACL/CAS и байты; fresh upload выбор в текущем UI контексте без recovery controls.
**Non-Goals:** изменение безопасной диагностики задачи48, S3/Proxmox инфраструктура, migration, production, изменение assignment/delete lifecycle каталога.

Уточнение scope 03.10.2026 включает upload UI в эту hotfix: диагностика задачи48 остаётся, recovery controls и stale context gate удаляются. Каталог ограничен upload recovery; assignment/delete lifecycle не меняются.

## Decisions

- CRM_FILE_STORAGE обязателен. S3 endpoint http/https без credentials/query/hash, bucket валиден, обе credentials nonblank. local принимает пустые placeholders, но отвергает nonblank S3 env, чтобы исключить неожиданное смешение. Server compose явно задаёт s3, local .env.example — local с пустыми S3 полями.
- Использовать существующий task transaction/advisory lock; receipt ChangeLog `file-upload:<UUID>` с actor/fingerprint. File create и create audit/receipt одна транзакция; текущий audit create сохранён для истории и QA.
- Повтор до storage проверяет receipt; callback после storage повторяет проверку под lock для concurrent requests. Проигравший компенсирует только свои новые random storedName ключи.
- Fingerprint включает raw bytes hash и существующий upload context, name/MIME/category/stage. Публичный DTO не раскрывает fingerprint.
- Верхняя граница route преобразует исключения в закрытый JSON. Ошибка commit неизвестна: commitState=unknown; серверный replay исходного UUID остаётся идемпотентным, но не требует видимого UI recovery. notify после commit best effort.
- Каждый новый choose/drop/camera выбор вне busy строит fresh запрос из текущей сущности/категории/stage, без сравнения с сохранённым ref прежней попытки. Для первой project-cover загрузки PHOTO и отсутствие optional category согласуются с фактическим текущим cover context; stale attempt не отклоняет выбор до POST. Во время busy повторная отправка/выбор заблокированы.
- Убрать «Проверить прежнюю загрузку», «Повторить…» и аналогичные видимые recovery действия во всех upload компонентах. Не переносить эти действия в скрытый автоматический повтор. Новый осознанный выбор не выдаётся за завершение старой попытки; unknown/malformed ACK показывает truthful error/technical copy, без success/pointer update.
- Server ACL, validation, idempotency fingerprint/receipt, cover/sketch CAS и исходные байты не ослабляются. Прежние client explicit-retry требования related48/53 уточнены владельцем; server same-CID replay остаётся.

## Risks / Trade-offs

- Внешнее storage не часть SQL transaction → точная компенсация; отсутствие receipt не выдаётся за доказательство отсутствия объекта.
- Deployment без explicit mode остановится → Root задаёт stage s3/local local перед фактической QA.
- Нет автоматического распознавания текущего root cause → reviewed readonly metadata/server request correlation отдельно.
- Фактический non-JSON500 исследуется по конкретному request/raw response и bounded server logs. Причина первоначально UNKNOWN; actual small PNG 20921B/POST21693B доказал, что это не 10MiB. Private runtime stack b704 указывает NextRequest constructor и NextRequestAdapter до app route JSON catch.

## Migration Plan

Нет DB migration. После local проверок Root выполняет обычную интеграцию и actual staging target/health/upload/replay/cleanup; production не выполняется этой задачей.

Регрессионная приёмка требует настоящего rendered file input: первый выбор обложки → browser-generated multipart POST → File/pointer/receipt и оригинал/thumbnail в реальном S3. Проверить fresh выбор после неуспеха и изменения текущей сущности, busy-only lock, отсутствие recovery controls, non-JSON/network/malformed ACK с truthful диагностикой. Handcrafted Node multipart подтверждает endpoint отдельно и не заменяет этот UI сценарий. Cleanup только точного собственного scope и полный original RAW/schema proof выполняет runtime координатор.

## Доказанная pre-handler stream race (04.10.2026)
Actual small rendered upload завершился Next builtin /_error HTML500 без x-request-id. Exact TypeError: Response body object should not be disturbed or locked. Source windows chunk1001 1:5030/22:24781 и upload route 1:3744 подтверждают Request constructor до user POST. Installed Next15.5.20 node middleware finally вызывает body.finalize() без await; finalize ждёт end и только затем заменяет consumed IncomingMessage на сохранённый stream. Pure installed-Next regression воспроизводит ошибку и восстановление21693B после awaited finalize, без network/DB.
Точный /api/files/upload исключён из middleware matcher до clone. Handler сохраняет auth() с текущими active/sessionVersion/roles и до formData проверяет общую operational isolation и union upload-role grants; контекстные Product/Task ACL остаются прежними. Другие API, скачивание /api/files/<id>, вложенные/похожие пути остаются в middleware. Host/allowedOrigins/CSRF/auth конфигурация не меняется; нет широкой exemption и нет изменения25MiB контракта.

# Design

## Context

route.ts пишет storage до File, ordinary audit выполняется отдельно, notify может бросить после commit. lib/s3.ts выбирает FS при неполной env. Прежняя hosted QA подтверждала seven files в stage MinIO, но не причину текущего сбоя.

## Goals / Non-Goals

**Goals:** безопасный server DTO, атомарный receipt без схемы, строгий выбор storage, сохранённые ACL/CAS и байты.
**Non-Goals:** UI задачи48, S3/Proxmox инфраструктура, migration, production, runtime storage writes агента.

## Decisions

- CRM_FILE_STORAGE обязателен. S3 endpoint http/https без credentials/query/hash, bucket валиден, обе credentials nonblank. local принимает пустые placeholders, но отвергает nonblank S3 env, чтобы исключить неожиданное смешение. Server compose явно задаёт s3, local .env.example — local с пустыми S3 полями.
- Использовать существующий task transaction/advisory lock; receipt ChangeLog `file-upload:<UUID>` с actor/fingerprint. File create и create audit/receipt одна транзакция; текущий audit create сохранён для истории и QA.
- Повтор до storage проверяет receipt; callback после storage повторяет проверку под lock для concurrent requests. Проигравший компенсирует только свои новые random storedName ключи.
- Fingerprint включает raw bytes hash и существующий upload context, name/MIME/category/stage. Публичный DTO не раскрывает fingerprint.
- Верхняя граница route преобразует исключения в закрытый JSON. Ошибка commit неизвестна: commitState=unknown, повтор только исходного UUID. notify после commit best effort.

## Risks / Trade-offs

- Внешнее storage не часть SQL transaction → точная компенсация; отсутствие receipt не выдаётся за доказательство отсутствия объекта.
- Deployment без explicit mode остановится → Root задаёт stage s3/local local перед фактической QA.
- Нет автоматического распознавания текущего root cause → reviewed readonly metadata/server request correlation отдельно.

## Migration Plan

Нет DB migration. После local проверок Root выполняет обычную интеграцию и actual staging target/health/upload/replay/cleanup; production не выполняется этой задачей.

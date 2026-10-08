# Design

## Context

См. proposal.md. В baseline уже существуют независимая кнопка замены, точный `expectedSketchFileId`, upload receipt, проверка технического блока и transactional CAS. UI удаления дополнительно ограничен автором; это не условие замены. Схема и публичный API не меняются. Найдена гонка идентичных запросов: оба успевают записать bytes до Product lock, второй получает repeated receipt, но не удаляет свои новые ключи и повторно уведомляет.

## Goals / Non-Goals

**Goals:** подтвердить назначенного ENGINEER и ENGINEER-участника DESIGN по полному пути, чужой и legacy-автор старого изображения, сохранность вложения, stale/retry, неверные FK, реальный staging/S3 и ограниченную очистку QA.

**Non-Goals:** расширение ролей или статусов, удаление старого эскиза при замене, конвертация файлов, миграции, production, seed/reset, дампы, restic.

## Decisions

- RED дополнительной POST-регрессии воспроизвёл retained duplicate keys (0 compensation deletes вместо2). Добавить только repeated compensation и !repeated notification guards в существующем sketch path. Транзакция, ACL и original bytes сохраняются.
- Приёмка staged baseline принадлежит root. Перед записью root читает task harness и подтверждает exact OCI revision, hostname, DB identity/mount/binding, отдельный S3 bucket и idle W07. Используется существующий transport без старого backup gate.
- Фикстуры содержат один помеченный QA-проект/клиент, DESIGN-изделие и QA-акторы. Живые назначения и файлы не изменяются. Через реальные authenticated POST/browser requests manager загружает первый эскиз, engineer заменяет его; pre/post fingerprints, оригинальные bytes, S3 keys и сведения операции остаются приватными.
- Повтор идентичного запроса SHALL вернуть тот же file ID без дополнительного file/receipt/storage write; устаревший baseline, иной contentHash или pointer возвращает conflict. Два конкурентных запроса используют один baseline; успешен ровно один, старые файлы сохраняются.
- Очистка начинается только после распознанных ACK и подписанного ownership checkpoint. Удаляются собственные файлы/точные новые S3 keys и связанные исключительно с QA операции; сравниваются исходные fingerprints. При неизвестном исходе — STOP, сохранение checkpoint и диагностика по точным IDs.

## Risks / Trade-offs

- Зелёные DI-тесты не доказывают deployed image, PostgreSQL, S3 или браузер → отдельные acceptance tasks и evidence не закрываются до фактической проверки.
- Совместная local DB и nightly staging refresh → root serial coordination и действующий W07 lock; субагент не выполняет мутации БД самостоятельно.
- Доставка org-уведомлений в staging → root подтверждает изоляцию внешних побочных действий; QA сохраняет точную область своих уведомлений и audit.
- Незавершённая staging-приёмка прежнего change → новая задача не выдумывает кодовый дефект; по итогам фиксируется работающая текущая реализация.

# Proposal

## Why

Задача137: обычное удаление сначала убирает File, подавляет ошибки storage и лишь затем записывает аудит. Отказ storage или аудита оставляет неизвестный исход без долговечного намерения и безопасного повтора.

## What Changes

- В одной транзакции повторно проверить действующие ACL и точный File, удалить метаданные, сохранить аудит/receipt по clientMutationId и внутренний DomainEvent с точными ключами и storage identity.
- После commit обрабатывать intent через существующую очередь135; сбой оставляет pending. Повтор того же UUID возвращает тот же результат без второго аудита, другой actor/file — conflict.
- Перед физическим удалением проверить identity storage и живые ссылки; local containment/reparse и ENOENT проверять явно. Сохранить обычный S3 DeleteObject без purge версий.
- Клиент обычного FileList удерживает UUID при неизвестном ответе; success завершает одно намерение. Внутренний cleanup не попадает в plugin hooks.

## Capabilities

### New Capabilities

- `durable-file-deletion`: атомарный metadata/audit/intent, безопасная повторяемая физическая очистка выбранного обычного файла.

### Modified Capabilities

Нет: ACL и очередь135 сохраняют исходную политику; новое внутреннее событие использует существующий lease/budget.

## Impact

Обычный delete action, небольшой core/contract/storage executor, внутренний маршрут events/queue135, FileList UUID и два обычных callers, целевые controlled/native проверки. Существующие ChangeLog и DomainEvent достаточны: schema/миграции/исторические строки не меняются. Ручные эскизы/обложки — отдельная задача138, загрузки —139/140. Global worker/settings, restic, dumps, новые БД, main/production не входят в задачу.

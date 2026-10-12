# Spec Delta

## Purpose

Обычное удаление вложения должно атомарно сохранять бизнес-факт и долговечное намерение физической очистки, допускающее безопасный повтор после отказа storage или неизвестного ответа.

## ADDED Requirements

### Requirement: Atomic deletion intent
Система SHALL повторно проверить текущие права на выбранный файл и в одной транзакции сохранить удаление метаданных, единственный аудит/receipt и точное внутреннее намерение storage cleanup.

#### Scenario: Audit or intent failure
- **WHEN** запись аудита или намерения очистки отказывает
- **THEN** метаданные файла остаются; storage не вызывается.

#### Scenario: Current permissions refuse deletion
- **WHEN** файл скрыт, роль/назначение/статус перестали разрешать удаление
- **THEN** метаданные, аудит, intent и storage остаются без изменений.

### Requirement: Idempotent client intent
Система MUST привязать UUID к actor и точному file ID. Повтор того же намерения SHALL вернуть сохранённый результат без второго аудита; несовпадающий actor/file SHALL получить conflict без изменений.

#### Scenario: Unknown response and concurrent retry
- **WHEN** клиент повторяет одинаковый UUID после неизвестного ответа либо одновременно
- **THEN** остаётся одно намерение и один аудит выбранного файла.

### Requirement: Durable storage retry
Система SHALL сохранять pending intent при отказе физического storage и завершать его повторяемо через существующий обработчик после восстановления или рестарта, без повторного бизнес-аудита.

#### Scenario: Storage outage and restarted dispatcher
- **WHEN** storage отказывает после metadata commit, затем новый dispatcher повторяет intent
- **THEN** удаляются только исходные подтверждённые ключи и intent подтверждается после storage ACK.

### Requirement: Exact storage ownership
Система MUST зафиксировать identity storage и точные ключи original/thumbnail. Изменившаяся identity, живая ссылка на file ID/key, traversal или local symlink SHALL остановить физическую очистку без ACK.

#### Scenario: New live reference or changed storage
- **WHEN** после принятия удаления появляется новая привязка к исходному key либо storage переключён
- **THEN** новый файл и соседние keys сохраняются, intent остаётся неподтверждённым.

#### Scenario: Missing local original or unsafe path
- **WHEN** исходный локальный файл уже отсутствует либо путь выходит за root/проходит через symlink
- **THEN** отсутствие считается повторяемым успехом, небезопасный путь отклоняется до удаления.

### Requirement: Internal cleanup compatibility
Система MUST сохранить обычную S3 DeleteObject семантику и отделить intent от пользовательских plugin hooks и внутренних obsolete-sketch правил.

#### Scenario: Versioned ordinary object and plugin registry
- **WHEN** обрабатывается обычный delete intent при versioned S3 или включённом пользовательском hook
- **THEN** применяется прежний DeleteObject без purge версий; пользовательский hook для intent не вызывается.

### Requirement: Retired binding fence
Система MUST сериализовать удаление и все поддерживаемые creators по одной canonical storage binding identity. Сохранённое намерение удаления, включая COMPLETED, SHALL запрещать повторную привязку этого key; malformed либо неподтверждённый intent SHALL приводить к отказу перед созданием File.

#### Scenario: Creator between reference check and remove
- **WHEN** supported creator пытается создать новый File к удаляемому key после reference check, но до физического remove
- **THEN** creator отказывает до File.create и не создаёт dangling binding; новые uploads используют отдельный server UUID key.

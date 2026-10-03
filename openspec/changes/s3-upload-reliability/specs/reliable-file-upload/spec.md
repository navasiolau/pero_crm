## Purpose

Обеспечить загрузку файлов в явно выбранное хранилище с безопасной диагностикой, сохранением исходных байтов и повтором запроса без дублирования файла.

## ADDED Requirements

### Requirement: Explicit storage target
Система SHALL требовать CRM_FILE_STORAGE=s3|local; S3 SHALL проверять endpoint, bucket и credentials до записи. Неполная конфигурация MUST NOT включать FS fallback.

#### Scenario: Partial S3 configuration
- **WHEN** выбрано s3 и отсутствует обязательный параметр
- **THEN** загрузка возвращает безопасный JSON ошибки и не пишет файл/DB

### Requirement: Safe upload response
Все ошибки POST SHALL сохранять error/kind и добавлять code, requestId, details.phase/message и commitState без секретов, endpoint, ключей или raw exception.

#### Scenario: Storage failure
- **WHEN** исходный файл или thumbnail не записан
- **THEN** ответ различает соответствующую phase и не выдаёт успех

### Requirement: Idempotent original bytes
Обычная загрузка SHALL требовать clientMutationId UUID, атомарно сохранять File и audit receipt, связывающий actor, context и SHA256 исходных байтов. Повтор идентичного запроса SHALL возвращать сохранённый id; другой payload с тем же UUID SHALL возвращать conflict. Ошибка позднего уведомления MUST NOT превращать сохранённую загрузку в неуспех.

#### Scenario: Lost acknowledgement
- **WHEN** тот же actor повторяет UUID и исходный payload после commit
- **THEN** ответ содержит тот же file id и repeated=true без второго File

#### Scenario: Changed retry
- **WHEN** UUID повторён с другими байтами или контекстом
- **THEN** ответ conflict и никаких новых записей

#### Scenario: Audit failure
- **WHEN** audit receipt не сохраняется
- **THEN** File транзакция откатывается; исходные и thumbnail ключи компенсируются по точным путям

### Requirement: Fresh selection in current upload context
По прямому решению владельца 03.10.2026 upload UI SHALL принимать каждый новый выбранный файл для текущей сущности вне busy, создавать fresh request и MUST NOT блокировать выбор сохранённым ref/context прежней попытки. Выбор и отправка SHALL блокироваться только во время busy. Server ACL/validation/idempotency/receipt/CAS SHALL сохраняться. Каталог SHALL менять только upload recovery, не assignment/delete lifecycle.

#### Scenario: First project cover selection
- **WHEN** менеджер впервые выбирает изображение через rendered picker пустой обложки текущего проекта
- **THEN** клиент отправляет browser POST; различие PHOTO и optional undefined category MUST NOT отклонять корректный текущий cover context до запроса

#### Scenario: New selection after failure or context change
- **WHEN** предыдущая попытка закончилась ошибкой или неизвестным ACK и пользователь вне busy выбирает файл для текущей сущности
- **THEN** новый запрос использует текущую сущность и fresh UUID, без stale-ref context gate; прежняя попытка не объявляется успешной

### Requirement: Upload UI without recovery controls
Все upload UI SHALL не показывать «Проверить прежнюю загрузку», «Повторить…» и эквивалентные recovery действия. Friendly error и безопасные копируемые technical details SHALL сохраняться. Unknown/malformed/non-JSON ACK MUST NOT давать success или менять pointer. Система MUST NOT подменять удалённые controls скрытым автоматическим повтором. Это решение уточняет прежнее client explicit-retry поведение задач48/53; server same-CID replay не меняется.

#### Scenario: Unknown response
- **WHEN** browser upload возвращает non-JSON500, network failure или неизвестный ACK
- **THEN** интерфейс показывает truthful failure/unknown result и безопасную диагностику, без ложного успеха и recovery controls; причина500 остаётся UNKNOWN до проверки raw response/logs

### Requirement: Rendered browser and real S3 acceptance
Регрессионная приёмка SHALL пройти rendered file picker → фактический browser POST → настоящее staging S3 с проверкой File/pointer/receipt, SHA исходного файла и thumbnail, затем exact owned cleanup/full RAW equality. Handcrafted Node multipart MUST NOT заменять эту проверку.

#### Scenario: Actual first cover upload
- **WHEN** развёрнута проверяемая ревизия и первый файл выбран в реальном UI
- **THEN** browser request сохраняет разрешённую обложку в реальном S3, UI показывает подтверждённый результат; receipts различают endpoint-only и rendered-browser доказательства

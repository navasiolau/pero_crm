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

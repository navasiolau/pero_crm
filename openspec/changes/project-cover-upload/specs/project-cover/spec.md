## Purpose
Самостоятельная обложка проекта обеспечивает изображение заказа независимо от эскизов изделий, с проверенными правами и сохранением исходных файлов.
## ADDED Requirements
### Requirement: Independent project cover
Project SHALL иметь nullable unique coverFileId на File; обложка SHALL быть изображением этого проекта без Product/Task. Migration MUST NOT изменять существующие данные или назначать обложки.
#### Scenario: Existing project
- **WHEN** применяется nullable schema
- **THEN** существующий проект остаётся без обложки, исторические файлы неизменны
### Requirement: Closed manager upload
Только MANAGER_ROLES SHALL загрузить обложку при истинном expectedCoverFileId=null с UUID. Смешанный upload target MUST отвергаться до чтения байтов/storage. File/pointer/audit/receipt SHALL сохраняться атомарно; повтор SHALL вернуть тот же id, другой payload — conflict.
#### Scenario: Concurrent cover
- **WHEN** обложку уже назначил другой запрос
- **THEN** новый запрос возвращает conflict и не заменяет pointer
### Requirement: Exact cover deletion
Удаление SHALL проверять текущий coverFileId, actor и UUID; stale confirm MUST NOT удалить прежний или новый файл. Atomic pointer/File/audit SHALL возвращать точные storage intents без расширения general file ACL.
#### Scenario: Stale confirmation
- **WHEN** ожидаемый файл не совпадает с текущим
- **THEN** ни один файл не удалён
### Requirement: Project cover interaction
Обложка SHALL находиться рядом с данными проекта без sticky; пустая область SHALL принимать file choose/drop и black-white action. Filled image SHALL открывать оригинал fullscreen, delete SHALL показывать red trash с confirm. Неизвестный ACK SHALL сохранять исходный UUID и файл для явного повтора.
#### Scenario: Readonly actor
- **WHEN** проект читается инженером
- **THEN** доступная по file ACL обложка отображается без upload/delete controls

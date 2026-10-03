# Proposal
## Why
Основной план56 требует удалить проект из работы вместе с изделиями, сохраняя данные, файлы, финансовую историю и номера. Foundation54 и Product delete55 дают tombstone и согласованную transaction границу.
## What Changes
- Manager-only атомарные Project и live Product tombstones; прежние индивидуальные удаления неизменны.
- Typed CAS проекта и набора изделий, UUID receipt/replay; любой активный project timer блокирует действие без остановки/начисления.
- Красная урна «Удалить» и точное предупреждение владельца в shared confirm.
## Capabilities
### New Capabilities
- `project-soft-delete`: сохранённая история проекта и всех изделий при скрытии из работы.
### Modified Capabilities
Нет.
## Impact
Project core/contracts/actions/UI, focused tests и private native BUILDONLY. Schema54/filter54/Finance history59/номера переиспользуются без изменения. Root runtime/Git/deploy, без БД/storage действий агента.

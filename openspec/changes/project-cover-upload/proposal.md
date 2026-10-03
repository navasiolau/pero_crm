# Proposal
## Why
Проект не имеет собственной обложки. Использовать эскиз одного изделия как обложку заказа нельзя: это разные сущности и права.
## What Changes
- Nullable unique Project.coverFileId с File FK SetNull, без переноса исторических файлов.
- Manager-only upload/delete с expectedCoverFileId, UUID и atomic audit receipt, исходными байтами.
- Статичная обложка рядом с данными проекта: empty choose/drop, black button, red trash confirmation, fullscreen оригинал.
## Capabilities
### New Capabilities
- `project-cover`: самостоятельная обложка заказа с безопасным CAS и повтором.
### Modified Capabilities
Нет.
## Impact
Project/File schema и миграция20261003040000_project_cover; project core/contracts/projection/Overview, новый закрытый upload target. Продуктовый layout, camera, finance и file ACL не расширяются. Root применяет DB/deploy/actualQA.

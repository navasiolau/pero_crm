# Proposal
## Why
Global Products thumbnail открывает fullscreen вместо карточки, хотя название/строка ведут в Product. Требуется единая навигация с безопасным return context51.
## What Changes
- Global kanban явно передаёт navigate coverAction с тем же onOpen.
- Drag guard остаётся общим, изображение не открывает fullscreen во время/после drag.
- Existing ProjectProducts navigate и fullscreen detail/files не меняются.
## Capabilities
### New Capabilities
- `product-thumbnail-navigation`: global thumbnail открывает карточку изделия.
### Modified Capabilities
Нет.
## Impact
Один global kanban consumer sharedProductKanbanCard и целевые callback tests. Без визуального layout/day/amount изменения, новых dependencies, данных или API.

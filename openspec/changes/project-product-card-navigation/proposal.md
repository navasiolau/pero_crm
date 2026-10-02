# Proposal

## Why

Во вкладке «Изделия» проекта пользователь ожидает переход в изделие при нажатии на его обложку, как при нажатии на название. Номера карточек проектов и изделий нужно сделать заметнее, сохранив остальные подписи и поведение общего канбана.

## What Changes

- В Project → Изделия клик по обложке использует существующий переход в изделие и не открывает fullscreen.
- Shared ProductKanbanCard получает явную контекстную политику; без неё изображение открывается fullscreen как прежде.
- Номера изделий/проектов на канбан-карточках, recent projects и мобильных карточках таблиц увеличиваются на 25% и становятся жирными.
- Названия, labels, drag/open/status/ACL сохраняют текущие правила.

## Capabilities

### New Capabilities

- `project-product-card-navigation`: контекстная навигация обложки изделия и выделение номеров карточек.

### Modified Capabilities

Нет.

## Impact

ProductKanbanCard, Project ProductsTab, project kanban/recent-projects, только number spans мобильных project/product tablecards; небольшой UI helper и focused tests. Без новых зависимостей, миграций, серверных writers и финансовых изменений.

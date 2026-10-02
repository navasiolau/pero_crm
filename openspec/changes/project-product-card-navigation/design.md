# Design

## Context

Shared ProductKanbanCard открывает viewer по кнопке обложки и останавливает bubbling. ProductsTab проекта и общий ProductsKanban оборачивают карточку общим onOpen; drag запускается отдельным DragHandle. Номера kanban/recent имеют 14px baseline, mobile number labels — 12px.

## Goals / Non-Goals

**Goals:** явная политика обложки только для контекста проекта, однократный shared onOpen и увеличение только номера на 25%.
**Non-Goals:** изменение viewer/загрузок/thumbnail, деталей изделия, настройки, статусов, DnD, ACL и серверных обработчиков.

## Decisions

- Discriminated cover policy: default fullscreen; navigate требует callback существующего onOpen. Кнопка остаётся нативной/keyboard-accessible, блокируется у drag overlay и предотвращает двойной родительский click.
- Project ProductsTab передаёт navigate с тем же onOpen(product). Общий канбан ничего не передаёт.
- Pure CardNumber использует 1.25em/font-bold; baseline задаёт существующий text-sm либо text-xs контейнер. Для mobile номер выделяется внутри прежнего label, не увеличивая слово «Проект/Изделие» или название.
- Focused tests проверяют callback policy, отсутствие fullscreen в project policy, SSR button/drag и точечную типографику; реальная browser/staging приёмка остаётся у root.

## Risks / Trade-offs

- [Двойной onOpen от bubbling] → существующие preventDefault/stopPropagation сохраняются.
- [Рост номера влияет на drag handle/длинные строки] → прежние gap/pr-10, break-all/min-width сохраняются; названия не наследуют новую font-size.

## Migration Plan

Без миграций. Strict OpenSpec до кода; focused RED→GREEN, TypeScript/lint. Root выполняет GitFlow и общий browser/staging после остальных задач round2. Субагент не запускает runtime/DB/browser и не меняет Git.

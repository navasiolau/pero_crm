# Design

## Context

ProductKanbanCard измеряет информационный блок и задаёт фото2×/карточку3× его высоты. ProjectKanbanCard использует aspect4/3. Оба рисуют object-contain внутри абсолютного фиксированного контейнера.

## Goals / Non-Goals

**Goals:** высота по intrinsic ratio и сохранение изображений целиком.
**Non-Goals:** изменение подробных страниц, файловых preview/API, dnd/navigation/fullscreen.

## Decisions

- Удалить ResizeObserver/infoHeight/style-height только из ProductKanbanCard.
- Кнопки фото — обычные block-контейнеры на всю ширину; img — block/w-full/h-auto без p-2 и абсолютного позиционирования.
- Общий ProductHeroImage продолжает обслуживать подробные страницы с прежними переданными классами. Error fallback остаётся естественной компактной высоты.
- Проверять настоящие компоненты и CSS в браузере с PNG трёх пропорций, delayed/cached/error и кликами/dragging.

## Risks / Trade-offs

До lazy-load высота определяется известным содержимым → проверить загрузку/кеш/изменение ширины и dnd после загрузки. Миграция не нужна.

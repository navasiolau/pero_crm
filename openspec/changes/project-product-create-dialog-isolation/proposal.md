# Proposal

## Why

Шесть черновиков создания изделия находятся в ProductsTab рядом с миниканбаном. Каждый символ повторно исполняет группировку, DnD hooks, колонки и карточки, хотя список изделий не меняется.

## What Changes

- Выделить постоянно смонтированный CreateProductDialog с локальными title/kind/quantity/price/description/engineerId, прежней валидацией и create pending.
- ProductsTab сохраняет controlled open, status/DnD transition и подтверждённый onCreated → router.refresh. Submit busy объединяет внешний status pending и локальный create pending.
- Перенести прежние JSX, ids, classes, labels, defaults, payload, action и toast без изменения UI, доступа, валюты и количества.
- Сохранить reset paths: footer cancel закрывает без сброса; X/Escape сбрасывают все6 полей; success сбрасывает5 и сохраняет engineerId. Поздние ответы продолжают прежнее поведение.

## Capabilities

### New Capabilities

Нет.

### Modified Capabilities

Нет изменений требований. skip_specs true для чистого выделения исполнения; product-quantity, navigation, engineer access и server policy сохраняются.

## Impact

Production scope: apps/web/src/app/(app)/projects/[id]/products-tab.tsx и новый create-product-dialog.tsx. Ветка bugfix/143 создана от d121, затем обычным fast-forward обновлена до принятого staging c6508448450813450b5dbb6a67d77494c37f6cdb. Server/CSS/schema/dependencies не меняются.

Измеримый результат:0 вызовов неизменившихся ProductsTab/StatusColumn/DraggableProduct/ProductKanbanCard при реальном вводе названия/описания/цены/количества и после idle. Ошибка сохраняет ввод; успешное создание вызывает1 action и1 подтверждённый refresh.

Существующий BEFORE400keys/6PNG082bd остаётся привязан к d121. Root согласовал небольшое сравнение текущего c650 before/after: реальные компоненты,20 карточек, точный RGBA/geometry и lifecycle вместо повторного inventory/профилирующего framework. Общий итог задержек141 оценивается на доступномПК по прямому решению владельца; конкретный iMac не проверяется и его аппаратная причина не заявляется.

Независимый review, local checks, обычная root integration и реальная staging-приёмка обязательны. Main/production запрещены. SAFETY-RULES D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP при guard mismatch. Restic/dumps/seed/reset/newDB не используются.

# Proposal

## Why

Перенос КП склеивает материалы, размеры и примечания в Product.description. Владелец согласовал JSON и компактный список с независимым автосохранением разделов и прежней полной синхронизацией из КП.

## What Changes

- Nullable JSONB technicalSpecifications без backfill; прежний description сохраняется дословно.
- Общий каталог разделов, расширяемые строки, порядок конструкция → фурнитура → подсветка → наполнение.
- Карточка и ручное создание изделия используют структурированный редактор; CAS, аудит, повторы и ACL сохраняются.
- Старые КП проецируются в JSON изделия при обычном save/restore, без изменения формата state КП.
- Новое поведение заменяет ограничение на единственное текстовое поле из исторического change product-description-textarea; текстовые гарантии остаются для legacy.

## Capabilities

### New Capabilities
- `product-technical-specifications`: структура, отображение, редактирование и совместимый перенос характеристик изделия.

### Modified Capabilities
Нет соответствующей основной спецификации; прежнее поведение описано в historical change product-description-textarea.

## Impact

Prisma, product actions/projections/UI, синхронизация КП, общий модуль @pero/kp-template и тесты. Одна additive migration. Ветка feature/214; реализация и staging-публикация прямо разрешены владельцем 11.11.2026. Production вне поручения.

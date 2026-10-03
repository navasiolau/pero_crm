# Proposal
## Why
Product всегда возвращает в родительский Project/Общее, даже при открытии из global Products. Требуется возврат в исходный список с его состоянием и в Project/Изделия.
## What Changes
- Явный проверяемый returnTo в Product links из Project и global Products.
- Back и успешное удаление Product используют один безопасный адрес возврата.
- Project читает разрешённый URL tab, обычный вход сохраняет default Общее.
- Канонический query списка читается без новых preference writes.
## Capabilities
### New Capabilities
- `contextual-product-return`: контекстный безопасный возврат карточки изделия.
### Modified Capabilities
Нет.
## Impact
Nav helpers/Product page+Header/ProjectTabs/list links. Без новой авторизации, истории данных, dependencies или visual card changes. Fullscreen thumbnail52 отдельно.

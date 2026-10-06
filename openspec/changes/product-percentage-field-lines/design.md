# Design: field-lines

## Решение

1. `server/product-percentage-pay/queries.ts`: `fieldTotal = ownMember ? ownMember.amount : null` (убрать fallback на `draftTotal` для поля; менеджерам `total` как раньше).
2. `product-percentage-panel.tsx`: новый `FieldPercentageLines` — три строки по `percentageRecipientLabel(kind)`: «Роль: имя», при `ownMember` в той же строке «Оплата: <formatAmount>». `ProductPercentagePanel` при `!canViewAll` рендерит его вместо карточек `SinglePercentageRow`; путь `canViewAll` (менеджеры, снабжение) untouched.
3. Тесты: обновить прогноз-для-поля на null; добавить рендер панели поля (своя оплата есть, чужой нет, `%`/селектов нет).

## Риски

- Отмена прогноза для поля — осознанное решение владельца (06.10.2026), зафиксировано здесь и имеет приоритет над сценарием `product-percentage-visibility` «DRAFT без назначенного для поля».
- `formatAmount` уже используется панелью; строки наследуют валюту секции.

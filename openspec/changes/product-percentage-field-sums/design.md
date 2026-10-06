# Design: field-sums

## Решение

1. `server/product-percentage-pay/queries.ts` (`getProductPercentageView`): вычислять `fieldTotal` для не-`financeView`:
   `ownMember ? ownMember.amount : (assignee ? null : draftTotal)`.
   `total` секции: `financeView ? (settled ?? draftTotal) : fieldTotal`.
   Дополнительно убрать устаревший комментарий про зависимость от `feature/81` (уже вмержена).
2. `app/(app)/products/[id]/product-percentage-panel.tsx`: `displaySum` для `!canViewAll` — `ownAmount ?? (section.assignee ? null : section.total)` (оборона в глубину, сервер уже режет).
3. Регрессионный тест: поле видит свою и прогноз, но не чужую (расширить `product-percentage-visibility.test.ts` кейсом двух назначенных).

## Риски

- С settled-этапами поле без членства увидит «—» вместо чужого итога — так и задумано (итоги прошлого видны менеджерам/зарплате).
- Прогноз для поля считается только при `rate+price` и валюте BYN — как раньше.

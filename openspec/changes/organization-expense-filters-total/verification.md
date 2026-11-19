# Проверка №239

- `pnpm install --frozen-lockfile`, `pnpm db:generate`, `pnpm build` — PASS. Сборка сообщает существующие предупреждения в `product-attachments.tsx` и `product-percentage-pay/core.ts`.
- `tsc --noEmit`, ESLint изменённых файлов и `openspec validate organization-expense-filters-total --strict` — PASS.
- Тесты `organization-expense-filters`, `list-state`, `list-state-controller`, `default-cash-account` — 39/39 PASS. Проверены условия AND/OR, границы московского дня, точный Decimal, guard, 101 совпадение, нулевой итог и URL.
- Chromium `organization-expense-browser.test.mjs` — 1/1 PASS с локальными синтетическими данными и подменённым транспортом. Проверены десктоп 1440 px и мобильный экран 390 px, ID, выбор двух касс и одной статьи, сохранение после повторного открытия, 101 строка в режиме «Все» и возврат к 100.
- Проверка с настоящими сессиями, PostgreSQL, архивными связями, документами и ролями остаётся на staging. Специальных миграций нет.

## Контракт для приёмки staging

- `/finance/expenses`: ключ настроек `organizationExpenses.list`, явный URL имеет приоритет. Проверить второго сотрудника, возврат через меню, фильтры после повторного входа и сброс в полный реестр.
- Проверить проекты в архиве, выключенную кассу/статью, общий расход и закупку, текущую и отменённую логистику, разные валюты, расход с несколькими или отсутствующими документами. Сумма совпадает с сохранёнными эквивалентами BYN и меняется вместе с поиском. В режиме «Все» совпадает с суммой числового режима.
- Для интеграции чека обновить предикат документов в `organization-expense-query.ts` синхронно с проекцией строки. Клиентские действия подставляются через `renderDetailActions(row, close)` в `OrganizationPaymentsView` из `OrganizationExpenseResults`.

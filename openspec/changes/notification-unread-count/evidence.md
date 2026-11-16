# Проверки №231

## Local

База worktree — `8dac03047a543029921a17dddab1cc457e945113`, ветка `bugfix/231`. Изменены две строки `notifications-bell.tsx`: порог 99 и размер badge по содержимому. `getBellData()` уже использует полный `notification.count`; серверные выборки, права, polling и действия чтения не менялись.

Private браузерный harness `.playwright-mcp/231/bell-boundaries.mjs` собирает настоящий `NotificationsBell`, Base UI Menu/Button и CSS приложения; заменены только notification transport и навигация. Сервер раздаёт исключительно GET собственного localhost fixture, БД не используется. Вводимое число является синтетическим компонентным значением, не фактическим состоянием staging.

- RED на прежнем коде: `.playwright-mcp/231/red/failure.json` — при unread=10 ожидалось «10», отрисовано «9+».
- GREEN: `.playwright-mcp/231/green-geometry/receipt.json` — **10/10** проверок на 1440×900 и 390×844: значения 9/10/99/100 дают «9»/«10»/«99»/«99+», возврат к нулю скрывает badge; ноль при первом mount также проверен. Обновления выполнялись обычным открытием колокольчика через настоящий refresh.
- Две цифры и «99+» помещаются в badge; текст не переносится, badge находится в пределах страницы и до следующей кнопки. Ширина «99+»: около 25 px на десктопе, 35 px на телефоне. Ошибок страницы и вызовов записи — 0.
- Worker лично просмотрел `bell-1440-100.png` и `bell-390-100.png` из `green-geometry`; закрытие Menu дожидается удаления popup до снимка. Предварительный `green` также проходил, но финальная геометрия и снимки относятся к `green-geometry` с явно заданной высотой fixture-шапки.
- `pnpm --filter @pero/web exec tsx --test tests/calendar-reminder-visibility.test.ts tests/auth-security.test.ts`: **6/6 PASS**.
- `pnpm --filter @pero/web exec tsc --noEmit --incremental false`: PASS.
- Scoped ESLint, `openspec validate notification-unread-count --strict`, `git diff --check`: PASS.

Dependencies установлены `pnpm install --offline --frozen-lockfile`, Prisma Client сгенерирован без подключения к БД; lockfile и версии не менялись. Новые экспортируемые helpers, CI cohort и постоянные тесты для двухстрочной обратимой UI-правки не добавлялись по согласованию с root.

## Staging

PENDING: root проверяет точный развёрнутый SHA/образ/health после штатного CI и фактическое число в шапке. Root исходный staging browser receipt показывает unread=20 при прежнем «9+»; это исходное состояние, не приёмка исправления. Значения 99/100 проверены компонентным transport и не приписываются реальным уведомлениям пользователя.

Root одобрил локальный cut и разрешил commit только компонента и этого OpenSpec. Push, DB/runtime staging и инфраструктурные действия worker не выполняет; публикация и фактическая staging-приёмка остаются у root. Production/main не изменялись.

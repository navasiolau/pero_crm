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

Root принял №231 на фактически развёрнутом `ad2cd677d94bf866159d5081a44840be5a661dc3`. Штатный [CI 43934361664](https://github.com/navasiolau/pero_crm/actions/runs/43934361664) завершился **7/7 SUCCESS**. Web image `sha256:bbae648a85d256a152998920002c6f8bf7e1100e7df53464a31ec47537ec1c69`, renderer image `sha256:fc32f41cbd7d34599a37625661574b0605b6931780d16bd18787a92befead352`: оба healthy, HTTP health=200. Идентичность существующей БД и защита W07 сохранены.

Фактический browser receipt root: `D:/Projects/pero_crm_v2/.playwright-mcp/ui-229-232/functional-desktop-retry/receipt.json`, SHA-256 `63aaf65c9b8d28d316980a0afe4640929c1c38485d5d8e0ad581bf508e9c2329`. Worker перечитал receipt: `status=PASS`, revision совпадает, `results.bell.actualUnread=20`, `results.bell.text="20"`, `errors=[]`. Root лично просмотрел снимок шапки со свёрнутым меню. Исходный staging показывал те же 20 как «9+»; после исправления отображается реальное число **20** без создания уведомлений в БД.

Границы 99/100 и мобильная геометрия badge подтверждены только контролируемым локальным компонентным transport из раздела Local; реальные уведомления пользователя этими значениями не подменялись. Эта запись не объявляет завершённой общую мобильную приёмку соседних задач.

Первый desktop-прогон сохранил React418 на странице изделия и оставлен как неуспешный результат. Свежий повтор прошёл все сценарии с нулём ошибок страницы; между этими попытками приложение не исправлялось, ошибки не игнорировались. Причина React418 этими материалами не устанавливается.

Ранее публикацию ограничивала квота GitHub Actions; после перевода репозитория владельцем в public root подтвердил его фактический статус и выполнил новый штатный успешный CI. Ограничение квоты не выдаётся за дефект счётчика или успешную staging-приёмку прежнего запуска.

Root одобрил локальный cut и разрешил commit только компонента и этого OpenSpec; результат реализован в `e355b02912fa63f8bedc7e76973663f239a868b2`. Финальная запись приёмки — отдельное изменение только документации по указанным фактическим доказательствам. Push, DB/runtime staging и инфраструктурные действия worker не выполнял; публикацию и приёмку выполняет root. Production/main не изменялись в рамках №231.

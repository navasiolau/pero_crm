# Проверки №232

Ветка `bugfix/232`, worktree `D:/Projects/pero_crm_worktrees/ui-sidebar-232`, база свежего `origin/staging` — `8dac03047a543029921a17dddab1cc457e945113`. Код затрагивает три компонента: `app-sidebar.tsx`, `nav-main.tsx`, `ui/sidebar.tsx`.

## Локальное воспроизведение и исправление

На прежнем коде actual-компоненты с текущим Tailwind CSS измерены в Chromium 1440×900: expanded container/gap=256/256 px; collapsed gap=64 px, container=66 px, наружный padding=8 px. У span PERO CRM оставался видимый участок шириной 8 px. Центр перa=24 px, центр панели=33 px. Это воспроизводит исходный дефект. Root независимо подтвердил те же значения на текущем staging.

После исправления: expanded=256/256 px; collapsed gap/container=48/48 px, наружный padding=0. Перо и все 16 разрешённых ADMIN-иконок имеют центр x=24 px; кнопки по 32 px. Подписи остаются в DOM с доступными именами, но визуально скрыты; верхняя ссылка имеет имя PERO CRM. Вариант floating не изменён.

Actual-компонентный браузерный прогон **PASS**, page errors=0:

- Hover и фокус показывают название «Проекты»; Ctrl+B раскрывает/сворачивает меню, полное название возвращается.
- При высоте 420 px контент прокручивается вертикально; фокус переводится на «Настройки», последний пункт остаётся доступен внутри viewport.
- На 360×800 и 390×844 отсутствует desktop-gap; inset начинается с x=0. Мобильная панель показывает полное название и подписи, последний раздел доступен фокусом/прокруткой.
- Escape, нажатие на overlay и переход через ссылку закрывают мобильную панель. После закрытия нет горизонтального переполнения.

Проверочная обвязка: ignored `.playwright-mcp/sidebar232/browser.mjs`, команды `node .playwright-mcp/sidebar232/browser.mjs baseline` и `... green`. Она использует настоящие AppSidebar/NavMain/Sidebar/Sheet/Tooltip и Tailwind CSS; внешние границы Next Link/pathname заменены локальным history-adapter. Это проверка UI без подключения к БД, не доказательство реальной Next-навигации или фактического deployment. Первый probe ожидал роль tooltip, тогда как Base UI вывел popup с data-slot; ожидание изменено на видимость настоящего popup. Снимки мобильного Sheet сделаны после завершения opacity-перехода.

Лично просмотрены `.playwright-mcp/sidebar232/green/desktop-expanded.png`, `desktop-collapsed.png`, `desktop-short.png`, `mobile-360-open.png`, `mobile-390-open.png`, `mobile-390-closed.png`. Полный receipt — `.playwright-mcp/sidebar232/green/receipt.json`.

## Проверки кода

- `pnpm install --offline --frozen-lockfile`: зависимости установлены; версии и lockfile не менялись.
- `pnpm db:generate`: PASS; только генерация Prisma Client, соединений с БД нет.
- `pnpm --filter @pero/web exec tsc --noEmit --incremental false`: PASS.
- Scoped ESLint для трёх изменённых компонентов: PASS.
- `openspec validate compact-sidebar-rail --strict`, `git diff --check`: PASS.

Отдельных тестов, повторяющих строки CSS, не добавлено: дефект и исправление проверены фактической геометрией и действиями в браузере.

## Staging

Первоначальная локальная передача оставляла staging PENDING; затем код и OpenSpec зафиксированы в `97ea586d2bb9394638994da0726285dd1e2aed14` после review root. Push и интеграцию выполнял root. Локальные результаты выше сохраняются отдельно от фактической приёмки ниже.

### Фактическая приёмка — ACCEPTED

Root подтвердил развёрнутый staging `ad2cd677d94bf866159d5081a44840be5a661dc3` после [штатного CI 43934361664](https://github.com/navasiolau/pero_crm/actions/runs/43934361664), **7/7 SUCCESS**. Web image — `sha256:bbae648a85d256a152998920002c6f8bf7e1100e7df53464a31ec47537ec1c69`, renderer — `sha256:fc32f41cbd7d34599a37625661574b0605b6931780d16bd18787a92befead352`; оба healthy, HTTP health=200. Root подтвердил сохранность существующих DB identity и W07.

Проверены actual CRM-компоненты и навигация на этом staging. Receipts находятся в `D:/Projects/pero_crm_v2/.playwright-mcp/ui-229-232/`:

- `functional-desktop-retry/receipt.json` — **PASS**: collapsed gap и rail по **48 px**, текст логотипа — визуально скрытый span шириной 1 px; root лично просмотрел `global-collapsed.png`.
- `functional-mobile390/receipt.json` и `functional-mobile360-body/receipt.json` — **PASS**: фактическое открытие мобильного меню, закрытие Escape, overlay и переходом в раздел. Ширина document/body совпадает с viewport 390/360 px, горизонтального переполнения нет.
- `functional-menu390-settled/receipt.json` — **PASS**; root лично просмотрел полностью открытое непрозрачное меню. Первые снимки захватывали начало CSS-перехода; проверочная обвязка стала ждать завершения анимации, код приложения не менялся. Финальный снимок 360 px также сделан после ожидания анимации.

Во всех принятых прогонах `errors=[]`. Первый desktop-прогон с React418 на странице изделия сохранён как неуспешный; повтор без изменения кода приложения прошёл. Это не объявляется исправлением отдельного дефекта страницы изделия.

Hover/focus подсказок, Ctrl+B и доступность последнего пункта при высоте 420 px проверены локально, как описано выше; эти отдельные сценарии не приписываются staging receipts, в которых зафиксированы геометрия и реальные desktop/mobile переходы.

Статус №232: **ACCEPTED на `ad2cd677d94bf866159d5081a44840be5a661dc3`**. Эта запись и закрытие пункта 2.2 — docs-only по фактическим доказательствам root. Последующий документационный SHA не подменяет принятый runtime SHA. БД, инфраструктура, production и main в рамках работы worker не изменялись; push worker не выполнял.

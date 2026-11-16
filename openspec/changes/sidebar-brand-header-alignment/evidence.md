# Проверки №234

Ветка `bugfix/234`, worktree `D:/Projects/pero_crm_worktrees/ui-sidebar-alignment-234`, свежая база `origin/staging` — `96efcfc1cbfee70ab9d85e1e3f1a0fca9b911432`. Изменение рабочего кода ограничено двумя классами `app-sidebar.tsx`: высота брендовой кнопки на desktop и верхний отступ брендового header в collapsed-состоянии. Общие Sidebar, SiteHeader, меню ролей и серверный код не менялись.

## Воспроизведение

Actual AppShell/AppSidebar/SiteHeader с текущим Tailwind CSS в локальном Chromium показал на обеих ширинах 1440/1024 px:

| Состояние до изменения | Центр пера | Центр кнопки | Разница |
|---|---:|---:|---:|
| expanded | 40 px | 31,5 px | +8,5 px |
| collapsed | 24 px | 31,5 px | −7,5 px |

Скачок составляет 16 px. Root независимо подтвердил ту же геометрию на фактическом staging `96efcfc1` при expanded/collapsed/reopened. Приватный root receipt: `D:/Projects/pero_crm_v2/.playwright-mcp/sidebar-234/baseline-browser/receipt.json`.

## Локальный GREEN

После изменения на 1440×900 и 1024×900 центр пера равен **32 px в обоих состояниях**, центр фактической кнопки SiteHeader — **31,5 px**, разница **0,5 px**, скачок между состояниями — **0 px**. Переключение кнопкой и Ctrl+B проходит, ширина collapsed rail/gap остаётся 48/48 px, подпись PERO CRM визуально скрыта и доступное имя ссылки сохранено.

На 360×800 и 390×844 мобильная брендовая кнопка сохраняет высоту **48 px**, название видно полностью, desktop-gap отсутствует. Открытие, Escape, overlay и переход по ссылке закрывают Sheet; горизонтального переполнения body/document нет. Browser page errors=0; серверные действия не вызывались.

Приватная обвязка `.playwright-mcp/sidebar234/browser.mjs` выполнялась командами `node .playwright-mcp/sidebar234/browser.mjs baseline` и `... green`. Она использует настоящие AppShell, AppSidebar, SiteHeader, Sheet, Tooltip и CSS; только Next Link/navigation и недостижимые server actions заменены локальными границами. Это локальная UI-проверка без БД, не фактическая staging-приёмка. Receipt: `.playwright-mcp/sidebar234/green/receipt.json`.

Лично просмотрены актуальные PNG: `desktop-1440-expanded.png`, `desktop-1440-collapsed.png`, `desktop-1024-collapsed.png`, `mobile-360-open.png`, `mobile-390-open.png` в `.playwright-mcp/sidebar234/green/`. Мобильные снимки сделаны после завершения opacity-перехода Sheet.

## Проверки кода

- `pnpm install --offline --frozen-lockfile`: PASS, lockfile/версии не менялись.
- `pnpm db:generate`: PASS, только генерация Prisma Client без соединения с БД.
- `pnpm --filter @pero/web exec tsc --noEmit --incremental false`: PASS.
- `pnpm --filter @pero/web exec eslint src/components/app-sidebar.tsx`: PASS.
- `openspec validate sidebar-brand-header-alignment --strict` и `git diff --check`: PASS.

Постоянный CI-тест, повторяющий классы, не добавлялся: проверена реальная геометрия и поведение actual-компонентов. Полный тестовый набор не запускался повторно для двух локальных CSS-классов; штатный CI выполняется при интеграции root.

## Staging

При первоначальной передаче staging оставался PENDING. После локального GREEN и review root код с OpenSpec зафиксирован в `8cb6c67c03f038ec09ad8921e3ca18ecb78b35c7`; push и интеграцию выполнял root. Локальная обвязка выше сохраняется отдельно от фактической приёмки ниже.

### Фактическая приёмка — ACCEPTED

Root подтвердил развёрнутый staging **`ca75430782ce4755691e83829bec5dc414621ad0`** после [штатного CI 43973192470](https://github.com/navasiolau/pero_crm/actions/runs/43973192470), **7/7 SUCCESS**. Web image — `sha256:e0046fa0299131963eeed2dab121446de9ebfa388550bbefbc94ff430d53fd57`; renderer — `sha256:f548aed87017ae3a5237289a1c0d2c5baf5c9f494e7eb85922a3f9451268dbf5`. Оба healthy, HTTP health=200. Root сверил metadata: DB ID, время старта, volume и W07 сохранены.

Приватный receipt `D:/Projects/pero_crm_v2/.playwright-mcp/sidebar-234/functional-browser/receipt.json` лично прочитан worker: **PASS**, revision совпадает, `errors=[]`. Шесть реальных desktop-измерений охватывают 1440/1024 px и expanded/collapsed/reopened после Ctrl+B: центр пера во всех случаях **32 px**, центр кнопки SiteHeader — **31,5 px**, разница **0,5 px**, скачок пера между состояниями — **0 px**. В collapsed rail имеет ширину **48 px**. Root лично просмотрел актуальные PNG 1440 px expanded и collapsed: перо выровнено и сохраняет уровень.

На том же staging в responsive-браузере при 390/360 px брендовая кнопка сохранила высоту **48 px**. Проверены фактическое открытие меню и закрытие Escape, document width=390/360 px, без ошибок браузера и неподтверждённых RPC. Это проверка адаптивного браузерного интерфейса, не физического телефона. Overlay и закрытие при переходе проверены локально; эти сценарии не приписываются данному staging receipt.

Первый запрос root на подготовку readonly-сессии получил обычный W07 `REFRESH_OR_DEPLOY_BUSY`: тело не выполнялось, identity mismatch не было. Поздний разрешённый повтор завершился штатно, guards не обходились.

Статус №234: **ACCEPTED на `ca75430782ce4755691e83829bec5dc414621ad0`**. Закрытие пункта 2.2 и эта запись — только документационные изменения по фактическим доказательствам root; последующий docs-only SHA не подменяет принятый runtime SHA. Записи БД, миграции, инфраструктура и main в рамках задачи не менялись. Push worker не выполнял.

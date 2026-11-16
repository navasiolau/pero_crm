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

PENDING: root принимает штатный CI и фактически развёрнутый SHA/образ/health, повторяет выравнивание и мобильное меню. Локальные проверки выше не заменяют эту приёмку. Push, операции с БД и инфраструктурой worker не выполняет.

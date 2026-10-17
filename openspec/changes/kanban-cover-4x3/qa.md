# QA — №176, 17.10.2026

## Result

Локальная реализация готова к независимому ревью. Изменены только два класса пропорций в общих канбан-карточках; `ProductHeroImage`, детальные страницы и обработчики навигации не менялись. Проверки выполнялись в отдельном worktree `D:/Projects/pero_crm_worktrees/requests-176`, ветка `feature/176`.

## Checks

- `pnpm install --offline --frozen-lockfile` — PASS, lockfile не изменён, скачиваний нет.
- RED: вызов `runProductCardNavigationGate()` из существующего `tests/product-card-navigation-browser.mjs` до замены классов — ожидаемый `DRAG_COVER_4X3_REQUIRED`. Артефакт `.playwright-mcp/kanban176/red.log` сохранён отдельно.
- GREEN: тот же объединённый сценарий — `COMPONENT_RUNTIME_PASS`: реальные компоненты React и Chromium, три исходника 1600×400 / 800×800 / 200×2000, viewport 1440×900 / 390×844 / 360×800. Проверены кадр 4:3, центрированный cover без полей, delayed/error/empty, resize/cache, прежний detail contain, полноэкранный оригинал, четыре навигационных сценария, четыре уничтоженных навигационных мутанта и две мобильные таблицы. Проверка реального PointerSensor подтверждает 4:3 и disabled preview на обеих досках изделий.
- Поиск: `KANBAN_FOCUS_ARTIFACT_DIR=../../.playwright-mcp/kanban176/search-with-cover pnpm --filter @pero/web exec node tests/kanban-search-focus-browser.mjs` — PASS, 38 групп для проектов и изделий. Обложка добавлена именно найденной карточке, поэтому проверяется её новая высота. Подтверждены фокус/каретка/центрирование, stale/pending ответы, DnD, мобильный Sheet, начальный сохранённый поиск, touch/snap и сохранение ручной прокрутки. В PowerShell env задаётся через `$env:KANBAN_FOCUS_ARTIFACT_DIR`.
- Scoped ESLint двух карточек и двух изменённых browser-файлов — PASS.
- Первая типизация после fresh install выявила отсутствие сгенерированного Prisma Client. После `pnpm db:generate` команда `pnpm --filter @pero/web exec tsc --noEmit --incremental false` — PASS. Генерация клиента не соединялась с БД.
- `git diff --check` и `openspec validate kanban-cover-4x3 --strict` — PASS.

## Artifacts

- Receipt обложек: `apps/web/test-results/product-card-navigation/febfe906-d55a-4a0d-8731-1def24400392/receipt.json`; рядом source provenance и шесть скриншотов `covers-{1440,390,360}-{light,dark}.png`.
- Визуально просмотрены 1440 light/dark, 390 dark и 360 light: горизонтальный кадр, заполнение без полей, прежние подписи/бейджи, компактные empty-карточки и заполненная error-область. Числовая геометрия проверена для всех шести вариантов темы/viewport.
- Receipt поиска: `.playwright-mcp/kanban176/search-with-cover/receipt.json`, рядом шесть скриншотов проектов/изделий. Предыдущий успешный прогон без обложки сохранён в `.playwright-mcp/kanban176/search/`.
- Логи команд сохранены в `.playwright-mcp/kanban176/`; все артефакты ignored и относятся только к этому worktree.

## Limits

Независимое ревью оркестратора и отдельного reviewer `review_176` выполнено 17.10.2026: actionable findings нет. Владелец отдельным сообщением разрешил сохранение в ветках и тестирование всех задач на staging; main и production-БД запрещены. Оркестратор передаёт этот результат в staging после локальных проверок.

Данные и HTTP-транспорт браузерных сценариев синтетические, сами карточки/доски/фильтры/DnD и CSS настоящие. БД, staging и production не использовались. Runtime-приёмка развёрнутого staging с SHA/образом/сценариями и независимое ревью остаются отдельным незавершённым пунктом 3.1. Коммиты, merge, push и deploy не выполнялись.

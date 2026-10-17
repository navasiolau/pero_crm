# QA — №176, 17.10.2026

## Result

Локальная реализация и обе темы фактически развёрнутого staging приняты оркестратором: 23 light-сценария и отдельные 4 dark-сценария с независимым просмотром receipt и PNG. Изменены только два класса пропорций в общих канбан-карточках; `ProductHeroImage`, детальные страницы и обработчики навигации не менялись. Локальные проверки выполнялись в отдельном worktree `D:/Projects/pero_crm_worktrees/requests-176`, ветка `feature/176`. Реальный staging `e742e2e18014191ac03551ff2730f112749b38bb` / image `sha256:a884efc14c37ce948b022c9ac3952b0895c3ef7f12280ea096dd9e1f4e94232e` описан в `staging-qa.md`.

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

Независимое ревью оркестратора и отдельного reviewer `review_176` выполнено 17.10.2026: actionable findings нет. Владелец отдельным сообщением разрешил сохранение в ветках и тестирование всех задач на staging; main и production-БД запрещены. Изменение доставлено в staging обычной интеграцией оркестратора.

В перечисленных локальных browser-сценариях данные и HTTP-транспорт синтетические, а карточки/доски/фильтры/DnD и CSS настоящие; БД в них не использовалась. Дополнительно реальный staging в светлой теме прошёл 23 сценария, включая поиск при удержанной доставке настоящего initial ACK и после ACK; в тёмной — 4 smoke-сценария досок проектов и изделий при 1440/390. Оркестратор независимо просмотрел receipts и PNG и подтвердил обе темы. В каждом run собственные ACK восстановлены по CAS, все 64 стабильные карты таблиц совпали; отдельно сохранён только runtime timestamp ApiToken.lastUsedAt. Существующая stale SSR aria-label темы и два нативных клика для синхронизации QA описаны в `staging-qa.md`; исправлением CRM это не является. Production и main в этих проверках не затрагивались; субагент не выполнял коммиты, merge, push и deploy.

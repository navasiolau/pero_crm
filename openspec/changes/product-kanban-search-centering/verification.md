# Проверка №196 — 22.10.2026

База `3def4f0c76e4a1756aa4dabfbb3871b2112dd927`, `bugfix/196`.

- RED: существующий browser harness с временно скрытой целевой карточкой воспроизвёл потерю поиска: ошибка центрирования 1312.75 CSS px после появления карточки; `.playwright-mcp/search196/red/receipt.json`.
- GREEN: `pnpm --filter @pero/web exec node tests/kanban-search-focus-browser.mjs` — PASS, 44 поведенческих сценария существующего harness проектов/изделий с новым ожиданием скрытой и поздно вставленной карточки. Реальные React Views/DnD/Tailwind/Base UI, Chromium, viewport 1440×900, 390×844, 360×800. Только серверные границы заменены локальным транспортом, БД не использовалась. `.playwright-mcp/search196/green/receipt.json`.
- Сохранены caret, геометрия колонок и карточек, зеркальная полоса, mobile snap, фильтры, однократность после SSE, stale-query и DnD gates. Desktop/mobile снимки изделий просмотрены.
- Scoped eslint и `pnpm --filter @pero/web exec tsc --noEmit` — PASS.
- `openspec validate product-kanban-search-centering --strict` — PASS.

Реальный staging принимается с общим пакетом №190–196 и окончательными правами №194; этот локальный результат не является подтверждением deployment.

Общий пакет №190–196: 63 затронутых проверки прав/долей/переназначения/процентов и итоговая типизация — PASS. Browser harness с окончательными статусами/ролями — PASS на desktop и mobile; квитанция `C:/Users/admin/.codex/tmp/pero-crm-190-196/acceptance/search-final-fixed/receipt.json`. После удаления крайней колонки обнаружен пропуск старого тестового слушателя scrollend: событие у границы приходило до touchend. Подписка перенесена перед жестом, обработка touchmove получает реальные кадры браузера; проверки стабильных координат, ручного scroll и SSE сохранены. Производственный код прокрутки этим исправлением теста не менялся.

## Уточнение поиска — четвёртая приёмка 22.10.2026

База `544b259dad1e9f9f0fcbe9f2d2542f44e69a9f3b`, существующая `bugfix/196`, отдельный worktree `C:/Users/admin/.codex/worktrees/requests-196-number-search`.

- Перед реализацией обновлены proposal/design/spec/tasks существующего change: поиск обоих видов списков только по собственному номеру, текстовый непустой запрос даёт пустую выборку, подсказка «Введите номер».
- RED: `pnpm --config.verifyDepsBeforeRun=false --filter @pero/web exec tsx --test tests/kanban-identity-search.test.ts tests/kanban-search-page-adapter.test.mjs` — 6 из 9 проверок воспроизводят прежний поиск по названию/клиенту, область `identity` в канбане и отсутствие области в таблице.
- GREEN той же команды — 9/9 PASS. Настоящие query/visibility исполняются на существующем связанном fixture adapter без БД; page-adapter исполняет обе страницы и проверяет внутреннюю область номера для канбана и таблицы с сохранением пагинации.
- Проверены собственные и частичные номера, отсутствие совпадения по названию/клиенту/родителю, несуществующий номер, пустой/пробельный запрос, строковые номера `3.01`, `108.13.2`, `108-A.01`, пересечение всех осей фильтров, visibility и soft deletion. Невалидный запрос возвращает также нулевой paged count. Default callers с прежним связанным поиском сохраняют поведение; URL не задаёт внутреннюю область.
- Scoped ESLint по 13 изменённым TS/TSX/MJS файлам — PASS. `git diff --check` — PASS. `openspec validate product-kanban-search-centering --strict` — PASS.
- В существующих browser harness/tests обновлены локаторы текста поля. Hook точного строкового центрирования не менялся; его ранее принятый desktop/mobile matrix повторно не запускался для этого уточнения.

Итоговая типизация и реальный staging с SHA/образом, обоими списками/видами и сохранённым точным центрированием остаются в общей интеграционной приёмке четырёх исправлений. Этот локальный результат не подтверждает deployment.

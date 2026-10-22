# Проверка №196 — 22.10.2026

База `3def4f0c76e4a1756aa4dabfbb3871b2112dd927`, `bugfix/196`.

- RED: существующий browser harness с временно скрытой целевой карточкой воспроизвёл потерю поиска: ошибка центрирования 1312.75 CSS px после появления карточки; `.playwright-mcp/search196/red/receipt.json`.
- GREEN: `pnpm --filter @pero/web exec node tests/kanban-search-focus-browser.mjs` — PASS, 44 поведенческих сценария существующего harness проектов/изделий с новым ожиданием скрытой и поздно вставленной карточки. Реальные React Views/DnD/Tailwind/Base UI, Chromium, viewport 1440×900, 390×844, 360×800. Только серверные границы заменены локальным транспортом, БД не использовалась. `.playwright-mcp/search196/green/receipt.json`.
- Сохранены caret, геометрия колонок и карточек, зеркальная полоса, mobile snap, фильтры, однократность после SSE, stale-query и DnD gates. Desktop/mobile снимки изделий просмотрены.
- Scoped eslint и `pnpm --filter @pero/web exec tsc --noEmit` — PASS.
- `openspec validate product-kanban-search-centering --strict` — PASS.

Реальный staging принимается с общим пакетом №190–196 и окончательными правами №194; этот локальный результат не является подтверждением deployment.

Общий пакет №190–196: 63 затронутых проверки прав/долей/переназначения/процентов и итоговая типизация — PASS. Browser harness с окончательными статусами/ролями — PASS на desktop и mobile; квитанция `C:/Users/admin/.codex/tmp/pero-crm-190-196/acceptance/search-final-fixed/receipt.json`. После удаления крайней колонки обнаружен пропуск старого тестового слушателя scrollend: событие у границы приходило до touchend. Подписка перенесена перед жестом, обработка touchmove получает реальные кадры браузера; проверки стабильных координат, ручного scroll и SSE сохранены. Производственный код прокрутки этим исправлением теста не менялся.

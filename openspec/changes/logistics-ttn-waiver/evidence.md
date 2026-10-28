# Приёмка №197 — 29.10.2026

База ветки: origin/staging 0045d3698cee2074e805abe56f817d2d6238d180. Коммит, CI и staging-приёмка пока не выполнены.

## Local

- RED: два новых теста отказали на отсутствии ttnNotRequired и запрете внутреннего Payment без ТТН.
- GREEN: 13/13 в logistics-ttn-waiver, logistics-trips, logistics-cash-allocation, logistics-workspace-render.
- `pnpm exec tsc --noEmit --pretty false` PASS; целевой ESLint PASS; strict OpenSpec PASS.
- Единственная новая миграция 20261029000100_logistics_ttn_waiver применена на существующем pero_crm_pg (точный container ID bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5, loopback5433/pero_crm). Остальные бизнес-таблицы при миграции сохранены; исходно Trip/Posting пусты. Дампы/reset/seed не выполнялись.
- `CRM_LOCAL_CONTAINER_ID=<проверенный ID> pnpm exec tsx scripts/logistics-local.ts`: реальный PostgreSQL PASS. Проверены сохранение галочки при пропуске поля, расход10→исправление12, два точных баланса, повтор без writes, чужой document ID, отказ выключенной галочки, неизменяемость снимка, SQL-отказ LOGISTICS_POSTING_TTN_REQUIRED и поздняя ТТН без расхода. Storage в native проверке injected, реальный S3 этим не подтверждается.
- Все собственные SQL-фикстуры отменены outer rollback; сравнение полного nativeSnapshot всех таблиц/ограничений/функций/индексов/триггеров совпало.
- Реальный Next development, ephemeral local secret и signed existing ADMIN; DB-соединение приложения принудительно READ ONLY. Chromium1440×900,390×844,360×800: галочка включается/выключается, подсказка видна, диалог без горизонтального переполнения, page errors0. Все PNG лично просмотрены. Браузер не отправлял writes; полные хэши всех public tables совпали до/после. Это не парольный вход и не browser E2E списания.
- Приватные browser receipt и PNG: `.playwright-mcp/logistics/browser.json`, `.playwright-mcp/logistics/screenshots/` в worktree logistics-197.

## Staging / production

NOT_RUN. Требуется явное разрешение коммита по AGENTS.md, обычная интеграция и фактическая приёмка staging. Production, миграция и конкретное удаление будут приняты отдельно после №198.

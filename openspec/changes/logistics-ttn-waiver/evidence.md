# Приёмка №197 — 29.10.2026

База ветки: origin/staging 0045d3698cee2074e805abe56f817d2d6238d180. Функциональный коммит c9fb8d52; обычный merge afb4c7bc. После согласованного исправления CI №199 принят staging e9b8eb09cef6e1c81272a9dce0e07781dad8e7bf.

## Local

- RED: два новых теста отказали на отсутствии ttnNotRequired и запрете внутреннего Payment без ТТН.
- GREEN: 13/13 в logistics-ttn-waiver, logistics-trips, logistics-cash-allocation, logistics-workspace-render.
- `pnpm exec tsc --noEmit --pretty false` PASS; целевой ESLint PASS; strict OpenSpec PASS.
- Единственная новая миграция 20261029000100_logistics_ttn_waiver применена на существующем pero_crm_pg (точный container ID bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5, loopback5433/pero_crm). Остальные бизнес-таблицы при миграции сохранены; исходно Trip/Posting пусты. Дампы/reset/seed не выполнялись.
- `CRM_LOCAL_CONTAINER_ID=<проверенный ID> pnpm exec tsx scripts/logistics-local.ts`: реальный PostgreSQL PASS. Проверены сохранение галочки при пропуске поля, расход10→исправление12, два точных баланса, повтор без writes, чужой document ID, отказ выключенной галочки, неизменяемость снимка, SQL-отказ LOGISTICS_POSTING_TTN_REQUIRED и поздняя ТТН без расхода. Storage в native проверке injected, реальный S3 этим не подтверждается.
- Все собственные SQL-фикстуры отменены outer rollback; сравнение полного nativeSnapshot всех таблиц/ограничений/функций/индексов/триггеров совпало.
- Реальный Next development, ephemeral local secret и signed existing ADMIN; DB-соединение приложения принудительно READ ONLY. Chromium1440×900,390×844,360×800: галочка включается/выключается, подсказка видна, диалог без горизонтального переполнения, page errors0. Все PNG лично просмотрены. Браузер не отправлял writes; полные хэши всех public tables совпали до/после. Это не парольный вход и не browser E2E списания.
- Приватные browser receipt и PNG: `.playwright-mcp/logistics/browser.json`, `.playwright-mcp/logistics/screenshots/` в worktree logistics-197.

## Staging — принят e9b8eb09

- [CI339](https://github.com/navasiolau/pero_crm/actions/runs/40786733614): все7jobs SUCCESS, включая renderer, обе component groups, backend, PostgreSQL/HTTP и публикацию обоих образов. CI338 отказал до публикации на Docker29 runtime identity; причина и исправление — отдельный согласованный change ci-containerd-image-identity.
- Actual staging: web/renderer revision e9b8eb09, healthy. Web OCI index sha256:4345ed68aa6123dd71614c71f8766a2d5d3c8b6277b829232a90517642580514, renderer index sha256:be9ea85e32e41d05a10f7fb72728bf1f790f0bcfcb8f98f966d069e2a19516a1 совпали с проверенными OCI CI. DB27b8f734.../started2026-09-23T11:42:14.649193151Z/том crm-staging_pgdata и W07 SHA27e3bcd727d9e83170c76a254806fde42590da76cea30c9e1441d873df680139 сохранены.
- Реальный native на существующей staging БД: все сценарии helper №197 PASS с outer rollback и неизменными snapshots. Original storage injected. Wrapper держит прежний workflow.lock и проверяет точные образы/сеть/renderer/DB/W07. Первые попытки не приняты из-за штатного ApiToken.lastUsedAt; в окончательной проверке исключён только этот внешний счётчик, все остальные поля и число токенов входят в fingerprint. Остальные таблицы/каталог схемы совпали.
- Реальный HTTPS browser с существующими активными ADMIN/DIRECTOR/PROCUREMENT/ACCOUNTANT, Basic auth и signed sessions:6сценариев PASS. ADMIN1440×900,390×844,360×800; остальные роли390×844. Галочка доступна только управляющим ролям; бухгалтер не получает создание. PNG лично просмотрены, page errors0, горизонтального overflow нет.
- Browser harness пропускает только GET/HEAD и блокирует1POST /logistics на каждый context; записи через UI этим прогоном не подтверждаются. Денежные writes проверены native. До/после browser совпали fingerprints всех77таблиц с явно указанной проекцией только ApiToken.lastUsedAt.
- Приватные receipts и PNG находятся в `.playwright-mcp/logistics/stage-native.receipt.private.json`, `staging-browser197.json`, `stage-pre197-browser.json`, `stage-post197-browser.json`, `staging-screenshots/` worktree logistics-197. Cookies и credentials в Git не включены.

## Production

NOT_RUN. Выпуск/миграция и конкретное удаление будут приняты отдельно после №198.

# Production №212 — 10.11.2026

- Владелец прямо поручил выпуск №212, затем реализацию уборки №213. Отдельно уточнил: данные защищены; стандартный production CI и предусмотренные им миграции сохраняются.
- `main` продвинут через `git merge --ff-only` до принятого staging **`efe1607ffa14384d07ea8638222c6eee3d66dfda`**. Remote main/staging совпадают.
- [Production CI 42885256398](https://github.com/navasiolau/pero_crm/actions/runs/42885256398): **7/7 success**. Обычный watcher выполнил выпуск автоматически; последующая проверка дала `already-current`.
- Web: `sha256:4397de6ce96f8ebbdfd3022fb89b817aef2952e383df47f61d15d9e716d42e86`, контейнер `9e42807de09a31ded2fd62a14a8441decf7b0f789e75d0a515af0133ff22bdb7`, revision `efe1607f`, healthy.
- Renderer: `sha256:94a5116481240cc6df0b0e8921cde82d404946c4d0e4e912921a53e2a00d81ab`, та же revision, healthy.
- Стандартная команда сохранена: `prisma migrate deploy ... && node apps/web/server.js`. В штатном логе старта подтверждено `No pending migrations to apply`; сообщение применения миграций отсутствует. Изменений `apps/web/prisma` между предыдущим main и этим релизом нет.
- По первоначальной чрезмерно строгой трактовке запрета миграций была добавлена временная настройка `web.command`. После уточнения владельца она **полностью отменена до deployment**. Все пять исходных конфигурационных файлов совпадают по SHA256 с preflight; рабочие контейнеры этой временной настройкой не перезапускались.
- Production-БД: container ID `15fee2f9002f17118ad148331a3b5ba61bd4d0969deb3913f6fa55f76ff9d624`, image, mounts, volume `crm_pgdata` и StartedAt **`2026-09-23T11:42:09.206207656Z`** до/после совпали. SQL, тестовые записи, dump/restore, seed/reset и операции с её контейнером/томом не выполнялись.
- Публичные HTTPS `/api/health` и форма входа на `https://crm.peromebel.by` проверены: HTTP 200, `database: ok`, 0 POST, 0 browser errors. Аутентифицированные бизнес-сценарии на production не запускались; их 40 сценариев ранее приняты на том же Git SHA в staging.
- До скачивания свободно 13 760 856 064 bytes; после выпуска 12 605 194 240 bytes. Очистка production-данных или кеша для №212 не требовалась.

Evidence: `.playwright-mcp/task-212/release/ci-production.json`, `production-before-212.json`, `production-final-212.json`, `prod-standard-restored.json`, `production-deploy.json`, `production-startup-check.json`, `production-public-smoke.json`, `production-login-212.png`. Проверка сохранности БД основана на Docker metadata; сравнение содержимого production-таблиц не выполнялось по указанию владельца.

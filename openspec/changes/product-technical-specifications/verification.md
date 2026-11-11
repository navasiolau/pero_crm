# Проверки №214

Код: `53b2a21ea49fd5881c61cd1a59a977e356f66a9a`. Владелец 11.11.2026 разрешил реализацию, commit/push и фактическую staging-приёмку. Production не входит в выпуск.

## Local

- Prisma generate, TypeScript, ESLint и production Next build — PASS. Lint: 0 errors, 4 прежних warnings вне задачи.
- Полный web suite перед последней защитой поколения — 1404/1404; финальная защита повторно проверена 23 server/domain + 9 UI/SSR tests и двумя Chromium suites. Пакет шаблона — 46/46, последние pure generation contracts — 3/3.
- Независимое ревью GPT 6.1 SOL: три найденных P2 закрыты; final GO. Дополнительно проверена упаковка shared subpath в Dockerfile.
- На существующем `pero_crm_pg`, loopback 5433/pero_crm применена единственная pending additive migration `20261111120000_product_technical_specifications`. Ни UPDATE/backfill, ни dump/reset/seed не выполнялись.
- Реальная guarded PostgreSQL-транзакция: переход legacy, stale text writer, независимые scalar CAS, receipt replay, удаление/late patch, source generation/no-op, восстановление той же строки из КП/stale generation, rollback JSON и receipt — PASS.
- Compiled браузер, 1440px и 390px: legacy просмотр, literal HTML, textarea Enter/Ctrl+Enter, autosave/reload, авторитетный save КП, неизменный повтор, source fields, добавление/удаление, ручное создание с custom строкой и длинным значением, отсутствие горизонтального overflow — PASS; PNG просмотрены root.
- Изначально в local не было служебного клиента КП; создана ровно одна принадлежащая QA карточка, не изменены существующие клиенты. Zero-image API использует изолированную loopback S3 binding без сетевых операций; local media/PDF этим прогоном не проверялись.
- Два принадлежащих прогону проекта и КП скрыты точечно после проверки, аудит сохранён; web-процесс остановлен. Рабочие строки не редактировались.

Приватные журналы и screenshots: `.playwright-mcp/specifications-root/` и `.playwright-mcp/specifications-acceptance/runs/7cb88fa2-87c5-414a-99ac-04f5a182cc7c/`. Cookies/credentials не входят в Git.

## Staging

Первый CI `42933381977` для merge `9283889633ed2c9b3fb12da8016c9ec4cce93210` остановил native job: отрицательная packaging-фикстура копировала старый набор файлов, не включая новый shared wrapper. Образ не опубликован. Фикстура дополнена отдельными проверками отсутствующего wrapper и UMD перед прежней проверкой limits; защитные guards и pipeline не ослаблены.

Принят staging `82514755bac492c537f249d6f2fd141679043ee0`, [CI 42934422091](https://github.com/navasiolau/pero_crm/actions/runs/42934422091): **7/7 success**, включая реальный native/PostgreSQL, обе browser cohorts, renderer, backend и публикации испытанных OCI.

Штатный W07 entrypoint развернул именно эту ревизию; web `sha256:521dcd99f3183573619bd99913309171f92cc6896feae7211a242b4dfd945651`, renderer `sha256:7f6210508be3f0e10f4e95f594d1c158f15faf3f94c69c499c9567af515076c3`, healthy. DB ID, volume и StartedAt `2026-11-10T18:42:15.758341834Z` сохранены; wrapper W07 не изменён. Staging health с Basic Auth — HTTP 200/database ok.

Root выполнил настоящий HTTPS/App Router browser-run: manual JSON transition, literal legacy, autosave/reload, save КП с заменой ручной правки, no-op, source fields, создание/удаление раздела, mobile ручное создание/custom/long value — PASS. При повторении устранены только недочёты QA harness: обе cookie схемы для текущего staging Auth.js, ожидание hydration и выбор кнопки в точном диалоге. Код приложения после принятого CI не менялся.

Финальный QA UUID `a3491362-2f2d-4c25-a460-57d6c6996913`; guard до/после подтвердил тот же образ, revision и DB. Readback подтверждён, оба QA-комплекта скрыты по exact receipts без удаления бизнес-данных/файлов. Приватные evidence: `.playwright-mcp/specifications-root/stage214-*`, `ci214-current.json`, `deploy214.json`. Main остаётся `30473e7f8bca76e843f1ec34580bcb5ca7133f5b`.

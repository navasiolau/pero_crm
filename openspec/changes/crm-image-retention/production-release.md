# Production №213 — 11.11.2026

## Разрешение и резервная копия

Владелец прямо разрешил перенос №213 на production с дополнительным условием: до изменений сохранить полный дамп production БД на диске E: этого компьютера. Эта копия сохраняется для владельца; правило удаления временного migration-dump к ней не применяется. Стандартный production CI, startup command и штатные миграции сохраняются.

- Каталог: `E:\pero-crm-release-backups\production-full-before-213-20261111-011038-dc213575`.
- `crm-production-full.dump`: PostgreSQL custom archive, **8 243 656 bytes**, SHA256 `00dd6f7206669ca0e8836dc399c35c1cd18a07f106881e4f0cbfc79eca644044`.
- `postgres-globals.sql`: полные глобальные роли и настройки; конфиденциальный файл остаётся только в защищённом локальном каталоге. SHA256 `d2339b1d5504311d5ffc4936408e38a8dd486149da33b60595e1898c04519add`.
- Архив содержит все пользовательские схемы, таблицы и данные, владельцев и права. Никаких `--no-owner`, `--no-privileges` или исключений таблиц. S3-вложения не являются частью дампа БД; S3 и restic не трогались.
- Production-операции backup использовали `default_transaction_read_only=on`, read-only repeatable-read transaction и единый экспортированный snapshot для `pg_dump` и отпечатков содержимого. Архив передавался бинарным потоком прямо на E:, без временного дампа на production. Локальный SHA256 совпал с рассчитанным на источнике.
- ACL нового каталога: текущий Windows-пользователь, SYSTEM, локальные администраторы. Каталог и его родители проверены на reparse points. Копия не включена в Git и не будет автоматически удалена этой задачей.

## Доказанное восстановление

**PASS, 2026-11-10 22:11:49 UTC / 11.11.2026 01:11:49 MSK.** Файлы `manifest.json`, `restore-verification.json`, `restore-comparison.json` и `SHA256SUMS.txt` находятся рядом с архивом.

- Фактическое восстановление globals, pre-data, data и post-data выполнено с `--exit-on-error` в новом локальном PostgreSQL 17. Использован тот же image ID `sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73`.
- Совпали содержимое **77 таблиц, 66 378 строк** и все **14 категорий** schema fingerprints: владельцы, ACL, функции, constraints, индексы, views, enums, sequences и свойства БД. Отпечатки строк: число строк, SHA-512 multiset sum и xor в одинаковой канонической SQL-сессии.
- При загрузке globals пропущен только повторный `CREATE ROLE crm`: роль уже создал bootstrap изолированного PostgreSQL. Остальные параметры роли и права восстановлены из исходного SQL; сам файл не менялся.
- Для функций без явного search_path временно задан путь только в изолированной восстановленной БД, после data/post-data он сброшен. Определения функций до/после совпали, затем совпали с production snapshot.
- Docker context `desktop-linux`, network `none`, ноль портов, host mounts и persistent volumes; данные только в tmpfs. Принадлежность контейнера проверена по ID, image и уникальным labels. После проверки удалён только этот временный контейнер. Существующая локальная БД не запускалась и не менялась.
- Первая попытка backup остановилась до архива из-за многострочного `json_agg` в списке таблиц; проверенный локально разбор через `jsonb_agg` исправил проблему. Отдельная локальная проверка была остановлена из-за различия представления tmpfs в Docker Desktop; read-only inspect подтвердил изоляцию, проверка переведена на `HostConfig.Tmpfs`. Production guards проходили, записей в production БД не было. Диагностические файлы сохранены.

## Выпуск

После успешного восстановления принятую staging-ревизию **`30473e7f8bca76e843f1ec34580bcb5ca7133f5b`** перенесли в main через `git merge --ff-only`, затем выполнили обычный push. Remote main/staging совпали. [Стандартный production CI 42912375579](https://github.com/navasiolau/pero_crm/actions/runs/42912375579): **7/7 success**.

- В 22:19:06 UTC установлен только `/opt/crm/watch-crm.py`, точные bytes принятой staging-ревизии: SHA256 **`4b69eebb8b9ab51947ec75a81eeb1464aedcb3c8570995524c3fd5700175e241`**, 53 237 bytes. Предыдущий helper и receipt: `/root/pero-213-image-retention-945ce5207fc94316b6f9986a82e2010b`.
- Во время установки ID/image/StartedAt/mounts всех четырёх контейнеров совпали до/после. Compose, override, kp-compose и `watch-prod.sh` сохранили прежние SHA. Cron `/etc/cron.d/watch-deploy` также не изменился: SHA256 `e8bae4903f3bd28445bf925191f13e413cd3cdc136e90e7cd8dff63d7653826f`, прежнее расписание `*/5 * * * *`. Entry point вызывает установленный helper.
- Обычный автоматический проход слота 22:20, завершённый **2026-11-10 22:20:41 UTC**, дал `status: deployed`, `health: healthy`. Ручной запуск watcher для этой приёмки не требовался.
- Production web: `sha256:ecf1f53edae7b04cb1c3b452e66d53f05744381a7a4828e7257fdd1a042c2941`; renderer: `sha256:bdd455b2e2a5e1352d67a2b6274a246424d274e9dda341e0d7823c3a1e2f9f45`. Обе ревизии `30473e7f`, оба контейнера healthy.
- Первый post-cleanup автоматически удалил **20** подтверждённых старых образов из 36 кандидатов, skipped — 0. Проход штатно ограничен `bounded-pass`. Защищены текущая `30473e7f`, предыдущие `efe1607f` и `f5c0cdb1`, всего 25 image IDs.
- Свободное место: до прохода 12 604 932 096 bytes; сразу после уборки 13 827 047 424 bytes; при контрольном чтении после GC **13 919 453 184 bytes (12,96 GiB)**.
- Повторный автоматический проход слота 22:25, завершённый **2026-11-10 22:25:17 UTC**, дал `status: unchanged`, `health: healthy` и `image_cleanup.after.status: complete`. Удалены оставшиеся **16 из 16** кандидатов, skipped — 0; всего два прохода удалили **36** различных старых образов. Защищённые версии и все четыре контейнера сохранились. После GC свободно **14 666 432 512 bytes (13,66 GiB)**, примерно на **2,06 GB** больше исходного наблюдения. Ручной запуск уборки не использовался.
- Production DB сохранила container ID `15fee2f9002f17118ad148331a3b5ba61bd4d0969deb3913f6fa55f76ff9d624`, image, том `crm_pgdata`, mounts и StartedAt **`2026-09-23T11:42:09.206207656Z`**. Рестарта/пересоздания БД, SQL-записей от QA, действий с её томом, S3 или restic не было.
- Стандартная команда `prisma migrate deploy --schema apps/web/prisma/schema.prisma && node apps/web/server.js` сохранена. Startup log подтвердил **No pending migrations to apply**; новых миграций в diff нет. Мигратор не отключался.
- Внешняя проверка: `/api/health` HTTP 200, database `ok`; форма входа открылась в браузере без page errors. Проверки выполняли только GET/HEAD; POST и тестовых business writes не было. Скриншот просмотрен.

## Evidence

Ignored-каталог `.playwright-mcp/retention213/`: `ci-production.json`, `production-install-receipt.json`, `production-before-install.json`, `production-after.json`, `production-scheduled-repeat.json`, `production-startup.json`, `production-public-smoke.json`, `production-login-213.png`, reviewed scripts; `backup/backup-location.json` указывает на сохранённую копию на E:. Полные backup/restore-отчёты хранятся рядом с дампом. Бизнес-данные, globals SQL и секреты в Git не включены.

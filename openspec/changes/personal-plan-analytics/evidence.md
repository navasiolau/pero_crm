# Приёмка №108 — аналитика личного плана

08.10.2026, feature/108 создана от свежего staging a3a52b08ba68ff2096a7041a0cc2025aacfe9684; перед реализацией обычным fast-forward получен fb6227bc6d5aa2ef7a4ca0270b40819070cb4983 с107.

## Local

- RED→GREEN3 сценариев диапазона/доступа/полной выборки. Fullweb1359/1359 и bot36/36, types/lint/build/strict PASS; 5 прежних lint warnings.
- Month и analytics используют один listCalendarIntervalCore с повторной проверкой actor и ownerId. Диапазон использует общий calendarDateRange105, расчёт — summarizeCalendarEntries107, визуальные итоги — PlanHoursSummary107. Статусы вынесены в общий справочник. Отдельной формулы часов/доступа нет.
- Native PostgreSQL: обе границы7–8 октября MSK,210 минут,105 минут выполненных,3 выполненные записи, дни165/45; поздний updatedAt не переносит запись в дату завершения. Месяц совпадает с календарным агрегатором; чужой администратор видит только свою запись; поддельный ownerId и отключённый доступ отклонены, пустой диапазон0. Всё rollback, исходные digest MATCH.
- Настоящий localhost3098: analytics/invalid/empty/calendar-link PASS; поддельный query ownerId не расширяет данные; foreign/outside/disabled privacy PASS. Собственные HTTP-фикстуры удалены точно, исходные digest MATCH. Native регрессия106/107 PASS. ProviderMessages0, собственный сервер остановлен.
- Реальные React/Calendar/Analytics/Summary/DataTable с production CSS: desktop1440/mobile390, даты/URL, поиск/статус, неизменный общий итог при фильтре, переход к дню, месяц и високосный февраль PASS. Подменены только framework boundaries (Next Link/server actions); реальные SSR/core проверены отдельно. Скриншоты визуально проверены, overflow и ошибок браузера нет.
- Миграций нет. Full selected set501 строк проверен без скрытого ограничения итогов. Дампы/Restic/seed/reset не выполнялись.
- При read-only проверке Telegram найден существующий tgbot-staging на прежнем образе d9aefd7. Его base URL — staging, токен отличается от остальных ботов; config/env хеши и ID других контейнеров зафиксированы. Финальная приёмка включает обновление только существующего bot-staging и проверку реального dist без сообщений сотрудникам. Production/прочие контейнеры сохраняются.

## Staging

- Принят обычный merge `ead7ac36acc8f64db79a74e5b198a859a31d5cb6`, CI174 SUCCESS: https://github.com/navasiolau/pero_crm/actions/runs/37753426784. Фактическая revision совпала; web `sha256:2d0ce6fe812fe01d0cb0da1a3325f10161d240c55f6dccfb2baa35327d3dcf18` healthy.
- Native108 и реальные SSR analytics/invalid/empty/calendar-link/privacy PASS:210/105 минут,3 выполненные, дни165/45, MSK и позднее завершение; исходные digest MATCH, QA0.
- Финальная регрессия пересобрана из принятого кода108: project/general Payment с обязательным документом/receipt, единый project ledger60−20−40 и неизменная цена, inventory без кассы, paid BYN60/USD21.99/BYN65.99, shortage/last-write rollback, настоящий ACTIVE/конкурентные закупки/выдачи/возвраты, план после прямой выдачи и cash report115/85/252 PASS. Исходные digest MATCH, QA0, providerMessages0.
- Настоящие web multipart/S3 bytes/private draft/роль/повтор/просмотр/отзыв роли и bot multipart/bearer/scope/role/audit/mandatory document PASS. Точные собственные объекты удалены; QA objects0/rows0, исходные digest MATCH.
- Bundles: analytics `95019a2fedc1d1570ab427bfadf881be05d2cb85ec3ccf7f369e6dced3d38bd4`; native regression `24900e3bc3f939ba4e35a3a9d92159f8f167f65ebc815c07f4e5be59ff55ea8d`; web documents `90502486d4bdd50cbba682b404c58ec0c8b93fc3291df4c49d9102a7ab28a2d5`; bot documents `72928d525afdfbabb5cab63274e3bb882cea9d14780a3a3b703b3f2e40b60a39`.
- Обновлён только существующий `telegram-bot-staging/bot-staging` до immutable image `sha256:12ac4b693e0d9a26d151f5d601b646b61353bf4b224522de1b55359a043f2685`, OCI revision совпала с web. Healthy. Compose/env hashes MATCH, другие контейнеры ID unchanged; конфиги/watcher/cron не менялись. На фактическом dist контейнера выполнены14 проверок finance/paid-stock/direct-stock/documents PASS, отдельные процессы с синтетическим env и подменённым транспортом, providerMessages0. Это не заявляется ручной Telegram-приёмкой владельца.
- Инструкция владельцу: `docs/FINANCE_WAREHOUSE_PLAN_97_108_STAGING.md`. Архитектурная сверка: verification.md. DB container/volume/start, W07 и штатный refresh сохранены. Main остаётся `ac394f1fc27856a5b183526152e7a6bec0dec2c6`; production не выпускался, дампов нет, Restic не затронут.

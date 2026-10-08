# Приёмка №109 — 08.10.2026

Владелец согласовал номер109, ADMIN-only мягкое удаление и каскад зависимых записей. feature/109 создана от свежего origin/staging491685b, до реализации обновлена FF до3704214. Исходный dirty checkout не изменялся.

## Local

- Аддитивная миграция20261008180000_warehouse_movement_soft_delete: nullable markers Payment/StockMovement, batch WarehouseMovementDeletion, nullable accountingRevision. Prisma validate/generate PASS. Применена только к существующей localhost5433/pero_crm; проверены исходные значения51 таблицы (новые nullable колонки исключены из сравнения), digest MATCH. Дампов/seed/reset нет.
- Единый планировщик использует warehouse-cost, сверяет активную цепочку и её конечную позицию, вычисляет каскад без переоценки выживших снимков. Неоднозначная/неполная история и строки до текущего запуска отклоняются до изменений.
- Общая money→warehouse→material→product блокировка; свежая ADMIN-проверка, receipt/fingerprint; одна транзакция на markers, возврат денег через исключение исходного расхода, баланс/derived price, issuedQty, счётчики возвратов, аудит/outbox. Синтетического дохода нет. Неизменившиеся потребности не переписываются.
- Канонические active-предикаты применены к журналам, кассовым/организационным балансам, отчёту, обороту, проектной экономике/расходам, выдачам/возвратным источникам и вложенным чтениям. Поиск всех Payment/StockMovement читателей выполнен. Replay удалённого движения/закупки/платежа не восстанавливает его.
- RED→GREEN планировщика; fullweb1371/1371 PASS. Native PostgreSQL6 сценариев: paid37kg/3700, inventory без денег, каскад с независимым приходом, отмена возврата и повторный полный возврат, USD21.99/BYN65.99, ошибка последней записи. Отдельно duplicate/stale/issue-race на реальных конкурентных SQL-транзакциях PASS. Все исходные таблицы MATCH, собственные QA-строки удалены/rollback, сообщений0.
- Регрессии оплаченного прихода и прямой выдачи/возврата (включая конкуренцию и потребность после выдачи) PASS.
- Реальные local Next HTTP/server-actions и SSR проверяют отсутствие кнопки/отказ DIRECTOR/PROCUREMENT/ACCOUNTANT/MANAGER. Текущий local phase UNINITIALIZED оставлен: локальный HTTP проводит только проверки/отказы, успешная серверная отмена проверяется на реально ACTIVE staging. Native local использует изолированный внутри транзакции state/собственные fixtures.
- Настоящие компоненты и compiled production CSS/Roboto в браузере1440/390 PASS: последний столбец и мобильная карточка, полный preview, cancel без write, стабильный UUID, старый preview блокирует подтверждение; фокус заголовка устранил начальную прокрутку, обе кнопки доступны. В этом layout-тесте только граница server actions заменена фикстурой. Screenshots осмотрены, горизонтального overflow нет.
- types/lint/build/strict PASS (5 прежних lint warnings). Собственные local серверы остановлены. Restic/W07/production schema/main не менялись. Ранее выполненная разовая production-коррекция не повторялась.

## Staging

Обычный merge7c8fec0a21bcba2899ea9ea62729aaa3995bdaed, CI178 SUCCESS. На фактически развёрнутом web подтверждены тот же revision, healthy, image sha256:f74fd284bcde0a59ea1013516f1b14bebd9615be526983be50758fad9d878a94 и успешно применённая миграция20261008180000_warehouse_movement_soft_delete.

Native6 сценариев и duplicate/stale/issue-race PASS на REAL_ACTIVE. Настоящие HTTP server-actions/SSR PASS: отсутствие права у остальных ролей, предпросмотр CASCADE2/возврат3700, отказ устаревшего подтверждения после новой выдачи, мягкая отмена, повтор с тем же результатом без второго возврата денег, исключение строк из SSR-журнала. Все собственные QA-строки очищены; бизнес-данные и остальные проверяемые поля52 таблиц MATCH; внешних сообщений0. DB container/start/volume и W07 hash неизменны, refresh не запускался.

Приёмочный контур уточнён после двух диагностированных отказов: работающий бот штатно обновляет ApiToken.lastUsedAt (из digest исключена только эта отметка, остальные поля токена/права/отзыв сверяются), а внутренний HTTP-адаптер должен передавать совпадающие Origin и X-Forwarded-Host. Защита сервера не изменялась. После каждого отказа отдельная read-only проверка подтвердила0 оставшихся QA users/movements/payments/batches. Повторная полная приёмка PASS.

Receipt: ignored .playwright-mcp/finance109/staging-receipt.json; bundle SHA256 d3abb0a6df1c6db8242197198d84c71406af3c0ea245ca0a28fb5cb682c6daba. Telegram остаётся на принятом3704214: diff apps/telegram-bot относительно этой ревизии пуст. Mainac394f1fc27856a5b183526152e7a6bec0dec2c6 и production-код/схема не менялись; production-выпуск не разрешён.

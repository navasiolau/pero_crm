# Приёмка №101 — журнал расходов проекта

08.10.2026, feature/101 от origin/staging6281d811d46672d2a332011998101854594c0d60. Разрешены commit/merge/staging; main только после проверки владельцем.

## Local

- RED нового domain test подтверждён до реализации. Полный web1331/1331 PASS; после добавления проверки предварительно загруженных фактов focused10/10 PASS. TypeScript/build PASS. Общий lint0 ошибок (5 прежних предупреждений), изменённые/новые файлы lint0. Strict OpenSpec PASS.
- Общий summarizeProjectExpenses использует сохранённые Decimal/BYN факты. Расходы группируются по ID статьи и отдельному ключу склада. ProjectExpenseRow содержит source/sourceId; warehouse total берётся из StockMovement, точная цена из WarehouseMovementValuation. Новых Payment при чтении нет.
- Экономика обоих экранов получает те же предварительно загруженные записи. Тест запрещает повторные payment/stock SQL-чтения. Зарплатные снимки и исключение связанных начислений сохранены.
- PostgreSQL localhost5433/pero_crm: собственная read-фикстура выдачи60/частичного возврата−20 плюс денежный расход10 даёт50BYN; смена текущей цены и последующий приход не меняют выдачу; полный возврат−40 оставляет10BYN. Число платежей неизменно. Неполная история даётNULL, удалённое изделие не скрывает расходы. Все фикстуры rollback, исходные digest MATCH.
- Локальная production-сборка3097: оба SSR-маршрута проверены реальными GET, ACCOUNTANT разрешён, MANAGER отклонён, M+ACCOUNTANT разрешён. Финансовый ответ не содержит техническое описание. Точные owned записи удалены, исходные digest MATCH, рассылок0.
- Playwright browser: фильтр статей, 9 знаков цены, переход возврат→выдача, отсутствие удаления складской строки, оба экрана, desktop1440×1000/mobile390×844 PASS. Снимки .playwright-mcp/finance101 просмотрены. Повторный expense-document-browser PASS: подтверждённая загрузка/обязательность документа/оригинальный просмотрщик из мобильной строки.
- Браузерные QA-данные удалены по точным owned ID; реальные данные и инфраструктура не менялись. Миграций/дампов/Restic нет.
- Подготовлен staging bundle52625bytes с native rollback и реальными SSR-запросами; W07/256KiB/timeout guards сохранены.

## Staging

- CI/CD166 SUCCESS: https://github.com/navasiolau/pero_crm/actions/runs/37723186792.
- Реально развёрнут6db0bc055df89071cf6a2b02874558f8da7e9f46, образ sha256:c976554534253ad982577c187ddbeaa24e82d395b9ef5b37b8dc3b597857f77b, health healthy.
- Native в этом контейнере PASS: выдача60, возвраты−20/−40, количество денежных Payment неизменно, повторное ценообразование не влияет, неизвестная историяNULL.
- Реальные SSR financial/general маршруты PASS: бухгалтер, отказ чистому менеджеру, объединённые роли. Техническое описание не попало в финансовый ответ. Исходные digest MATCH, QA rows0, providerMessages0.
- Bundle SHA256a2493cf0514357354e6f8da94e469ba8c679f22a28fcc5eba8c74f504ee5bd0e, exitCode0; receipt .playwright-mcp/finance101/staging-receipt.json.
- W07/DB guards сохранены: DB27b8f7342b9d722ab8788e137b37b03a3037442da038c5b8b98dbb30245b8b6a, started2026-09-23T11:42:14.649193151Z, volumecrm-staging_pgdata, watcher SHA27e3bcd727d9e83170c76a254806fde42590da76cea30c9e1441d873df680139. Миграций нет. Main не изменён.

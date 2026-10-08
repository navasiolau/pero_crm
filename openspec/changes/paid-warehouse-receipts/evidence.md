# Приёмка №103 — оплаченный приход

08.10.2026, feature/103 от staging79339748b705a4f2e04934d3c84bf3743cfb5828.

## Local

- RED контракта/денежного расчёта подтверждён до реализации. Fullweb1338/1338 и bot32/32 PASS; types/lint/build/strict PASS (5 прежних lint warnings). После исправления мобильного начального фокуса повторены build/types, lint затронутого файла и реальный browser.
- Миграция20261008140000_paid_warehouse_receipts применена только к localhost5433/pero_crm. Прежние StockMovement/valuation/balance/state/Material/Payment/Payout/CashAccount/FinanceDocument digest MATCH. Новая StockPurchase без backfill, FK Restrict на обе операции.
- Один денежный prepare и createPaymentInTransaction, одно warehouseMove, общий transaction lock. Новые client totals/project/policy flags отклоняются строгим контрактом. Исключение файла проверяет собственное ещё не связанное PAID INCOME и равенство сохранённого BYN; обычный расход по-прежнему требует документ.
- Реальный PostgreSQL: закупка3×20=60BYN одновременно в кассе/запасе; USD3×7.33=21.99USD при3.001 даёт65.99BYN и цену21.996666667. Повтор возвращает прежние payment/movement без новых events, даже при другой подготовленной котировке. Нет проектного Payment/projectAmount и обязательного документа.
- Cash shortage и сбой последнего StockPurchase.create откатывают склад, оплату, balance, audit/outbox. Проверены роль, обычный document guard, server+FK запрет отдельного удаления и безопасная проекция связанного прихода в общем журнале. Исходные digest MATCH, все QA rollback.
- Две настоящие конкурентные PostgreSQL-транзакции: одинаковыйUUID создаёт одну закупку; два разных запроса за остаток допускают один и отклоняют второй; cash40, stock6/120, ровно2 итоговых закупки. Local без глобального warehouse state использует только тестовый reader ACTIVE для собственной номенклатуры, сохраняя реальные SQL/advisory/material locks; глобальное состояние не записывается. Staging runner требует настоящее ACTIVE. Все собственные committed QA-строки удалены, исходные digest MATCH.
- Прежний inventory native повторно PASS:3/60BYN, INVENTORY, одна запись, cash unchanged. Прежний finance native и focused11 денежных/document/receipt сценариев PASS.
- CRM переиспользует PaymentDialog для закупки и общие StockMaterialFields для обоих приходов. Входы — складские остатки и общие расходы. В деталях видна связь, отдельное удаление disabled и защищено сервером.
- Настоящий localhost3097: paid form/material/cash/article, автоматическая сумма60, отсутствие обязательного файла, desktop1440/mobile390/footer, связанная строка и начальная видимость заголовка PASS. Денежный UI submit не выполнялся; показ связанности использует точную собственную read-фикстуру. После удаления всех QA исходные digest MATCH, notifications0.
- Реальный bot API local: bearer/scope/role, readonly quote21.99USD/65.99BYN, минимальный material directory, отклонение поддельных totals/flags, валютного несоответствия и закрытого local-склада PASS. Принятых денежных HTTP-запросов и сообщений сотрудникам нет.
- Исполняемый Telegram engine: /закупка, серверная quote, касса/статья/материал/количество/курс, stale choice nonce/dialog, revoked roles/group/foreign sender, потеря quote/commit ACK и тот жеUUID PASS. Транспорт Telegram подменён, реальные сообщения не отправлялись.
- Старый build-only native probe проверял наличие payment core среди15 крупнейших входов; после извлечения prepare он стал меньше. Проверка теперь использует все реально retained inputs, дополнительно требует prepare, сохраняет настоящие Zod validators и прежний бюджет256KiB. Защитные ограничения не ослаблены.
- Staging bundle129635bytes подготовлен с native rollback, настоящей конкуренцией ACTIVE и реальным HTTP. W07/identity/timeout/budget guards сохранены. Дампы/Restic/seed/reset не использовались.

## Staging

Ожидаются merge, CI, фактическая ревизия и runtime-приёмка. Main не выпускался.

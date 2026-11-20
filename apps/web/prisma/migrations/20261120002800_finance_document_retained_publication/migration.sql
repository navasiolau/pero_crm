-- Скрытый принятый документ сохраняет время приёмки и исходный файл.
ALTER TABLE "FinanceDocument" DROP CONSTRAINT "FinanceDocument_ready_time",
  ADD CONSTRAINT "FinanceDocument_ready_time" CHECK (
    ("state" IN ('READY', 'RETAINED')) = ("readyAt" IS NOT NULL)
  );

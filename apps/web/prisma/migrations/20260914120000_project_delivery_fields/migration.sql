-- Доставка / Выгрузка / Монтаж проекта из КП — прибавляются к Σ цен изделий
-- в «сумме проекта» (карточка, канбан/таблица, экономика, бот).
ALTER TABLE "Project" ADD COLUMN "delivery" DECIMAL(12,2);
ALTER TABLE "Project" ADD COLUMN "unloading" DECIMAL(12,2);
ALTER TABLE "Project" ADD COLUMN "installation" DECIMAL(12,2);

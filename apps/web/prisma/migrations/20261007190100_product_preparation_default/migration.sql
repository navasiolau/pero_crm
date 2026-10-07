-- Только новые изделия; существующие статусы, даты, история и финансы не меняются.
ALTER TABLE "Product" ALTER COLUMN "status" SET DEFAULT 'PREPARATION'::"ProductStatus";

-- Первоначальная цена изделия (необязательная); по проекту — сумма по изделиям.
ALTER TABLE "Product" ADD COLUMN "initialPrice" DECIMAL(12,2);

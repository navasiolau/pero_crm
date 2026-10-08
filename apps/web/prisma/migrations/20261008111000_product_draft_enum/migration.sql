-- Новый enum должен быть закоммичен до использования в следующей миграции.
ALTER TYPE "ProductStatus" ADD VALUE IF NOT EXISTS 'DRAFT' BEFORE 'PREPARATION';
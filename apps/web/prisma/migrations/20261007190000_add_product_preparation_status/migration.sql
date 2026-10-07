-- Отдельная миграция фиксирует значение enum до его использования в DEFAULT.
ALTER TYPE "ProductStatus" ADD VALUE 'PREPARATION' BEFORE 'DESIGN';

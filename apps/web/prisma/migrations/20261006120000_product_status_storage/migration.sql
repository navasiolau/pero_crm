-- Переименование статуса изделия DELIVERY («Доставка») в STORAGE («На складе ГП»).
-- Семантика переходов и триггеров начислений не меняется; история статусов
-- (ProductStatusHistory, ProductPercentageCompletion) использует тот же тип
-- и переименовывается атомарно вместе со значениями.
ALTER TYPE "ProductStatus" RENAME VALUE 'DELIVERY' TO 'STORAGE';

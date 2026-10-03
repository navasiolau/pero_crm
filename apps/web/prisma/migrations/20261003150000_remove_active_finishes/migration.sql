BEGIN;

-- Отменённая функция удаляется только при отсутствии любых исторических данных.
LOCK TABLE "Finish", "CatalogueMediaAsset", "ProductFinishAssignment", "Product" IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Finish")
     OR EXISTS (SELECT 1 FROM "CatalogueMediaAsset")
     OR EXISTS (SELECT 1 FROM "ProductFinishAssignment")
     OR EXISTS (SELECT 1 FROM "Product" WHERE "finishRevision" <> 0) THEN
    RAISE EXCEPTION 'FINISH_REMOVAL_NONEMPTY_STOP';
  END IF;
END $$;

-- Без CASCADE: неизвестные внешние зависимости должны остановить миграцию.
DROP TABLE "ProductFinishAssignment";
ALTER TABLE "Finish" DROP CONSTRAINT "Finish_sampleAssetId_id_fkey";
DROP TABLE "CatalogueMediaAsset";
DROP TABLE "Finish";
DROP TYPE "FinishKind";
ALTER TABLE "Product" DROP COLUMN "finishRevision";

COMMIT;

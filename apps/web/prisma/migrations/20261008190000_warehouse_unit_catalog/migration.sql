-- Обозначения переносятся без нормализации, количественные и денежные поля не меняются.
CREATE TABLE "MaterialUnit" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MaterialUnit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MaterialUnit_name_key" ON "MaterialUnit"("name");
INSERT INTO "MaterialUnit" ("id", "name", "updatedAt") VALUES
    ('warehouse-unit-piece', 'шт', CURRENT_TIMESTAMP),
    ('warehouse-unit-square-meter', 'м²', CURRENT_TIMESTAMP),
    ('warehouse-unit-linear-meter', 'м.п.', CURRENT_TIMESTAMP),
    ('warehouse-unit-sheet', 'лист', CURRENT_TIMESTAMP),
    ('warehouse-unit-kilogram', 'кг', CURRENT_TIMESTAMP),
    ('warehouse-unit-meter', 'м', CURRENT_TIMESTAMP),
    ('warehouse-unit-set', 'компл', CURRENT_TIMESTAMP),
    ('warehouse-unit-package', 'упак', CURRENT_TIMESTAMP),
    ('warehouse-unit-liter', 'л', CURRENT_TIMESTAMP),
    ('warehouse-unit-tenth-sheet', '1/10 листа', CURRENT_TIMESTAMP);
INSERT INTO "MaterialUnit" ("id", "name", "updatedAt")
SELECT 'warehouse-unit-custom-' || md5(m."unit"), m."unit", CURRENT_TIMESTAMP
FROM "Material" m GROUP BY m."unit"
ON CONFLICT ("name") DO NOTHING;
ALTER TABLE "Material" ADD COLUMN "unitId" TEXT;
UPDATE "Material" m SET "unitId" = u."id" FROM "MaterialUnit" u WHERE u."name" = m."unit";
ALTER TABLE "Material" ALTER COLUMN "unitId" SET NOT NULL;
ALTER TABLE "Material" ALTER COLUMN "unitId" SET DEFAULT 'warehouse-unit-piece';
CREATE INDEX "Material_unitId_idx" ON "Material"("unitId");
ALTER TABLE "Material" ADD CONSTRAINT "Material_unitId_fkey"
    FOREIGN KEY ("unitId") REFERENCES "MaterialUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Material" DROP COLUMN "unit";

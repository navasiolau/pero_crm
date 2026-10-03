-- Stable article numbers only. Payment identities/FKs/amounts are untouched.
ALTER TABLE "ExpenseArticle" ADD COLUMN "code" INTEGER;
WITH base AS (
  SELECT COALESCE(MAX("code"), 0) AS max_code FROM "ExpenseArticle"
), missing AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "id") AS ordinal
  FROM "ExpenseArticle" WHERE "code" IS NULL
)
UPDATE "ExpenseArticle" a SET "code" = (base.max_code + missing.ordinal)::INTEGER
FROM missing CROSS JOIN base
WHERE a."id" = missing."id" AND a."code" IS NULL;
ALTER TABLE "ExpenseArticle" ALTER COLUMN "code" SET NOT NULL;
CREATE UNIQUE INDEX "ExpenseArticle_code_key" ON "ExpenseArticle"("code");
ALTER TABLE "ExpenseArticle" ADD CONSTRAINT "ExpenseArticle_positive_code" CHECK ("code" > 0);

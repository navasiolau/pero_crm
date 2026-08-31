-- Нормализация номеров проектов (решение владельца, 08.2026):
-- канонический номер = только цифры без ведущих нулей, потолок 205
-- (205 — самый свежий реальный проект). Всё, что не канонично
-- («CRM-27990», «37А», «3,412 = 47019474307», ведущие нули «007»/«01»)
-- или числом больше 205 («0211» → 211), перенумеровывается в свободные
-- номера 1..205 по дате создания: старейший получает наименьший
-- свободный номер. Проект «0» — каноничный, остаётся.
-- Попутно: числовые колонки для серверной сортировки «новые сверху»
-- (Project.numberInt, Product.suffixInt).

ALTER TABLE "Project" ADD COLUMN "numberInt" INTEGER;
ALTER TABLE "Product" ADD COLUMN "suffixInt" INTEGER;

-- ── 1. Перенумерация пула в свободные номера 1..205 ─────────────────────
DO $$
DECLARE
  rec RECORD;
  new_num INTEGER;
BEGIN
  -- Снимок пула: не число, число с ведущим нулём или число > 205.
  -- («0» начинается с нуля, но состоит из одного символа — каноничный, не в пуле.)
  CREATE TEMP TABLE _renumber AS
  SELECT id, number AS old_number, NULL::integer AS new_number
  FROM "Project"
  WHERE number !~ '^[0-9]+$'
     OR number ~ '^0[0-9]+$'
     OR (number ~ '^[0-9]+$' AND number::bigint > 205);

  -- Основной проход: по дате создания (старые вперёд), каждому — наименьший
  -- свободный номер. Обновление внутри цикла сразу исключает повторное занятие.
  FOR rec IN
    SELECT p.id, p.number AS old_number
    FROM "Project" p
    JOIN _renumber r ON r.id = p.id
    ORDER BY p."createdAt" ASC, p.id ASC
  LOOP
    SELECT g INTO new_num
    FROM generate_series(1, 205) g
    WHERE NOT EXISTS (SELECT 1 FROM "Project" q WHERE q.number = g::text)
    ORDER BY g
    LIMIT 1;
    IF new_num IS NULL THEN
      RAISE EXCEPTION 'Свободные номера 1..205 закончились — проект «%» не перенумерован', rec.old_number;
    END IF;
    RAISE NOTICE 'Номер проекта «%» → «%»', rec.old_number, new_num;
    UPDATE "Project" SET number = new_num::text WHERE id = rec.id;
    UPDATE _renumber SET new_number = new_num WHERE id = rec.id;
  END LOOP;

  -- ── 2. Изделия перенумерованных проектов: префиксная замена ────────────
  -- number = <новый номер проекта> + хвост старого (суффикс сохраняется);
  -- хвостовой разделитель без цифр обрезается: «01.» → «N», «0211.» → «N».
  UPDATE "Product" p
  SET number = regexp_replace(r.new_number::text || substring(p.number, length(r.old_number) + 1), '[.-]+$', '')
  FROM _renumber r
  WHERE p."projectId" = r.id AND p.number LIKE r.old_number || '%';

  DROP TABLE _renumber;
END $$;

-- ── 3. Бэкфилл числовых колонок ──────────────────────────────────────────
UPDATE "Project" SET "numberInt" = number::bigint;

-- suffixInt = первая цифровая группа суффикса изделия (часть после
-- префикса проекта): «108.13.2» → 13, «3.100 = …» → 100, «108.» → NULL.
UPDATE "Product" p
SET "suffixInt" = x.suf::int
FROM (
  SELECT p2.id,
         (regexp_match(substring(p2.number, length(pr.number) + 1), '^\D*(\d+)'))[1] AS suf
  FROM "Product" p2
  JOIN "Project" pr ON pr.id = p2."projectId"
) x
WHERE p.id = x.id;

ALTER TABLE "Project" ALTER COLUMN "numberInt" SET NOT NULL;

CREATE INDEX "Project_numberInt_idx" ON "Project"("numberInt");
CREATE INDEX "Product_projectId_suffixInt_idx" ON "Product"("projectId", "suffixInt");

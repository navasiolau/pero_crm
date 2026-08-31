-- Суффиксы номеров изделий (решение владельца, 08.2026): у каждого изделия
-- номер вида «<номер проекта>.<N>». Исправляем остатки legacy, у которых
-- суффикса не было вовсе:
--   «202.» — номер проекта с хвостовым разделителем без цифры (25 шт.);
--   «101»  — номер, равный номеру проекта (12 шт.).
-- Каждому присваивается ближайший свободный суффикс в своём проекте
-- (единственное изделие проекта становится «202.1», «101.1»).
-- Уведомлений со ссылками на эти номера нет — строки-ссылки не трогаем.

DO $$
DECLARE
  prod RECORD;
  n int;
  candidate text;
  changed int := 0;
BEGIN
  FOR prod IN
    SELECT p.id, p.number AS old_number, p."projectId", pr.number AS proj_number
    FROM "Product" p
    JOIN "Project" pr ON pr.id = p."projectId"
    WHERE p.number ~ '[.\-]$' OR p.number = pr.number
    ORDER BY pr."numberInt" ASC, p."createdAt" ASC, p.id ASC
  LOOP
    n := COALESCE(
      (SELECT max("suffixInt") FROM "Product" WHERE "projectId" = prod."projectId"),
      0
    ) + 1;
    candidate := prod.proj_number || '.' || n;
    WHILE EXISTS (
      SELECT 1 FROM "Product" WHERE number = candidate AND id <> prod.id
    ) LOOP
      n := n + 1;
      candidate := prod.proj_number || '.' || n;
    END LOOP;
    RAISE NOTICE 'Изделие «%» → «%»', prod.old_number, candidate;
    UPDATE "Product"
    SET number = candidate, "suffixInt" = n
    WHERE id = prod.id;
    changed := changed + 1;
  END LOOP;
  RAISE NOTICE 'Итого исправлено изделий: %', changed;
END $$;

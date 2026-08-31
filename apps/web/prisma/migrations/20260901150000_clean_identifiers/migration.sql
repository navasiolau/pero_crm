-- Чистые идентификаторы (решение владельца, 08.2026): убрать legacy-префиксы
-- из идентификаторов.
--
-- Схема после миграции:
--   Project.id = номер («205») — назначается и при создании новых;
--   Product.id = свежий сгенерированный код (cuid-подобный) — номер «205.21»
--   остаётся отображаемым полем (уникальным глобально);
--   остальные 13 таблиц (Client, User, Task, Work, File, Communication,
--   PriceItem, Material, MaterialCategory, ProjectMaterial, StockMovement,
--   ProductStatusHistory, ProjectStageHistory) — свежие сгенерированные коды.
--
-- Перед сменой id: нормализация номеров изделий — URL-небезопасные номера
-- («3.100 = 87587562-0467-1», «175.36 доп», …) приводятся к виду
-- «<номер проекта>.<свободный суффикс>», чтобы адрес карточки изделия
-- (/products/<номер>) был корректным у всех. Знакомые номера с точками
-- («3.01», «108.13.2») и чистые одиночные («101») сохраняются.
--
-- Колонки legacyId/legacyTable остаются как провенанс (в UI не видны).
-- Строковые ссылки (Notification.link, ChangeLog.entityId) переписываются
-- по соответствиям; DomainEvent.payload — история событий, не трогается.

-- ── 1. Нормализация URL-небезопасных номеров изделий ─────────────────────
DO $$
DECLARE
  proj RECORD;
  prod RECORD;
  n int;
  candidate text;
BEGIN
  FOR proj IN SELECT id, number FROM "Project" LOOP
    FOR prod IN
      SELECT id FROM "Product"
      WHERE "projectId" = proj.id AND number !~ '^[0-9A-Za-z.\-]+$'
      ORDER BY "createdAt" ASC, id ASC
    LOOP
      n := COALESCE((SELECT max("suffixInt") FROM "Product" WHERE "projectId" = proj.id), 0) + 1;
      candidate := proj.number || '.' || n;
      WHILE EXISTS (SELECT 1 FROM "Product" WHERE number = candidate AND id <> prod.id) LOOP
        n := n + 1;
        candidate := proj.number || '.' || n;
      END LOOP;
      RAISE NOTICE 'Изделие: новый номер «%» → «%»',
        (SELECT number FROM "Product" WHERE id = prod.id), candidate;
      UPDATE "Product" SET number = candidate, "suffixInt" = n WHERE id = prod.id;
    END LOOP;
  END LOOP;
END $$;

-- ── 2. Соответствия старых и новых идентификаторов ───────────────────────
CREATE TEMP TABLE _map_project AS
SELECT id AS old, number AS new FROM "Project";

CREATE TEMP TABLE _map_product_id AS
SELECT id AS old, 'm' || replace(gen_random_uuid()::text, '-', '') AS new FROM "Product";

-- Для строковых ссылок на изделие используется номер (URL по номеру)
CREATE TEMP TABLE _map_product_num AS
SELECT id AS old, number AS new FROM "Product";

CREATE TEMP TABLE _map_client AS
SELECT id AS old, 'm' || replace(gen_random_uuid()::text, '-', '') AS new FROM "Client";
CREATE TEMP TABLE _map_user AS
SELECT id AS old, 'm' || replace(gen_random_uuid()::text, '-', '') AS new FROM "User";
CREATE TEMP TABLE _map_task AS
SELECT id AS old, 'm' || replace(gen_random_uuid()::text, '-', '') AS new FROM "Task";
CREATE TEMP TABLE _map_work AS
SELECT id AS old, 'm' || replace(gen_random_uuid()::text, '-', '') AS new FROM "Work";
CREATE TEMP TABLE _map_file AS
SELECT id AS old, 'm' || replace(gen_random_uuid()::text, '-', '') AS new FROM "File";
CREATE TEMP TABLE _map_communication AS
SELECT id AS old, 'm' || replace(gen_random_uuid()::text, '-', '') AS new FROM "Communication";
CREATE TEMP TABLE _map_priceitem AS
SELECT id AS old, 'm' || replace(gen_random_uuid()::text, '-', '') AS new FROM "PriceItem";
CREATE TEMP TABLE _map_material AS
SELECT id AS old, 'm' || replace(gen_random_uuid()::text, '-', '') AS new FROM "Material";
CREATE TEMP TABLE _map_materialcategory AS
SELECT id AS old, 'm' || replace(gen_random_uuid()::text, '-', '') AS new FROM "MaterialCategory";
CREATE TEMP TABLE _map_projectmaterial AS
SELECT id AS old, 'm' || replace(gen_random_uuid()::text, '-', '') AS new FROM "ProjectMaterial";
CREATE TEMP TABLE _map_stockmovement AS
SELECT id AS old, 'm' || replace(gen_random_uuid()::text, '-', '') AS new FROM "StockMovement";
CREATE TEMP TABLE _map_productstatushistory AS
SELECT id AS old, 'm' || replace(gen_random_uuid()::text, '-', '') AS new FROM "ProductStatusHistory";
CREATE TEMP TABLE _map_projectstagehistory AS
SELECT id AS old, 'm' || replace(gen_random_uuid()::text, '-', '') AS new FROM "ProjectStageHistory";

-- ── 3. FK: снять → перевставить с ON UPDATE CASCADE → обновить → вернуть ─
-- Обновление родителя каскадно тянет детей; перевставка констрейнтов
-- валидирует целостность (или уронит миграцию при ошибке соответствий).
DO $$
DECLARE
  r RECORD;
  cols text;
  refcols text;
  delact text;
BEGIN
  -- Снимок всех FK, ссылающихся на 15 пере-идентифицируемых таблиц
  CREATE TEMP TABLE _fk AS
  SELECT c.conname,
         child.relname AS child_tbl,
         parent.relname AS parent_tbl,
         c.conkey, c.confkey, c.conrelid, c.confrelid, c.confdeltype
  FROM pg_constraint c
  JOIN pg_class child ON child.oid = c.conrelid
  JOIN pg_class parent ON parent.oid = c.confrelid
  WHERE c.contype = 'f'
    AND child.relnamespace = 'public'::regnamespace
    AND parent.relnamespace = 'public'::regnamespace
    AND parent.relname = ANY (ARRAY[
      'Project', 'Product', 'Client', 'User', 'Task', 'Work', 'File',
      'Communication', 'PriceItem', 'Material', 'MaterialCategory',
      'ProjectMaterial', 'StockMovement', 'ProductStatusHistory',
      'ProjectStageHistory']);

  -- Перевставка с ON UPDATE CASCADE (ON DELETE сохраняется)
  FOR r IN SELECT * FROM _fk LOOP
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY u.ord) INTO cols
    FROM unnest(r.conkey) WITH ORDINALITY AS u(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = r.conrelid AND a.attnum = u.attnum;
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY u.ord) INTO refcols
    FROM unnest(r.confkey) WITH ORDINALITY AS u(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = r.confrelid AND a.attnum = u.attnum;
    delact := CASE r.confdeltype
      WHEN 'c' THEN ' ON DELETE CASCADE'
      WHEN 'n' THEN ' ON DELETE SET NULL'
      WHEN 'r' THEN ' ON DELETE RESTRICT'
      WHEN 'd' THEN ' ON DELETE SET DEFAULT'
      ELSE '' END;
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', r.child_tbl, r.conname);
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%s) REFERENCES %I (%s)%s ON UPDATE CASCADE',
      r.child_tbl, r.conname, cols, r.parent_tbl, refcols, delact);
  END LOOP;

  -- Смена идентификаторов (каскад обновляет детей)
  UPDATE "Project" p SET id = m.new FROM _map_project m WHERE p.id = m.old;
  UPDATE "Product" p SET id = m.new FROM _map_product_id m WHERE p.id = m.old;
  UPDATE "Client" t SET id = m.new FROM _map_client m WHERE t.id = m.old;
  UPDATE "User" t SET id = m.new FROM _map_user m WHERE t.id = m.old;
  UPDATE "Task" t SET id = m.new FROM _map_task m WHERE t.id = m.old;
  UPDATE "Work" t SET id = m.new FROM _map_work m WHERE t.id = m.old;
  UPDATE "File" t SET id = m.new FROM _map_file m WHERE t.id = m.old;
  UPDATE "Communication" t SET id = m.new FROM _map_communication m WHERE t.id = m.old;
  UPDATE "PriceItem" t SET id = m.new FROM _map_priceitem m WHERE t.id = m.old;
  UPDATE "Material" t SET id = m.new FROM _map_material m WHERE t.id = m.old;
  UPDATE "MaterialCategory" t SET id = m.new FROM _map_materialcategory m WHERE t.id = m.old;
  UPDATE "ProjectMaterial" t SET id = m.new FROM _map_projectmaterial m WHERE t.id = m.old;
  UPDATE "StockMovement" t SET id = m.new FROM _map_stockmovement m WHERE t.id = m.old;
  UPDATE "ProductStatusHistory" t SET id = m.new FROM _map_productstatushistory m WHERE t.id = m.old;
  UPDATE "ProjectStageHistory" t SET id = m.new FROM _map_projectstagehistory m WHERE t.id = m.old;

  -- Возврат исходных констрейнтов (без ON UPDATE CASCADE)
  FOR r IN SELECT * FROM _fk LOOP
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY u.ord) INTO cols
    FROM unnest(r.conkey) WITH ORDINALITY AS u(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = r.conrelid AND a.attnum = u.attnum;
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY u.ord) INTO refcols
    FROM unnest(r.confkey) WITH ORDINALITY AS u(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = r.confrelid AND a.attnum = u.attnum;
    delact := CASE r.confdeltype
      WHEN 'c' THEN ' ON DELETE CASCADE'
      WHEN 'n' THEN ' ON DELETE SET NULL'
      WHEN 'r' THEN ' ON DELETE RESTRICT'
      WHEN 'd' THEN ' ON DELETE SET DEFAULT'
      ELSE '' END;
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', r.child_tbl, r.conname);
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%s) REFERENCES %I (%s)%s',
      r.child_tbl, r.conname, cols, r.parent_tbl, refcols, delact);
  END LOOP;

  DROP TABLE _fk;
END $$;

-- ── 4. Строковые ссылки ───────────────────────────────────────────────────
-- Уведомления: /projects/<id-номер>, /products/<номер>. Граница id —
-- не-буквенно-цифровой символ, чтобы «…2051» не задел «…20511».
UPDATE "Notification" n
SET link = regexp_replace(n.link, '/projects/' || m.old || '($|[^0-9A-Za-z])', '/projects/' || m.new || '\1')
FROM _map_project m
WHERE n.link LIKE '%/projects/' || m.old || '%';

UPDATE "Notification" n
SET link = regexp_replace(n.link, '/products/' || m.old || '($|[^0-9A-Za-z])', '/products/' || m.new || '\1')
FROM _map_product_num m
WHERE n.link LIKE '%/products/' || m.old || '%';

-- Журнал изменений: entityId для отображения — человекочитаемые номера
UPDATE "ChangeLog" c SET "entityId" = m.new FROM _map_project m
WHERE c.entity = 'project' AND c."entityId" = m.old;
UPDATE "ChangeLog" c SET "entityId" = m.new FROM _map_product_num m
WHERE c.entity = 'product' AND c."entityId" = m.old;
UPDATE "ChangeLog" c SET "entityId" = m.new FROM _map_client m
WHERE c.entity = 'client' AND c."entityId" = m.old;
UPDATE "ChangeLog" c SET "entityId" = m.new FROM _map_task m
WHERE c.entity = 'task' AND c."entityId" = m.old;
UPDATE "ChangeLog" c SET "entityId" = m.new FROM _map_work m
WHERE c.entity = 'work' AND c."entityId" = m.old;
UPDATE "ChangeLog" c SET "entityId" = m.new FROM _map_file m
WHERE c.entity = 'file' AND c."entityId" = m.old;
UPDATE "ChangeLog" c SET "entityId" = m.new FROM _map_material m
WHERE c.entity = 'material' AND c."entityId" = m.old;
UPDATE "ChangeLog" c SET "entityId" = m.new FROM _map_materialcategory m
WHERE c.entity = 'materialCategory' AND c."entityId" = m.old;
UPDATE "ChangeLog" c SET "entityId" = m.new FROM _map_projectmaterial m
WHERE c.entity = 'projectMaterial' AND c."entityId" = m.old;
UPDATE "ChangeLog" c SET "entityId" = m.new FROM _map_stockmovement m
WHERE c.entity = 'stockMovement' AND c."entityId" = m.old;

DROP TABLE _map_project, _map_product_id, _map_product_num, _map_client,
  _map_user, _map_task, _map_work, _map_file, _map_communication,
  _map_priceitem, _map_material, _map_materialcategory, _map_projectmaterial,
  _map_stockmovement, _map_productstatushistory, _map_projectstagehistory;

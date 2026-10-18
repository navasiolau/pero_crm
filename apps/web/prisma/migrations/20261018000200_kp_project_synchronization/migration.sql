BEGIN;

-- Не перепривязываем существующие реальные данные при обнаружении аномалии.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "ProposalItem" i
    JOIN "CommercialProposal" q ON q.id = i."proposalId"
    JOIN "Product" p ON p.id = i."productId"
    WHERE q."projectId" IS DISTINCT FROM p."projectId"
  ) THEN
    RAISE EXCEPTION 'KP181_GUARD_ITEM_PROJECT_MISMATCH' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM "Product" WHERE "deletedAt" IS NULL GROUP BY number HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'KP181_GUARD_ACTIVE_NUMBER_CONFLICT' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "Notification" n JOIN "Product" p ON
      n.link = '/products/' || p.number OR
      left(n.link, length('/products/' || p.number) + 1) IN ('/products/' || p.number || '?', '/products/' || p.number || '#')
    WHERE p.id !~ '^[A-Za-z0-9._~-]+$'
  ) THEN
    RAISE EXCEPTION 'KP181_GUARD_UNSAFE_LINK_ID' USING ERRCODE = '23514';
  END IF;
END $$;

-- Старые уведомления должны продолжить открывать то же изделие после reorder.
-- Хвост query/hash и все прочие поля сохраняются буквально.
UPDATE "Notification" n SET link = '/products/' || p.id || substring(n.link FROM length('/products/' || p.number) + 1)
FROM "Product" p
WHERE n.link = '/products/' || p.number OR
  left(n.link, length('/products/' || p.number) + 1) IN ('/products/' || p.number || '?', '/products/' || p.number || '#');

DROP INDEX "Product_number_key";
CREATE UNIQUE INDEX "Product_number_active_key" ON "Product"(number) WHERE "deletedAt" IS NULL;
CREATE INDEX "Product_number_idx" ON "Product"(number);

CREATE FUNCTION "kp181_check_item_project"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  product_project text;
  proposal_project text;
BEGIN
  IF NEW."productId" IS NULL THEN RETURN NEW; END IF;
  -- SHARE защищает проверяемые projectId от конкурентной смены родителя.
  SELECT "projectId" INTO product_project FROM "Product" WHERE id = NEW."productId" FOR SHARE;
  SELECT "projectId" INTO proposal_project FROM "CommercialProposal" WHERE id = NEW."proposalId" FOR SHARE;
  IF product_project IS NULL OR proposal_project IS NULL OR product_project <> proposal_project THEN
    RAISE EXCEPTION 'KP181_ITEM_PROJECT_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "ProposalItem_same_project" BEFORE INSERT OR UPDATE OF "proposalId", "productId" ON "ProposalItem"
FOR EACH ROW EXECUTE FUNCTION "kp181_check_item_project"();

CREATE FUNCTION "kp181_check_product_project"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."projectId" IS DISTINCT FROM OLD."projectId" AND EXISTS (
    SELECT 1 FROM "ProposalItem" i JOIN "CommercialProposal" q ON q.id = i."proposalId"
    WHERE i."productId" = NEW.id AND q."projectId" IS DISTINCT FROM NEW."projectId"
  ) THEN
    RAISE EXCEPTION 'KP181_PRODUCT_PROJECT_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "Product_proposal_same_project" BEFORE UPDATE OF "projectId" ON "Product"
FOR EACH ROW EXECUTE FUNCTION "kp181_check_product_project"();

CREATE FUNCTION "kp181_check_proposal_project"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."projectId" IS DISTINCT FROM OLD."projectId" AND EXISTS (
    SELECT 1 FROM "ProposalItem" i JOIN "Product" p ON p.id = i."productId"
    WHERE i."proposalId" = NEW.id AND p."projectId" IS DISTINCT FROM NEW."projectId"
  ) THEN
    RAISE EXCEPTION 'KP181_PROPOSAL_PROJECT_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "CommercialProposal_product_same_project" BEFORE UPDATE OF "projectId" ON "CommercialProposal"
FOR EACH ROW EXECUTE FUNCTION "kp181_check_proposal_project"();

COMMIT;

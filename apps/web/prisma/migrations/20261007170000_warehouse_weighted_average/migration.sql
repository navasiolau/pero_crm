-- Добавочная схема: без сброса старых остатков и без изменения старых строк.
CREATE TABLE "WarehouseAccountingState" (
 "id" TEXT PRIMARY KEY,"phase" TEXT NOT NULL,"runId" TEXT NOT NULL UNIQUE,
 "backupSha256" TEXT,"proofSha256" TEXT,"beforePrices" JSONB NOT NULL,"beforeBalances" JSONB NOT NULL,"protectedSnapshot" JSONB,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "WarehouseAccountingState_shape" CHECK ("id"='main' AND "phase" IN ('FROZEN','VERIFYING','ACTIVE','RESTORED')
 AND ("backupSha256" IS NULL OR "backupSha256" ~ '^[a-f0-9]{64}$') AND ("proofSha256" IS NULL OR "proofSha256" ~ '^[a-f0-9]{64}$'))
);
CREATE TABLE "WarehouseBalance" (
 "materialId" TEXT PRIMARY KEY REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "runId" TEXT NOT NULL,"quantity" DECIMAL(12,3) NOT NULL DEFAULT 0,"valueByn" DECIMAL(30,9) NOT NULL DEFAULT 0,"revision" INTEGER NOT NULL DEFAULT 0,
 CONSTRAINT "WarehouseBalance_shape" CHECK ("quantity">=0 AND "quantity"<>'NaN' AND "valueByn">=0 AND "valueByn"<>'NaN' AND "revision">=0 AND ("quantity"<>0 OR "valueByn"=0))
);
CREATE TABLE "WarehouseMovementValuation" (
 "id" TEXT PRIMARY KEY,"movementId" TEXT NOT NULL UNIQUE REFERENCES "StockMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "sourceMovementId" TEXT REFERENCES "StockMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "runId" TEXT NOT NULL,"clientMutationId" TEXT NOT NULL UNIQUE,"requestFingerprint" TEXT NOT NULL,"actorId" TEXT NOT NULL,
 "quantity" DECIMAL(12,3) NOT NULL,"unitCost" DECIMAL(24,9) NOT NULL,"valueByn" DECIMAL(30,9) NOT NULL,"moneyByn" DECIMAL(12,2) NOT NULL,
 "returnedQuantity" DECIMAL(12,3) NOT NULL DEFAULT 0,"returnedValueByn" DECIMAL(30,9) NOT NULL DEFAULT 0,"returnedMoneyByn" DECIMAL(12,2) NOT NULL DEFAULT 0,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "WarehouseMovementValuation_shape" CHECK ("quantity">0 AND "unitCost">0 AND "valueByn">0 AND "moneyByn">=0
 AND "quantity"<>'NaN' AND "unitCost"<>'NaN' AND "valueByn"<>'NaN' AND "moneyByn"<>'NaN'
 AND "returnedQuantity">=0 AND "returnedQuantity"<="quantity" AND "returnedValueByn">=0 AND "returnedValueByn"<="valueByn" AND "returnedMoneyByn">=0 AND "returnedMoneyByn"<="moneyByn"
 AND "returnedQuantity"<>'NaN' AND "returnedValueByn"<>'NaN' AND "returnedMoneyByn"<>'NaN')
);
CREATE INDEX "WarehouseMovementValuation_sourceMovementId_idx" ON "WarehouseMovementValuation"("sourceMovementId");

-- Операторский fingerprint сравнивает все старые строки в одном MVCC-снимке.
CREATE FUNCTION warehouse_protected_snapshot() RETURNS JSONB AS $$
DECLARE item RECORD; summary JSONB; result JSONB:='{}'; expression TEXT;
BEGIN
 FOR item IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('WarehouseAccountingState','WarehouseBalance','WarehouseMovementValuation') ORDER BY tablename LOOP
  expression:=CASE WHEN item.tablename='Material' THEN '(to_jsonb(t)-''purchasePrice'')::text' ELSE 'to_jsonb(t)::text' END;
  EXECUTE format('SELECT jsonb_build_object(''rows'',count(*),''hash'',md5(COALESCE(string_agg(h,'''' ORDER BY h),''''))) FROM (SELECT md5(%s) h FROM public.%I t) x',expression,item.tablename) INTO summary;
  result:=result||jsonb_build_object(item.tablename,summary);
 END LOOP;
 RETURN result;
END; $$ LANGUAGE plpgsql;

CREATE FUNCTION warehouse_freeze(wanted_run TEXT) RETURNS JSONB AS $$
DECLARE existing RECORD; prices JSONB; balances JSONB;
BEGIN
 IF wanted_run !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' THEN RAISE EXCEPTION 'WAREHOUSE_RUN_ID_INVALID'; END IF;
 PERFORM pg_advisory_xact_lock(18436,94001);
 SELECT * INTO existing FROM "WarehouseAccountingState" WHERE id='main' FOR UPDATE;
 IF FOUND AND existing."runId"=wanted_run THEN RETURN jsonb_build_object('runId',wanted_run,'phase',existing.phase,'repeated',true); END IF;
 IF FOUND AND existing.phase<>'RESTORED' THEN RAISE EXCEPTION 'WAREHOUSE_ALREADY_INITIALIZED'; END IF;
 IF EXISTS(SELECT 1 FROM "WarehouseMovementValuation") THEN RAISE EXCEPTION 'WAREHOUSE_NEW_MOVEMENTS_EXIST'; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'price',"purchasePrice") ORDER BY id),'[]') INTO prices FROM "Material";
 SELECT COALESCE(jsonb_agg(to_jsonb(b) ORDER BY "materialId"),'[]') INTO balances FROM "WarehouseBalance" b;
 INSERT INTO "WarehouseAccountingState" (id,phase,"runId","beforePrices","beforeBalances","updatedAt") VALUES ('main','FROZEN',wanted_run,prices,balances,NOW())
 ON CONFLICT(id) DO UPDATE SET phase='FROZEN',"runId"=wanted_run,"beforePrices"=prices,"beforeBalances"=balances,"backupSha256"=NULL,"proofSha256"=NULL,"protectedSnapshot"=NULL,"updatedAt"=NOW();
 RETURN jsonb_build_object('runId',wanted_run,'phase','FROZEN','materials',jsonb_array_length(prices));
END; $$ LANGUAGE plpgsql;

CREATE FUNCTION warehouse_attach_recovery_proof(wanted_run TEXT, backup_sha TEXT, proof_sha TEXT) RETURNS JSONB AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(18436,94001);
 IF backup_sha !~ '^[a-f0-9]{64}$' OR proof_sha !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'WAREHOUSE_RECOVERY_PROOF_INVALID'; END IF;
 UPDATE "WarehouseAccountingState" SET "backupSha256"=backup_sha,"proofSha256"=proof_sha,"updatedAt"=NOW() WHERE id='main' AND "runId"=wanted_run AND phase='FROZEN';
 IF NOT FOUND THEN RAISE EXCEPTION 'WAREHOUSE_FROZEN_RUN_REQUIRED'; END IF;
 RETURN jsonb_build_object('runId',wanted_run,'proofAttached',true);
END; $$ LANGUAGE plpgsql;

CREATE FUNCTION warehouse_zero_start(wanted_run TEXT, backup_sha TEXT, proof_sha TEXT) RETURNS JSONB AS $$
DECLARE state RECORD; before_data JSONB; current_prices JSONB;
BEGIN
 PERFORM pg_advisory_xact_lock(18436,94001);
 SELECT * INTO state FROM "WarehouseAccountingState" WHERE id='main' FOR UPDATE;
 IF NOT FOUND OR state."runId"<>wanted_run THEN RAISE EXCEPTION 'WAREHOUSE_RUN_MISMATCH'; END IF;
 IF state.phase IN ('VERIFYING','ACTIVE') THEN RETURN jsonb_build_object('runId',wanted_run,'phase',state.phase,'repeated',true); END IF;
 IF state.phase<>'FROZEN' OR state."backupSha256" IS DISTINCT FROM backup_sha OR state."proofSha256" IS DISTINCT FROM proof_sha OR backup_sha IS NULL OR proof_sha IS NULL THEN RAISE EXCEPTION 'WAREHOUSE_VERIFIED_BACKUP_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM "WarehouseMovementValuation") THEN RAISE EXCEPTION 'WAREHOUSE_NEW_MOVEMENTS_EXIST'; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'price',"purchasePrice") ORDER BY id),'[]') INTO current_prices FROM "Material";
 IF current_prices IS DISTINCT FROM state."beforePrices" THEN RAISE EXCEPTION 'WAREHOUSE_BACKUP_PRICE_SNAPSHOT_CHANGED'; END IF;
 before_data:=warehouse_protected_snapshot();
 INSERT INTO "WarehouseBalance" ("materialId","runId",quantity,"valueByn",revision) SELECT id,wanted_run,0,0,0 FROM "Material"
 ON CONFLICT("materialId") DO UPDATE SET "runId"=wanted_run,quantity=0,"valueByn"=0,revision=0;
 UPDATE "Material" SET "purchasePrice"=0 WHERE "purchasePrice" IS DISTINCT FROM 0;
 IF warehouse_protected_snapshot() IS DISTINCT FROM before_data THEN RAISE EXCEPTION 'WAREHOUSE_PROTECTED_DATA_CHANGED'; END IF;
 UPDATE "WarehouseAccountingState" SET phase='VERIFYING',"protectedSnapshot"=before_data,"updatedAt"=NOW() WHERE id='main';
 RETURN jsonb_build_object('runId',wanted_run,'phase','VERIFYING','materials',jsonb_array_length(state."beforePrices"),'protectedDataMatched',true);
END; $$ LANGUAGE plpgsql;

CREATE FUNCTION warehouse_activate(wanted_run TEXT) RETURNS JSONB AS $$
DECLARE state RECORD;
BEGIN
 PERFORM pg_advisory_xact_lock(18436,94001);
 SELECT * INTO state FROM "WarehouseAccountingState" WHERE id='main' FOR UPDATE;
 IF NOT FOUND OR state."runId"<>wanted_run THEN RAISE EXCEPTION 'WAREHOUSE_RUN_MISMATCH'; END IF;
 IF state.phase='ACTIVE' THEN RETURN jsonb_build_object('runId',wanted_run,'phase','ACTIVE','repeated',true); END IF;
 IF state.phase<>'VERIFYING' OR EXISTS(SELECT 1 FROM "Material" WHERE "purchasePrice" IS DISTINCT FROM 0) OR EXISTS(SELECT 1 FROM "WarehouseBalance" WHERE quantity<>0 OR "valueByn"<>0 OR "runId"<>wanted_run) OR (SELECT count(*) FROM "Material")<>(SELECT count(*) FROM "WarehouseBalance") THEN RAISE EXCEPTION 'WAREHOUSE_ZERO_VERIFICATION_REQUIRED'; END IF;
 UPDATE "WarehouseAccountingState" SET phase='ACTIVE',"updatedAt"=NOW() WHERE id='main';
 RETURN jsonb_build_object('runId',wanted_run,'phase','ACTIVE');
END; $$ LANGUAGE plpgsql;

CREATE FUNCTION warehouse_restore_start(wanted_run TEXT, backup_sha TEXT, proof_sha TEXT) RETURNS JSONB AS $$
DECLARE state RECORD; before_data JSONB;
BEGIN
 PERFORM pg_advisory_xact_lock(18436,94001);
 SELECT * INTO state FROM "WarehouseAccountingState" WHERE id='main' FOR UPDATE;
 IF NOT FOUND OR state."runId"<>wanted_run OR state."backupSha256" IS DISTINCT FROM backup_sha OR state."proofSha256" IS DISTINCT FROM proof_sha OR backup_sha IS NULL OR proof_sha IS NULL THEN RAISE EXCEPTION 'WAREHOUSE_RECOVERY_RUN_MISMATCH'; END IF;
 IF state.phase='RESTORED' THEN RETURN jsonb_build_object('runId',wanted_run,'phase','RESTORED','repeated',true); END IF;
 IF state.phase NOT IN ('VERIFYING','ACTIVE') THEN RAISE EXCEPTION 'WAREHOUSE_RECOVERY_STATE_INVALID'; END IF;
 IF EXISTS(SELECT 1 FROM "WarehouseMovementValuation") THEN RAISE EXCEPTION 'WAREHOUSE_NEW_MOVEMENTS_REQUIRE_SELECTIVE_RECOVERY'; END IF;
 before_data:=warehouse_protected_snapshot();
 UPDATE "Material" m SET "purchasePrice"=CASE WHEN p->'price'='null'::jsonb THEN NULL ELSE (p->>'price')::numeric END FROM jsonb_array_elements(state."beforePrices") p WHERE m.id=p->>'id';
 DELETE FROM "WarehouseBalance" WHERE "runId"=wanted_run AND "materialId" IN (SELECT p->>'id' FROM jsonb_array_elements(state."beforePrices") p);
 INSERT INTO "WarehouseBalance" ("materialId","runId",quantity,"valueByn",revision)
 SELECT b->>'materialId',b->>'runId',(b->>'quantity')::numeric,(b->>'valueByn')::numeric,(b->>'revision')::integer FROM jsonb_array_elements(state."beforeBalances") b
 ON CONFLICT("materialId") DO UPDATE SET "runId"=EXCLUDED."runId",quantity=EXCLUDED.quantity,"valueByn"=EXCLUDED."valueByn",revision=EXCLUDED.revision;
 IF warehouse_protected_snapshot() IS DISTINCT FROM before_data THEN RAISE EXCEPTION 'WAREHOUSE_PROTECTED_DATA_CHANGED'; END IF;
 UPDATE "WarehouseAccountingState" SET phase='RESTORED',"updatedAt"=NOW() WHERE id='main';
 RETURN jsonb_build_object('runId',wanted_run,'phase','RESTORED','protectedDataMatched',true);
END; $$ LANGUAGE plpgsql;

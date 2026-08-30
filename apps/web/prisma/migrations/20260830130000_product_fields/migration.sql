-- Поля изделия по требованиям владельца: вид изделия (текст), замерщик
-- (ссылка на сотрудника), эскиз (изображение). Клиент/адрес/телефон
-- подтягиваются из проекта без копирования в изделие.

ALTER TABLE "Product" ADD COLUMN "kind" TEXT;
ALTER TABLE "Product" ADD COLUMN "surveyorId" TEXT;
ALTER TABLE "Product" ADD COLUMN "sketchFileId" TEXT;

CREATE UNIQUE INDEX "Product_sketchFileId_key" ON "Product"("sketchFileId");

ALTER TABLE "Product" ADD CONSTRAINT "Product_surveyorId_fkey" FOREIGN KEY ("surveyorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_sketchFileId_fkey" FOREIGN KEY ("sketchFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Заполнение из legacy (только чтение) ────────────────────────────────────
-- kind = f2641 «Вид изделия», surveyorId = f4061 «Замерщик» (id сотрудника
-- t46), эскиз = первый файл поля f3851 «Фото эскиз изделия» (из files).
CREATE EXTENSION IF NOT EXISTS dblink;

DO $legacy$
DECLARE
  v_has_legacy boolean := false;
BEGIN
  BEGIN
    PERFORM dblink_connect('legacy', 'host=host.docker.internal port=5432 dbname=pero_legacy_clean user=pero password=pero_legacy_dev');
    v_has_legacy := true;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Legacy DB недоступна, заполнение пропущено: %', SQLERRM;
  END;

  IF v_has_legacy THEN
    -- Вид изделия и замерщик (f4061 хранит ФИО — резолв по словарю t46;
    -- «удален» и прочий мусор → NULL)
    UPDATE "Product" p SET
      kind       = NULLIF(btrim(s.kind), ''),
      "surveyorId" = su.uid
    FROM dblink('legacy', $q$
      SELECT p.id::text,
             btrim(p.f2641) AS kind,
             m.id::text AS surveyor
      FROM t181 p
      LEFT JOIN t46 m ON btrim(m.f483) = btrim(p.f4061)
    $q$) AS s(id text, kind text, surveyor text)
    CROSS JOIN LATERAL (
      SELECT CASE WHEN s.surveyor ~ '^[0-9]+$' THEN 'legacy_user_' || s.surveyor END AS uid
    ) su
    WHERE p."legacyTable" = 't181' AND p."legacyId" = s.id;

    -- Эскиз: первый файл поля f3851 у записи t181
    UPDATE "Product" p SET "sketchFileId" = 'legacy_file_' || sk.fid
    FROM dblink('legacy', $q$
      SELECT DISTINCT ON (fl.record_id) fl.record_id::text AS rid, fl.id::text AS fid
      FROM files fl
      WHERE fl.table_id = 181 AND fl.field_id = 3851
      ORDER BY fl.record_id, fl.id
    $q$) AS sk(rid text, fid text)
    WHERE p."legacyTable" = 't181' AND p."legacyId" = sk.rid;

    PERFORM dblink_disconnect('legacy');
  END IF;
END
$legacy$;

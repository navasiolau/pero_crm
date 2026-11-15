-- Совместимое расширение: исходные события и квитанции остаются неизменными.
ALTER TABLE "ChangeLog"
  ADD COLUMN "presentation" JSONB,
  ADD COLUMN "searchText" TEXT;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "ChangeLog_searchText_trgm_idx"
  ON "ChangeLog" USING GIN ("searchText" gin_trgm_ops);

CREATE INDEX "ChangeLog_contexts_gin_idx"
  ON "ChangeLog" USING GIN (("presentation" -> 'contexts') jsonb_path_ops);

# Tasks
## 1. Контракт
- [x] 1.1 FF/apply strict до code, 140000 scope/retention.
- [x] 1.2 Проверены metadata CAS/ACL/snapshot retention и реальный transport unit: итоговые 24 теста PASS. Первичный RED до реализации backend не зафиксирован; доказательство RED→GREEN для всей задачи не заявляется.
## 2. Реализация
- [x] 2.1 Schema/core/storage/routes known commit/original/hash/ACL/cache/exact cleanup.
- [x] 2.2 Catalogue + Product snapshot UI protected preview/fullscreen, nullable copy без backfill; UI реализован и проверен Root.
- [x] 2.3 Native outer rollback BUILD ONLY, TSC и scoped lint PASS, source freeze. Автор native не запускал; реальные SQL/S3 проверки относятся к 3.1.
  - Fingerprint охватывает все public tables, columns/constraints/indexes/enums, triggers, functions/procedures, views/materialized views, sequence definitions; данные populated materialized views проверяются отдельно. Расширенный bundle пересобран, syntax PASS; SQL автором не выполнялся.
## 3. Приёмка
- [ ] 3.1 Root guardedmigration/nativeactualmetadata +actualS3/blob/finalfunctionalQA.

- Coordinator actual LOCAL: миграция140 с no-backfill/original48-table proof PASS; native SQL 6 групп, все49 public tables и полный schema fingerprint MATCH после outer rollback, externalFetchCalls0. Приватные receipts sample74/local-migration-2df6126c-4716-4ead-8a60-06da98872d9d.private.json и sample74/native-result.private.log. Hosted S3/staging остаются pending.

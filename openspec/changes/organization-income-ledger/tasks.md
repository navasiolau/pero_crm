# Tasks

## 1. Setup

- [x] 1.1 Подготовить strict-valid4 artifacts на fresh feature61 и прочесть apply context.

## 2. Core

- [x] 2.1 Добавить nullable Payment и direction/project CHECK миграцию без переписи истории; проверить static regression и own Prisma generate.
- [x] 2.2 Реализовать общий INCOME/strict EXPENSE/атомарный audit-outbox и nullable delete/projections; meaningful RED→GREEN cash/FX/null/rollback/ACL tests.
- [x] 2.3 Подключить finance-only journal и optional live project picker к общему PaymentDialog; проверить TypeScript и scoped lint.

## 3. Verification

- [x] 3.1 Собрать private native outer-rollback runner для actual DDL/core/sums/all-table data+schema fingerprint; не запускать DB работником.
- [ ] 3.2 Root выполняет local native и actual staging image/health/smoke общего прихода/удаления без нарушений balances; записать реальные receipts.

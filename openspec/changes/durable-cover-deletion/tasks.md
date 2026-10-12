# Tasks

## 1. Manual adapters

- [x] 1.1 Зафиксировать targeted RED обоих delete actions: committed storage outage даёт pending durable cleanup, legacy replay даёт confirmed reconciliation без physical effects.
- [x] 1.2 Выделить существующий137 receipt/intent writer и подключить новые manual cores в ту же CAS/domain transaction; rollback/replay/current ACL tests должны стать GREEN.
- [x] 1.3 Подключить actions к cleanup137 и confirmed pending DTO; targeted legacy/new-pointer/ordinary/replacement compatibility должны сохранить исторические receipts/bytes и новый pointer.

## 2. Verification

- [x] 2.1 Scoped typing/lint/OpenSpec/independent CODE review; atomic138 diff относительно137, schema/old receipts/replacement-route неизменность записать в evidence.
- [x] 2.2 После reviewed thin protocol/Root ONE выполнить existing-local native CAS/replay/rollback/storage fault для двух adapters с exact own cleanup/full-original equality без новой матрицы.
- [ ] 2.3 После normal137→138 merge/CI принять actual staging identity/scoped manual deletion/cleanup; до этого local/stage/S3 actual отмечать NOT_RUN.

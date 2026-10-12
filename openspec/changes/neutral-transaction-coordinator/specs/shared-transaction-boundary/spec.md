# Spec Delta

## ADDED Requirements

### Requirement: One neutral transaction adapter

All existing aliases MUST использовать один neutral adapter с lock18435/55001, ReadCommitted, maxWait5000/timeout15000. Lock SHALL захватываться перед callback; errors/rollback/return type MUST сохраняться. Confirmation fresh fence SHALL ждать тот же transaction-scoped lock.

#### Scenario: Legacy and neutral entrypoints
- **WHEN** вызываются legacytask или neutral adapter
- **THEN** используются те же factory/singleton objects и SQL/options/order

### Requirement: Mixed monetary writer serialization

Expense500 иadvance600 изcash1000 MUST разрешать ровно одну операцию, отрицательный balance запрещён; replay SHALL не писать повторно. Segmentation и warehouse/logistics isolation policies MUST NOT изменяться.

#### Scenario: Two real connections and rollback
- **WHEN** смешанные writers конкурируют и fresh fence ждёт завершения прежнего abort/commit
- **THEN** secondwriter видит protected balance/currentreceipt, rollback не оставляет own effects, originals preserved

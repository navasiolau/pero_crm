# Tasks
## 1. Контракт
- [x] 1.1 RED/GREEN genuine core tests current actor/status/PriceItem, strict payload, exact quantity/price and audit rollback.
- [x] 1.2 Выделить atomic addWork core/thin action и scoped picker; сохранить manager independent flow и historical snapshots, focused tests.
- [x] 1.3 Additive unitSnapshot migration без backfill и ordinaryWork read/money masks; exact core/read tests.
## 2. UI
- [x] 2.1 Отдельный canAddWork на PRODUCTION Product, не менять manager/task/price CRUD gates; meaningful SSR permission tests.
## 3. Проверка
- [x] 3.1 Private client/deps, full regressions, TSC/scoped lint и strict validate.
- [ ] 3.2 Root native/local/staging acceptance без DB execution агентом.

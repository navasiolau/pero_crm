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

## 4. Уточнение владельца: конкретная оплачиваемая работа
- [x] 4.1 RED→GREEN manager create/update обязательных Work/Product/executor и известной цены; zero и quantity allocation сохранить.
- [x] 4.2 Additive server reward DTO без historical repricing или FX fallback.
- [x] 4.3 Structural Work/Product/executor workspace quarantine по прямому уточнению владельца и readonly происхождению t47; без DELETE/изменения финансовых фактов.
- [ ] 4.4 Root local/staging acceptance actual обновлённого writer/read контракта.

- [x] 4.5 Исправить reviewer gap обеих reward-веток: actual Work/Product/Project join и NULL/foreign/deleted negative tests; исходные monetary snapshots неизменны.

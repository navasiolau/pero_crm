# Tasks
## 1. Основа
- [x] 1.1 Добавить nullable metadata Project/Product additive migration; private client generate и TSC проверяют совместимость.
- [x] 1.2 Общие live predicates/read guards; RED/GREEN тесты parent deletion, manager/union deny и рабочих дочерних сущностей.
## 2. Рабочие каналы
- [x] 2.1 Закрыть прямые operational lookup и mutation guards до replay; focused API/core tests подтверждают отсутствие writes/старого ACK.
- [x] 2.2 Сохранить finance/history/max-number queries; regression tests подтверждают исторические суммы и непереиспользование номера.
## 3. Проверка
- [x] 3.1 Focused regression, own TSC/scoped lint и strict OpenSpec validation PASS.
- [ ] 3.2 Root применяет миграцию/native/staging acceptance; отдельные55/56 реализуют deletion actions/UI.

# Tasks

## 1. Независимое ядро и UI

- [x] 1.1 Реализовать отдельный reassign contract/core/query/actions с актуальными правами, immutable сохранностью, CAS/UUID/replay; проверить targeted core cases.
- [x] 1.2 Добавить dialog/button с live options и замороженным retry, opt-in ширину/перенос work/rate selectors; проверить существующим component harness.

## 2. Интеграция после зависимости №191

- [x] 2.1 После обычного merge191 подключить narrow read grant/DTO/actions/task-dialog/my/tasks-tab и закрыть generic ordinary assignee update; проверить targeted роли и UI.
- [x] 2.2 Выполнить typecheck/scoped lint/OpenSpec/diff-check, записать фактические результаты без БД/инфраструктуры.
- [ ] 2.3 Root: принять согласованный staging SHA/образ и затронутые реальные сценарии.

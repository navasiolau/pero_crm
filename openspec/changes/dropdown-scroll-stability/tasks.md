# Tasks

## 1. Причина и исправление

- [x] 1.1 Изолированный baseline/causal control original components: 12 измеренных scroll-сценариев, focus trace доказывает early React autoFocus; ordinary Select/body lock стабильны.
- [x] 1.2 Перенести focus поиска в штатный Popover initialFocus; GREEN sandbox подтверждает focus/query/selection/Escape и координаты без scrollTo или подавления aria. 4 mouse/Escape cases + 12 повторных keyboard selections PASS.
- [x] 1.3 Добавить focused regression sandbox исходных контролов с координатами/фокусом и неизменностью shared Select; tsc PASS, lint 0 errors/0 warnings, strict OpenSpec VALID. Собственный browser/server закрыты.

## 2. Интеграция

- [ ] 2.1 Root после всех №33–38 выполняет actual CRM browser acceptance и staging точного SHA; sandbox не заменяет приёмку приложения.

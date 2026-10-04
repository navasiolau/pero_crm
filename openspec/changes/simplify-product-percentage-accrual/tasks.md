# Tasks

## 1. Домен и формулы

- [x] 1.1 Зафиксировать meaningful RED→GREEN для инженерной цены1шт, отсутствия/незавершённости работ, retired workReview, однократности и исторического stage guard; focused tests подтверждают поведение.
- [x] 1.2 Удалить активную классификацию из contracts/patch/query/direct completion/stage policy и эффект coverage на обычный Task completion; устаревший patch отказан, сдельные frozen обязательства сохранены, regression tests PASS.
- [x] 1.3 Ввести calculationVersion3 и совместимую CHECK migration без изменения старых ветвей1/2; проверить source migrations/SQL tests и настоящее принятие/отказ формы3 на existing DB.
- [x] 1.4 Исправить процент ENGINEERING и предварительные server DTO; pretransition status/history и existingcompletion защищают прошлое/повторы без Work/Task reads, focused tests PASS.

## 2. Интерфейс

- [x] 2.1 Удалить review list/controller/flush barrier и DTO wiring, сохранить employee/rate typed inline saves; controller/UI behavior tests RED→GREEN.
- [x] 2.2 Предварительная сумма ENGINEERING отunitPrice, остальные отunitPrice×quantity; quantity>1 и его изменение, frozen totals проверены тестами.

## 3. Проверка и staging

- [x] 3.1 Existing local DB: применить только новую миграцию и выполнить native OUTERROLLBACK полный цикл без работ, незакрытые задачи, v3 суммы50/120/210, frozen v1/v2, no-retro и replay; original-data fingerprints/rollback PASS, без дампа/seed/newDB.
- [x] 3.2 TypeScript, необходимые целевые/общие regression tests, lint и strict OpenSpec PASS; независимое ревью исправляет конкретные замечания перед commit.
- [ ] 3.3 Обычный commit/merge/push staging; CI PASS и actual deployed SHA/image/health/new migration подтверждены. Main/production не меняются.
- [ ] 3.4 Actual staging: native сценарии и focused browser карточка/формулы/отсутствие классификации приняты, собственные QA effects очищены; сохранить краткий receipt и итоговый SHA.

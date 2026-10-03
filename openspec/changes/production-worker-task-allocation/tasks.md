# Tasks

## 1. Серверное назначение

- [x] 1.1 Подготовить meaningful RED тесты полномочий, active WORKER получателя, контекста, quantity/legacy budget и UUID repeat.
- [x] 1.2 Создать отдельные core/action/query с атомарными task/audit/event/receipt, проверкой текущих ролей и зависимостей; подтвердить GREEN и сохранение истории.

## 2. Интерфейс и приёмка

- [x] 2.1 Добавить worker диалог назначения на строке работы и безопасные краткие сведения о назначениях; проверить typecheck и сохранность manager flow.
- [x] 2.2 Выполнить focused tests, lint и strict OpenSpec; сохранить реальные результаты.
- [ ] 2.3 После merge/CI проверить реально развёрнутый staging SHA: два WORKER, расходование остатка, отказ превышения и чужого исполнения, повтор, автоматический таймер и зависимости.
- [x] 2.4 Уточнение03.10 UI: убрать generic/unassigned создание, фиксировать работу изделия и одного исполнителя; удалить task share%/split presentation, сохранить independent quantity и исторические суммы. Genuine manager-control RED2PASS/1FAIL → GREEN.
- [x] 2.5 Task UI использует additive server reward DTO68 без client reprice/share fallback; проверить 0BYN, missing amount, actualTaskDialog безshare%, закреплённое название работы и unknownACK retry неизменного quantity назначения.
- [ ] 2.6 Координатор проверяет integration68 reward DTO/createdAssignments projection, OWN private current Prisma generation/fullTSC и strict/whole checks перед commit; первоначальный stale-client fullTSC FAIL не считается PASS.
- [ ] 2.7 После merge/CI actual browser: manager/worker назначение конкретной работы изделия одному исполнителю, независимые количества/остаток, reward из server snapshot включая0BYN, отсутствие generic/no-money/share/split controls; exact owned cleanup без пересчёта frozen history.

Локально 03.10.2026: domain RED 3 PASS/2 FAIL до реализации → 10/10 GREEN. Итоговый набор domain/UI/dialog/work-creation regression — 13 PASS/0 FAIL. Shared web TSC PASS; scoped lint backend/UI 0 ошибок/0 предупреждений. Проверены настоящий Decimal scalar, exact UUID replay/stale receipt, active роль, чужой контекст, legacy group volume и unknown legacy quantity без догадки, dependency group scope, atomic audit, measurement photo и неизвестный клиентский ACK. Первичный UI RED был ошибкой отсутствующего Prisma до установки зависимостей, он сохранён и не считается behavioral TDD. Native и hosted staging проверяет координатор; текущие тесты не являются доказательством SQL/runtime. Приватные логи — apps/web/.playwright-mcp/development69 и root .playwright-mcp/corrections.

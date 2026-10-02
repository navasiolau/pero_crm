# Статус и бот №18: локальные доказательства

Проверки выполнены 02.10.2026 в feature/18; реальная БД, браузер, staging и Git этим исполнителем не использовались.

## Доменный статус

`pnpm --filter @pero/web exec tsx --test tests/project-stage-contract.test.ts tests/project-stage-core.test.ts` — 7/7 PASS. Проверены закрытый контракт/baseline/UUID, обязательные новые extras, необязательный отказный комментарий, competing CAS, точный receipt replay и отказ повторного ID с изменённым payload, ролевое объединение и запреты, исторический same-stage no-op, rollback всей stage/date/history/audit/outbox при ошибке outbox.

Первый contract RED был ошибкой отсутствующего модуля. Эти transaction tests написаны после реализации и сами по себе не являются историческим TDD RED старого ядра.

Отдельно воспроизведена sourcebaseline regression demonstration на точной private ignored копии старого `stage-core.ts` из `D:/Projects/pero_crm_worktrees/modernization-staging/apps/web/src/server/projects/stage-core.ts`. Root подтвердил HEAD checkout `6edd76ef2cee0b7ce40c5df4399ea9b7570b0728` и отсутствие изменений этого файла в №17. SHA256 оригинала и копии совпали: `158930BB4D34BB667C8A14D9C5A4A391B652889A466CDA69C6478033C918CB9C`. Рабочий source №18 не откатывался.

Harness: `apps/web/test-results/project-stage-regression/desired.test.mts`; точная копия: соседний `stage-core-baseline.mts` (расширение изменено, байты сохранены). При `PROJECT_STAGE_REGRESSION_SOURCE=baseline` desired tests двух новых переходов без extras FAIL: `actual true !== expected false`, 0/2 PASS. При `PROJECT_STAGE_REGRESSION_SOURCE=current` те же случаи PASS, 2/2; оба отклонены без writes. Это выполненная после реализации демонстрация регрессии на исходнике, не заявление о TDD до реализации.

Targeted ESLint всех status server/UI/API файлов PASS.

## Bot edit lost ACK

`pnpm --filter @pero/telegram-bot test` — build и 18/18 PASS. До изменения ordinary edit DTO новый тест `ordinary project edits retry same field receipt after commit then lost ACK` FAIL: `clientMutationId` undefined. После изменения title/address/manager отправляют closed ProjectPatch в существующий PATCH route, expectedValue берётся из захваченного fullBaseline, UUID создаётся при открытии диалога и сохраняется при повторе того же значения. Fake HTTP server пишет receipt, затем теряет ACK: повтор того же ID/payload даёт ровно одну запись (все три поля).

Отдельные PASS: новое намеренное значение получает новый UUID без подмены baseline; conflict сохраняет диалог и требует явно открыть редактирование заново; автоматического GET непосредственно перед записью нет. initialPrice остаётся прежним compatibility fullbaseline writer до №26.

Status bot tests подтверждают capture stage одним GET при открытии меню, token-отказ stale callback, extras draft после отказа, необязательный комментарий «—», повтор того же stage UUID/payload после lost ACK. Нативный API/DB rollback и браузерный barrier/визуальная проверка принадлежат root.

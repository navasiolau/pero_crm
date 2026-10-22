# Проверки №192

Root native local5433 — PASS на SHA `d7826e9f674c423a24f9e831ef92fc7a2463574e`. Настоящий core переназначил занятую групповую задачу с суммой 300 BYN новому исполнителю и статусом NEW; ID, объём 10, файлы, зависимости, снимок оплаты и прежняя история времени сохранились. UUID replay и stale revision не записали данные. Завершённая/начисленная задача защищена; координатор не получил выполнение чужой задачи, новый исполнитель получил ровно одно начисление 300 BYN. Вся проба откатилась одной внешней транзакцией: все 77 таблиц и каталог совпали до/после. Квитанция `C:/Users/admin/.codex/tmp/pero-crm-190-196/acceptance/local192.json`, digest `2a14122d231f97d22cc4ca7aba8716cfd8e59280b35e2447af5cf2634446161f`.

feature/192 от3def4f0c. По прямому поручению Root выполнен обычный dependency merge96187eadd595c257fcbe7ca240f320f59dc7be50 (№191, включает190dea3ae52) → feature/192; merge74f60d42, без конфликтов/stash. Собственные изменения сохранены, прочие коммиты/push/deploy не выполнялись.

Зависимости frozen установлены в `C:/Users/admin/.codex/tmp/pero-crm-190-196/requests-192/node_modules/.pnpm`, lockfile не изменён. Prisma generate — только генерация клиента, без БД. Все следующие pnpm-команды запускались с `--config.verifyDepsBeforeRun=false`.

## Результаты

- Новый task-reassignment core:6/6 PASS. Проверены свежие роли/отзыв доступа, CAS, exact UUID replay, запрет иной команды с прежним UUID, подходящая активная PIECE схема, DONE/PayrollEntry/settlements/conversions/percentage/physicalOnlyShare запреты, rollback outbox, сохранность количества/group/shareAmount/files/history/TimeEntry. Первые fixture ошибки были отсутствующей пустой project.tasks relation в relational matcher; исправлен fixture без изменения app-policy.
- Затронутые существующие work-coordinator-role, task-work-required, task-work-reward-ui, task-file-list плюс новый core:26/26 PASS. Чтение чужой ordinary task не даёт execution или глобального доступа; masked price не скрывает affordance; generic MANAGER assignee update отвергается. Финальный повтор только6 core cases после последнего historical marker guard также PASS; уникальный набор остаётся26.
- Реальный Chromium, новая форма переназначения390px:1/1 PASS. Открытие live options, выбор, потеря ответа, блокировка закрытия, exact тот же object/UUID при повторе, один refresh/подтверждение. Harness заменяет только server/Next boundaries. Первоначально исправлены слои fixture CSS и secure fixture origin для browser crypto.randomUUID; production-код под эти ошибки не менялся.
- Существующий `actual pickers…` Chromium case:1/1 PASS. Прежние hint/disabled/search/clear/closed-neighbor свойства сохранены; opt-in560px, перенос длинного имени и вписывание в390px viewport работают. Остальные большие browser suites не повторялись.
- Web TypeScript `tsc --noEmit --incremental false` PASS; scoped ESLint изменённых source/tests PASS; strict OpenSpec и git diff-check PASS.

Это DI/component evidence, не PostgreSQL/runtime/staging приёмка. БД, инфраструктура, storage и TimeEntry агентом не читались/не менялись. Настоящая приёмка и выпуск принадлежат Root.

## Интерфейс

- `reassignOrdinaryTaskCore(actor,{taskId,assigneeId,expectedRevision,clientMutationId},transaction?)` — отдельная команда. ExpectedRevision — текущий splitRevision. Namespace receipt `task-reassignment-v1:UUID`, action `task.reassignment.receipt.v1`, version1; exact replay не создаёт assigned event и повторного уведомления.
- `listTaskReassignmentOptions(actor,taskId,transaction?)` перечитывает текущие роли, изделие, task и получателей. UI actions: `getTaskReassignmentOptions`, `reassignOrdinaryTask`.
- `TaskReassignmentButton` используется в TaskDialog и MyTasksView; ordinary generic assignee selector read-only. Создание/процентное распределение свободного объёма — существующий №191 dialogue.
- Task DTO: optional `canReassignOrdinaryTask`; расчёт структурный и не раскрывает маскированную стоимость. Core отдельно проверяет настоящие snapshots.
- Изменение `visibility.ts` — только узкий LEGACY-task read через productVisibilityWhere. При интеграции №194 сохранить этот grant; taskExecutionWhere не менялся.
- SearchableSelect: opt-in `popupMinWidth`/`wrapOptions`.560px включено только для WorkDialog «Расценка», task-dialog и new-task «Работа»; default selectors сохраняются.

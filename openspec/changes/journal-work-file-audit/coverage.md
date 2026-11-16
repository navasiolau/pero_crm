# Матрица покрытия №226

| Действующий путь | Исходное покрытие | Изменение | Проверка |
|---|---|---|---|
| Work create (`works/core`) | Основные суммы, без владельца/снимка всех свойств | Полные title/quantity/norm/unit/price/total и price reference, только product контекст либо прямой project | production-worker-work-creation, native226 |
| Work update (`works/update-core`) | Частичный before/after без title/total | Полный снимок, обе расценки, no-op не отображается как изменение | unit work suites, native226 |
| Work delete (`works/actions`) | Название и итог | Полный прежний снимок и контекст в существующей transaction | action/core suites |
| Task create (`tasks/actions`) | Только title/project | Все новые поля, срок, исполнитель, объём и развёрнутые зависимости; отдельный receipt не отображается | task creation suites |
| Task update (`tasks/actions`) | Неполный снимок, текущая связь не фиксировалась | Полные before/after с dependencies; старый и новый owner contexts; System status consequence отдельно | task-work-required, journal ownership test |
| Task status/completion (`completion-core`) | Статус; payroll без отдельного audit | Статус/doneAt/doneBy и самостоятельное System начисление; суммы и auth остаются прежними | piecework allocation/completion, native226 |
| Task reassignment (`task-reassignment-core`) | Основной audit + технический receipt | Имя исполнителя, точный product контекст, System reset статуса отдельно, receipt сохранён | task-reassignment |
| Worker/self allocation (`worker-allocation-core`) | Частичный task snapshot + receipt | Полный снимок задачи, dependencies, владелец и имена; receipt без UI-дубликата | production worker allocation, native226 |
| Piecework creation/transfer (`piecework-core`) | Агрегированный durable receipt | Полные снимки создаваемых и разделяемых задач, долей, бюджетов и связей; отдельное System событие каждого реально изменённого списка зависимостей у затронутых задач | piecework-allocation, journal-work-file, native226 cross-owner |
| Payroll move/split from task (`task-payroll-transfer`) | Старое/новое родительское начисление, только ID дочернего | System+инициатор, полные обе суммы и получатели; raw parent payload неизменён | journal-work-file, task-reassignment, coordinator tests |
| Task delete (`delete-core`, action wrapper) | Audit после transaction | Audit внутри transaction; имя исполнителя фиксируется до удаления; System file detach и удаление входящих зависимостей, точные контексты | journal-work-file fault rollback/assignee label, native226 |
| Ordinary file upload (`files/upload-core`) | Название/раздел/receipt | Полные filename/type/size/section/ownership/uploader; подтверждённый replay без дубля | journal-work-file, upload suites, native226 |
| File deletion (`files/delete-intent`, ordinary/cover callers) | Только filename и durable cleanup intent | Полный известный metadata snapshot до удаления; связи после удаления не угадываются; raw storage intent сохранён | journal-work-file actual project/product cover-delete, file-delete suites, native226 |
| Time cutoff operator (`time/cutoff`) | Уже существуют guard, audit и replay | Читаемые снимки отдельных остановок System с инициатором и task owner; агрегат оператора сохранён | timer-stop-cap |
| Retired task sharing (`share-core`) и time actions | Новые изменения запрещены; старые квитанции только читаются | Запрет сохранён; новых событий чтения не создаётся | task-share/time retirement tests |

Контексты обозначают ленты, `links` — связанные сущности. Обычная работа/задача/вложение изделия получает только product context, родительский проект остаётся ссылкой. При переносе и автоматической отвязке фиксируются обе реально затронутые принадлежности.

Граница с №227 согласована: salary/percentage core принадлежит №227; task-generated payroll create/transfer принадлежит №226, без дублирующих записей между задачами. Денежные формулы, исходные snapshots обязательств, UUID/fingerprint/result и outbox payload не изменены. Строки user audit не превращаются в system raw actor: отображаемый исполнитель задан отдельным presentation.

## Фактическая staging-проверка

На `e3f99ff05b97f3999fc8fbf74472e9077d769a3b` root получил PASS сценария `journal-226`; [receipt и идентичность runtime](evidence.md#ci-fixture-и-финальная-staging-приёмка) зафиксированы в evidence.

- Полный diff работы, создание задачи, System начисление и отсутствие дублей при replay.
- Полные метаданные файла, автоматическая отвязка, удаление файла/replay и имя исполнителя удалённой задачи.
- Изменение входящих зависимостей, split с общепроектной задачей и другим изделием, точные контексты, суммы и replay.
- Отказ аудита удаления с rollback; `SET CONSTRAINTS ALL IMMEDIATE` выполнен до общего rollback, число исходных audit записей сохранено.

CI также подтвердил строгий mutation fixture после точечной адаптации metadata reads и собственного payroll audit. Остальные строки матрицы сохраняют свой указанный вид проверки; закрытые legacy interfaces не активировались. QA import alias имел ноль вызовов и не проверяет Next cache invalidation. Общая браузерная и auth-приёмка ведётся root отдельно.

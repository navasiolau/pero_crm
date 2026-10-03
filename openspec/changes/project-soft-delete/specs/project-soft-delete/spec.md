## Purpose
Удаление проекта атомарно скрывает его и изделия из работы без физического удаления связанных записей, файлов, денег и неизменяемой истории.
## ADDED Requirements
### Requirement: Atomic retained project deletion
Операция SHALL устанавливать tombstone проекта и всех ещё живых изделий в одной транзакции. Прежние индивидуальные deletedAt/deletedById SHALL сохраняться. Данные Tasks/Works/Files/Payroll/Payment/snapshots/history и номера MUST NOT удаляться, отвязываться или пересчитываться.
#### Scenario: Mixed live and individually deleted products
- **WHEN** менеджер удаляет проект
- **THEN** живые изделия скрыты вместе с проектом, ранее удалённые metadata и вся история неизменны
### Requirement: Exact confirmation and replay
MANAGER_ROLES union SHALL быть обязательным. expectedUpdatedAt и expectedProductsVersion SHALL проверяться до записи; changed child set/state, stale project, reused UUID с другим payload MUST отказать. Exact replay SHALL возвращать тот же результат без новых записей.
#### Scenario: Product added after confirmation
- **WHEN** набор изделий изменился после captured baseline
- **THEN** conflict без tombstone
### Requirement: Every active project timer blocks deletion
Любой timer stoppedAt=null у задачи проекта SHALL блокировать удаление, включая project-wide и product tasks. Global transaction lock SHALL сериализовать timer start и delete. Операция MUST NOT выполнять auto-stop или accrual.
#### Scenario: Project-wide running timer
- **WHEN** активный timer относится к task.productId=null
- **THEN** проект и изделия остаются живыми, таймер и финансовые факты неизменны
### Requirement: Explicit exact warning
UI SHALL иметь сплошную красную кнопку урна+«Удалить» и shared confirm с текстом «Внимание! Проект будет удален вместе со всеми изделиями!». Unknown ACK SHALL удерживать исходный UUID/baseline; readonly actor MUST NOT получать управление.
#### Scenario: Lost acknowledgement
- **WHEN** ответ удаления не подтверждён
- **THEN** явный повтор использует тот же запрос, не новую операцию

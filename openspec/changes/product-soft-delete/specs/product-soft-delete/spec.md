## Purpose
Удаление изделия скрывает его из обычной работы, сохраняя все связанные записи, файлы, неизменяемые финансовые факты и зарезервированный номер.
## ADDED Requirements
### Requirement: Logical product deletion
Удаление SHALL изменять только tombstone изделия и audit/receipt. Система MUST NOT удалять или отвязывать Tasks/Works/Files/materials/completions/payroll/пулы либо начислять оплату. Номер и suffix SHALL сохраняться.
#### Scenario: Product with history
- **WHEN** менеджер подтверждает удаление изделия с историей
- **THEN** изделие скрыто operational filters54, все зависимости остаются неизменны
### Requirement: Exact authorized acknowledgement
MANAGER_ROLES union SHALL разрешать подтверждённое удаление с expectedUpdatedAt и UUID. Stale состояние, удалённый родитель, другой payload UUID SHALL отказывать до ACK. Exact replay SHALL вернуть прежний результат без повторного tombstone/audit.
#### Scenario: Concurrent edit
- **WHEN** updatedAt изменился после открытия confirm
- **THEN** conflict без записей
### Requirement: Active timer refusal
Удаление SHALL отклоняться при активном таймере задачи изделия. Проверка SHALL быть сериализована с timer start. MUST NOT автоматически останавливать таймер или начислять деньги.
#### Scenario: Running timer
- **WHEN** есть timer TimeEntry stoppedAt=null
- **THEN** удаление отказано и таймер, начисления, изделие неизменны
### Requirement: Explicit delete control
Карточка SHALL показывать менеджменту сплошную красную кнопку урна+«Удалить», shared confirm с предупреждением о скрытии из работы и сохранении истории. Неизвестный ACK SHALL удерживать исходный UUID и подтверждённый baseline.
#### Scenario: Readonly actor
- **WHEN** карточку читает pure ENGINEER
- **THEN** удаление недоступно и прямой вызов также запрещён

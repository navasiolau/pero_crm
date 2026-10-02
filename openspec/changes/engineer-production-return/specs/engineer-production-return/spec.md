# Spec Delta

## Purpose

Текущий назначенный инженер меняет DESIGN↔PRODUCTION без модели и возвращается черезcard/kanban с сохранением финансовой истории и ограничений остальных статусов.

## ADDED Requirements

### Requirement: Текущий инженер и менеджмент

Manager/Admin/Director SHALL выбирать любойProductStatus безordering/modelgates. ENGINEER безmanagement SHALL менять только текущее назначенное Product DESIGN↔PRODUCTION и повтор текущего разрешённого статуса. Legacy participant/payrecipient SHALL не заменять текущее engineerId; все другие переходы SHALL отвергаться сервером даже приstaleUI/directAPI.

#### Scenario: Нет файлов и возврат
- **WHEN** текущий инженер переводит DESIGN→PRODUCTION→DESIGN безB3D/NoModel/Task
- **THEN** оба перехода разрешены, карточка доступна; повтор не создаёт новыйPayroll

#### Scenario: Старое назначение
- **WHEN** прежний payrollrecipient/participant или чужой инженер вызывает transition
- **THEN** отказбезизменений; management+ENGINEER сохраняетполную management policy

### Requirement: Оплата и модель

Financial price/assignee/currency/snapshot constraints и uniquecompletion SHALL сохраняться. Возврат SHALL не стирать заработанное, повторproduction SHALL не платить второй раз. NoModelcheckbox иordinarysetter SHALL отсутствовать/отказывать; историческиеDBfields/files SHALL сохраняться безSQLmigration.

#### Scenario: Financial validation
- **WHEN** положительный процент не имеет валиднойцены или получателя
- **THEN** статус неcommit несмотря отменуmodelgate

#### Scenario: Устаревший NoModel writer
- **WHEN** старая форма вызывает обычный NoModel setter
- **THEN** он явноотказывает безDBwrite; историческийflag/fileнеизменён

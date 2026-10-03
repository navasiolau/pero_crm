# Spec Delta
## Purpose
Личный календарь хранит собственную повестку аккаунта, предоставляет согласованные даты и защищает записи от чужого доступа и перезаписи устаревшим редактором.
## ADDED Requirements
### Requirement: Personal owner scope
The system MUST читать и изменять только записи активного session actor с включённым Планом, не принимая произвольный owner/userId. Administrator SHALL не получать исключения для чужих записей.
#### Scenario: Foreign record and disabled plan
- **WHEN** actor запрашивает или меняет чужую запись либо его План выключен
- **THEN** данные не раскрываются, mutation отклоняется без изменений
### Requirement: Calendar lifecycle and CAS
The system SHALL позволять создать, прочитать, изменить, выполнить и отменить собственную запись с названием/описанием/датой-временем. Изменения MUST проверять revision; точный retry create не создаёт дубликат.
#### Scenario: Stale editor and repeated creation
- **WHEN** старый редактор сохраняется после другой правки либо создание повторено с прежним UUID
- **THEN** stale mutation отклоняется, exact retry возвращает прежнюю запись без дубликата
### Requirement: Explicit date and month view
The system SHALL отображать месячный календарь и дневную повестку в Europe/Moscow одинаково в SSR и клиенте и отклонять невозможные даты/время.
#### Scenario: Environment timezone differs
- **WHEN** один месяц и запись отображаются сервером и клиентом с разными timezone среды
- **THEN** дата/время и месячные границы совпадают по Europe/Moscow
### Requirement: Reminder settings without delivery
The system SHALL хранить выключенное напоминание либо offset 0/15/60/1440 минут, default15. Отмена/выключение SHALL сохранять записи; доставка находится за границами этой задачи.
#### Scenario: Reenable calendar
- **WHEN** аккаунт выключил и затем включил План
- **THEN** записи возвращаются со своими state/offset без отправки уведомлений этой задачей

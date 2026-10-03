# Spec Delta
## Purpose
Персональное включение плана отделяет доступ к личному календарю от других ролевых полномочий, сохраняя настройки аккаунта при изменении ролей.
## ADDED Requirements
### Requirement: Account override and inherited default
The system SHALL разрешать всем ролям календарь по nullable настройке аккаунта; NULL включён только при наличии PROCUREMENT. Явные true/false MUST сохраняться при изменении ролей.
#### Scenario: Inherited and explicit settings
- **WHEN** роли изменены у аккаунта с NULL или явным boolean
- **THEN** NULL следует default PROCUREMENT, а boolean сохраняет выбранный доступ
### Requirement: Conditional navigation
The system SHALL показывать План только enabled аккаунту после Dashboard, либо первым при отсутствии Dashboard, сохраняя union остальных прав.
#### Scenario: Accountant enables personal plan
- **WHEN** чистый ACCOUNTANT имеет override true
- **THEN** План стоит первым, финансовый доступ сохраняется, операционные разделы не открываются
### Requirement: Current actor access and preservation
The system MUST проверять актуального активного actor из session и актуальный effective-флаг при серверном входе, без доступа к чужому календарю. Выключение SHALL прекращать доступ и будущую доставку без удаления записей.
#### Scenario: Flag disabled after page opened
- **WHEN** администратор выключает флаг уже вошедшего actor
- **THEN** следующий серверный вход отклонён и сохранённые данные не удалены
### Requirement: Administrative setting
The system SHALL позволять только существующим администраторам пользователей менять override через имеющуюся форму.
#### Scenario: Editing account
- **WHEN** администратор сохраняет наследование, включён или выключен
- **THEN** аккаунт получает соответственно NULL, true или false

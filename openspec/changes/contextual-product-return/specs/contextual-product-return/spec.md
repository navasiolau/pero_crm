## Purpose
Предсказуемый безопасный возврат из карточки изделия к исходному списку без потери фильтров и без доверия внешним URL или browser history.
## ADDED Requirements
### Requirement: Contextual return
Product SHALL вернуть пользователя в Project/Изделия при открытии из Project, а при открытии из global Products — в тот же canonical list state.
#### Scenario: Global table or kanban
- **WHEN** Product открыт из global списка с view/filter/sort/page
- **THEN** Back сохраняет эти параметры списка.
#### Scenario: Project products
- **WHEN** Product открыт из родительского Project
- **THEN** Back открывает вкладку Изделия того же Project.
### Requirement: Safe destination
Сервер MUST принять только global Products либо фактический родительский Project/Изделия; любой иной адрес возвращает parent/products fallback.
#### Scenario: Forged destination
- **WHEN** returnTo содержит другой Project, внешний URL, hash, backslash либо неоднозначный массив
- **THEN** он не становится адресом перехода.
### Requirement: Delete and default navigation
Успешное удаление Product SHALL использовать тот же проверенный return path; обычный вход Project MUST открывать Общее.
#### Scenario: Product deletion
- **WHEN** разрешённое удаление завершено успешно
- **THEN** пользователь возвращается в исходный разрешённый список.
#### Scenario: Direct Project route
- **WHEN** tab отсутствует или недопустим
- **THEN** открывается Общее без изменения предпочтений.

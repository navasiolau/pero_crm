## Purpose
Карточка заказа на канбане с защищённой обложкой и ясным текущим возрастом этапа без изменения карточек изделий или финансовых полномочий.
## ADDED Requirements
### Requirement: Project card presentation
Project kanban SHALL показывать cover сверху, крупный bold номер с днями справа, затем title/client/BYN amountnumber без label/currency suffix.
#### Scenario: Visible project cover
- **WHEN** cover доступен текущему actor
- **THEN** используется optimizedpreview и click открывает Project, не fullscreen.
### Requirement: Current stage age
Дни MUST считаться от входа в текущий этап; createdAt используется толькоinitial/nohistory.
#### Scenario: Return to first stage
- **WHEN** Project вернулся в LEAD после переходов
- **THEN** возраст начинается с последнего перехода, не создания проекта.
### Requirement: Preserve visibility and information
Card MUST сохранять monetaryroleACL, distinctnull/zero и существующие counters/shortage послеamount; Productcardlayout остаётся прежним.
#### Scenario: Restricted or unknown price
- **WHEN** actor не видит деньги либо цена неизвестна
- **THEN** hiddenamount не появляется и неизвестное значение не становится0.

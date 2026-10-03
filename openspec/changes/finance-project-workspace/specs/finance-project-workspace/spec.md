# Spec Delta

## Purpose

Финансовый actor работает с денежными данными и операциями проекта через отдельный workspace, не получая доступ к обычным management/technical изменениям.

## ADDED Requirements

### Requirement: Финансовый маршрут и safe DTO

Workspace SHALL разрешать только centralFINANCE_ROLES, сохраняя role union. List/detail SHALL выдавать только необходимые номер/title/stage/currency/clientlabel и финансовую проекцию. Technicaldescription/files/tasks/generaledit DTO SHALL не сериализоваться. Nonfinance actor SHALL отказывать доDBread.

#### Scenario: Бухгалтер и снабженец
- **WHEN** ACCOUNTANT/PROCUREMENT открывает Finance project
- **THEN** финансовые данные доступны; обычныеproject/productmanager edits не появляются и прямыеихactionsпо-прежнемуотказывают

### Requirement: Прежние денежные правила

INCOME/EXPENSE SHALL использовать existingpayments cores/rolechecks/FXsnapshots/cashcurrency/balance constraints. Экономика SHALL использовать прежние helpers/NULLhistory guards безперемаркировкиилиновогокурса. ConfirmedACK SHALL обновлять workspace, failure SHALL сохранять форму и данные.

#### Scenario: Финансовая операция
- **WHEN** допустимая операция подтверждена сервером
- **THEN** оплаты/расходы/экономика обновлены, денежный факт один; приотказе записьнепоявляется

### Requirement: Изоляция прав

Финансовый маршрут SHALL не вызывать fullgeneralProjectreader и не расширять officevisibility. Finance+manager union SHALL сохранять свои независимые права, но workspace не содержит общихформ. Readonly(nonfinance) user SHALL не пользоваться денежнымиcontrolsчерезподменупути/ID.

#### Scenario: Подмена роли
- **WHEN** MANAGER или ENGINEER безfinance роли вызываетworkspacequery
- **THEN** отказдо dataread, прежнийgeneralprojectдоступнеизменён

### Requirement: Удалённые проекты и финансовая история

Selectable list SHALL исключать soft-deleted проекты через central liveProjectWhere. Прямой финансовый lookup SHALL сохранять исторические строки, выдавая только projectArchived boolean. Архивный workspace SHALL оставаться доступным для просмотра и отключать денежные controls; серверные ограничения №54 SHALL сохраняться.

#### Scenario: Историческая ссылка
- **WHEN** финансовый actor открывает ранее удалённый проект по ID
- **THEN** история и экономика сохранены, новые операции недоступны, а picker этот проект не предлагает

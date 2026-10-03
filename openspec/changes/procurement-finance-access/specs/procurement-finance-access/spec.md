# Spec Delta

## ADDED Requirements

### Requirement: Отдельные supply и finance grants
Система SHALL поддерживать PROCUREMENT «Снабженец»: fullFinance, warehouse catalog/income/issue/return/costs и office readonly. MANAGER_ROLES SHALL не включать PROCUREMENT; material requirements SHALL редактировать только менеджмент.

#### Scenario: Снабженец
- **WHEN** чистый PROCUREMENT читает изделие и выполняет выдачу материала
- **THEN** чтение/выдача доступны, product fields/status/requirements edit запрещены

### Requirement: Finance-only и объединение ролей
Чистый ACCOUNTANT SHALL иметь Finance без operational pages/tasks/technical files. Pure MANAGER SHALL не иметь Finance/Advance. Дополнительная роль SHALL добавлять свои права; AD/DIR SHALL оставаться эксклюзивными. Финансовые DTO SHALL сохранять финансовую историю без operational payload.

#### Scenario: Прямой обход
- **WHEN** чистый бухгалтер запрашивает project detail либо technical file/preview
- **THEN** операционные данные отсутствуют/доступ отклонён, финансовый ledger остаётся доступным

#### Scenario: Совмещённые роли
- **WHEN** ACCOUNTANT дополнен MANAGER или ENGINEER
- **THEN** Finance сохраняется вместе с manager grants либо собственными engineer grants

### Requirement: Совместимая роль и данные
Новая роль SHALL работать в user DTO/chips/session/nav/notifications. Миграция SHALL добавлять только enum; реальные роли, payScheme и исторические деньги SHALL оставаться прежними.

#### Scenario: Добавление enum
- **WHEN** Root применяет миграцию
- **THEN** появляется PROCUREMENT без назначения пользователям и пересчёта зарплат

### Requirement: Глобальный Журнал только для ADMIN
Система SHALL показывать глобальный «Журнал» и разрешать /changelog и его серверное чтение только ADMIN. DIRECTOR, PROCUREMENT, ACCOUNTANT, MANAGER, ENGINEER, WORKER, MOUNTER и их комбинации без ADMIN SHALL не получать доступ. Серверный query SHALL проверять актуальную авторизованную сессию до чтения ChangeLog. Общий ADMIN_ROLES, запись аудита и история отдельных сущностей/финансов SHALL сохраняться.

#### Scenario: Прямое чтение журнала
- **WHEN** не-ADMIN обращается к /changelog либо вызывает серверную страницу/query напрямую
- **THEN** запрос отклонён до чтения audit rows; скрытие sidebar не заменяет server guard

#### Scenario: Администратор
- **WHEN** ADMIN открывает глобальный журнал с фильтрами
- **THEN** журнал и прежние фильтры доступны с прежним лимитом записей

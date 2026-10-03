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

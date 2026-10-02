# Spec Delta

## Purpose

Менеджмент управляет стандартными процентами трёх этапов, применяемыми только к вновь созданным изделиям с сохранением ранее введённой оплаты.

## ADDED Requirements

### Requirement: Defaults и права

Система SHALL предоставлять MANAGER/ADMIN/DIRECTOR три nullable ставки ENGINEERING/ASSEMBLY/INSTALLATION0..100 точностью0.1;0 SHALL отличатьсяотNULL. Отсутствующая настройка SHALL означатьALLNULL. Другиеsettings/finance/admin доступы SHALL не расширяться. Изменения SHALL использовать CAS/revision и audit атомарно.

#### Scenario: Смена и конфликт
- **WHEN** management сохраняет новое0/null/5.1 значение сcapturedrevision
- **THEN** настройка/audit commit вместе; stale request отказывает без overwrite, readonlyroles запрещены

### Requirement: Новый Product snapshot

НовыйProduct SHALL получатьALL3configs из одногоeffective settings snapshot в тойжеcreateTX, дажебезназначенного engineer/assembler/mounter. Web/actions/bot SHALL идти черезобщийcreatecore. Изменение defaults SHALL не обновлятьexistingproducts/configs/payroll/frozenfacts.

#### Scenario: Настройки ещё не заданы
- **WHEN** новоеизделие создано безOrgSettingdefaults
- **THEN** созданы триNULLrate configs, прежнееотсутствиепроцентнойоплаты сохранено

#### Scenario: Changed defaults
- **WHEN** defaults5/0/null изменены на6/4/7после первогоProduct
- **THEN** только следующийProduct получает6/4/7, прежние5/0/null иfrozenpay неизменны

#### Scenario: Ошибка конфигурации
- **WHEN** createTXconfig/audit падает либо сохранённыеdefaults повреждены
- **THEN** создание откатывается/отказывает целиком, нетpartialProduct/config snapshot

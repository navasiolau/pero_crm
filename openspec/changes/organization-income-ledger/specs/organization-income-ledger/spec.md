# Spec Delta

## Purpose

Общий приход организации хранится и учитывается без фиктивного проекта, сохраняя денежные снимки и строгие права финансового пользователя.

## ADDED Requirements

### Requirement: Необязательный проект для прихода

INCOME SHALL допускать отсутствие проекта и хранить projectId/projectAmount NULL. EXPENSE SHALL требовать действующий проект до записи. Проектный приход SHALL сохранять прежние ограничения внутренней валюты.

#### Scenario: Общий USD приход
- **WHEN** финансовый actor вносит100 USD в активную USD кассу по курсу3 без проекта
- **THEN** существует один Payment с amount100, bynAmount300, двумя project NULL; фиктивный проект отсутствует

#### Scenario: Расход без проекта
- **WHEN** actor отправляет EXPENSE без проекта либо на удалённый проект
- **THEN** отказ без payment/audit/outbox и без обхода cash/org ceilings

### Requirement: Однократный учёт и атомарность

Организация, касса и месячный оборот SHALL включать общий приход один раз; экономика отдельного проекта SHALL не включать его. Payment/audit/outbox SHALL фиксироваться атомарно. NULL history guards и лимиты удаления SHALL сохраняться.

#### Scenario: Аудит не записан
- **WHEN** запись аудита завершается ошибкой
- **THEN** денежная транзакция откатывается целиком

#### Scenario: Балансы и месяц
- **WHEN** общий приход300BYN принят
- **THEN** org/cash/месячный income увеличены один раз, paidTotal всех проектов не меняется

### Requirement: Финансовый журнал

Журнал SHALL быть доступен только central FINANCE_ROLES с role union. Необязательный picker SHALL показывать только live safe refs. Общий приход SHALL отображаться без подставного project label и NULL SHALL сохраняться в DTO; manager без Finance SHALL не получить денежные права.

#### Scenario: Создание из журнала
- **WHEN** ACCOUNTANT или PROCUREMENT оставляет проект пустым
- **THEN** общий приход доступен через тот же валютный dialog; ошибка сохраняет форму, confirmed ACK обновляет журнал

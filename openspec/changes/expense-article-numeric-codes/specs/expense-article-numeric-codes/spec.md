# Spec Delta

## Purpose

Статьи расходов имеют стабильный положительный числовой код для чтения и выбора, при сохранении прежних денежных связей и прав.

## ADDED Requirements

### Requirement: Устойчивый код

ExpenseArticle SHALL иметь positive INT UNIQUE code. Старые статьи SHALL получить коды детерминированно поcreatedAt,id, включая inactive; уже назначенные коды SHALL не перенумеровываться. Id/FK/name/comment/active и платежи SHALL сохраняться.

#### Scenario: Первое внедрение
- **WHEN** migration выполняется на старом справочнике
- **THEN** каждому missing code назначен устойчивый positive code; суммы/expenseArticleId старых Payment не изменены

### Requirement: Создание и проверка

Форма SHALL предложить max всех статей, включая inactive, плюс1. Finance actor SHALL выбирать свой свободный positive code; UI SHALL принимать толькоASCII digits. Ноль/дробь/знак/overflow/duplicate SHALL дать понятную ошибку безpartial article/audit. Concurrentauto allocation SHALL не создавать duplicate.

#### Scenario: Inactive и custom
- **WHEN** maxcode9 неактивен и создаётся новая статья
- **THEN** предложен10; custom12 допустим, повтор12 отвергнут с конкретной ошибкой

### Requirement: Права и история

Server SHALL использовать centralfinance policy, не отдельный список ролей. Readonly/nonfinance actor SHALL не изменять справочник. Deactivate/reactivate SHALL не менятьcode; audit и article write SHALL commit вместе, платежи SHALL не переписываться.

#### Scenario: Повторная активация
- **WHEN** статья деактивирована и активирована вновь
- **THEN** её code/id и связанные суммы остаются прежними

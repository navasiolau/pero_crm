# Proposal

## Why

№62 добавляет устойчивые положительные числовые коды статей расходов. Сейчас справочник содержит только id/name/comment/active; код нужен для выбора и чтения статей без изменения связей или денежных операций.

## What Changes

- ExpenseArticle.code — positive INT UNIQUE; migration старых статей по createdAt,id включает inactive.
- Новая форма предлагает max всех кодов +1, допускает собственный свободный положительный код и только цифры.
- Код после создания не перенумеровывается; toggle active и старые Payment FK/amounts неизменны.
- Права через central requireFinance/FINANCE_ROLES, включая futurePROCUREMENT из№58 без локальной копии ролей.

## Capabilities

### New Capabilities

- `expense-article-numeric-codes`: устойчивые коды, безопасное создание и показ справочника.

### Modified Capabilities

Нет.

## Impact

Schema/migration20261003020000, только ARTICLE actions/core/query/view и focusedtests. CashAccount/финансовые формулы/Payment records не меняются. Feature62 fresh927, root owns migrationapply/Git/runtime/stage.

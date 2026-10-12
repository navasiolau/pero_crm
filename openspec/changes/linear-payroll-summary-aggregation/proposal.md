# Proposal

## Why

Задача №149 утверждённого CRM_APPLICATION_IMPROVEMENT_PLAN.md устраняет повторную фильтрацию всей зарплатной истории для каждого сотрудника и повторные чтения одних сумм на странице сводки и в settleAll. Сейчас CPU grouping растёт как сотрудники × строки; legacy BYN, неизвестные суммы и денежные проверки должны сохраниться точно.

## What Changes

- Общий однопроходный Decimal-агрегатор по сотруднику/периоду вместо rows.filter для каждого userId.
- Явный request-local снимок входных строк для чтения сводки: выбранный/current/past период, выплаты/авансы/оборотные начисления, общий точный payout total. Повторное использование ограничено текущим вызовом, без глобального кеша.
- Убрать повторные чтения сводки; getMyPayroll повторно использует уже прочитанные детали выбранного месяца.
- В settleAll каждый debtor получает новый preview из БД; повторное использование допускается только внутри одной итерации, transactional cash-core/locks/limits остаются прежними.
- Измерить grouping O(R+U), одинаковые Decimal/null DTO, SQL-count и bounded10× benchmark. Передача raw history остаётся O(R); переход к SQL aggregation в этот change не входит.

## Capabilities

### New Capabilities

Нет.

### Modified Capabilities

Нет. Пользовательские права, значения, порядок и недоступность исторических сумм сохраняются; refactor объявлен `skip_specs: true`. Прежние payroll/BYN/combined-engineering/cash contracts проверяются существующими тестами и oracle прежних helper-функций.

## Impact

Production allowlist: payroll/queries.ts, один payroll/summary-read-model.ts, payroll/actions.ts только preview settleAll и finance/payroll/page.tsx только композиция чтений после прежней авторизации. Tests: выбранные payroll/history/settleAll suites и один aggregate parity/benchmark/native readonly regression. UI/CSS, DTO/CSV формат, schema/миграции, cash-core/cash-service/transaction, payroll-month/history-byn, roles/ACL, provider FX и исторические финансовые факты не меняются. Local/staging существующие разрешённые окружения, без dump/reset/seed/newDB; main/production запрещены. Зависимость131 должна пройти staging-приёмку до интеграции149.

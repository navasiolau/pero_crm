# Proposal

## Why

После №58 бухгалтер работает только в Finance, поэтому финансовая вкладка обычной карточки проекта не является доступным входом. Нужен отдельный финансовый workspace с прежними cash/FX/economics guards без новых прав на технические или management поля.

## What Changes

- /finance/projects: финансовый список/выбор проекта и /finance/projects/[number] с readonlymetadata.
- FINANCE_ROLES, включая ACCOUNTANT/PROCUREMENT и union roles, получают экономику и существующие приходы/расходы.
- Переиспользуются FinanceTab/getProjectEconomics/addPayment/deletePayment; DTO не содержит технических/общих edit fields.
- General office ACL/sidebar не расширяются; cash/price/payroll формулы, schema и migration не меняются.

## Capabilities

### New Capabilities

- `finance-project-workspace`: отдельный финансовый доступ к проекту.

### Modified Capabilities

Нет.

## Impact

Newfinancepages/corequeries/listUI +Finance landinglink иузкие ACKrefresh/shareddate formatting для FinanceTab. Feature59 fresh90c69f8 после58;61вне scope. Root/coordinator owns commits/runtime/stage, worker noDBwrites/SSH/prod/restic/dumps.

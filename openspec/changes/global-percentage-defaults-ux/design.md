# Design
## Context
Settings middleware уже вызывает canAccessSettingsPath, exact percentage page/core допускают MANAGER union. Settings root пока без auth и показывает все admin cards; nav имеет duplicatepercent/root. DRAFT helper использует Decimal-style confirmed unitprice×qty×rate, null/0 и frozen safeguards.
## Goals / Non-Goals
Упростить подсказку ENGINEERING DRAFT и дать менеджеру только нужный settings entry. Не менять salary, роли58, сохранённые rates/money snapshots или формулу.
## Decisions
Helper разрешает exact /settings и /settings/product-percentages MANAGER union; любые другие пути толькоADMIN/DIRECTOR. SettingsPage самостоятельно auth-check и фильтрует sections тем же helper. Nav изменяется только Settingsrootrow MANAGER_ROLES и removalduplicatepercentrow, интеграция с58 обычным merge.
Panel удаляет инженерные строки базы/сохранённых цен, сохраняя существующий total/null/frozen текст. Defaults backend уже применяет3rates только на createProduct, не меняется.
## Risks / Trade-offs
Подмена URL не расширяет permissions: middleware+Settingspage/service actualrolechecks. UItests не заменяют staging; root принимает runtime отдельно.
## Migration Plan
Без миграций; отдельный change50, root local/merge/staging.

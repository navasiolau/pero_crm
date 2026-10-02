# Proposal

## Why

№42 добавляет управляемые менеджментом стандартные проценты инженера, сборщика и монтажника для новых изделий. Сейчас создание не задаёт конфигурацию этапов; отсутствие defaults должно сохранить NULL, не вводить выдуманные финансовые ставки.

## What Changes

- Settings/product-percentages: три nullable0..100 ставки шаг0.1, толькоMANAGER/ADMIN/DIRECTOR и объединение ролей.
- AuditedCAS одного OrgSettingJSON/revision без schema migration; существующие adminsettings/finance не расширяются.
- НовыйProduct получает snapshotALL3configs внутриcreateTX, дажебезназначений; actions/bot используют тотжеcore.
- СтарыеProduct/currentconfigs/immutablepay не меняются.

## Capabilities

### New Capabilities

- `product-percentage-default-settings`: nullableorganizationdefaults и transactionalnewproduct initialization.

### Modified Capabilities

Нет.

## Impact

Newsettingsroute/actions/domaincontracts, products/corecreate, nav/auth exactroute exception. No widgets41/sourcepay/schemamigration/dependencies/backfill. Feature42fresh02d7db1; ownerdirectapproval/no newpermissionpause, rootownsruntime/stage/Git.

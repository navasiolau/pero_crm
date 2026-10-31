# Proposal

## Why

Администратору нужен общий настраиваемый набор значений новых КП.

## What Changes

- Настройки подписи КП; задача 206, согласована владельцем 31.10.2026.
- Система SHALL позволять только ADMIN менять общие значения подписи новых КП с аудитом и защитой от конкурентного сохранения. Прежние КП SHALL сохранять значения.

## Capabilities

### New Capabilities

- `kp-signature-defaults-settings`: Настройки подписи КП.

### Modified Capabilities

Нет опубликованной основной спецификации этой возможности; прежние change artifacts используются как контекст.

## Impact

Страница /settings/kp и серверные actions с общей настройкой OrgSetting kp.signatureDefaults. Формат совместим с 205: JSON revision и values {managerName,managerRole,managerPhone,warrantyMonths,footer}. Сохранение под advisory lock с UUID receipt, CAS revision и аудитом. ADMIN проверяется сервером. Срок гарантии — положительное целое; изменение срока синхронизирует стандартную фразу подвала так же, как раздел 5. Миграция таблиц не нужна.

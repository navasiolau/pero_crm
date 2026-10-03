# Proposal
## Why
Инженерный DRAFT содержит лишние строки базы и пояснений. Менеджеру требуется понятный вход Настройки → Проценты изделий без остальных административных разделов.
## What Changes
- DRAFT показывает только Предварительно и существующий подтверждённый расчёт суммы.
- Settings root доступен менеджеру, содержит только Проценты изделий; прямой дублирующий nav пункт убран.
- Остальные settings остаются ADMIN/DIRECTOR; существующие три global rates применяются только при создании нового изделия.
## Capabilities
### New Capabilities
- `global-percentage-defaults-ux`: узкий менеджерский вход и компактная подсказка DRAFT.
### Modified Capabilities
Нет.
## Impact
settings-access,SettingsPage,navSettingsrow,percentagepanel. Existing CAS/default core/creation и frozen money не меняются, новые dependencies не нужны.

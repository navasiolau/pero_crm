## Purpose
Удобный ограниченный вход менеджера в глобальные проценты новых изделий и краткий предварительный инженерный расчёт без изменения финансовых правил.
## ADDED Requirements
### Requirement: Manager settings entry
Менеджер SHALL иметь доступ к Settings root и точной странице процентов изделий; root MUST показывать ему только соответствующую карточку.
#### Scenario: Manager union
- **WHEN** MANAGER либо комбинированный MANAGER открывает Настройки
- **THEN** доступна только карточка Проценты изделий, остальные admin URLs отказаны.
#### Scenario: Other roles
- **WHEN** чистый ENGINEER/ACCOUNTANT/WORKER/MOUNTER открывает Settings
- **THEN** доступ отказан; ADMIN/DIRECTOR сохраняют все текущие карточки.
### Requirement: Compact engineering draft
Инженерный DRAFT SHALL показывать только Предварительно с существующей подтверждённой суммой; null и0 MUST оставаться различимы, frozen guard сохраняется.
#### Scenario: Confirmed quantity price and rate
- **WHEN** подтверждены цена1000 BYN, количество3 и ставка5%
- **THEN** предварительная сумма150 BYN без строки База или пояснения по сохранённым ценам.
### Requirement: Defaults remain creation only
Глобальные три ставки MUST применяться только при создании нового изделия без перерасчёта существующих конфигураций/начислений.
#### Scenario: Existing product
- **WHEN** default rates изменены
- **THEN** существующие Product configuration и Payroll facts остаются прежними.

# Spec Delta
## Purpose
Совмещённые инженерные роли сохраняют выбранную обычную оплату и самостоятельный процент за выполненное проектирование без изменения исторических денежных фактов.
## ADDED Requirements
### Requirement: Independent chosen scheme
The system SHALL сохранять выбранную обычную схему для ENGINEER+MANAGER независимо от порядка ролей и начислять самостоятельные работы по её действующему правилу.
#### Scenario: Combined piece-paid engineer
- **WHEN** ENGINEER+MANAGER со схемой PIECE завершает самостоятельную обычную работу
- **THEN** записывается одно обычное начисление, инженерный процент изделия остаётся отдельным
### Requirement: Separate one-time product engineering percentage
The system MUST начислять процент только при первом завершении проектирования с frozen unit-price, quantity и rate snapshot, без зависимости от обычной схемы.
#### Scenario: Replayed completion and later price changes
- **WHEN** переход повторяется после начисления и цена либо ставка изменены
- **THEN** сохраняется первое начисление без пересчёта и дубликатов старого PERCENT_PROJECT
### Requirement: Preserve historical financial guards
The system SHALL сохранять правила покрытых работ, immutable snapshots, месячного долга, валюты и баланса и исключать новые обычные начисления чистому ENGINEER.
#### Scenario: Engineering work already covered
- **WHEN** завершена покрытая процентным этапом работа
- **THEN** дополнительное PIECE за неё не создаётся независимо от совмещённых ролей

### Requirement: Pure engineer new earnings
The system SHALL ограничивать новое начисление чистого ENGINEER инженерным процентом изделия, независимо от сохранённой ordinary payScheme. Совмещённые роли MUST сохранять выбранную обычную схему; прежние начисления и долг не удаляются.
#### Scenario: Pure engineer with stored piece or turnover scheme
- **WHEN** чистый ENGINEER завершает новую обычную работу либо закрывается оборотный месяц
- **THEN** новое PIECE/оборотное начисление не создаётся, инженерный процент доступен и старые денежные факты сохранены
### Requirement: Preserve fixed unpaid monetary obligations
The system MUST сохранять ранее зафиксированное неоплаченное денежное обязательство валидного TASK_FIXED даже для чистого ENGINEER. Его сохранённая shareAmount SHALL оставаться источником суммы без пересчёта по текущей цене, количеству или ставке; прежние валютные и duplicate guards сохраняются.
#### Scenario: Fixed monetary share survives later price change
- **WHEN** чистый ENGINEER завершает TASK_FIXED с валидной сохранённой денежной долей и matching work/group, а текущая расценка изменена либо NULL
- **THEN** начисляется только сохранённая сумма один раз; snapshot и прежние PayrollEntry не меняются
#### Scenario: Nonmonetary or corrupted marker
- **WHEN** имеются только groupId, старый коэффициент, PHYSICAL_ONLY, STAGE_PREVIEW или повреждённый monetary snapshot
- **THEN** исключение для старого денежного обязательства не выдаётся
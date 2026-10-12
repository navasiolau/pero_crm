# Spec Delta

## ADDED Requirements

### Requirement: Framework-independent payment scenario

Payment scenario MUST не импортировать Next cache и SHALL возвращать ACK и минимальный context подтверждённого нового commit. Reader/prepare/transaction SHALL быть явными dependencies; прежние UUID/actor/financial/receipt/fence rules MUST сохраняться.

#### Scenario: Direct core use
- **WHEN** coordinator вызван с явными dependencies без framework effects
- **THEN** money/audit/outbox/receipt факты и ACK прежние, external/cache effects не выполняются

### Requirement: One effect adapter for web and bot

Web/bot SHALL вызывать один compatibility service; post-commit SHALL использовать explicit dispatch/notify/cache dependencies и existing confirmed-effect runner. Public ACK MUST оставаться прежним.

#### Scenario: New commit versus replay
- **WHEN** новый подтверждённый payment доставляется или replay возвращает original ID
- **THEN** новый commit получает прежний exact ordered effect/cache набор; replay не повторяет notifications/dispatch

#### Scenario: Optional effect failure
- **WHEN** dispatch/notification/cache падает после commit
- **THEN** сохранённый ACK/ID остаётся COMMITTED и остальные effects продолжаются

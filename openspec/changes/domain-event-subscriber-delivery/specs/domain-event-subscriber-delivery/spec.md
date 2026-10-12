# Spec Delta

## Purpose

Сохранять прогресс каждого подписчика доменного события отдельно, чтобы подтверждённая доставка не повторялась из-за отказа другого подписчика, без ложных обещаний exactly-once.

## ADDED Requirements

### Requirement: Frozen recipients
Система SHALL однократно сохранить первоначальный упорядоченный набор enabled зарегистрированных hooks, включая пустой набор.

#### Scenario: Concurrent initialization and later enable
- **WHEN** обработчики одновременно инициализируют одно owned событие, а затем включается новый C
- **THEN** сохраняется один набор без смешивания или дубликатов; C не добавляется к прежнему событию.

### Requirement: Subscriber progress
Система SHALL сохранять attempts, backoff и terminal ACK/SKIPPED каждого subscriber отдельно; подтверждённый receipt неизменен при retry другого.

#### Scenario: Partial success and nested emit
- **WHEN** A успешно исполнился и вызвал ctx.emit, B отказал, затем происходит штатный retry
- **THEN** A и его публикация не повторяются; вызывается только неподтверждённый B.

### Requirement: Current ownership
Система MUST подтвердить текущий claim token и срок lease после row lock перед receipt mutations и hook; прежний callback не подтверждает нового владельца.

#### Scenario: Expired owner waiting on lock
- **WHEN** старый callback ожидает row lock и lease истекает до захвата
- **THEN** его изменения receipt отклоняются; другой активный владелец не теряет свой прогресс.

### Requirement: Disabled and internal isolation
Система SHALL терминально отмечать неподтверждённого disabled/removed subscriber как SKIPPED с причиной; внутренний cleanup не получает пользовательских receipts/hooks.

#### Scenario: Disabled retry and obsolete cleanup
- **WHEN** B отключён перед retry или доставляется obsolete sketch cleanup
- **THEN** B не вызывается; cleanup обрабатывается только внутренним маршрутом.

### Requirement: Historical and consumer guarantees
Система MUST сохранять completed старые события без переоткрытия/изменений и MUST NOT выводить прежний ACK из PluginRunLog. Consumers MUST обеспечивать идемпотентность эффекта по event.id; crash после эффекта до durable ACK допускает повтор.

#### Scenario: Legacy pending or crash after effect
- **WHEN** old pending впервые получает receipts либо callback завершил эффект, но упал до ACK
- **THEN** неподтверждённый consumer может повториться с тем же event.id; exactly-once не обещается, старые completed остаются нетронутыми.
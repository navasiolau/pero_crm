# Spec Delta
## Purpose
Личная Telegram-доставка подтверждённого календарного события использует безопасный recipient scope и durable outbox, предотвращая дубликаты и слепые повторы неясных отправок.
## ADDED Requirements
### Requirement: Personal current recipient
The system MUST доставлять только личному активному связанному owner/account с current enabled calendar/current planned entry/revision/reminder. Другие сотрудники и org broadcast SHALL не получать сообщение.
#### Scenario: Link revoked or source cancelled before send
- **WHEN** после queue/claim изменены entry/revision/flag либо TelegramLink
- **THEN** preflight не разрешает отправку и сообщение не переадресуется новой привязке
### Requirement: Shared fact and dedup
The system SHALL использовать confirmed reminder fact и уникальный outbox namespace/fact; повтор claim/authorize/ACK MUST не создавать повторного send grant.
#### Scenario: Replayed authorize and ACK
- **WHEN** bot повторяет preflight или положительный ACK
- **THEN** второй send grant не выдаётся, SENT остаётся одним outcome
### Requirement: Unknown-safe sending
The system MUST сохранять timeout/malformed/ambiguous send как UNKNOWN без автоматического повтора. Только подтверждённый429 failure SHALL получать bounded retry не более3 попыток.
#### Scenario: Timeout or crash after authorization
- **WHEN** исход Telegram send неизвестен либо SENDING lease истёк
- **THEN** outbox UNKNOWN не claimable и повторный send не выполняется
### Requirement: Test namespace isolation
The system MUST работать в local/staging только с matching namespace, exact approved OWNER/CHAT mapping и approved actual testbot ID. Unconfigured/foreign/production-imported source SHALL не вызывать query/claim/send там.
#### Scenario: Missing approved test recipient
- **WHEN** test recipient/bot/namespace отсутствует или не совпадает
- **THEN** Telegram job остаётся выключенным и реальные сообщения не отправляются
### Requirement: Independent existing workers
The system SHALL использовать существующий web loop для очереди и existing isolated bot для outbound, сохраняя независимость web доставки и runtime секретность token.
#### Scenario: Bot unhealthy
- **WHEN** Telegram bot недоступен
- **THEN** web reminder продолжает подтверждаться, TG outcome не выдаётся за positive proof

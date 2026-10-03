# Spec Delta
## Purpose
Личные web-напоминания связывают календарное событие с единственным подтверждённым фактом и собственной Notification, сохраняя isolation окружений и актуальный доступ аккаунта.
## ADDED Requirements
### Requirement: Confirmed personal once delivery
The system MUST создать не более одной web Notification и shared confirmed reminder fact для namespace/entry/revision, атомарно и только собственному текущему активному enabled аккаунту.
#### Scenario: Concurrent tick and retry
- **WHEN** due запись обрабатывается параллельно либо job повторяется после сбоя
- **THEN** подтверждается одна Notification/fact, сбой transaction не оставляет частичный delivery
### Requirement: Live cancellation and revision
The system SHALL проверять current state/revision/due time/offset/flag до подтверждения; completed/cancelled/disabled/null offset и stale candidate не доставляются.
#### Scenario: Entry changed before candidate confirmation
- **WHEN** запись отредактирована, отменена или аккаунт выключен до подтверждения
- **THEN** старый reminder не создаётся, запись сохраняется
### Requirement: Trusted environment namespace
The system MUST принимать namespace только от trusted server environment; local/staging SHALL обрабатывать только exact allowlisted testowners и matching stamped entries/facts, без imported production доставки.
#### Scenario: Imported source or missing guard
- **WHEN** запись имеет production/NULL namespace либо environment/allowlist отсутствует или не совпадает
- **THEN** test worker не выбирает и не доставляет её
### Requirement: Precise personal notification visibility
The system SHALL показывать plan reminder всем enabled ролям, включая чистый ACCOUNTANT, только через собственный confirmed fact и current calendar grant, без расширения операционных уведомлений.
#### Scenario: Accountant own reminder and foreign payload
- **WHEN** enabled ACCOUNTANT открывает уведомления
- **THEN** собственное plan reminder видно, чужой/неподтверждённый/foreign-namespace reminder и operational content скрыты
### Requirement: Existing process scheduler
The system SHALL выполнять bounded60s reminder job в существующем web process, без нового сервиса/Telegram/org вызова; dispatch endpoint MUST требовать calendar.reminders capability.
#### Scenario: Invalid environment
- **WHEN** worker запускается без принятого environment context
- **THEN** query/delivery не выполняется и внешние уведомления не отправляются

### Requirement: Dedicated validated reminder origin
The system MUST выбирать первый непустой CALENDAR_REMINDERS_PUBLIC_ORIGIN, AUTH_URL, NEXTAUTH_URL для проверки reminder environment, без автоматического адреса и без изменения auth/CSRF.
#### Scenario: Both auth aliases absent
- **WHEN** оба auth alias отсутствуют и dedicated reminder origin явно совпадает с staging environment
- **THEN** reminder context проходит остальные обязательные DB/S3/runtime/owner guards
#### Scenario: Empty aliases and invalid explicit origin
- **WHEN** более приоритетный alias пуст, resolver использует следующий непустой; если выбранный origin unsafe или не совпадает environment
- **THEN** unsafe context отклоняется без менее приоритетного обхода

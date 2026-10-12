# Spec Delta

## ADDED Requirements

### Requirement: Shared bounded transport with domain permissions

Finance web/Telegram и logistics uploads MUST reuse ограниченный139 multipart/spool/hash transport; auth SHALL предшествовать body. Existing metadata/limits/read/finalization ACL MUST сохраняться отдельно в каждом домене.

#### Scenario: Domain stream upload
- **WHEN** разрешённый actor отправляет generated streamed документ
- **THEN** body не превращается в полный Buffer, size/SHA и original bytes сохраняются, final ACL проверяется прежде READY

### Requirement: Reservation and storage acknowledgement

PENDING→READY и audit MUST оставаться атомарными после storage ACK. Same UUID/context/bytes SHALL возвращать один документ; changed payload MUST отклоняться. Buffer callers MUST оставаться совместимыми, failed/unknown storage MUST NOT давать ложный READY.

#### Scenario: Retry or denied finalization
- **WHEN** storage отказал или permissions изменились до finalization
- **THEN** READY не появляется, exact retry сохраняет прежний intent, foreign/payment-linked/TTN-stage policies не расширяются

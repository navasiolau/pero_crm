# Proposal

## Why

№140: финансовые документы и ТТН используют полный formData/arrayBuffer. После №139 следует подключить общий ограниченный multipart/spool transport, сохранив разные доменные права и lifecycle.

## What Changes

- Web/Telegram finance и logistics HTTP adapters авторизуют до body, принимают общий spool, передают size/SHA/fresh reader в существующие сервисы.
- Finance/logistics upload services сохраняют Buffer lane для существующих callers и добавляют потоковый source; reservation/fingerprint/retry/PENDING→READY/audit и final ACL остаются в своих доменах.
- Storage forwarding принадлежит worker151: совместимый FileContentSource и atomic stream write; keys/mode/UploadError сохраняются. Общего business handler нет.

## Capabilities

### New Capabilities

- streaming-domain-documents: общий transport для финансовых документов и ТТН при прежних domain contracts.

### Modified Capabilities

Нет.

## Impact

bugfix/140 от fresh origin/staging16edb1e78daa47619977c3efa30e02ee1e20120e. №139/151 входят только обычными dependency merges после готовности; WIP feature copying/cherry-pick запрещены. Ownership140 HTTP/core/services и их existing tests; storage adapters151 не трогаются. User approved whole plan/commits, Root stage integration/push. Main/production/restic/dumps/seed/newDB запрещены; SAFETY-RULES STOP при mismatch.

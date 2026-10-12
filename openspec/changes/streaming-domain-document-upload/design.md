# Design

## Decisions

- HTTP adapters reuse spoolMultipartUpload с прежними metadata fields; auth до чтения, project/trip/document ACL и finalization остаются в существующих services. Limits image25MiB/document1GiB не повышаются.
- Streaming content structurally equals FileContentSource {size,contentHash,openRead}; Buffer input remains supported. Stream source SHA/size приходит только от owned guarded spool; storage проверяет реальные bytes/SHA и ACK прежде READY.
- Reservation и request fingerprint сохраняют прежнее представление bytes facts; exact retry получает один документ, changed payload конфликтует, failed/unknown storage не создаёт READY. Final actor/entity permissions rechecked в transaction.
- Finance и TTN не объединяются: retained payment document ownership/read ACL и ISSUED/SIGNED/ttnNumber semantics независимы. Web/Telegram используют существующие endpoints/auth/scopes.
- Worker151 owns document-storage.ts и две storage implementations. Соответствие Buffer|FileContentSource согласовано; его adapters forwarding выполняется после нормальных dependency merges, не обходится optional SDK calls.

## Verification

Existing HTTP generated multipart/stream tests, service retry/reservation/final-ACL/audit failures; meaningful relevant new regression только если существующие не покрывают stream path. Native/runtime на existing approved target только после Root ONE, exact own fixtures/cleanup/fingerprints; DI не заменяет native. №139 RSS диагностика/приёмка остаётся отдельной, её failure не называется PASS. Staging actual revision/image/adapters/downloadSHA/ACL после CI.

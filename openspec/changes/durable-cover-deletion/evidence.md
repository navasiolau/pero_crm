# Evidence — manual durable cover deletion138

## Actual local source checks

Bugfix138 starts at fresh cfc4f91a and normally merges prepared137 ff50b0e (HEAD ed3e2cf). Atomic138 production changes: shared137 intent/audit writer; manual product-sketch/project-cover CAS transactions and confirmed pending DTOs. No schema/data migration or obsolete exact-version replacement changes.

- Actual action RED8b854e (two failures) → GREEN2b76ec. New manual actions return confirmed metadata success with pending durable cleanup; compatible historical replay reports reconciliation and has no physical effects/new intent.
- Focused source checks2e4261:25/25(two real actions,14sketch CAS/ACL/replacement and9project CAS/replay cases).
- Additional controlled legacy/intent-rollback37f414:4/4. Stored historical domain receipts remain byte-identical, no identity enrichment/new event; injected intent failures preserve metadata/pointer/audits within the controlled transaction boundary.
- Ordinary delete regressions37f414:12/12 after extracting the same sealed intent writer. Existing137 supported-key fence/retirement and receipt seal remain in use.
- Strict web typinga57ac7 and scoped lintbf4678 PASS. Strict OpenSpec437be0 PASS.

Compatible legacy results keep their original UUID/file-CAS facts; incompatible replay or a newer pointer keeps existing conflict semantics. Only NEW manual deletes capture current storage identity and create sealed137 intent/file audit with domain CAS/receipt in the same transaction. Cleanup uses the same existing queue and UUID. Consumer/ordinary storage semantics do not acquire an exact-version promise.

## Remaining actual acceptance

Independent SOURCE_CODE_GO + UPDATED_INERT_EXEC_PROTOCOL_GO accepted; new native strictTS214dee/lint9578c0/inertdcfd20 passed. Actual local Root ONE b57276 CLOSED PASS, run63a6fced-b022-4527-8585-e20a256c714f, exact native source1d6795be31df9c8029c3ddae57fda7779643193d3e445ff0e7dba6bb0becc704. Two real manual criteria: CAS refusal, actual DomainEvent insertion then transaction rollback, same-UUID replay with one file audit/domain audit/domain receipt, committed storage fault followed by a fresh processor completing exact owned local bytes. Existing137 seven-case matrix was not repeated. All64 original rows/catalog equal b373ec8ec1ab293abc175e1e2e89b9f99f84e4a331dfd22be2b39e0d62fee6d4; ownDB/storage0, private folder removed, awaited single client disconnect, globalworkerfalse/outboundproviders0. Private pre/verified/cleanup-intent/cleanup-ack/closed receipts remain under .playwright-mcp/revision-acceptance/63a6fced-b022-4527-8585-e20a256c714f/. Independent FINAL_CODE_GO + ACTUAL_LOCAL_GO confirmed exact closed receipt a16d4349941a98af8a35999a4bcc2e00659728b931efa5f4deb7a6b9d03ccdbc; no native retry/new SQL is required. Stage/S3 actual NOT_RUN: Root integrates137 then138 by normal merge, accepts actual image/revision and scoped behavior separately. No restic/dumps/new DB/seed/reset/global settings or main/production effects.
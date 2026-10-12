# Tasks

## 1. Planning

- [x] 1.1 Проверить clean bugfix/139@cd38, AGENTS/preservation/SAFETY/context/spec inventory и actual caller order; подготовить required proposal/spec/design и подтвердить root legacy qualification в artifacts.
- [x] 1.2 Получить независимый design/allowlist/dependency GO и root RELEASE; сверить public parser/type version, согласованный pnpm lock delta и отсутствие посторонних package обновлений до исходных правок.

## 2. Context and transport

- [x] 2.1 Зафиксировать RED реального multipart/handler для bounded document path, headerless file-first и declared ACL0body; generated tests должны измерять bytes/pulls/publication, сохраняя existing roles/CAS/replay assertions.
- [x] 2.2 Реализовать neutral declared context header только в общем client helper и reuse target service; проверить File не прочитан, public result/nonce/body прежние, malformed/mismatched header отказан, headerless lane доступна.
- [x] 2.3 Реализовать bounded multipart/private owned spool и stream hash; проверить chunked/multiple boundaries/exact cap+1/extra files/duplicates/UTF8/empty file/abort/cleanup ownership, hash совпадает без полного doc buffer.
- [x] 2.4 Реализовать narrow stream publishing в existing S3/local, сохраняя Buffer callers; transport tests проверяют length/checksum/fresh reader/no giant buffer и known/unknown storage outcome без фиктивной отмены.

## 3. Handler lifecycle

- [x] 3.1 Подключить transport и early/late/final auth/context к actual upload handler; проверить обе lanes и permission revoke/status/CAS/context mismatch до publication, old stale/direct callers и task inheritance.
- [x] 3.2 Сохранить storageACK→atomic File+receipt и original fingerprint/bytes; existing/new tests проверяют simultaneous/serial same nonce, changed bytes/section conflict, audit rollback, unknown commit, notifications и winning/current originals.
- [ ] 3.3 Выполнить actual NextRequest/HTTP body/cancel/error сценарии; подтвердить прежние structured statuses/errors для limit/abort и существующее middleware exclusion, не только DI/pipeline rejection.

## 4. Local acceptance

- [x] 4.1 После concrete root IO/RSS approval выполнить warmed measured-worker HTTP25/100/1024 МиБ иtwo-concurrent generated docs; capture exact source/target, RSS/external/arrayBuffers/queued-byte peaks и<=32 МиБ transport/upload без размера-зависимого роста; sender memory отдельно.
- [ ] 4.2 В existing approved5433/native окне на exact owned fixtures проверить final ACL/retry/audit rollback/unknown ACK/byteSHA и cleanup/data fingerprints; no dump/newDB/seed/reset, fake не выдаётся за native PASS.
- [x] 4.3 Выполнить targeted suites/scopedlint/typecheck/strictOpenSpec и независимое final code review; исправить findings, recorded evidence actual, commits только после root/owner approval с exact staged paths.

## 5. Staging acceptance

- [ ] 5.1 После root normalmerge/CI принять actual deployed SHA/image/health и declared/legacy actual upload/download/hash/retry/ACL/abort на signed owned fixtures с protected DB/storage fingerprints; ignored producer closure отдельно reviewed.
- [ ] 5.2 Проверить existing ordinary/measurement/sketch/project-cover/batch/camera workflows на1440/390/360 иlarge-doc memory/runtime в reviewed window; zero unexplained visual/functional/data regressions, iMac/native недоступные проверки честно NOT_RUN; main/production не трогать.

Current local scope: source/unit checks и actual installedNextRequestAdapter/NodeHTTP mockSDK transport выполнены. Memory7cases evidence составлено из5 исходныхcompleted+2 strictTAIL_PASS; independent FINAL_LOCAL_TRANSPORT_GO/CODE_COMMIT_GO принят Root. FullNextServer/cancel/MinIO/PostgreSQL/staging не выдаются за PASS и остаются отдельнойприёмкой Root. Historical STOP/DIAGNOSTIC_ONLY сохраняются.

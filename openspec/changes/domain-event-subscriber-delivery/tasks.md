# Tasks

## 1. Subscriber progress

- [x] 1.1 Добавить actual-dispatcher RED: A success/ctx.emit затем B failure/retry не вызывает A повторно; проверить разные порядки.
- [x] 1.2 Добавить additive plan/receipt store с currenttoken/postlockclock/rollback guards; schema/client/SQLreview и targetedtests подтвердить uniqueness и empty snapshot.
- [x] 1.3 Включить frozen recipients/partialACK/disabledSKIP в dispatcher, сохранить internalcleanup/completed/SDKidempotency; GREEN и existingcontext/queue checks.

## 2. Verification

- [x] 2.1 Targetedtests/scopedlint/stricttyping/OpenSpec и independentCODEreview; source/migration/legacy scopes записать.
- [x] 2.2 После Rootlocalwindow проверить native2connections unique/concurrentinit/rollback/expiry +exactownedcleanup/originals equality, безglobalworker.
- [ ] 2.3 После normalmerge/CI принять actualstaging source/image/health и owned partialsuccess/literalconsumer/replay/cleanup; originals unchanged.

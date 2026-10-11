# Proposal

## Why

После подтверждённого сохранения отказ dispatch/notify/cache превращает изменение статуса задачи и другие штатные операции в ошибку. Потеря ответа самого commit сейчас не отделяется от rollback. После законного дальнейшего перехода IN_PROGRESS→DONE текущий статус уже не идентифицирует прежнее подтверждённое намерение START; его повтор должен подтверждать исходную команду без обратного перехода или новых записей.

## What Changes

- Ввести компактное различение COMMITTED, ROLLED_BACK и UNKNOWN вокруг существующей transaction, сохранив lock18435/55001, изоляцию и таймауты. Detached candidate остаётся неподтверждённым до успешного ACK либо exact durable proof.
- Для task status добавить optional request UUID/expectedActor precondition и receipt в существующем ChangeLog с actor/type/server-normalized payload fingerprint; семь действующих web callsites сохраняют одно намерение до подтверждения. Legacy вызовы остаются допустимыми, но UNKNOWN без receipt не объявляется безопасным автоматическим повтором. Переназначение и таймеры сохраняются.
- Для supported payment service переиспользовать существующие clientMutationId/fingerprint/receipt, вернуть тот же paymentId после подтверждения и отличать UNKNOWN. Обязательность UUID относится к134, обычное создание задачи — к165.
- Исполнять каждый optional post-commit effect независимо, регистрировать только безопасный operation/resultId/effect code. Подтверждённое сохранение остаётся успешным при каждом dispatch/notify/cache fault. Durable audit/outbox и business checks остаются внутри transaction.
- Подключить общий механизм к точным task/product/work/warehouse wrappers; для removeWork и трёх projectMaterial norm actions перенести существующий обязательный audit внутрь уже существующей transaction, не меняя его смысл.

## Capabilities

### New Capabilities

- `confirmed-mutation-outcomes`: подтверждение сохранённой операции, безопасная сверка неизвестного результата, повтор исходного намерения и изоляция optional эффектов.

### Modified Capabilities

Нет: основной каталог specs содержит engineer-product-access, его требования не меняются. Существующие change contracts распределения, процентов, выплат и доступа сохраняются.

## Impact

Задача133, отдельный worktree D:/Projects/pero_crm_worktrees/improvements-133, bugfix/133 от accepted staging cd38cb745759becd58dbbad4d6d37afa03f0ab7a. Код только после independent DESIGN_GO и root RELEASE. Exact source/test allowlist и verification matrix описываются в design.md; public signatures расширяются совместимыми optional полями, без schema/migration/package/lock changes. UI layout/styles и production history/FX/money/data остаются неизменными. Local native/staging fixture protocol требует отдельного review и GO; planning не разрешает SQL writes. main/production/restic/dumps/reset/seed/new DB и новые commits до явного human-разрешения запрещены.

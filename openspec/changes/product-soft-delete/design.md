# Design
## Context
Foundation54 уже добавил tombstone/operational filters/guards, financial history59 сохраняет доступ. Старый deleteProductCore делает физический delete и удаляет draft configs/pools, отказывает при истории. Это заменяется без schema55.
## Goals / Non-Goals
**Goals:** manager CAS/replay, сохранённые зависимости, активный timer отказ, явный UI.
**Non-Goals:** Project delete56, financial recalculation, restore UI, number reuse, file deletion, runtime агента.
## Decisions
- Typed productId/expectedUpdatedAtISO/clientMutationId. Старый string-only action не выполняет удаление без baseline.
- Существующий global task transaction, Parent→Product row locks, compare exactupdatedAt. Parent deleted проверяется до replay/ACK. Receipt product-delete:UUID содержит actor/fingerprint/ack в одной tx с tombstone.
- Сохраняются все зависимости независимо от frozen states. Только active TimeEntry source timer/stoppedAtnull блокирует операцию; timer start использует тот же transaction lock.
- UI wrapper flushes existing inline fields, retained baseline captured на confirm, explicit lostACK retry. Shared ConfirmDeleteDialog, warning не обещает физическое удаление.
## Risks / Trade-offs
- UpdatedAt conflict после inline flush → refreshedbaseline требует повторного подтверждения, не серверной подстановки expectedValue.
- Timer API до55 вне tx → узкая сериализация startTimer обязательна для гонки, без смены его business behavior.

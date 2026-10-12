# Design

## Context

Bugfix138 создан от fresh `origin/staging` cfc4f91a и обычным merge подключает prepared137 ff50b0e, merge HEAD ed3e2cf. См. proposal.md и утверждённую Root legacy policy. Atomic138 diff относительно137 затрагивает только manual sketch/project-cover adapters и общий receipt helper; staging принимает Root после137.

## Goals / Non-Goals

**Goals:** тот же durable sealed intent137 для новых manual deletes; сохранение domain CAS/UUID, один file audit, подтверждённый outcome и bounded legacy replay.

**Non-Goals:** миграция или обогащение старых receipts, переназначение target к текущему bucket/root, изменение obsolete exact-version replacement, новая очередь/таблицы/settings.

## Decisions

Небольшой shared writer выделяет существующие137 file audit/receipt/DomainEvent creation без изменения ordinary guarantees. Manual core после текущего permission/CAS сохраняет этот intent вместе с pointer clear и domain receipt. Общие UUID/storage-binding locks137 сериализуют запрос; receipt seal и permanent tombstone сохраняются. Identity получается только для нового удаления, после legacy replay, чтобы старый confirmed result не зависел от текущей конфигурации storage.

Новые domain success receipts содержат cleanupEventId; после commit actions используют cleanupDeletedFile137. Физический отказ даёт ok=true/cleanupPending=true, metadata остаётся подтверждённой. Revalidation после known commit не превращает результат в неизвестный. Public response не отдаёт storage keys/identity.

Compatible legacy receipt с storageIntent и без нового cleanupEventId не переписывается: runtime response сохраняет confirmed business result и добавляет cleanupPending/cleanupReconciliation; physical effects/новый intent отсутствуют. Existing replay проверяет actor/fingerprint/current pointer как прежде, поэтому старое подтверждение не применимо к новой обложке. Obsolete-sketch upload/replacement route не меняется.

## Risks / Trade-offs

- [Storage outage] → durable intent137 и тот же UUID retry.
- [Старые receipts без identity] → подтверждённый business outcome с reconciliation, без опасного automatic retarget.
- [Новый pointer или alias] → существующий CAS и supported-writer tombstone137 до effects.

## Migration Plan

Schema/данные/исторические receipts не мигрируются. Targeted RED→GREEN обоих manual endpoints, legacy confirmed/no effects, current CAS/ACL compatibility, typing/lint. Native после reviewed thin protocol и Root ONE на existing5433; staging после normal137→138 integration/CI/identity. Без нового QA framework/матрицы, main/prod/restic/dumps.

# Context

Source175 содержит Finish, ProductFinishAssignment, CatalogueMediaAsset, Product.finishRevision и отдельную catalogue-media область. Владелец прямо отменил72–74 после завершения их испытаний; данные original сохраняются до проверенного выбора schema boundary.

# Goals / Non-Goals

Goals: убрать всю active feature и imports, обычные Files/Viewer/storage/ACL сохранить; direct removed routes404; clean generated ORM; local/CI/stage подтверждать честно.
Non-Goals: business S3 cleanup/archives, финансовые удаления/пересчёт, rollback applied migrations, production release, правки Task68/69/journal58.

# Decisions

- Remove active modules, not feature flag. Shared viewer возвращается к scope обычных File, upload endpoint только /api/files/upload; S3 functions добавленные исключительно catalogue scope убрать, стандартный transport не менять.
- Prisma models/relations/enum/technical column убрать. Historical SQL090/130/140 НЕ удаляется. Coordinator сначала проверяет actual counts/FK/asset refs. Для empty tables новый ordered guarded DROP без CASCADE; при любых original records STOP/PRESERVE, отдельная retention boundary вне active feature без выдуманного переписывания данных.
- Все feature-specific tests и native helpers удаляются из active suite. Сохранить общие image transform/image-preview/ordinary upload/roles tests и добавить meaningful nav absence/read permission regression.
- Normal merges сохраняют №47 и disjoint Task changes. Исторические73/74 planning artifacts не переименовывать в PASS/removal.

# Risks / Trade-offs

Drop не выполнять работником и не считать source schema diff actual DB proof. Nonempty referenced assets нельзя физически удалять. No completed47/financial proof повторяется ради removal.

# Migration Plan

Coordinator readonly counts→автор guarded migration source→coordinator exact existing local/stage application→native metadata/wholeTSC/CI/direct404/nav absence. Без dumps/restic/newDB; main/prod только отдельно по владельцу.

# Design
## Context
Project имеет files, но не cover. ProductSketch isolated FK/CAS существует. POST47 сохраняет bytes→storage→atomic receipt, client48 удерживает UUID/FormData при unknown ACK. Используем эти границы, не fakeProduct.
## Goals / Non-Goals
**Goals:** независимый project target, management права, typed projection, понятный hero.
**Non-Goals:** Product layout/measurement/camera/finance, новые форматы/deps, S3 infra/production/runtime агентом.
## Decisions
- Project.coverFileId unique nullable File relation ProjectCover SetNull; FK и unique без backfill. Same-project/unbound/image validation в domaincore (crossrowconstraint Prisma не выражает).
- Project→File lock order, manager union и projectVisibilityWhere, receipt project-cover:UUID в same withTaskTransaction. Empty upload CAS only; нет gallery replacement.
- Generalupload target не получает cover grant. Explicit assignProjectCover исключает Product/Task/assignCover. Storage/error/unknowncommit механизм47 сохраняется.
- Project cover projection использует existing fileVisibilityWhere; никаких обходов privatefileACL.
- UI отдельный widget с ProductHeroImage/FileViewer и transport48; product layout не меняется. Delete original intent применяется после commit; retry повторяет точный intent.
## Risks / Trade-offs
- Storage вне SQL → exactkey compensation только доказанного callbackrollback; unknowncommit не удаляет возможный committed original.
- Миграция нужна до appdeployment → Root schema/native/staging review. Оригинальные проекты/файлы не изменяются.

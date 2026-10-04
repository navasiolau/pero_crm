# Design

## Context

Actualdigest967541885/logs подтверждаетP2022 column MaterialCategory.revision does notexist. Поле @default(0) имеется только в schema.prisma; исходная warehouse migration не содержит его, application/OpenSpec не использует category revision/CAS. Default scalar selections ломают list/create/findUnique/update, поэтому select обход исправляет лишь часть проблемы.

## Goals / Non-Goals

**Goals:** убрать phantom field, регенерировать клиент и восстановить существующие warehouse category операции/страницу.

**Non-Goals:** миграция/новое поле БД, CAS/inline warehouse функция, перерасчёт остатков/цен, изменение ролей/данных, main/production.

## Decisions

- Удалить только MaterialCategory.revision из Prisma schema. Это восстанавливает historical table contract и generated default fields; additive DDL отвергнута как добавление неиспользуемой незапрошенной возможности.
- Initial generated-client regression MUST показать поле до удаления, после regenerate исключить его. Native на existingDB выполняет default list/create/toggle внутри outerROLLBACK; browser readonly warehouse/items наactualnewimage.
- Не трогать revision других моделей и не менять SQL/history. Separatebugfix58/OpenSpec от Income61, ordinarymerge соблюдаетsourcedependencies.

## Risks / Trade-offs

- [Старый generated client останется после schema change] → private regenerate +build/CI иactualdeployed client/page.
- [Маскировка ошибки select] → generated model и всеобычные scalar операции, без workaroundquery.
- [Повреждение исходных данных] → nativeforcedrollback/readonlyUI, no schemaDDL/backfill/dumps/restic.

# Design
## Context
58 уже содержит PROCUREMENT и warehouse manage set ровно ADMIN/DIRECTOR/MANAGER/PROCUREMENT. OFFICE/FIELD operationalread grants исключают чистый ACCOUNTANT. 72 создаёт foundation,73 назначения snapshots и74 media отдельно.
## Goals / Non-Goals
Независимые сохранённые варианты с edit/deactivate. Не привязывать к Project/Product, не писать платежи/зарплату/цены, не реализовывать storage74.
## Decisions
FinishKind ENAMEL/VENEER/COATING и Finish UUID(name/code/color/active/revision/createdAt/updatedAt). Code trim+uppercase, unique(kind,code) allowsодноимённыекоды разных материалов. Name/color plain text, requiredmaxlength; нет требованияhex для дерева.
Authrolechecks в page/query/action/core; толькоactive доступныreadonly, manager видитinactive и можетвключить. Обычнаяформа сохраняет captured integer revisionCAS, stale update/active refusalnoaudit; запись+ChangeLog atomicwithTaskTransaction. P2002 duplicate mapsfriendlyerror, все прочиеошибкиgeneric безdetails/secrets.
UI /finishes с DataTable и реальным sharedDialog Editor; navEntry operationalrole set. Middleware prefix добавленonlycatalog, readonlyfinance-role нерасширяется. Media74 модель неизвестна, pointer сейчаснеимитируется и никакогоuploadcontrol нет.
## Risks / Trade-offs
Неактивныйcode остаётсязанят, UUID neverreused; snapshots73 будуткопироватьвыбранныйвариант. Sourcechecks/buildnative не DB/runtimeproof; Root выполнит migrationtargetguards/rollbacknative.
## Migration Plan
Добавочная enum/table/uniqueindex миграция20261003060000. No seed/reset/newDB/restic/dumps. Rootexistinglocal/stagingguards и nativeouterrollback; prod толькоотдельноowner.

CAS использует monotonic integer revision, а не равенство wall-clock timestamps: одинаковая миллисекунда двух правок не разрешает lost update. UpdatedAt остаётся служебной датой. Sample-media pointer сейчас отсутствует: он должен ссылаться на реальный защищённый asset74, не на fakeProject/File.

До первого применения Root перенёс reserved migration на20261003090000_finish_catalog. Native защищает динамически все actual public tables (включая CalendarEntry64 вне source72 Prisma.ModelName) и schema fingerprints columns/constraints/indexes/enums. Прежний canonical guard не изменён, единственное operational исключениеApiToken.lastUsedAt сохранено. SQL не выполнялся агентом.

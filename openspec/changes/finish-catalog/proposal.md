# Why

Владелец отменил функциональность «Покрытия» целиком. Скрытого feature flag недостаточно: каталог, назначения изделия и образцы не должны оставаться в UI, routes, active domain/API/types/Prisma.

# What Changes

- Удалить active functionality задач72–74: nav, catalogue CRUD/page, Product section/queries/controllers, sample routes/storage domain и associated active tests/QA.
- Сохранить migration history090/130/140 и неизменяемые financial facts. Новая guarded drop migration допускается только после coordinator actual empty-row/reference proof; при nonempty metadata destructive DDL останавливается, данные и blobs не переписываются.
- Общий FileViewer/upload/storage остаются для обычных Files. №47 client upload исправления, текущие Task68/69 и journal58 сохраняются при normal integration.

# Capabilities

## Modified Capabilities

- finish-catalog: отмена и полное снятие active catalogue/assignment/sample scope.

# Impact

Source: web nav/routes/Product page/schema/domain/helpers/tests. No production/main/storage cleanup. Координатор владеет Git, actual DB migration и staging acceptance. Один change finish-catalog; historical73/74 specs остаются историей.

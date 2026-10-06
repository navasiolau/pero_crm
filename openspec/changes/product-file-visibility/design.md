# Design

## Context

См. proposal.md Why. Сейчас fileVisibilityWhereGrants требует одновременно назначенный проект, назначенные изделие и задачу (assignedProject/Product/Task). productVisibilityWhere для WORKER уже имеет глобальное чтение PRODUCTION, но комментарий «File and technical assignment access never inherit the global production read» фиксирует, что файлы его не наследуют. Поэтому цех видит карточку чужого PRODUCTION, но files=[], sketchFile=null, hasB3d=false, _count.files=0 и 404 на скачивание. Для MOUNTER глобального чтения изделий нет вовсе. Эскиз (productSketchProjection), hasB3d (products/queries.ts, projects/queries.ts с фильтром .b3d), _count.files и taskDetailsIncludeFor.files уже используют тот же fileVisibilityWhere, отдельные ветки не нужны.

## Goals / Non-Goals

**Goals:** добавить в fileVisibilityWhere для FIELD_ROLES (WORKER, MOUNTER) ветку чтения файлов изделий со статусом != DESIGN — прямые файлы (product.status != DESIGN) и файлы задач изделия (task.product.status != DESIGN), с сохранением live-фильтров и закрытым DESIGN.

**Non-Goals:** изменение productVisibilityWhere, projectVisibilityWhere, taskVisibilityWhere, upload-context.ts, delete-permission.ts, cover-core.ts, canEdit/canReplaceProductCover, maskProductionRead; изменение UI; миграции; общие файлы проекта без изделия; расширение записи.

## Decisions

- Новая ветка только для hasAnyRole(FIELD_ROLES) и без hasFullProjectVisibility: `OR [существующий строгий AND, { OR: [{ product: { status: { not: DESIGN } } }, { task: { product: { status: { not: DESIGN } } } }] }]`. Альтернатива «расширить assignedProductVisibilityWhere» отклонена: она бы открыла и карточки/задачи, а нужен только File-доступ.
- Прямая ветка покрывает замеры, документы, файлы инженера, эскиз и .b3d (у них productId изделия). Косвенная ветка через task.product покрывает файлы задач изделия, даже если file.productId пуст, а task скрыта по assignee. Альтернатива «только product» отклонена: часть файлов задач не попала бы в project.files.
- liveChildWhere остаётся внешним AND в fileVisibilityWhere, поэтому живые проекты и изделия фильтруются как раньше; для task.product явно требуем deletedAt=null, так как liveChildWhere не проверяет продукт через задачу. DESIGN проверяется как `status: { not: DESIGN }` (PRODUCTION, DELIVERY, INSTALLATION, DONE, RECLAMATION видны).
- Комбинированные роли (ENGINEER+WORKER, ENGINEER+MOUNTER) получают объединение: инженерная ветка DESIGN сохраняется, полевая ветка добавляет не-DESIGN файлы. ENGINEER без FIELD не получает новую ветку.
- Скачивание /api/files/:id, files/actions.ts, cover-projection и все проекции файлов получают новое право автоматически, так как используют fileVisibilityWhere; отдельные изменения вызовов не нужны.

## Risks / Trade-offs

- Расширение чтения файлов без расширения карточек: MOUNTER может скачать файл не-DESIGN по прямому id, даже если изделие скрыто в списке — намеренно, по требованию «видят ВСЕ файлы», запись при этом закрыта → приёмка прямым GET 200/404.
- Файлы задач чужих исполнителей становятся видны в project.files и product.files — намеренно, так как это файлы изделия; сами задачи остаются скрыты по taskVisibilityWhere, их исполнители и суммы не раскрываются через файлы.
- Фикстура matches() для OR/AND должна трактовать отсутствующий deletedAt как null — уже так; иначе новая ветка с deletedAt=null не совпадёт в тестах → проверка focused тестами visibility.

## Migration Plan

Миграции не нужны. Реализация только в server/access/visibility.ts. Проверки: pnpm lint, pnpm --filter @pero/web test (в первую очередь visibility-тесты), ручные кейсы в evidence.md: цех видит замер+эскиз+документы чужого PRODUCTION, DESIGN не видит, /api/files/:id 200 вместо 404. Откат — удаление новой OR-ветки.

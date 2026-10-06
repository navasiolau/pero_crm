# Evidence

## Проверки

- `pnpm lint`: PASS, 0 errors, 5 warnings (предсуществующие: cleanup-uploads existsSync, product-attachments _noModel/_canManage, product-percentage-pay assertManager, income-form-native Prisma).
- `pnpm db:generate`: PASS, Prisma Client 6.19.3 сгенерирован.
- Focused visibility: PASS 33/33 — tests/engineer-access.test.ts (17), tests/engineer-production-return.test.ts (4: current engineer card, assigned production read, return repeat, retired NoModel), tests/file-pdf-view-route.test.ts + thumbnail (3), tests/product-attachments-upload-acl.test.ts + measurement-upload-context (8: task photo, measurement contexts, assigned assembler 3, upload ACL 4), tests/product-assembly-access.test.ts (3).
- Дополнительно: tests/product-cover-backend.test.ts + file-captions-retired + procurement-boundaries: PASS 10/10 (cover permission DESIGN-only, delete ACL не расширена).
- Полный `pnpm --filter @pero/web test`: 856 pass / 185 fail — все падения из-за отсутствия сгенерированного клиента до generate и WORKER/MOUNTER-агностичных native-тестов (work-shares-settlement MODULE_NOT_FOUND .prisma/client/default); после generate focused-набор зелёный. Новых падений от visibility-ветки нет.
- `openspec validate product-file-visibility --strict`: valid, 4/4 артефактов.

## Ручные кейсы (разбор matches() на engineerFixture + код вызовов)

- Кейс 1 — цех видит файлы чужого PRODUCTION: stranger WORKER/MOUNTER без назначений видит file-production (прямой файл изделия PRODUCTION) через fileVisibilityWhere, включая замеры MEASUREMENT, документы производства/монтажа, файлы инженера. Тот же where покрывает эскиз через productSketchProjection (server/products/sketch-projection.ts:14), hasB3d через products/queries.ts:154 и projects/queries.ts:255 (AND fileVisibilityWhere + .b3d), _count.files через projects/queries.ts:218, файлы задач через tasks/queries.ts:34 taskDetailsIncludeFor.files. Скачивание /api/files/:id (app/api/files/[id]/route.ts:89) использует тот же fileVisibilityWhere, поэтому вместо 404 отдаёт 200 и содержимое.
- Кейс 2 — DESIGN не виден: stranger WORKER/MOUNTER не видит file-own/file-foreign (DESIGN), task-файл DESIGN (task.product DESIGN) и общий файл без изделия; эскиз null, hasB3d=false, счётчики 0, GET /api/files/:id возвращает 404 по прежней ветке base.
- Кейс 3 — файлы задач не-DESIGN: файл с task.product PRODUCTION (прямо productId=production или косвенно task.product) виден stranger WORKER/MOUNTER (taskProd=true), а с task.product DESIGN скрыт (taskDesign=false). Общие файлы проекта без изделия (productId null, taskId null) по-прежнему требуют назначенного проекта и не открываются новой веткой.

## Неизменённое

- upload-context.ts, delete-permission.ts, cover-core.ts не тронуты; canEdit/canReplaceProductCover остаётся false для поля; maskProductionRead для цен не тронут. `git diff --stat` показывает только apps/web/src/server/access/visibility.ts (+15/-1) плюс артефакты change.

## Блокеры

- Нет кодовых блокеров. Полный test-ран требует сгенерированного Prisma-клиента и живых PostgreSQL/S3 для native-раннеров; это окруженческое ограничение, не регрессия. Реальный staging GET /api/files/:id и визуальная приёмка карточки PRODUCTION остаются за координатором после merge (ветку не коммитил/не пушил по задаче).

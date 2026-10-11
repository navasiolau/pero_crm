# Design

## Context

Мотивация описана в proposal.md. Исходная ревизия — d121f0798e963f32d13f52c9bde57c0aa82b7929, feature/153; выборка сделана после fetch. TaskDetails объявлен в components/task-dialog.tsx, FileListItem — в components/file-list.tsx. server/tasks/queries.ts и server/files/list-view.ts импортируют их через import type; исполняемый UI сервером через эти рёбра не загружается.

mapTaskDetails уже выполняет денежную проекцию, фильтрует согласованность Work/Product/Project, преобразует Decimal в строки и Date в ISO/null, получает разрешённые файловые DTO. ordinaryFileListView возвращает только id/fileName/mimeType/section/canDelete. Эти реализации и их реальные зависимости сохраняются целиком. Участие получателя в старой оплате не подменяет актуальное назначение и роли; требования engineer-product-access не меняются.

## Goals / Non-Goals

**Goals:**

- Единственное определение TaskDetails в нейтральном lib/task-details.ts; FileListItem рядом с ViewableFile в lib/viewable-file.ts.
- Все потребители двух DTO используют нейтральный путь; количество обратных server→components импортов этих контрактов уменьшается с двух до нуля.
- Сохранение порядка/типов/optional/null всех полей и вложенных DTO, а также байтов JSON утверждённых fixtures и executable emit существующих файлов.

**Non-Goals:**

Новые DTO/получатели, расширение полей, raw Prisma-record, изменение mapper/SQL/ACL/handlers/UI, миграции, обновления зависимостей, SDK/bot API, обещание сокращения JS. Не переносить TASK_TYPES, taskStatusLabels, taskStatusBadge, FileList, FileListRow и другие реальные UI exports. Не выполнять SQL, native, Browser/Next/fullbuild в рамках локального переноса типов.

## Decisions

### Contract placement and imports

TaskDetails переносится дословно, включая содержательные комментарии. Новый модуль содержит только import type для TaskStatus и FileListItem, затем export interface. FileListItem добавляется в существующий нейтральный модуль рядом с ViewableFile без изменения getViewableFileSource.

Все type consumers перенаправляются; смешанные UI импорты разделяются на прежний runtime import и отдельный import type. Старые компоненты не содержат определения или compatibility re-export контрактов: проверенный inventory позволяет обновить все потребители одновременно. Альтернатива с re-export оставляла бы ложный источник контракта и не достигала бы цели границ. Новый packages/contracts исключён: бот и packages сейчас эти типы не используют, межпакетное расширение не обосновано.

### Exact source scope

Пути относительно корня; 12 production paths, 11 существующих и один новый:

1. apps/web/src/lib/task-details.ts — новое единственное определение TaskDetails.
2. apps/web/src/lib/viewable-file.ts — единственное определение FileListItem рядом с ViewableFile.
3. apps/web/src/components/task-dialog.tsx — убрать определение TaskDetails; перенаправить оба type imports, сохранить UI exports.
4. apps/web/src/components/file-list.tsx — убрать определение FileListItem; нейтральный type import, сохранить runtime source helper.
5. apps/web/src/components/actual-time-dialog.tsx — TaskDetails import.
6. apps/web/src/app/(app)/my/my-tasks-view.tsx — TaskDetails import.
7. apps/web/src/app/(app)/tasks/tasks-page-view.tsx — отделить нейтральный TaskDetails от прежнего UI import.
8. apps/web/src/app/(app)/tasks/tasks-kanban.tsx — аналогично.
9. apps/web/src/app/(app)/projects/[id]/tasks-tab.tsx — аналогично.
10. apps/web/src/app/(app)/projects/[id]/files-tab.tsx — отделить FileListItem от прежнего FileList import; FileRow не меняется.
11. apps/web/src/server/tasks/queries.ts — только TaskDetails type import.
12. apps/web/src/server/files/list-view.ts — только FileListItem type import.

Четыре existing test paths меняют исключительно type-import:

- apps/web/tests/task-file-list.test.ts;
- apps/web/tests/task-work-reward-ui.test.ts;
- apps/web/tests/plain-file-list.test.ts;
- apps/web/tests/file-list-printing.test.ts.

Все runtime imports компонентов в этих тестах сохраняются. Новые committed tests/helpers не нужны для дословного переноса; возможный ignored verification script и receipts относятся только к локальной проверке и не включаются в коммит.

### Local verification

1. До изменений сохранить source pins исходных 11+4 файлов из Git d121f079, фактический compiler version и options. Для нового модуля зафиксировать import/export inventory; без executing source при проверке emit.
2. У существующих 15 source/test файлов сравнить TypeScript executable emit до/после одним установленным компилятором с одинаковыми options из tsconfig; source maps и comments исключить из сравнения явно. Требуется точное равенство emitted JS/JSX bytes каждого файла, без изменения runtime import inventory. Новый task-details.ts MUST эмитировать только пустой module marker и не вносить executable imports. Это доказательство отсутствия runtime delta, а не full Next build или byte-identical source maps.
3. Переиспользовать существующие tests file-list-view, work-shares-settlement, engineer-access, task-file-list, task-work-reward-ui, plain-file-list, file-list-printing. Проверяются exact file fields/delete ACL, неизменяемая история частей/строковые суммы, engineering legacy-money masking, скрытые вложенные связи и SSR/handlers. Никакой замены содержательных assertions регэкспами структуры кода.
4. ROOT_RELEASE_IMPLEMENTATION уточнил достаточный локальный набор: семь существующих содержательных suites, дословное равенство двух declarations и executable emit 15 существующих файлов. Эти независимые проверки подтверждают отсутствие изменений реализации mapper, полей, доступа и UI. Полный новый TaskDetails JSON capture на Date/null/Decimal и own/foreign/office cohort остаётся дополнительной проверкой и имеет статус NOT_RUN_OPTIONAL; частичные assertions существующих suites не выдаются за выполненное сравнение полного JSON. При необходимости отдельного capture использовать один утверждённый fixed in-memory cohort, source pins и свежие процессы; real DB/storage/mutations запрещены. Новый committed mirror test не добавляется.
5. RG/AST inventory после правок: определения ровно по одному; 0 ссылок на старые UI paths для двух типов в server и всех source/test consumers; нет новых runtime imports. Бот/packages — подтверждённое отсутствие потребителей, а не выдуманная выполненная bot runtime-приёмка.
6. TSC --noEmit --incremental false после ROOT_HEAVY_TSC_SLOT, lint изменённых файлов и strict OpenSpec. При необходимости один owned offline frozen install, 0 download, lockfile SHA до/после; запуск согласовать отдельно, версии не менять.

### Delivery and coordination

Независимый CODE_GO должен предшествовать атомарному разрешённому коммиту. Push/normal merge staging выполняет root. Staging-приёмка проверяет фактически развёрнутый SHA/image/health и затронутый read-only просмотр карточки задачи и файлов; до этого статус STAGING_NOT_RUN. Исправления выполняются в feature/153. Main/production не включены; миграций нет.

Задача147 меняет tasks/queries.ts в отдельной ветке. При ordinary merge возможен import-hunk conflict; сохранить нейтральный TaskDetails import и согласованные runtime query changes147, затем повторить typing/affected scenarios. Исходники соседних веток не копировать.

## Risks / Trade-offs

- Потеря optional/null или комментария при переносе → дословный interface move и независимое сравнение исходного/нового declaration AST, полный typing.
- Замена UI runtime import вместе с type import → сохранить UI imports, проверить emitted bytes для каждого изменённого файла.
- Совпавшие частичные assertion ошибочно выданы за полный DTO proof → отдельный pin-bound полный capture, ограничения доказательства явно записать в evidence.
- Расхождение baseline от новых staging commits → фиксировать baseline d121f079 и кандидат отдельно; принятый root integration SHA требует собственных сценариев.
- Guard mismatch → STOP и сообщение root согласно D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md. БД/инфраструктура/storage не затрагиваются.

## Migration Plan

Миграции данных отсутствуют. Изолированная ветка feature/153 проходит local → независимое review → normal merge staging → реальная staging-приёмка. При регрессии исправление возвращается в ветку153; main запрещён до прямого указания владельца.

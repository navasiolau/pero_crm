# Design

## Context

№192, feature/192 от3def4f0c. №190 удаляет timer writer, №191 возвращает реальное распределение обычной сдельной работы. Независимый core/dialog создаются до dependency merge; общие actions/task-dialog/my/tasks-tab меняются только после обычного merge191 через Root.

Safety: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; СТОП при guard mismatch. БД/инфраструктура/хранилище/дампы/reset/seed не используются агентом. Зависимости устанавливаются frozen в выделенный virtual store на C:, lockfile не меняется.

## Goals / Non-Goals

**Goals:** отдельная команда исполнителя с текущим доступом, CAS, подтверждаемым повтором и пригодным UI; узкое чтение ordinary tasks для coordinator.

**Non-Goals:** расширение MANAGER_ROLES/global product visibility/финансов, выполнение чужих задач, изменение TimeEntry/старого timer writer, количеств и денежных снимков, generic task update для coordinator.

## Decisions

1. `reassignOrdinaryTaskCore(actor,input,transaction)` принимает taskId/assigneeId/expectedRevision/clientMutationId. Actor и recipient читаются свежими в транзакции; доступ к изделию проверяется через существующую политику. Обычная работа должна иметь согласованные project/product bindings, LEGACY, отсутствие stage pools/conversions/settlements и зафиксированную допустимую цену либо TASK_FIXED снимок.
2. Сначала проверяются текущие actor grants и подлинность versioned receipt, затем новый запрос проверяет ревизию, незавершённость и отсутствие начислений/settlements. Namespace `task-reassignment-v1:UUID` и строгий typed result не смешиваются с №191. Действие не меняет history/files/TimeEntry; один task update меняет только assignee/status/revision. После commit доставляются assigned event и уведомление без повторной доставки при receipt replay.
3. WORK_COORDINATOR получает narrow ordinary-task read grant через productVisibilityWhere; taskExecutionWhere не меняется. DTO содержит optional canReassignOrdinaryTask, подтверждающий только affordance. Core остаётся authority.
4. Обычный MANAGER edit показывает отдельное действие переназначения тем же command; generic updateTask отвергает изменение исполнителя ordinary task. Engineering старый путь сохраняется. Частичная передача выполняется №191 до переназначения.
5. SearchableSelect получает opt-in popupMinWidth/wrapOptions. CSS использует min(viewport,max(requested width,anchor width)); перенос включается только выбранным selectors, остальных не затрагивает.

## Risks / Trade-offs

- [Роль снята/задача завершена конкурентно] → свежие строки под общим task transaction lock и CAS ревизии до update.
- [Потеря ACK] → замороженный запрос в UI, UUID typed receipt, никакого автоматического нового UUID для неизвестного результата.
- [Расширение прав через карточку] → отдельный read grant, без изменения execution и generic mutation grants.
- [Общие файлы параллельных задач] → изменения после обычного merge191; чужой код сохраняется.

## Migration Plan

SQL migrations нет. Root интегрирует190→191→192 обычными merge, принимает новый staging SHA/образ и затронутое поведение. Самостоятельных commit/push/deploy или production нет.

# Proposal

## Why

Обычное createTask сохраняет задачу в transaction, а обязательный аудит и task.assigned — после commit. При отказе аудита или потере ответа повтор с достаточным остатком работы создаёт вторую задачу; в аудите quantity1 из работы10 расходовала quantity2. №165 устраняет этот повтор намерения, сохраняя разрешённое создание двух самостоятельных одинаковых задач.

## What Changes

- Обязательный clientMutationId UUID и expectedActorId для обычного createTask; actor берётся из серверной сессии. **BREAKING** для старых прямых вызовов без UUID: отказ до записи, без серверной генерации ключа.
- Один transaction сохраняет Task/зависимости, обычный аудит, task.assigned outbox и actor-bound receipt в существующем ChangeLog. Новый результат содержит task ID и UUID подтверждённого намерения.
- Повтор того же actor/UUID/нормализованного payload возвращает прежний минимальный ACK без нового Task, quantity, audit или event; другой payload/actor конфликтует.
- Использовать confirmation и post-commit helpers №133. Отказ доставки/cache после подтверждённого commit не меняет ACK; после UNKNOWN только matching COMMITTED ACK освобождает UUID. Отсутствие receipt под lock и rollback повторной попытки не исключают поздний исходный запрос.
- Диалог TasksTab удерживает UUID и неизменный payload при UNKNOWN, закрытии/повторном открытии и React remount в той же странице. Сознательно новая задача после разрешения прежнего намерения получает новый UUID; полная загрузка страницы не запускает mutation автоматически.

## Capabilities

### New Capabilities

- `ordinary-task-creation-intents`: атомарное создание обычной задачи, actor-bound replay и безопасное восстановление неопределённого ответа в диалоге.

### Modified Capabilities

Нет: действующие role/visibility, quantity, dependency graph, финансовые правила и обычный вид диалога сохраняются.

## Impact

- Ветка bugfix/165 создана от origin/staging d121f0798e963f32d13f52c9bde57c0aa82b7929; после принятия №133 обычным FF merge обновлена до c6508448450813450b5dbb6a67d77494c37f6cdb. Отдельный worktree improvements-165; исходники WIP не копируются.
- Предлагаемый production scope: tasks/actions.ts (только createTask/imports), новый tasks/creation-receipts.ts, новый components/use-task-create-command.ts, projects/[id]/tasks-tab.tsx (только создание), operations/post-commit.ts (один task-create код), changelog/queries.ts (точное исключение внутреннего receipt).
- Существующие schema, миграции, версии, lockfile, production data и внешние уведомления не переустраиваются. Проверки включают actual action/real transaction, две connections PostgreSQL, loss-of-ACK/reopen в Chromium и actual staging на принятом SHA. Local/staging dumps, seed/reset/newDB/restic/main/production запрещены; guard mismatch означает STOP.

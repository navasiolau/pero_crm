# Proposal

## Why

Ручной stop, switch, task completion и auto-stop считают время разными путями:20часов могут записаться как1200минут, а запоздалый stop перезаписать подтверждённый auto-stop720. Общий механизм должен сохранять ровно один факт закрытия автоматического таймера и защищать прежние записи.

## What Changes

- Ввести один серверный механизм start/stop автоматических таймеров в существующих task transactions. Все закрытия source=timer считают minutes/stoppedAt/autoStopped из одного instant; elapsed>=720минут даёт720, stoppedAt=startedAt+12ч, autoStopped=true. До границы сохраняются floor/minimum1 и фактический instant.
- getActiveTimer/auto-stop и явный stop используют существующий общий lock18435/55001. Закрытие применяет условие stoppedAt=null, поэтому поздний запрос не переписывает уже закрытую запись. Start/switch/completion используют тот же механизм; повтор live same-task start не создаёт второй активный таймер.
- Разрешённое ordinary переназначение останавливает старые таймеры задачи в той же transaction до смены assignee, сохраняя IN_PROGRESS и возможность нового исполнителя запустить таймер штатной кнопкой. Прежний обязательный update audit переносится внутрь той же transaction с неизменными payload/source/JSON normalization, чтобы audit fault откатывал таймер и назначение вместе. Непубличная engineering reset ветка не объявляется работающей; действующий engineering reassignment reject не ослабляется.
- Исторические закрытые TimeEntry, включая minutes0/1200 и manual records, не изменяются. Офисный ручной ввод1–1440минут сохраняется; запрет производственным/readonly finance ролям и объединение прав действуют прежним образом.
- Добавить clock/path/role/race regressions и guarded native SQL concurrency; прежние protective timer/access/completion tests сохранить, заменить только зависящие от старого внутреннего числа SQL вызовов assertions более сильной проверкой результата.

## Capabilities

### New Capabilities

- `transactional-timer-stop-cap`: согласованное атомарное закрытие автоматических таймеров, предел720минут, защита закрытых фактов и текущих execution grants.

### Modified Capabilities

Нет: основной spec inventory не содержит timer capability. Требования доступа, soft-delete, сохранности split/history и инженерной оплаты сохраняются.

## Impact

Задача132, worktree D:/Projects/pero_crm_worktrees/improvements-132, bugfix/132 от fresh origin/staging cd38cb745759becd58dbbad4d6d37afa03f0ab7a. Предлагаются4source/6test paths, exact allowlist и call matrix вdesign.md. Planning only: source0 до independent DESIGN_GO/root RELEASE; зависимости133WIP не копируются, новые public arguments/outcome/receipts не добавляются. UI/DTO/roles/schema/config/lock/packages неизменны; миграция/backfill/reset/seed/newDB/dumps/restic не нужны и не разрешены. Local native требует отдельного reviewed протокола/root окна, staging — actual SHA/image/health/W07 и свои сценарии. Новые коммиты HOLD; main/production запрещены.

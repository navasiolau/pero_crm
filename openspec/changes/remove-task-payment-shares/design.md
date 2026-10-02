# Design

## Context

Основание — §5.2 CRM_MODERNIZATION_PLAN.md, №22. В текущем коде `server/tasks/share-actions.ts` вызывает `splitTaskCore` из `share-core.ts`; `product-percentage-pay/actions.ts` вызывает `transferProductPercentageCore`. Task хранит executorShare, allocationGroupId, shareUnits/shareAmount и splitRevision. TaskAllocationGroup хранит общий объём и бюджет. `lib/work-shares.ts:28` уже считает объём группы один раз; `:46` использует её shareAmount, а для прежней негруппированной задачи — executorShare. Эти расчёты являются совместимостью истории.

## Goals / Non-Goals

Цель — закрыть новые операции деления на всех входах и сохранить исполнение старых обязательств. №22 не вводит одного получателя нового процентного этапа, сборочную конфигурацию, новую формулу процентов и перерасчёт истории: это №23–24. Работы/задачи продолжают распределяться по количеству. Миграция модели не нужна.

## Decisions

### Серверный запрет раньше денежных writes

Новый split/transfer отказывает всем ролям в domain entrypoint и Server Action. Старые формы и прямой вызов не создают группы, детей, новые доли, audit/outbox или денежные факты. Ранее сохранённый UUID receipt может возвращаться только как безопасное чтение уже совершённого результата после прежних actor/fingerprint checks; это не разрешает новое распределение. Альтернатива «скрыть кнопку» не закрывает stale callers.

Новые/обычные task create и update явно отклоняют присланные executorShare/shareUnits/shareAmount/allocationGroupId и другие управляемые сервером поля долей вместо их молчаливого Zod stripping. Новая задача получает серверную полную долю и оплату только своего quantity. Не расширять whitelist обычного update историческими полями.

### Отдельные новые и исторические пути

Сохранить `allocatedWorkQuantity`, `taskPieceAmount`, старые snapshots и проверки объёма групп. Не менять executorShare/shareUnits старых задач и не назначать каждой строке группы весь объём. Завершение незавершённой группы использует старую shareAmount/валюту и штатные BYN historical guards. Нет массового backfill, удаления записей или нового группового writer. Старые неточности/отсутствующие валютные снимки не исправлять догадками.

### UI только убирает команды

Убрать TaskSplitDialog launch/import/state из `components/task-dialog.tsx`/`task-split-dialog.tsx` callers, `app/(app)/my/my-tasks-view.tsx`, task/work views, и transfer UI из `app/(app)/products/[id]/product-percentage-panel.tsx`. Серверные query DTO возвращают canSplit=false. Исторические подписи/суммы могут остаться read-only; они не становятся новым переключателем оплаты. Конфигурация процентных этапов до №23 остаётся действующей, но не может служить обходом запрета через изменение shares существующей конфигурации: сервер отклоняет такой переход распределения, сохраняя редактирование разрешённых текущих ставок/назначений по действующему контракту.

## Risks / Trade-offs

- Старый участник получает полный бюджет → оставить group snapshots и legacy calculation unchanged; проверять сумму выплат группы.
- Неизвестный share payload молча проигнорирован → явная валидация запрещённых полей на create/update.
- Общий helper удаления UI используется в других местах → найти все callers, сохранить read-only исторический rendering.
- Конфигурационный writer меняет participants и обходит transfer ban → проверять изменение существующего распределения в core, не только transfer action.

## Migration Plan

Реальная feature/22 создана root после fresh fetch от originf33f574 после ordinarymerge21. Независимая local22 параллельно21 разрешена новым указанием владельца; integration22 только после ordinarymerge21 и его basic actualstage acceptance, с согласованием свежей базы root. Данные/схема не мигрируются. Существенные pure/DI tests, сборка и короткая приёмка реального staging кандидата; визуальная/пиксельная проверка отложена до завершения №26 указанием владельца. Restic, дампы, seed/reset и новые огромные QA runners отсутствуют.

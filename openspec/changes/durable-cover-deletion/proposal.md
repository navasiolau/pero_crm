# Proposal

## Why

Задача138: ручное удаление эскиза подавляет storage errors, удаление обложки проекта зависит от ручного повтора. Уже принятый local137 механизм позволяет долговечно завершать точное удаление с сохранением CAS и аудит-фактов.

## What Changes

- Новые ручные sketch/project-cover deletes сохраняют CAS, UUID и выбранный File ID; metadata/domain receipt и sealed storage intent137 создаются в одной транзакции.
- Оба endpoints после commit вызывают существующий cleanup worker; storage failure возвращает confirmed business result с pending cleanup, повтор не добавляет аудит/intent.
- Root legacy policy: старые confirmed receipts не изменять и не дополнять текущим bucket/root. Legacy replay без verified identity возвращает confirmed result и reconciliation status, без physical delete/нового намерения. Несовместимый payload/current pointer — прежний conflict.
- Obsolete-sketch exact-version replacement сохраняет свой действующий маршрут.

## Capabilities

### New Capabilities

- `durable-cover-deletion`: надёжное ручное удаление эскиза и обложки с domain CAS и bounded legacy replay.

### Modified Capabilities

Нет; capability137 используется без изменения её гарантий supported storage bindings.

## Impact

Manual sketch/project-cover cores/actions/contracts, один общий receipt/intent helper137 и targeted tests/OpenSpec138. Ветка freshcfc → NORMAL merge137; атомарный diff138 относительно137. Schema/исторические receipts/объекты/worker settings не мигрируются; actual local/stage только после reviewer и Root ONE. Main/production/restic/dumps вне задачи.

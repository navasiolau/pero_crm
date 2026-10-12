# Design

## Context

См. proposal.md. Все четыре callsite внутренние: event delivery, enable/disable hook, UI command и REST command. SDK PluginContext не меняется; базовая очередь135 уже принята на c650.

## Goals / Non-Goals

**Goals:** context имеет только явный типизированный emitter, runtime context→events отсутствует; ctx.emit сохраняет plugin actor и один прежний вызов публикации.

**Non-Goals:** subscriber ledger136, file deletion137/138, новый delivery runtime, миграции, UI и изменение trusted-plugin разрешений.

## Decisions

buildPluginContext(pluginId, emitter) требует callback (type:string,payload:unknown,actor:string)=>Promise<void> без скрытого default. Тип объявлен в context; потребители передают прежний emitDomainEvent. Отдельный composition wrapper не нужен для четырёх простых callsite. В events остаётся прежняя lease-ограда вокруг base.emit; внутренний obsolete sketch путь сохраняется перед выборкой enabled plugins.

## Risks / Trade-offs

[Пропущен caller] → поиск всех buildPluginContext и strict typing. [Сменился actor/audit] → actual-context regression с реальными context/events и memory outbox; permissions/settings/audit/logger проверяются. [Повторная вложенная доставка] → nested ctx.emit создаёт child один раз, failure/backoff и internal cleanup подтверждаются существующими queue tests. Runtime-импорты проверяются прямо в четырёх модулях; отдельного graph collector нет.

## Migration Plan

DB миграции нет. Обычный local → review → staging/CI; staging приёмка использует существующий135 scoped dispatcher с exact-owned events и literal handler, global worker не включать, чужие pending не доставлять. Main/production запрещены до отдельного указания.
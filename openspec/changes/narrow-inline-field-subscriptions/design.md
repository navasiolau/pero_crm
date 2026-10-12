# Design

## Context

Current f479 использует настоящие независимые controllers и useSyncExternalStore. Целые snapshots меняются на каждом setDraft, включая поля, которых confirmed summary не читает. Родитель ProductInlineDetails держит2полные подписки, хотя потребитель price/quantity draft — только маленькая живая сумма.

## Goals / Non-Goals

Уменьшить лишнее выполнение при сохранении DOM/расчётов и async contracts. Не менять inline-save-controller/use-inline-save/provider/action/parser, финансовые/helpers/UUID dialogs владельца165/134, сервер, схему, CSS или права.

## Decisions

### Product total ownership

ProductLiveTotal остаётся private в том же модуле и возвращает прежний div/aria-live/classes. Получает существующие price/quantity controllers/currency; useSyncExternalStore читает их draft strings. ProductInlineDetails остаётся без этих subscriptions; скрытая сумма при showAmount=false не монтируется. Description и прочие children/props не меняются.

### Project stable projections

Небольшой private useConfirmedService(controller) читает scalar baseline и boolean pending двумя useSyncExternalStore. Pending ровно прежний predicate status неidle/saved; getServerSnapshot использует frozen initial snapshot. ProjectConfirmedTotal объединяет прежние3 baselines и pending booleans. Значение null/0/string не сериализуется и не нормализуется заново; прежний confirmedProjectTotal остаётся единственным расчётом.

### Bounded verification

Один existing-style React/esbuild/Chromium fixture с настоящими providers/controllers/inputs и memory transport. Два старых модуля для явного local BEFORE читаются одним git show каждый; CIdefault тестирует толькоactualAFTER, не зависит отshallowGit history. Existing authored-body observer literal targets: ProductInlineDetails, ProjectConfirmedTotal, InlineTextField; дляпоследнего тестовая literal key projection поid позволяет считать реальный description, не wrapper. Общий алгоритм и тела не подменяются, новых API registryfeatures не нужно.

Actual native price/quantity input: live amount немедленный, description/parent counts0 послеidle. Dirty delivery первыйраз показываетpending; subsequent keys дают summary0 иconfirmedbaseline прежний. Save/lateACK/error/IME/RSC behavior проверяется затронутымиexisting controller tests и малым реальным fixture, без повторения per-field suite. NULL/0/comma/invalid quantities/readonly/privacy сохраняются. Current before/after sameDOM/classes/style/geometry и3viewport PNG anchors сравниваются как в143; не добавлятьclock/profiler/framework. Окончательные141 latency/longtasks замеры отдельно после144/146.

## Risks / Trade-offs

Boolean pending должен включатьdirty/saving/error/conflict и исключатьidle/saved. Новый object snapshot вызвал бы лишние/infinite renders, поэтому projection исключительноscalar/boolean. Server getter не читаетlive edit вместоfrozenSSR. Broad provider updates после подтверждённогоpricing/roles допустимы; их не мемоизировать вслепую.

## Migration Plan

Нет миграций. Local corresponding before/after/controller tests/lint/TSC →independent code/evidence review →own atomiccommit →root normalstaging merge/CI/actualscenario. Source143 не заимствуется доstaging. Main/production/DBreset/seed/dumps/restic запрещены; STOP приguard mismatch.

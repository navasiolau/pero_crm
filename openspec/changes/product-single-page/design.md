# Design

## Context

Provisionalf33f574 planning в24, не actualfeature25. Передapply root fresh24merged tree; изучить actual23/24 singleparticipant sections. Product page уже имеет description/measurement/cover/providers и табовые Works/Materials. Использовать существующие components/queries без переноса historywriters или новой модели.

## Goals / Non-Goals

**Goals:** окончательная композиция карточки.
**Non-Goals:** pay rules/initial26/новый файлACL/удаление истории/schema/dependencies.

## Decisions

Переиспользовать keyed ProductInlineProvider/controllers и существующие status/cover/attachment/percentage/actions components; перенести Work/Task/Material tabs-content в нижние секции без дублирования запросов/монтажа. Удалить только navigation/obsolete controls, оставить audit/status/history DB. Narrow card query не загружает скрытую историю ради layout; настоящие необходимые history guards работают domain-side.

Contacts первые, desktop grid эскиз справа, mobile после контактов; дальнейший semantic order соответствуетspec. Engineer/rate row flex min-width0, compact rate; documents отдельный sibling spanning fullwidth с existing container640rule. Nullprice не превращать в0, счётчики не пересчитывают snapshots. Табличная scroll локальна. Closedpatch транспорт не заменять full RSC refresh на каждый blur.

ACL props и authoritative server guards сохраняются. Доступ ограниченного сотрудника не расширять при переносе секции; lazy/conditional section reads используют прежнюю policy. Пустые нижние секции функционально необязательны.

## Risks / Trade-offs

- [Unmount controllers при перемещении] → stable keys/provider и dirty/pending smoke.
- [Скрытая history удалена из UI] → source/storage unchanged, historyguard regression.

## Migration Plan

Нет DB migration. Root freshfeature25 после24merge/basicstageaccepted; tests/type/build/smallsmoke, ordinarymerge/actualimagehealth. Финальнаяvisual/pixel20–26 после26; restic/dumps/newDB/infra/prod исключены, guard mismatchSTOP.

## Actual Branch Context

Root после fresh fetch создал feature/25 от originf33f574 в modernization-25. Прежняя planning в24 была provisional; теперь это фактическая локальная ветка. Независимая параллельная localimplementation разрешена владельцем. Перед интеграцией root ordinarymerge свежего предшествующего staging (для25 после24, для26 после25), сверяет source/contracts и проходит basicactualstage gate. Fullvisual после26 остаётся unchecked; sourceworkers changes не затронуты.

## Final Essential Local25

Actualfeature25 ordinaryfresh24merged HEAD82a19f1, preservedcode/no conflicts. Root828unit/type/lint/BUILD25PASS. Card-onlyhistorypayload removed, DB/domain/AdminChangeLog preserved. Integration25afteractual24acceptance; actual25stage pending, finalvisualafter26unchecked.

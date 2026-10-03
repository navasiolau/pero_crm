# Design
## Context
Central visibility объединяет роли и назначения. File predicates сейчас наследуют Product read; общий grant без отделения нарушил бы существующую файловую ACL. См. proposal.
## Goals / Non-Goals
Readonly Product/Project production grant, sidebar. Создание Work/Task68/69, status writes, warehouse/financial operations вне №67.
## Decisions
Сохранить назначенную Product/Project видимость отдельными predicates; общий productVisibilityWhere объединяет назначенный набор и PRODUCTION для WORKER. File predicates используют только назначенные predicates. Родительский Project получает readonly inheritance через новый product grant. Upload сохраняет прежние проверки собственных задач/инженерного назначения. Active user обеспечивается auth/session/API actors, не дополнительным доверяемым клиентскому active флагом. После обычного merge54 mandatory live wrappers сохраняются вокруг обоих видов grants.
## Risks / Trade-offs
Технические изображения без отдельного файла-grant отсутствуют → безопасная existing ACL. Подмена фильтра или обход прямым URL → реальные query/access tests. Общий parent read не расширяет finance/history grants; существующие вложенные DTO используют самостоятельные predicates.

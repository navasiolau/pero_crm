# Design

## Context

Ветка `bugfix/128` создана от свежего `origin/staging` fa9c8c458ab13f09b78a032556ddf1ee69c40414 после интеграции документной задачи 127. Сервер, карточка и проектная доска уже используют текущее назначение. Глобальная доска ошибочно использует `isEngineeringParticipant` в трёх проверках drag/drop/action.

## Goals / Non-Goals

**Goals:** единое вычисление текущего назначения для всех UI-входов и проверка положительного/отрицательного возврата.

**Non-Goals:** новая role/access policy, изменения статусов или денежного расчёта, SQL-миграция, redesign, autofocus145, оптимизации142–146, закрытие iMac141.

## Decisions

1. Передать `actorUserId` из authenticated products page через ProductsView в ProductsKanban. Право UI остаётся подсказкой; server action заново проверяет назначение.
2. Добавить компактный `currentProductStatusTargets` рядом с существующим `productStatusTargets`. Он преобразует status/engineerId/projectStage и actor ID в прежний контракт, считая назначенным только непустой совпадающий ID. Карточка и обе доски используют его; retired participant/model fields не становятся grant. Сам `decideProductPercentageStatus` и сервер не меняются.
3. Сохранить layout, существующие уведомления, rollback, price-draft flush карточки, DRAFT-lock и навигацию. Исправленная видимость drag handle — единственное ожидаемое UI-отличие для текущего/бывшего инженера.
4. RED→GREEN: матрица назначения×участия×статуса×ролей и настоящий rendered global/project board; Chromium pointer drag и card action с настоящими React/DnD компонентами, подменяются только server/navigation boundaries. Повторно проверить thumbnail navigation и draft boards.
5. Supporting QA baseline: существующий `qaTransport` без изменения. Private ignored copy session-entry добавляет только `products.list` и `project.tab=products`, отдельный namespace/protocol digest и подписанный checkpoint. Prepare/inspect остаются READ ONLY; restore сохраняет exact CAS всех исходных/зафиксированных успешных ответов. Пойманный неуспешный/неопределённый ACK не разрешает restore. Сначала отдельное protocol review.
6. До UI source changes снять before screenshots 1440×900, 390×844, 360×800 на фактическом staging SHA с одинаковым Chrome/DPR/fixtures и approved prefs cleanup. Новый protocol не разрешает business CRUD существующих записей; настоящее staging drag — только на owned QA fixture после отдельного review. Runtime и unit evidence различаются.
7. Native актуального v4: на существующей разрешённой local/staging БД в outer rollback проверить возврат, current assignment, отказ former participant и неизменность completion/PayrollEntry. unit1000×5% при quantity3 даёт 50 BYN v4; сравнение frozen snapshot целиком, а не только row counts. Native проверки сериализуются с root и запускаются после protocol review.

## Risks / Trade-offs

- [Missing actor ID] → fail closed для ENGINEER; отдельный regression, менеджмент не зависит от ID.
- [Изменение исторических grants] → сервер не меняется; independent role union и technical DESIGN access проходят прежние suites.
- [Случайная staging запись при baseline] → только reviewed preference scope, успешные реальные response bytes, HMAC и exact CAS; любое несовпадение guard СТОП.
- [Ложная приёмка на другом компьютере] → iMac недоступен; его диагноз и бюджет141 остаются BLOCKED_DEVICE_UNAVAILABLE.

## Migration Plan

Миграций и dependencies нет. Targeted tests, lint/typecheck и независимое review; обычный merge/push staging выполняет root. Проверяются фактическая ревизия/образ/здоровье и owned UI/native сценарий, main остаётся прежним.

Обязательная безопасность: `D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md`; СТОП при guard mismatch. Нет дампов, reset, seed, restic, production или инфраструктурных операций. Чужие изменения и shared node_modules не изменять.

# Design

## Context

General createTask ограничен MANAGER_ROLES, проверяет quantity через allocatedWorkQuantity и требует оценку. TasksTab используется проектом и изделием; задача 68 уже отделила canAddWork от canManage. Обычная работа имеет LEGACY paymentKind и не связана с процентным pool. Мотивация — proposal.md.

## Goals / Non-Goals

**Goals:** отдельное worker действие, серверный физический бюджет, безопасный выбор активного WORKER, атомарные факты и повтор UUID.

**Non-Goals:** расширение общего TaskDialog/manager permission, редактирование чужих задач, новые доли, смена тарифов и перерасчёт старой оплаты.

Уточнение03.10 изменяет только общий presentation/create UI без расширения manager permission: менеджер начинает назначение из строки обычной работы конкретного изделия; generic «+Задача» и optional product/work/executor пути убраны. Изделие/работа/название работы закреплены, исполнитель обязателен. Domain68 проверяет те же ограничения на сервере; независимое выделение количества работы несколькими отдельными задачами69 сохраняется, child split не возвращается.

## Decisions

- Новый core использует существующий общий task transaction lock и дополнительно блокирует актуальные User/Product/Work. Проверяет live parents, PRODUCTION, LEGACY/no-pool, сохранённую цену и активные WORKER роли.
- Quantity приводится к существующим целочисленным atoms; allocatedWorkQuantity учитывает все задачи и legacy groups один раз. Вход не принимает цену, доли, группы или статус.
- UUID receipt связан с actor и нормализованным payload. Task, ChangeLog, DomainEvent и receipt создаются в одной транзакции; уведомление/dispatch выполняется после commit и не создаёт новую задачу при ошибке.
- Зависимости ограничены этим изделием, расширяют существующие legacy groups и не изменяют граф старых задач. Новый task ID генерируется сервером; ссылки направлены только к уже существующим задачам. Оценка задаётся пользователем либо берётся тем же расчётом из истории.
- Отдельный небольшой диалог на строке работы сохраняет общий менеджерский путь. Worker options содержат только id/name; чужие созданные автором назначения показываются кратко, без зарплаты и фактического времени.

## Risks / Trade-offs

TaskDetails получает additive rewardAmount/rewardCurrency/rewardSource из server68 query. UI не рассчитывает цену×количество, FX или старую долю самостоятельно, не использует замаскированный workTotal как цену и не подставляет ноль при отсутствии DTO. Known server zero — 0 BYN; unavailable — «—». Исторические денежные preview/frozen amounts сохраняются в данных и отдельных history readouts; при недоступном canonical reward Task показывает «—», без fallback на preview/share. В TaskDialog/MyTasks/строках задач показывается «Вознаграждение», task share percentages и history share percentages скрыты; в engineering-fund удаляется только task share% presentation. Во время worker creation цена не угадывается: сумма подтверждается server DTO после назначения. Старые orphan/service задачи фильтрует query68, без удаления данных.

- Одновременное расходование остатка → общий task lock, свежий расчёт и отказ превышения.
- Устаревшая роль/статус/получатель → повторный live check под transaction lock.
- Неизвестный результат → тот же UUID и payload; новые факты не дублируются.

## Migration Plan

Миграций нет. RED→GREEN проверяет права, бюджет, legacy volume, привязки, повтор и atomic audit. Финальные реальные сценарии с двумя WORKER выполняются координатором в existing local/staging без дампов или seed.

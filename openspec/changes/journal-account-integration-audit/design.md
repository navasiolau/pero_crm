# Design

## Context

См. proposal.md. Общий writer №221 готов. Users/plugins/Telegram оставляют mutation и audit раздельными; Telegram и notification preferences частично не имеют событий. Auth.js использует stateless JWT.

## Goals / Non-Goals

**Goals:** полные snapshots, точный пользователь/Система, транзакционность бизнес-операций, аудит успешной аутентификации и проверяемая матрица покрытия.

**Non-Goals:** изменение прав, JWT/session механизма, данные личного плана, финансовые и проектные writers других задач, deployment/БД worker.

## Decisions

- Выделить небольшие transaction cores users/Telegram/plugin settings/notification preference. В них читать прежнюю запись под lock, изменять данные и вызывать writer №221 в том же tx. HTTP/server action сохраняет прежние guards и DTO, hash пароля/генерация секрета выполняются до короткой tx.
- При no-op не записывать ложное изменение. Смена пароля имеет безопасный flag; token hash/linkCode никогда не входят в audit snapshot.
- Привязка Telegram относится к linked user, API-token бота не подменяет пользователя. Автоматическая регистрация бота записывается только при изменении значения от Системы.
- Проверенный локальный @auth/core 0.41.2 вызывает events.signIn после подготовки JWT/cookie, причём также при JWT=null. Audit-only WeakSet наблюдает неизменённый результат прежнего JWT callback и подтверждает только non-null; signIn event потребляет marker. Refresh не журналируется. events.signOut при явном выходе сохраняет очистку cookie даже при ошибке callback.
- Согласованный root policy: UUID входа добавляется только во внутренний user результата Credentials.authorize; обычная session projection его не копирует. JWT jti используется только как безопасный идентификатор операции выхода; JWT целиком не сохраняется. Unique ID события подавляет повтор callback, исходные права и Auth.js fail behavior неизменны.
- Cookie и БД не являются общей транзакцией. При отказе auth-аудита сохраняется штатная семантика входа/выхода и fixed-code diagnostic; запись успеха не выдумывается. Это исключение только для аутентификации, обязательный бизнес-аудит остаётся транзакционным.
- Чтения, session refresh, token lastUsedAt, notification readAt, личный план/plan.reminder и UI preferences остаются вне журнала.
- Существующий DB trigger автоматически повышает sessionVersion и отзывает персональные API credentials. Правила trigger не меняются: before читается под User→ApiToken locks, фактические after получают отдельные события Системы с инициатором. Token create использует тот же owner lock, чтобы новый token не выпал из снимка; raw user snapshot остаётся полным.
- Только зарегистрированная demo.ping версии0.1.0/API1 имеет проверенный DB-only contract. В tx подставляются db/audit/outbox adapters, наружные dispatcher и run log выполняются после commit. Будущие неподтверждённые callbacks не исполняются в долгой DB tx. API сохраняет write/admin scope grant, web — прежние ADMIN/DIRECTOR grants; источник действия и автор определяются отдельно от авторизации.
- Необязательные notify/cache/dispatch эффекты используют существующий deliverPostCommit и не превращают подтверждённое бизнес-сохранение в ошибку.
- Явные producer labels из `hints.changes` отмечаются списком `technical.explicitFieldLabels`; принудительное обновление производных подписей сохраняет эти labels, продолжая обновлять обычные словари и форматирование values. Имя владельца нового API-токена фиксируется через hints.links: имя actor только для собственного token, другой owner читается внутри той же tx.

## Risks / Trade-offs

- Контакты и настройки могут содержать секреты → явные safe snapshots и sanitizer №221, regression tests на raw/presentation/search.
- Точное старое значение при конкурентных изменениях → row/advisory locks внутри tx, повторное чтение и no-op.
- Auth audit failure → безопасная диагностика без утечки, реальный тест core signOut очищает cookie.

## Migration Plan

Новой схемы нет; используется миграция №221. Native rollback helpers вызываются только root на разрешённых целях. Root выполняет обычный merge/CI и фактическую staging-приёмку.

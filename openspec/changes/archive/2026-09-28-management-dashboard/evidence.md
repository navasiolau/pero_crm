# Приёмка management-dashboard — 28.09.2026

Эта актуальная сводка дополняет [локальную историю проверок](verification.md). Указания в её исторических разделах о ещё не выполненных staging/main относятся к состоянию до приёмки первой волны.

## Локальная приёмка

На существующей локальной БД прошли HTTP и 8/8 browser checks для реально существующих ADMIN, DIRECTOR, MANAGER, ENGINEER, ACCOUNTANT, WORKER, MOUNTER и MANAGER+ENGINEER: актуальная сессия, `/`, active `/login`, меню и логотип, отказ `/payroll` директору. Counts/hashes 13 бизнес-таблиц совпали; роли, пароли и sessionVersion не менялись. Использованы подписанные тестовые сессии, парольный вход не проверялся. Детали — `verification.md` и санитизированный `local-existing-db-acceptance.json`.

Итоговая интеграция первой волны на существующей local DB также прошла 8/8: run `590386f3-1802-4f76-bb81-047d76f8de1e`, exit 0, четыре prefs возвращены CAS без конфликтов, бизнес-счётчики совпали. Источник: `.playwright-mcp/local-list-acceptance/590386f3-1802-4f76-bb81-047d76f8de1e/result.json`.

## Приёмка staging

Ревизия `a1123c5f8a498dc916a67e609a4a550720367fc2`; [staging CI #46](https://github.com/navasiolau/pero_crm/actions/runs/36422255188) — success, scheduled deployment 12:40:31 UTC, приложение healthy, DB identity прежняя. Read-only run `82bb11a9-73d1-4e90-aecd-7ca1d8772dce` содержит 13 PASS и 1 NOT_AVAILABLE; данные — 1325 изделий и 184 проекта, 15 контрольных таблиц совпали по counts/hashes.

Семь чистых ролей прошли session/home checks: ADMIN/DIRECTOR/MANAGER получают дашборд, ENGINEER — изделия, ACCOUNTANT — финансы, WORKER/MOUNTER — свои задачи. M+E на staging отсутствует и отмечена NOT_AVAILABLE; локальная проверка этой роли остаётся положительной, заменяющих пользователей не создавали и роли не меняли.

Общий браузерный этап через public HTTPS + Basic Auth успешно покрыл 12 сценариев в двух run: четыре на 360 px (`5e5af0c2-481e-4976-882a-8f4f7245288c`), восемь на 390/1440 (`b56c73bb-6648-4934-b4a7-0d07175ba1b2`). Первый run остановился на следующей native-session проверке 390 и целиком имеет FAIL; это не единый отчёт 12/12. После каждого run четыре prefs приведены к принятому baseline, 15 hashes совпали. Root лично просмотрел 21 реальный PNG общей QA. Сессии использовали существующие id/roles/sessionVersion; парольный вход — NOT_TESTED.

Источники: `.playwright-mcp/staging-first-wave/<runId>/readonly-result.json`, `browser-result.json`, `restore-result.json`. Public Basic Auth не проверялся внутренним read-only runner, но прошёл на отдельном браузерном этапе.

## Граница сохранности UI-предпочтений

Первый исторический browser run `b761bc98-6e3b-4ce9-9e15-58e4703c5d31` потерял response bodies. CAS отказался перезаписывать непроверенную ревизию; две канонические manager-настройки `view=kanban` оставлены без удаления, исходные list/legacy view строки отсутствовали. `disposition.json` фиксирует принятый новый baseline; побайтового возврата этого run не было. Последующие прогоны вернули четыре ключа точно. QA capture исправлен на один `route.fetch` с durable записью ответа до unchanged fulfill; код приложения ради этого не менялся.

## Завершение выпуска

Root продвинул a1123c5 в main после QA. [Main CI #47](https://github.com/navasiolau/pero_crm/actions/runs/36428827890) — SUCCESS, все три jobs зелёные. Production a1123c5 подтверждён root: web started `2026-09-28T13:35:26.80154508Z`, scheduled watcher `13:40:05.434559 UTC` — `unchanged`/healthy, штатный HTTP health 200. DB ID/startedAt/mount прежние; прямой production SQL не выполнялся. Снимки: [staging deployment](../../../../deploy/evidence/2026-09-28-first-wave-stage-deployment.json), [production](../../../../deploy/evidence/2026-09-28-first-wave-production.json).

Основные specs синхронизированы, change архивирован 28.09.2026. Этот документ добавляет только санитизированную сводку: PII, checkpoints, JWT и PNG не копируются в Git; новых runtime/DB/remote операций не выполнялось.


## Завершение OpenSpec

28.09.2026 основной агент сверил все требования и сценарии с основными спецификациями, выполнил strict validation и архивировал change после принятой локальной, staging и production приёмки.

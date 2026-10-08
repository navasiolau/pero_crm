# Приёмка №108 — аналитика личного плана

08.10.2026, feature/108 создана от свежего staging a3a52b08ba68ff2096a7041a0cc2025aacfe9684; перед реализацией обычным fast-forward получен fb6227bc6d5aa2ef7a4ca0270b40819070cb4983 с107.

## Local

- RED→GREEN3 сценариев диапазона/доступа/полной выборки. Fullweb1359/1359 и bot36/36, types/lint/build/strict PASS; 5 прежних lint warnings.
- Month и analytics используют один listCalendarIntervalCore с повторной проверкой actor и ownerId. Диапазон использует общий calendarDateRange105, расчёт — summarizeCalendarEntries107, визуальные итоги — PlanHoursSummary107. Статусы вынесены в общий справочник. Отдельной формулы часов/доступа нет.
- Native PostgreSQL: обе границы7–8 октября MSK,210 минут,105 минут выполненных,3 выполненные записи, дни165/45; поздний updatedAt не переносит запись в дату завершения. Месяц совпадает с календарным агрегатором; чужой администратор видит только свою запись; поддельный ownerId и отключённый доступ отклонены, пустой диапазон0. Всё rollback, исходные digest MATCH.
- Настоящий localhost3098: analytics/invalid/empty/calendar-link PASS; поддельный query ownerId не расширяет данные; foreign/outside/disabled privacy PASS. Собственные HTTP-фикстуры удалены точно, исходные digest MATCH. Native регрессия106/107 PASS. ProviderMessages0, собственный сервер остановлен.
- Реальные React/Calendar/Analytics/Summary/DataTable с production CSS: desktop1440/mobile390, даты/URL, поиск/статус, неизменный общий итог при фильтре, переход к дню, месяц и високосный февраль PASS. Подменены только framework boundaries (Next Link/server actions); реальные SSR/core проверены отдельно. Скриншоты визуально проверены, overflow и ошибок браузера нет.
- Миграций нет. Full selected set501 строк проверен без скрытого ограничения итогов. Дампы/Restic/seed/reset не выполнялись.
- При read-only проверке Telegram найден существующий tgbot-staging на прежнем образе d9aefd7. Его base URL — staging, токен отличается от остальных ботов; config/env хеши и ID других контейнеров зафиксированы. Финальная приёмка включает обновление только существующего bot-staging и проверку реального dist без сообщений сотрудникам. Production/прочие контейнеры сохраняются.

## Staging

Ожидаются обычный merge, CI, фактический web/bot runtime и регрессия пакета. Main/production не менялись.

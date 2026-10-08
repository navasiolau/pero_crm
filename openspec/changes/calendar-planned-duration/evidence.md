# Приёмка №106 — плановая длительность

08.10.2026, feature/106 от staging a63c08fd753120dd9ab4eef71872ecce022cc57f.

## Local

- RED нового duration-теста до реализации, затем GREEN; fullweb1353/1353, types/lint/build/strict PASS. После перехода контракта на именованные настоящие Zod factories повторены focused6/native/HTTP/types/build; 5 прежних lint warnings.
- Миграция20261008180000_calendar_planned_duration: nullable Int и CHECK >=0, без backfill. Local5433: прежние CalendarEntry (без новой колонки)/reminder/outbox/notification/TimeEntry/Task/Payment/StockMovement digest MATCH; все исторические plannedMinutes NULL. Дампы/seed/reset не выполнялись.
- Единые parseCalendarHours/calendarHoursInput/formatPlannedMinutes. Запятая/точка, округление до минуты, пустое/null и явный0, roundtrip в том числе MAX Int проверены. Server принимает только integer/null, старый update без поля сохраняет часы; state меняет только статус.
- Настоящий PostgreSQL:90 минут, retry одна запись, другие минуты в повторе дают конфликт; старый клиент и COMPLETED сохраняют90; NULL очищает,0 сохраняется; stale CAS, DB negative CHECK, администратор другого владельца и отключённый план отклонены. Всё rollback, исходные digest MATCH.
- Настоящий localhost3097: собственные90/NULL/0 отображаются; чужая запись не видна, администратор видит только свою, отключённый план не раскрывает данные. Собственные HTTP-фикстуры точно удалены; digest MATCH, providerMessages0.
- React PersonalCalendar с production CSS: desktop1440/mobile390, часы1,25→75, очистка, отрицательное значение,0 и потеря ACK с тем же entryId PASS. Подменена только граница server actions; core и SSR проверены отдельно. Визуально проверены редактор и повестка, overflow/ошибок браузера нет; свой сервер остановлен.
- Runtime bundle120998bytes содержит настоящие validators/core и HTTP. Именованные Zod factories позволили сохранить прежний лимит256KiB без ослабления правил. W07/identity guards не менялись.

## Staging

Ожидаются обычный merge, CI и фактическая runtime-приёмка. Main/production не менялись, Restic не затронут.

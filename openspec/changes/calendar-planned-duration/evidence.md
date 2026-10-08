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

- Обычный merge `a3a52b08ba68ff2096a7041a0cc2025aacfe9684`, CI172 SUCCESS: https://github.com/navasiolau/pero_crm/actions/runs/37749731126. Фактическая revision совпала; healthy образ `sha256:23865b37e1ae8b932deb8936b3968daa54f09a0c6995a80f0a25638e7714c488`.
- Перед развёртыванием сохранён только count/digest прежних полей CalendarEntry (не дамп). После фактической миграции count1/digest `fbc971e8f05474bbdbc7b12bda217b53` совпал, историческая длительность NULL.
- Native90/NULL/0, повтор, старая форма, CAS, SQL CHECK и owner/disabled access PASS. Реальные SSR-страницы показали длительность, администратор не получил чужой план. Исходные digest MATCH, QA0, providerMessages0.
- Bundle с дополнительной проверкой миграции `f59569a85c6d60743b0055389cc5f48d37eb084c161a4d5a8b331eaa533be18a` (121449bytes). DB container/volume/start и W07 сохранены. Main/production не менялись, дампов нет, Restic не затронут.

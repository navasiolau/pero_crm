# Приёмка №107 — часы дня и месяца

08.10.2026, feature/107 от свежего staging a3a52b08ba68ff2096a7041a0cc2025aacfe9684.

## Local

- RED→GREEN3 сценариев агрегации; fullweb1356/1356, types/lint/build/strict PASS, 5 прежних lint warnings.
- Один lib/calendar-summary считает период и дни, PlanHoursSummary переиспользуется для месяца и выбранного дня. Источник — подтверждённые собственные entries, отдельного запроса/кэша сумм нет. Целые минуты, группировка MSK, отменённые исключены, completed subtotal отдельный. NULL/0/частично известные часы различаются.
- Настоящий PostgreSQL: месяц180/день150/выполненных60 минут, два выполненных задания включая одно без длительности; границы месяца MSK и другая учётная запись исключены. Отмена/восстановление и правка с переносом на другой день пересчитывают общую и дневную суммы. Всё rollback, исходные календарь/пользователи/напоминания/уведомления/TimeEntry/Task digest MATCH.
- Реальный localhost3098: собственная страница с месячными/дневными итогами и пустой месяц PASS; чужих и соседних месячных записей в HTML нет. Точные собственные HTTP-фикстуры удалены, исходные digest MATCH.
- Настоящие React/Calendar/Summary и production CSS: desktop1440/mobile390; cancel/reopen/edit/move/complete/navigation обновляют итоги, пропуски видны, overflow/ошибок браузера нет. Подменены только server actions; реальные ядра и SSR проверены отдельно. Визуально проверены обе ширины.
- Миграций нет, providerMessages0. Дампы/Restic/seed/reset не выполнялись. Runtime native/HTTP bundle подготовлен под прежние W07/identity/budget guards.

## Staging

- Обычный merge `fb6227bc6d5aa2ef7a4ca0270b40819070cb4983`, CI173 SUCCESS: https://github.com/navasiolau/pero_crm/actions/runs/37751506472. Фактическая revision совпала; healthy образ `sha256:bd97a2d8a7c68387a540a05b11ff5b4516b2cded026576cb01cc5f3785b908b7`.
- Native месяц180/день150/выполненных60, пропуск1, отмена/восстановление/правка/перенос, MSK и owner-only PASS. Реальный SSR с итогами и пустым месяцем PASS; чужих/соседних месячных записей нет. Исходные digest MATCH, QA0, providerMessages0.
- Bundle `792158937a6c29614a187201e412a6685d185e30b11fa1807bbd6d7b17c922fb` (122626bytes). DB container/volume/start и W07 сохранены. Main/production не менялись; дампов нет, Restic не затронут.

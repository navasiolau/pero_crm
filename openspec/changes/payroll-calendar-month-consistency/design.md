# Design

## Context

Базовый SHA3819f175dca3f69f40da92760cf746bad430f4bc, ветка bugfix/131, задача131 плана. См. proposal/specs. `calendar-dates` уже задаёт Europe/Moscow, но его parser намеренно ограничен личным календарём 2000–2100; payroll не должен получить новое ограничение на исторические периоды. Финансовые ядра сохраняют снимки и идемпотентные receipts, task completion также отвечает за таймер: меняются лишь выражения месяца.

## Goals / Non-Goals

**Goals:** общий browser/server-safe payroll helper без Prisma/Next зависимостей; строгий вход; точные именованные границы; минимум правок в существующих producers/UI.

**Non-Goals:** конкуренция turnover130, агрегация149, правило таймера132, изменения денежных формул, базы/истории/schema/миграций, новые зависимости, изменение FX UTC-дня.

## Decisions

1. `lib/payroll-month.ts` экспортирует валидацию/строгий parser, текущий месяц произвольного переданного instant, границы и календарное смещение месяца. Использует существующую константу CALENDAR_TIMEZONE и Intl с явной зоной; для границ проверяются кандидаты UTC из именованных смещений вокруг wall-date; при повторе выбирается ранний. Для исторического gap в полуночи первый действительный instant находится по границе локального месяца. Смежные ranges получают один boundary. Era BC учитывается для bracket до0001, без создания пользовательского0000. Не использовать fixed+03 (не совпадает с историческими смещениями), Date(year,month) (зависит от процесса), календарный parser2000–2100 (сужает допустимую историю). Год0000 отклоняется, 0001–9999 сохраняет четырехзначный календарный ключ, пределы смещения проверяются.
2. `payroll/queries.ts` сохраняет совместимые экспорты currentMonth/isValidMonth/monthRange и делегирует helper. Все публичные месячные queries проверяют месяц до DB; getMonthTurnover сначала валидирует диапазон. actions используют общий predicate для payoutSchema/accrue/settle; invalid month не вызывает денежный service.
3. cash-core меняет только проверку зарплатного month и вычисление месяца аванса/порога долга. Месяц уже сохранённого receipt возвращается прежним. UTC asOf и fingerprint полей команды остаются неизменными.
4. Новые PIECE/percentage/adjustment rows получают payrollMonth(operationDate). Историческое чтение и timestamps не меняются. В UI заменяются только month expressions, а monthLabel/shiftMonth используют канонический parser и именованную зону. JSX/classes/состояния/роли не меняются.
5. При отсутствующем month страницы/экспорт берут текущий бизнес-месяц. Невалидные страницы redirect на тот же payroll route с каноническим текущим ключом; невалидный явно переданный экспорт400 без data queries. Валидные ссылки и CSV формат сохраняются.
6. Проверки: boundary ±1ms, leap/DST/month alias, TZ UTC/Moscow/New_York; реальные action/core ветви с DB access counters и fault-fast stubs; существующие money/retry/history suites. Native runner только после exact localhost5433/pero_crm target guard, в существующей БД; negative вызовы плюс rollback-only owned boundary fixture, baseline/fingerprint охватывает деньги/audit/outbox. На staging runner target guard и реальные URL/страницы/SHA/health принимает оркестратор; main запрещён.

## Exact source allowlist

- apps/web/src/lib/payroll-month.ts (новый)
- apps/web/src/server/payroll/queries.ts
- apps/web/src/server/payroll/actions.ts
- apps/web/src/server/payroll/cash-core.ts
- apps/web/src/server/tasks/completion-core.ts (только импорт и month)
- apps/web/src/server/product-percentage-pay/direct-completion.ts (только импорт и month)
- apps/web/src/server/product-percentage-pay/core.ts (только импорт и month)
- apps/web/src/components/month-switcher.tsx (parser, monthLabel, shiftMonth, isCurrent)
- apps/web/src/app/(app)/advances/cash-payout-form.tsx (только импорт и payroll fallback month)
- apps/web/src/app/(app)/finance/payroll/finance-payroll-view.tsx (только импорт и isCurrentMonth)
- apps/web/src/app/(app)/finance/payroll/page.tsx
- apps/web/src/app/(app)/payroll/page.tsx
- apps/web/src/app/(app)/finance/payroll/export/route.ts
- apps/web/tests/payroll-month.test.ts (новый)
- apps/web/tests/payroll-month-writers.test.ts (новый)
- apps/web/tests/payroll-month-native.ts (новый guarded runner)
- apps/web/tests/combined-engineering-turnover.test.ts (now helper, не менять другие ожидания)
- openspec/changes/payroll-calendar-month-consistency/*

## Risks / Trade-offs

- [Временная граница меняет допустимость предыдущего месяца раньше UTC] → это согласованное исправление; fixed clock tests на всех producers и payroll UI, FX test показывает неизменный UTC день.
- [Новые query guards могут затронуть fixture stubs] → не ослаблять guard, обновлять только некорректные fixture assumptions и проверять actual positive/negative flows.
- [Shared file completion-core позже меняется132] → оркестратор закрепил файл за131 до интеграции; остальные изменения финансового поведения исключены.
- [Native/hosted результаты могут быть недоступны] → NOT_RUN/BLOCKED отдельно, не заменять их unit/build; задачу не объявлять полностью принятой до staging proof.

## Migration Plan

Schema migration отсутствует. Local targeted tests, typing/lint после согласования ресурсов, независимое ревью, обычный merge131 в staging и SHA-bound приёмка. Возврат приложения возможен на прежний образ; новые строки не переписываются. Main/production не изменяются.

## Accepted review clarifications

- Внутренняя граница9999-12 заканчивается в00:00 10000-01 Europe/Moscow; пользовательский ключ10000-* запрещён. Годы0001/0099 формируются через setUTCFullYear без смещения1900; предыдущий месяц0001-01 недоступен через UI и смещение возвращает контролируемую ошибку.
- Каждый writer захватывает один instant для месяца/порогов операции; FX asOf остаётся по действующему UTC дню. Fingerprint сохраняет прежние поля и actor binding.
- Независимый design review: GO от оркестратора11.10.2026, RELEASE_IMPLEMENTATION131.

- Независимый code review выявил historical DST gap1981–1984; regression RED1 подтверждён, corrected boundary сохраняет все допустимые ключи; добавлены gap и реальный Sep30 repeated-hour tests.

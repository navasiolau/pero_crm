# Proposal
## Why
Личные записи уже хранят время и настройку напоминания, но web-доставка отсутствует. Нужен подтверждённый личный факт с атомарной дедупликацией и защитой test окружений до Telegram66.
## What Changes
- Отдельный namespace записи и уникальный reminder факт по namespace/entry/revision.
- Реальный Notification владельцу в той же транзакции, проверка текущего actor/flag/state/revision/offset и preference.
- Ограниченный60s worker существующего web process и capability-защищённый dispatch endpoint; Telegram не вызывается.
- Точный personal plan notification scope для enabled ACCOUNTANT и всех иных ролей без операционного расширения.
- Local/staging получают только явно allowlisted testowners и записи своего trusted namespace; импортированные production записи/факты не доставляются.
## Capabilities
### New Capabilities
- `plan-web-reminders`: личная атомарная web-доставка, shared fact и окружение/namespace isolation.
### Modified Capabilities
Нет.
## Impact
CalendarEntry namespace, CalendarReminderFact, Notification relation и migration100000; calendar actions/worker/env guard, instrumentation, dispatch API и точечный notification read scope. Будущий66 использует confirmed fact; нет TG вызовов/изменений реального env.

## Startup origin correction
Actual1955 startup/QA shared resolver fails ERR_INVALID_URL when AUTH_URL and NEXTAUTH_URL are both absent; all46 startup data MATCH before first write, OFF flags restored, no reminder delivery claimed. Добавляется CALENDAR_REMINDERS_PUBLIC_ORIGIN: первый непустой origin перед AUTH_URL/NEXTAUTH_URL, без hardcoded fallback и без изменения auth/Host/CSRF.

# Проверки №228

Ветка `bugfix/228`, isolated worktree `D:/Projects/pero_crm_worktrees/journal-228`, база принятого №221 `26f1d12a`. Собственные pnpm offline dependencies и Prisma generate; lockfile/версии не менялись.

## Local

- RED: отсутствующие mutation/auth modules при первом запуске новых сценариев. При добавлении automatic token revoke отдельный behavioral regression воспроизвёл ошибку formatter: safe metadata entity apiToken целиком превращалась в `[скрыто]`; исправлена контекстная маскировка, не защита реальных secret fields.
- Итоговые targeted tests: **46/46 PASS** — foundation model, users, Auth events + реальная Auth configuration wiring, реальный Auth.js signOut, Telegram core, plugin/settings/token/preferences core и реальные server action transaction/post-commit boundaries.
- Прежние auth-security, calendar-user-actions, calendar-reminder-visibility, plugin context/queue и startup no-op сценарии проходили совместно с новыми.
- Итоговый `pnpm --filter @pero/web test`: **1494/1494 PASS**, 88,7 с; нет skipped/failed/cancelled. Все source/test изменения предшествуют началу этого прогона. Лог: ignored `.playwright-mcp/journal-228/web-tests-final.log`.
- Scoped ESLint: PASS, 0 warnings. `pnpm --filter @pero/web exec tsc --noEmit --incremental false`: PASS.
- `openspec validate journal-account-integration-audit --strict` и `git diff --check`: PASS.

## Существенные проверки

- Существующий JWT callback возвращает тот же token/null. При JWT=null signIn event не создаёт ложный успех; ephemeral UUID отсутствует в JWT/session. Повтор/конкурентная доставка UUID имеет одну запись. Auth audit failure выводит fixed-safe diagnostic; реальный core signOut очищает cookie даже при rejected callback.
- Users сохраняют все изменяемые поля, а последствия прежнего DB trigger получают System + initiator. Сам SQL trigger не изменён.
- Web и API plugin commands разделяют выполнение, сохраняя разные прежние authorization grants. Подтверждённый DB-only command пишет audit/outbox внутри tx; наружный emitter не вызывается до commit и после rollback. Будущая неподтверждённая команда отклоняется до запуска.
- plan.reminder/preferences, private calendar, notification reads/delivery и token lastUsedAt исключены. Секреты/хэши/коды отсутствуют в новых audit snapshots, presentation и searchText.

## Native helper для root

`apps/web/tests/helpers/native-journal-accounts.ts` экспортирует `exerciseJournalAccountNative(tx, {runId, expectedDatabase, auditFailure?})`. Принимает только interactive transaction после внешних target/W07 guards, проверяет UUID/DB/readOnly/ownership и **всегда** бросает `JournalAccountNativeRollback` с кодом `JOURNAL228_ROLLBACK_COMPLETE`. Sentinel ловится только снаружи `prisma.$transaction`.

Happy path: 27 assertions, ожидаемые18 событий; только собственные временные users/plugins/tokens/counterparty/preferences/Telegram/outbox, без dispatch. Глобальную регистрацию бота только читает и требует существующее значение. `auditFailure:true`: 3 assertions, подтверждает реальный SQL update + проброшенную ошибку аудита, затем forced rollback; глобальная регистрация бота не нужна. Root после обоих режимов сверяет сохранность БД. Worker helper не запускал и к БД не подключался.

Root подтвердил на существующей local БД оба сценария: **happy 27 assertions / 18 events PASS**, **auditFailure 3 assertions PASS**. Перед каждым rollback выполнен `SET CONSTRAINTS ALL IMMEDIATE`; sentinel завершил транзакции откатом, собственных users осталось0, общий счётчик ChangeLog сохранён. Приватные evidence в основном workspace: `.playwright-mcp/journal-221-228/local228-accounts.stdout.private.log` и `local228-audit-failure.stdout.private.log`. Независимое ревью оркестратора замечаний не выявило.

## Staging / интеграция

Own implementation зафиксирован commit `7796c46da6fd9db42726c57ab705a9f30ec02430`. Принятый staging `a632e1e36326c61f157d3de5d506e533fe0b3ff2` объединён обычным merge без конфликтов. Сохранены публичный formatter/refresh №222 и apiToken root-context fix №228.

По точечному root GO добавлены две integration поправки: marker `technical.explicitFieldLabels` сохраняет manifest labels через полную цепочку stored enrichment→refresh, остальные производные подписи и форматирование values обновляются; reference создателя API-токена показывает имя actor только при совпадении ID, другого владельца читает внутри tx. Исходные raw payloads не меняются. На сочетании: **90/90 targeted PASS**, включая reader/UI/refresh/resolver и228; после расширения pipeline regression повторно **14/14 related PASS**, scoped lint/full tsc PASS. Push/staging merge worker не выполняет.

PENDING: интеграция со свежим принятым staging, штатный CI и фактическая staging-приёмка, включая HTTP login/logout. Новые UI не входят в228. Limited repair старых apiToken presentations согласован с №222/root, выполняется только после доставки исправленного formatter. Root разрешил commit own228 и обычный merge принятого staging; push и staging merge выполняет только оркестратор. Production/restic/infra не изменялись.

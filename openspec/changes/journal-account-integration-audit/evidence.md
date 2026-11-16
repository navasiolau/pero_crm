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

### Исправление bootstrap P2010

На combined `ca61155e` root воспроизвёл startup RED: успешная production-сборка, но `/api/health`500; stderr указывает `loading instrumentation hook`, Prisma `P2010`, невозможность десериализовать PostgreSQL `void`. Точная причина — две новые lock-проекции `SELECT pg_advisory_xact_lock(...)`: в plugin startup и bot registration. Root подтвердил на guarded local PostgreSQL в READ ONLY tx, что прежний запрос падает, а `SELECT 1 AS locked FROM ...` возвращает `[{locked:1}]`.

Production fix меняет только эти две проекции; namespace228, ключи блокировок, транзакции, guards и мигратор остаются прежними. Existing native suite расширен сценарием `journal/startup-register-locks-native-types`: actual syncPlugins и actual bot registration выполняются в существующем `fixture.rollback` через тот же guarded module scope; Prisma реально декодирует результаты SQL. Проверяются повторный startup/registration без дублирования аудита, новые connections/network/workers не запускаются. Новых runtime inventory или target guard обходов нет.

На исправленном cut: **30/30 targeted PASS**, scoped ESLint, полный `tsc --noEmit --incremental false`, strict OpenSpec и diff-check — PASS. Worker native/DB не запускал. Точная команда нового native regression в уже разрешённом CI postgres environment: `pnpm --filter @pero/web exec tsx --test --test-name-pattern="journal/startup-register-locks-native-types" tests/integration/domain-postgres.test.ts`; существующие CI target guards обязательны, локальные/staging значения под них не подставлять. Root отдельно выполняет полный production build/start/health GREEN и штатный CI.

### Подтверждённый локальный production GREEN

Root проверил integration `ded366431ca09322568e45a0afb84a2ca3309a7c`: `pnpm build` PASS, реальный `Next start` на собственном локальном процессе с guarded существующей БД вернул `/api/health`200. Метаданные Plugin и счётчик аудита до/после совпали. Собственный сервер остановлен; проверка процессов подтвердила отсутствие оставшегося server process. Прежний startup RED500 на `ca61155e` выше сохраняется как доказательство воспроизведения исправленного дефекта.

Receipt: `D:/Projects/pero_crm_v2/.playwright-mcp/journal-221-228/startup-green.json`, SHA-256 `007e6243038fe7411f0a3be1c4eaadcdcf315f8e24ee0eccb5081fd3a404a6e8`. Это подтверждение локального запуска production-сборки, не deployment proof и не финальная приёмка staging.

### Прерванный CI 43795423314

Штатный [CI run 43795423314](https://github.com/navasiolau/pero_crm/actions/runs/43795423314) до native-проверок не дошёл: smoke renderer завершился `KP_CI_SMOKE_TIMEOUT` после Chromium version/close. Исходники renderer в изменениях журнала не менялись. Этот результат не подтверждает прохождение нового native startup/register case в CI и не помечается staging PASS; root повторяет полный штатный CI без обхода проверок.

Own implementation зафиксирован commit `7796c46da6fd9db42726c57ab705a9f30ec02430`. Принятый staging `a632e1e36326c61f157d3de5d506e533fe0b3ff2` объединён обычным merge без конфликтов. Сохранены публичный formatter/refresh №222 и apiToken root-context fix №228.

По точечному root GO добавлены две integration поправки: marker `technical.explicitFieldLabels` сохраняет manifest labels через полную цепочку stored enrichment→refresh, остальные производные подписи и форматирование values обновляются; reference создателя API-токена показывает имя actor только при совпадении ID, другого владельца читает внутри tx. Исходные raw payloads не меняются. На сочетании: **90/90 targeted PASS**, включая reader/UI/refresh/resolver и228; после расширения pipeline regression повторно **14/14 related PASS**, scoped lint/full tsc PASS. Push/staging merge worker не выполняет.

### Фактическая приёмка staging — e3f99ff0

**№228 STAGING_ACCEPTED** на `e3f99ff05b97f3999fc8fbf74472e9077d769a3b`. Штатный [CI 43796217344](https://github.com/navasiolau/pero_crm/actions/runs/43796217344) завершился **7/7 SUCCESS**. В native log подтверждён `journal/startup-register-locks-native-types` (`ok 2`): PostgreSQL **87/87**, target guards **13/13**, HTTP/S3 **32/32**. Backend, components и renderer также прошли. Прежние RED и прерванный CI выше остаются историей, не заменяются новым результатом.

Root проверил именно развёрнутый runtime: web image `sha256:7a08b609684a03aad93249ca9f190ef688571fbe5de2b3bd163a6443dba0cc2a`, renderer image `sha256:8fb1087afd508f9506952c4b16279adeccc7a27df353472eff485edf7770a19f`, состояние healthy и HTTP200. Существующие DB identity и W07 сохранены.

На этом staging root выполнил actual native **happy 27 assertions / 18 events PASS** и **auditFailure 3 assertions PASS**. Перед rollback выполнен `SET CONSTRAINTS ALL IMMEDIATE`; оба сценария завершены откатом, `remainingUsers=0`, счётчик аудита сохранён. Evidence в `D:/Projects/pero_crm_v2/.playwright-mcp/journal-221-228/`: `stage-final228.response.private.json` (SHA-256 `5700d136cf83d2228af166c71aed4ab553c0b6ce3b19d758fcf5e76dce3f2676`) и `stage-final228-fault.response.private.json`.

Реальный credential/browser прогон `auth-final228-roles/runtime.json` прошёл: неверный пароль не создаёт событие; ADMIN входит и открывает журнал; login/logout записываются по одному; session refresh не добавляет событий. Для фактического `WORK_COORDINATOR` подтверждены отказы всех трёх readers (список, подробности, варианты фильтров). SSR-запросы карточек проекта и изделия вернули **302 без разметки журнала**: проверен отказный ответ, а не отрисовка разрешённых карточек и не HTTP403. Всего за финальный прогон созданы ровно **4** собственных auth-события; проверяемые секреты в них отсутствуют.

`auth-final228-roles/cleanup.json` подтверждает удаление только этих 4 собственных событий: `users=0`, `events=0`. SHA-256 runtime `2180a67e430c21f5341d335ec7cd28b0073d5d12c6bec42ef7c4ae36af5e5363`, cleanup `a9d2fd9aa85c3c5f600cb10213c3e8c1f972a9274fb3249ea4c947f0387cd78f`. Ранний полный auth PASS сохранён отдельно в `auth-final228`. Промежуточная расширенная обвязка следовала запрещённым redirects и завершилась ошибкой; её cleanup подтвердил удаление 3 собственных событий. Финальная обвязка останавливается на 302 и проверяет отсутствие разметки журнала; неудачный промежуточный запуск не объявляется PASS.

Первый полный refresh после доставки всех formatter изменений: `final-refresh-state.json` — **5529 updated, raw preserved** (SHA-256 `6d85a7adfad2018ee5d6c05b0924b96b8599c304c1c4cd6a24b04418751965e3`). Дополнительный readonly `stage-api-token-repair2.response.private.json` подтвердил **PASS для 4 исторических записей**: имя и scopes восстановлены. Scopes отображаются через русские `journalEnumLabel`; первоначальное сравнение с raw API codes оказалось ошибкой ожидания проверочной обвязки, не дефектом приложения. Исходные коды сохраняются в raw и поисковом документе.

Root `stage-e3-preservation.json`: **75/76** исходных таблиц совпали по побайтовым хэшам; единственное различие — штатный polling `ApiToken.lastUsedAt`, остальные поля токенов стабильны. Сохранены5529 ChangeLog с raw hash `64bcf0448dabe8e594a5ffa37da4aa1a`.

Повтор refresh выявил **1679 повторных обновлений только searchText** из-за порядка токенов после JSONB roundtrip; факты и UI values не изменились. Исправление детерминированной сортировки относится к №222. Его новая CI-проверка и повтор с нулём обновлений ещё не приняты этой записью; native/auth приёмка №225–228 на точном e3f99ff0 остаётся действительной.

Новые UI относятся к соседним задачам. Эта приёмка фиксирует точный runtime и сценарии №228; дальнейшие docs-only публикации требуют отдельного подтверждения deployment. Push и staging merge выполняет только оркестратор. Production/main, restic и инфраструктура в рамках228 не изменялись.

# universal-work-shares — evidence

Рабочая ветка: `codex/universal-work-shares`, независимый worktree `D:\Projects\pero_crm_worktrees\universal-work-shares`, исходная ревизия `a1123c5`.

## Граница проверки

На этапе подготовки субагент не запускал migration/db push/SQL, fixtures, runtime, browser, staging или production. Актуальная локальная приёмка root приведена ниже отдельно. `pnpm install --offline --frozen-lockfile --ignore-scripts` создал независимый node_modules; Prisma Client сгенерирован только в нём. `prisma validate` проходит с фиктивным DSN на `127.0.0.1:1/not_used` (validate/generate не подключаются к БД). Первый validate без DATABASE_URL корректно отказал на отсутствующей env, после задания фиктивного адреса прошёл.

## TDD: арифметика

`pnpm exec tsx --test tests/work-shares-math.test.ts`.

Из существующего расчёта выделены прежние формулы суммирования Task.quantity и price×quantity×executorShare. До добавления групп: **2 pass / 4 fail**. Конкретные RED: занято 20 вместо 10 единиц; сумма части 1000 вместо 300; повторное деление даёт 3000 вместо 1000; две части по копейке вместо 0,01/0,00.

После внедрения целых units/копеек и точного снимка: **10/10 pass**, включая 30/70, 35/35/30, остаточную копейку, нулевую задачу, малый личный объём 0,005, неправильные проценты и слишком малую долю. Статическая проверка migration закрепляет явные `IS NOT NULL` для shareUnits/shareAmount: SQL CHECK не должен принимать UNKNOWN. Обновлений Task/PayrollEntry/Payout или удаления истории в SQL нет.

## TDD: деление и завершение

- Новый доменный entrypoint split до реализации: **2 pass / 9 fail**; после реализации **11/11 pass**. Проверены все активные роли, собственная задача/менеджмент, inactive/same-recipient/engineer scope, DONE/начисление, UUID/idempotency, старая ревизия, повторное деление, время/фото и rollback.
- Дополнительный RED → GREEN для legacy quantity без Work: при первом делении такое невыделенное количество нормализуется в null у обеих частей; бюджет остаётся 0 и повторное деление работает. Актуальный core-набор: **12/12 pass**.
- На реальном прежнем `changeTaskStatus` с инъекцией in-memory Prisma/auth/effects получены **3/3 RED**: выплата 1000 вместо 700 после деления; два начисления при двух параллельных DONE; после отказа PayrollEntry задача остаётся DONE и таймер остановлен.
- После переноса закрытия в transaction core эти три сценария GREEN. Дополнительные DI-сценарии проверяют оба порядка split/complete, блокировку зависимого после одной части, точные 700/300 и сохранённую валюту, лимит количества Work, запрет удаления/переноса отдельной части и расширение зависимости на всю группу.
- Отдельный тест адаптера подтверждает получение advisory transaction lock до mutation. In-memory транзакции сериализуются и откатывают состояние при injected failure; это **не** заменяет native PostgreSQL concurrency-проверку.
- В DI внешние emit/dispatch/notify проверяются через AsyncLocalStorage: они вызываются после выхода из transaction context, а не под lock.

## UI и текущие проверки

Один общий диалог используется в TaskDialog и MyTasksView. Preview показывает именно личный объём, долю и фиксированную сумму; UUID сохраняется при retry одного payload, меняется при правке/новом open. Старые ответы после закрытия игнорируются. Общие Work/product/quantity и удаление отдельной части закрыты в UI и на сервере.

UI-субагент выполнил изолированный harness с моками: границы процента, 5,01/5,00, double-click, retry UUID, изменения формы/новое открытие, поздние ответы, toast/close/onDone. Фактическую браузерную или визуальную проверку это не доказывает; она ждёт отдельного разрешения миграции и локальной приёмки.

До повторного review `pnpm test`: **133/133 pass** (102 ранее существовавших теста + 31 новый math/core/settlement/transaction). `tsc --noEmit --incremental false`, ESLint затронутых файлов, `git diff --check` и `openspec validate universal-work-shares --strict` — PASS.

Итоговый `pnpm run build` — PASS с фиктивным DSN и отдельным нерабочим AUTH_SECRET: production compilation, lint/type validation и 24/24 static pages завершились. Приложение не запускалось и существующая БД не использовалась. Build не является доказательством runtime/визуальной или native DB-приёмки.

## Исправление P2: дробный остаток и атомарная DDL

Независимый reviewer обнаружил, что Number-арифметика UI передаёт 10,30−10,00 как `0.3000000000000007`, а строгий сервер обоснованно отказывает. Добавленный RED подтвердил неверные остатки `0.3000000000000007`, `0.5000000000000007`, шаг `1.2999999999999998` и отказ реального createTask в DI. Старое вычисление было извлечено без изменения смысла, затем заменено общими helpers на целых сотых.

TasksTab и TaskDialog теперь вычисляют остатки и собственный добавляемый объём через `remainingWorkQuantity`; QuantityStepper принимает точную строку и считает ±1 через `stepWorkQuantity`. «Все» сохраняет `0.30`, настоящий ввод `0.301`/`1.234` не округляется и отклоняется. Денежные формулы и серверные bounds не ослаблены.

Вся additive migration обёрнута явными BEGIN/COMMIT; статический тест подтверждает единый transaction block и отсутствие CONCURRENTLY. Миграция не запускалась.

После исправления: **139/139 полный unit/DI набор**, **14/14 targeted quantity+settlement**, `tsc --noEmit --incremental false`, touched ESLint, OpenSpec strict — PASS. Повторный независимый review `/root/telegram_existing` подтвердил закрытие P2 и отсутствие новых замечаний в этом исправлении. Production build выше был выполнен до этого UI-fix; после него повторены unit/type/lint, без runtime/БД.

В план и design добавлено только extension-point уточнение будущей фичи №6: фонд изделия → менеджерские веса Work суммой 100% → доли исполнителей внутри работы. Обычные Work snapshots остаются прежними, pools здесь не реализуются. Root-owned `tests/work-shares-preflight.mjs` не менялся и этим субагентом не запускался.

## Root: существующая локальная БД — 28.09.2026

Пользователь отдельно разрешил локально и на staging один помеченный QA Project, одну Work, до четырёх Task и два временных сотрудника PIECE с точной очисткой и сверкой сохранности. Production в это разрешение не входит.

Root независимо повторил полный набор **139/139 unit/DI**, TypeScript и production build после исправления дробного остатка. Затем подготовлены opt-in QA helpers; независимое ревью нашло и исправило перезапись прежнего migration outcome при повторном apply. Отказ повторной попытки теперь сохраняет прежнее доказательство без изменений. Root: **25/25 guard/DI tests** и TypeScript PASS; это проверка защитных скриптов, а не hosted приёмка.

Применена только миграция `20260928140000_universal_work_shares`, SHA256 `65058910bdeec05482a9881c4f83a015cd1e86c32e0ffc352278ac3aa378f0a6`, через установленный Prisma migrate deploy. Guard подтвердил единственную pending migration, существующий `pero_crm_pg` с ID `bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5`, volume `pero_crm_v2_pgdata`, loopback5433, DB/user `pero_crm`/`pero`.

До DDL создан custom pg_dump на том же exported READ ONLY snapshot, что и контрольные суммы всех 33 исходных application tables: **1 311 608 bytes**, SHA256 `b8efc00fa9806252519c5158d5e6af9a00220b5fb522fb266ecd399c8885d398`. `pg_restore --list` подтвердил структуру архива; восстановление не выполнялось и не заявляется проверенным. Private receipt: `%LOCALAPPDATA%/Temp/pero-work-shares-local-BT60Ok/receipt.json`.

Результат `APPLIED_AND_VERIFIED`: все 33 исходные таблицы сохранили counts/hashes; Task сравнивалась без четырёх добавленных колонок. Сохранились 174 Project, 1305 Product, 1131 Task, 6449 Work, 4726 File, 18 User. Новая TaskAllocationGroup пуста; allocationGroupId/shareUnits/shareAmount у старых Task NULL, splitRevision=0. Прежняя migration history, Docker identity/mount/start time сохранены. Никаких seed/reset/новых БД/restore не было.

Отдельный локальный runtime запущен на loopback3105 из проверенной production build; сервер пользователя на3000 не изменялся. Этот запуск сам по себе ещё не доказывает UI или concurrency.

Первый browser run `d2a4ce22-65c7-46c2-b441-0689f46b002e` — **FAIL до первой UI mutation**, не приёмка фичи. Три подписанные сессии проверены. В форме «Новая задача» фактически выбран остаток `0.30`, однако общий dialog locator совпал с основной формой и закрывающимся Base UI popover. Отдельно возник pageerror `Cannot read properties of undefined (reading 'waiting')` при `serviceWorkers: block`; его причина проверяется по установленному Serwist/Playwright, ошибка не игнорируется. Root визуально осмотрел failure-manager.png: крупный шрифт, форма в пределах экрана360px, прокручиваемый диалог; весь сценарий этим не подтверждён.

Контексты закрыты, intercepts=0, uncertainMutation=false. Native capture подтвердил две начальные задачи, без групп/времени/начислений. Exact cleanup **PASS**: удалены только 2 QA User, 1 Project, 1 Work, 2 Task и 1 TaskDependency; остальные 34 table fingerprints совпали (Plugin сравнивается по защищённому runtime-представлению согласно QA helper). Контролируемый runtime PID1932 остановлен после проверки полного command line и владельца loopback3105. Private diagnostics сохранены в `%LOCALAPPDATA%/Temp/pero-work-shares-qa-local-1oWdHJ/`.

Повторный полный code/guard набор: **168/168 PASS**. Новая SQL-миграция закреплена `text eol=lf`, чтобы Git checkout не менял принятый SHA/Prisma checksum.

## Root: принятая локальная функциональность и визуальная проверка

Playwright `serviceWorkers: block` подменяет register() функцией с Promise<undefined>; установленный Serwist затем читает registration.waiting. Установленный source подтвердил причину. Тест теперь использует изолированный браузер без SW capability: guarded initScript удаляет configurable API до загрузки страницы, затем проверяются отсутствие API/window.serwist и зарегистрированных workers. Стандартный capability guard приложения отключает регистрацию. Само приложение, реальные backend-ответы и fatal pageerror не подменяются. **Offline/PWA и парольный вход этим не проверялись**.

Второй run `fc8447ae-804b-4bba-92e6-641405891291` подтвердил UI create C через «Все» (0,30), два одновременных одинаковых split POST с одним UUID/одной дочерней задачей, суммы 700/300 и блокировку B. Остановился на ошибочном test regex: UI правильно показывал «Стоп 00:19». Исправление parser получило RED 8 fail → GREEN 10/10. Native capture был PASS; exact cleanup удалил 2 User, 1 Project, 1 Work, 4 Task, 1 group, 2 dependencies, 1 TimeEntry, 6 Notification, 3 DomainEvent, 3 ChangeLog. Остальные данные сохранены.

Принятый набор `099ea392-0930-4307-9d0a-334cc22edf87`:

- Реальный UI создал C с точными 0,30; настоящий ввод 0,301 отклонён формой.
- Два параллельных split POST с UUID `09c9e7f7-714f-4195-a086-9928ef7d35dd` вернули один child ID. Native group quantity=10, budget=1000, части 70%/30% и 700/300 BYN. Work занята на 10,30 ровно один раз.
- B отклонена сервером до выполнения обеих частей и после одного выполненного A; затем успешно выполнена после A и D.
- A/D/B/C запускают автоматические таймеры и завершаются с фактом времени. Два параллельных DONE для D не дублируют PayrollEntry.
- Native capture: dataChecks PASS, четыре DONE, три PayrollEntry 700/300/30 BYN; сумма работнику 730, монтажнику 300, B без Work не начисляет деньги.

Полный mutating run дошёл до последней readonly части, где locator заголовка «Моя зарплата» совпал с site header и h1 контента. Первый scoped locator через main тоже оказался неоднозначным (SidebarInset включает header). Исправлен на h1 вне header. После подтверждённых native commits оставшиеся readonly проверки выполнены отдельно на **том же** завершённом наборе: `READ_ONLY_COMPLETION PASS`, ноль отправленных mutations, зарплата 730/300, по одной строке на оплачиваемую задачу, 4 DONE и полностью распределённые 10,30. Это приёмка всего сценария с readonly-продолжением, **не** один безошибочный полный browser run. Ошибочные отчёты сохранены.

Root лично просмотрел все 17 PNG успешных шагов: создание, обе ширины split preview/footer и карточек 70/30, автоматические таймеры, расчётники, финальные DONE-карточки 360/390. Диалог прокручивается в пределах экрана, кнопки ≥48px, горизонтального переполнения страницы/диалога нет. Таблица расчётника сохраняет существующий внутренний горизонтальный скролл; суммы дополнительно проверены в DOM и native capture. Артефакты: `%LOCALAPPDATA%/Temp/pero-work-shares-qa-local-zXI3zW/`, успешное readonly-продолжение — `pero-work-shares-qa-local-vPueqp/`.

После закрытия всех browser contexts и проверки всех drain receipts exact cleanup **PASS**: 2 User, 1 Project, 1 Work, 4 Task, 1 TaskAllocationGroup, 2 TaskDependency, 4 TimeEntry, 3 PayrollEntry, 43 Notification, 10 DomainEvent, 10 ChangeLog; исходные 34 table fingerprints восстановлены. Реальные User/Payment/Payout/File/настройки не переписывались.

## Staging: подготовка, пока без применения фичи

Первый transport attempt `WB8bgf` не запустил guest backup: урезанное окружение Windows SSH давало exit255 без stdout/stderr. Root readonly probe с тем же окружением воспроизвёл отказ; добавление USERNAME/USERDOMAIN/ProgramData/ALLUSERSPROFILE дало exit0. На госте точный backup run и его root directory отсутствовали. Старые intent/outcome сохранены; добавлена ограниченная приватная диагностика SSH, session payload на диск не пишется.

Следующий readonly preflight `GSh1Sr` остановился `PSQL_JSON_REQUIRED`. Root под W07 lock проверил SELECT json_agg по двум константным VALUES: PostgreSQL действительно выдал JSON на двух физических строках, тогда как helper читал одну. Business tables этот probe не читал. Исправляется framing; migration/reset/seed на staging не выполнялись. Неудачные guest receipts сохраняются, автоматического повторения нет.

Framing исправлен: полный scalar JSON кодируется PostgreSQL в UTF8/hex с одним LF, затем строго декодируется. Root native smoke на существующем staging PG подтвердил composite JSON, Unicode/вложенный LF и scalar count0; только константные VALUES, READ ONLY, W07 lock и прежняя identity.

Новый явный preflight `6f11150f-27b8-4f98-8224-fddd7fea43cd` принят: **1 324 070 bytes**, dump SHA256 `a6b9421cf0bb27dff3dba26e724fed85648c49a78f12d029c020631bd1f8f9b1`, receipt SHA256 `278755259a31dcbc095304a57d1c569c635211d2b0b6154a13db45584852f355`. Все 34 public tables (включая migration ledger) сняты на одном exported READ ONLY snapshot с pg_dump, повторный свежий snapshot совпал. Единственная pending migration — reviewed SQL650…f0a6. Архив проверен `pg_restore --list`; restore-test не проводился. Dump/receipt находятся в защищённом `/var/lib/pero-work-shares-qa/6f11150f-27b8-4f98-8224-fddd7fea43cd/`, локальный control — `%LOCALAPPDATA%/Temp/pero-work-shares-stage-FtSDNX/`. До push требуется ещё свежий backup-check; сам preflight ничего не мигрирует.

Feature worktree fast-forward обновлён до принятой базы `2cac6f3`. Два прежних локальных уточнения плана сохранены в private patch и уже представлены в этой базе (разрешённые QA fixtures и распределение фонда между работами); исходный root worktree/его незафиксированные заметки не менялись.

Следующий backup-check корректно остановил публикацию в staging: изменилась только таблица ApiToken. Root сравнил по полям архивный COPY (pg_restore **без подключения к БД**, только вывод текста в приватный процесс) и текущий READ ONLY COPY: у трёх токенов совпали идентификаторы/количество и все поля кроме `lastUsedAt`. Ключи, scopes, revokedAt, владельцы и бизнес-таблицы не изменились. Source `tokens.ts:42` подтверждает штатный recordUse при API-запросах. Никакого восстановления архива, записи/отката дат или повторного применения данных не было.

QA и migration guards теперь защищают все поля ApiToken кроме ровно lastUsedAt; полные hashes/фактические даты и их изменения остаются в native receipt. Старые архивы и envelopes не переписаны, для новой политики создаётся новый sealed backup. Изменение scopes/hash/revocation/идентичности/числа строк по-прежнему отказывает до cleanup. RED на прежней проекции → **24/24 fixture DI PASS**, полный web-набор **185/185 PASS**. Product/runtime-код не менялся. Сначала был опубликован кандидат fdda264 только в feature-ветке; staging/main всё это время оставались на2cac6f3. Финальная версия будет сведена в один feature-коммит до staging rollout.

Новый accepted backup `e9728819-e923-4633-a7b0-dd0c63839928`: **1 324 068 bytes**, SHA256 `7e3cc6a434752435c0de96ba44f9b1e41dc596bc6841dbf8ac6ba17d2506aca2`, receipt `16683e3b90c5a5a0f30eb644ddb3bf0ab35af18b40e9856cd808d96854934bec`. Exported-snapshot dump, 34 public tables, свежая повторная сверка и TOC — PASS; pending migration ровно одна. В этом коротком preflight изменения API-дат не потребовалось допускать (0). Root control: `%LOCALAPPDATA%/Temp/pero-work-shares-stage-4qAENZ/`. Архив на госте сохранён в одноимённом run-каталоге; restore-test не заявляется.

## Не выполнено

Staging и production этой фичи, её commit/push. После первого реального split откат на прежний код начислений небезопасен: нужна совместимая версия (см. design.md).

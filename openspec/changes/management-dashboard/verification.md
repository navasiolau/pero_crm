# Проверки management-dashboard

## RED — 28.09.2026

- До изменения кода: `pnpm exec tsx --test --test-reporter=spec tests/management-dashboard.test.ts` из `apps/web`.
- 33 проверки: 18 прошли, 15 упали (exit 1).
- Содержательные падения: ENGINEER/ACCOUNTANT и сочетания получают разрешение вместо редиректа; офисная навигация показывает дашборд; корневой callback не перенаправляет производственные роли; актуальная ENGINEER в проверенной сессии всё ещё открывает дашборд.
- Тесты не подключаются к БД; используются реальные route/session callbacks и навигация с входными фикстурами.

## GREEN и локальные проверки

- `pnpm install --frozen-lockfile` — успешно, lockfile не изменён; зависимости установлены в собственном worktree.
- `pnpm db:generate` — Prisma Client 6.19.3 сгенерирован локально, без подключения к БД.
- `pnpm test` из `apps/web` — 52/52 PASS: 33 новых проверки и 19 существующих auth/security-проверок.
- `pnpm exec tsc --noEmit --incremental false` из `apps/web` — exit 0.
- `pnpm exec eslint src/auth.config.ts src/lib/home-route.ts src/lib/nav.ts 'src/app/(app)/page.tsx' src/app/login/page.tsx src/components/app-sidebar.tsx tests/management-dashboard.test.ts` — exit 0.
- `git diff --check` — exit 0.
- `openspec validate management-dashboard --strict` — valid.
- Регрессионный тест DIRECTOR проверяет отсутствие пункта `/payroll`; существующий серверный запрет страницы сохранён без изменения. Полная проверка этой страницы в работающем приложении остаётся ниже.

## Приёмка существующей локальной БД — 28.09.2026

- По уточнению владельца выполнена проверка на существующей `localhost:5433/pero_crm`. Оркестратор предварительно сделал backup и применил две уже имевшиеся миграции main; настоящий change не содержит миграций и их не применяет.
- Guard проверил ID локального `pero_crm_pg`, volume `pero_crm_v2_pgdata`, binding `127.0.0.1:5433`, `current_database()=pero_crm`, `current_user=pero`. Пароль прочитан только в память из Config.Env именно этого контейнера и не выводился/не сохранялся. Соединение test harness: `default_transaction_read_only=on`.
- Использованы восемь реально существующих наборов ролей: ADMIN, DIRECTOR, MANAGER, ENGINEER, ACCOUNTANT, WORKER, MOUNTER, MANAGER+ENGINEER. Пользователи, роли, пароли и версии сессий не изменялись; fixtures, seed, schema/reset/cleanup данных отсутствовали.
- По явному разрешению оркестратора использованы короткоживущие JWT под отдельным локальным AUTH_SECRET, с реальными id/roles/sessionVersion. Auth.js прочитал и подтвердил актуального пользователя из БД. Это проверка подписанной тестовой сессии; парольный вход существующих пользователей не проверялся.
- HTTP: восемь наборов ролей PASS для `/api/auth/session`, прямого `/`, доступности целевой страницы и активного `/login`. Проверялся полный origin редиректа. DIRECTOR перенаправлен из `/payroll` на `/`; для каждого набора сессия с несовпадающей версией отклонена без изменения БД.
- Playwright при 1440×900: 8/8 PASS для прямого `/`, видимости дашборда/меню, перехода в «Мои задачи» и возврата по логотипу, активного `/login`; DIRECTOR без пункта зарплаты и с отказом `/payroll`. Во всех восьми browser contexts `pageerror=0`; contexts закрыты в finally.
- Контроль после HTTP и после браузера: количества строк и агрегированные хэши 13 бизнес-таблиц совпадают с исходными. Машиночитаемые baseline/after сохранены в `local-existing-db-acceptance.json`; личные данные и токены в отчёт не включены.
- Штатная синхронизация metadata двух установленных плагинов при startup отдельно разрешена оркестратором после чтения `sync.ts`; production bypass для неё не добавлялся. Enabled/settings не перезаписываются этим startup-кодом.
- Next был привязан к `127.0.0.1:3102`, AUTH_URL `http://localhost:3102`; S3/AWS/MinIO/Telegram runtime-переменные удалены из дочернего окружения. Сессия запуска 35083 остановлена; отсутствие listener 3102 проверено. Временные локальные auth-state/browser-run файлы удалены, включая тестовые cookies/secret.
- Повторяемые read-only helpers: `tests/management-dashboard-local.ts` (guard/profiles/serve/http/browser-script/verify-data) и `tests/management-dashboard-local-browser.js`. Старые disposable-fixture скрипты удалены из поставляемого change.
- TypeScript после добавления local helpers: `pnpm exec tsc --noEmit --incremental false` PASS; ESLint обоих новых helpers PASS; `git diff --check` и OpenSpec strict PASS.

Независимое статическое review оркестратора прошло без actionable замечаний. Staging, архивирование и продвижение в main ещё не выполнены; prod/staging БД не затрагивались. Эта проверка не заменяет мобильную визуальную QA.

## Историческая предварительная проверка отдельной БД — 28.09.2026

Владелец не принял отдельную одноразовую БД как замену существующей локальной. Ниже сохранён только исторический результат; он не служит основанием задачи 3.2. Соответствующие fixture-скрипты удалены из поставляемого change.

- Root выполнил независимое статическое review: actionable замечаний в выборе маршрута, auth callback, навигации и серверной проверке не найдено; сохранение отзыва сессии подтверждено чтением diff.
- Guard до каждой подготовки/приёмки/очистки: точный loopback `127.0.0.1:55433`, отдельная БД `pero_crm_test_dashboard`, `current_database()` и COMMENT `PERO_CRM_TEST_DISPOSABLE`, явный confirm, отсутствие `.env*` runtime-файлов в worktree. Guard прошёл.
- `tests/management-dashboard-runtime.ts prepare`: `prisma db push --skip-generate` и 12 явных пользователей `dashboard-runtime-*`; legacy migrations и seed не выполнялись.
- Собственный Next dev слушал только `127.0.0.1:3102`; отдельный тестовый AUTH_SECRET, очищенные S3/AWS/MinIO/Telegram-переменные. Origin приложения `http://localhost:3102`.
- HTTP-приёмка: реальные credentials login и сессии, `/`, активный `/login`, доступность стартовой страницы для 12 наборов ролей; проверены полный origin редиректа, запрет `/payroll` директору, явный отзыв manager-сессии. Всё PASS.
- Playwright, изолированный browser context на каждого пользователя, 1440×900: форма входа → корректный маршрут; навигация; переход в «Мои задачи» и назад по логотипу; прямой `/`; активный `/login`. Все 12 наборов ролей PASS, `pageerror=0` в итоговом прогоне. DIRECTOR не имеет пункта зарплаты и перенаправляется с `/payroll`; ENGINEER + ACCOUNTANT открывает финансы.
- Наборы: ADMIN, DIRECTOR, MANAGER, ENGINEER, ACCOUNTANT, WORKER, MOUNTER, MANAGER+ENGINEER, ENGINEER+ACCOUNTANT, ENGINEER+WORKER, ACCOUNTANT+MOUNTER, WORKER+MOUNTER.
- Исторические скрипты `management-dashboard-browser.js` и `management-dashboard-runtime.ts` после уточнения владельца удалены из поставляемого change.
- Первичный прогон с origin `127.0.0.1` выявил нормализацию NextURL в `localhost` и потерю cookie из-за смены host. Это воспроизведённая особенность установленного Next 15.5.20 (`next/dist/server/web/next-url.js`), поэтому стенд приведён к единому canonical localhost, и приёмка целиком повторена с проверкой полного origin. Производственный код ради обхода этой особенности не менялся.
- В браузерном runner исправлены locator логотипа (в имени также присутствует SVG `PERO`) и ожидание окончания перехода, чтобы быстрый переход не обрывал dev RSC-поток. После этого итоговая матрица прошла без ошибок страницы.
- Очистка после приёмки: guard повторно прошёл; удалены только 12 fixture users по явным ID и домену `example.invalid`; остаток fixture users = 0. Собственный Next-процесс остановлен, отсутствие listener на порту 3102 проверено.
- Остановка завершена до получения нового ограничения: own Next-сессии 43975 и 69928 завершены через Ctrl-C; HTTP-сессии 87198 и 21313 завершены exit 0; изолированные browser contexts закрыты в finally. После ограничения DB/schema/fixture/cleanup-команд не выполнялось. Существующая локальная БД 5433 не затрагивалась.

Этот исторический прогон использовал тестовые fixtures и не является проверкой на реальных данных. Ни commit, ни push, ни deploy, ни архивирование в нём не выполнялись.

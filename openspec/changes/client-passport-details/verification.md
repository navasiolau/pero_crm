# Проверки задачи №171

Дата: 17.10.2026. Ветка `feature/171`, отдельный worktree `D:/Projects/pero_crm_worktrees/requests-171`.

## Выполнено локально

- `pnpm install --offline --frozen-lockfile` — успешно; зависимости из локального кэша, lockfile не изменён.
- RED до реализации: создание клиента с паспортом отвергалось прежней строгой схемой; адаптер редактора не передавал паспортный baseline.
- `pnpm db:generate` — успешно, Prisma Client 6.19.3.
- `pnpm --filter @pero/web exec prisma validate` — успешно с фиктивным loopback DATABASE_URL только для проверки схемы; соединение с БД не выполнялось.
- `pnpm --filter @pero/web exec tsx --test tests/client-passport-component.test.mjs tests/client-passport-read.test.ts tests/client-passport-details.test.ts tests/product-quantity-input.test.ts tests/engineer-access.test.ts tests/project-client-contact-component.test.mjs` — **47/47**.
- `pnpm --filter @pero/web exec tsc --noEmit --incremental false` — успешно.
- `pnpm --filter @pero/web exec eslint` для всех изменённых TypeScript/TSX/test.mjs файлов — успешно, 0 предупреждений.
- `openspec validate client-passport-details --strict` — успешно.
- `git diff --check` — успешно; старые миграции, lockfile, owner-документы и env не изменены.

## Что подтверждают тесты

- Реальные create/update core: нормализация, необязательные реквизиты, очистка, запрет до чтения БД для неподходящих ролей, объединение MANAGER+PROCUREMENT, строгий устаревший baseline, CAS только изменённых полей и аудит.
- Реальные ClientsPage/catalog, getProjectFor/getProductFor, опции и search route с заполненными паспортами: ENGINEER/PROCUREMENT не получают ключи/значения паспорта; MANAGER/ADMIN/DIRECTOR и совмещённый менеджер получают их в справочнике.
- Chromium с реальными ClientDialog/ClientsView и CSS: создание, просмотр, заполненное редактирование, очистка, сохранение ввода после конфликта, отсутствие паспортных полей/управления у readonly-просмотра. Проверены 1440×1000/light и 360×800/dark; Save доступна прокруткой, горизонтального переполнения нет.
- Скриншоты component harness: `apps/web/test-results/client-passport-details/{desktop-light,mobile-dark}-{viewer,editor}.png`, отдельный `mobile-dark-editor-footer.png`. Проверены визуально. Это изолированный harness без Next.js font-loader, БД и настоящих server actions; production/staging-визуальной приёмкой он не является.

## Проверки оркестратора

17.10.2026: независимое ревью `review_176` — замечаний нет. Владелец явно разрешил запуск существующего Docker/pero_crm_pg и сохранение веток со staging-тестированием. Guard подтвердил прежний контейнер, postgres:16-alpine, том pero_crm_v2_pgdata, loopback5433, БД pero_crm/public и отсутствие пропущенных базовых миграций.

Миграция171 применена штатным `pnpm --filter @pero/web exec prisma migrate deploy`. Отпечатки всех63 прежних бизнес-таблиц совпали с исходными после исключения новых nullable-полей; изменилась только запись учёта миграции. NativeSQL:10 сценариев PASS — роли, создание паспорта, независимые поля/phone, stale CAS, устаревший baseline, очистка, audit/event и откат транзакции при ошибке события. После rollback все64 таблицы совпали с состоянием после миграции, собственных QA-строк нет. Межтранзакционное расписание этим прогоном не заявляется.

Приватные доказательства оркестратора: `.playwright-mcp/requests-171-179/local-db-before.json`, `local-after171-migration.json`, `local-native171.json`, `local-after171-native.json` в основном каталоге. Первый технический запуск harness остановился на десериализации SQL void до записей; сохранность проверена, lock-вызов исправлен и итоговый прогон PASS.

## Исторический handoff до staging-приёмки

- Применение `20261017000100_client_passport_details` и локальная native-проверка завершены оркестратором, см. выше; исходный исполнитель БД не менял.
- Native CAS/rollback: подготовлен существующий сценарий клиента в `tests/integration/files-crud.test.ts` — паспорт при создании, независимые изменения номера/выдавшего органа, конфликт номера и rollback phone+passport при отказе DomainEvent. CI fixture локально не запускался; текущие guards интеграционного раннера сохраняются.
- Ревью, commit/merge, фактический staging SHA/образ/права/CRUD. Staging и production не менялись этим исполнителем; миграционная и runtime-приёмка не заявляются.
- Для №174 интегрировать схему/миграцию после №171; новая миграция №174 должна иметь более поздний timestamp. Уже применённые миграции не редактировать.

## Размещение браузерной проверки в CI

CI635dad выявил, что новый client-passport-component запускался в backend без Chromium. Проверка перенесена в components-1; ни один тест не отключён. Реальный Bash case из workflow исполнен локально для всех globs: каждый файл ровно в одной группе, новый browser-файл в components-1. Независимое ревью изменения маршрутизации — замечаний нет; на этом этапе требовался повторный CI. Итоговая CI/runtime-приёмка ниже.

## Фактическая staging-приёмка — PASS с явными границами

17.10.2026 оркестратор принял №171 на **SHA `0d399e96d56010b05cd8f4df077aef03a7064e05`**, image **`sha256:0f89f9de9c0e8a4ee0437a4e443a41784e0a173c3e429ce42a266974c8f2b189`**, `https://staging-crm.peromebel.by`. Проверены внешняя identity, прежние DB container/start/volume и W07, внутренние hostname `db`, БД/schema `crm/public` и завершённые миграции. Production/main не изменялись. [CI38996944460](https://github.com/navasiolau/pero_crm/actions/runs/38996944460) — все6 jobs SUCCESS по подтверждению оркестратора; ранний `ci-all9.json` остался промежуточным in_progress и не используется как final receipt. Интеграционный source: **988/988**, TypeScript PASS, lint0 errors/4 существующих warnings, strict9/9; собственные47 локальных тестов выше сохранены.

Общий run **`1c0b0ed5-b65a-4fe2-8ba4-9116e8fa4d89`**, status `STAGE171174_BROWSER_PASS`, 168 проверок, guard mismatch/denied/clientErrors — 0. Проверки №171 отделены в [staging-acceptance.json](staging-acceptance.json); 18 actual business POST общего прогона относятся к контрагентам №174, а не к UI-редактированию клиента.

**Native staging:** реальные client core по immutable SHA собраны отдельно и выполнены на существующей staging БД во внешней rollback-транзакции. PASS: нормализация паспорта, необязательные поля и очистка, сохранение независимой правки телефона, конфликт того же паспортного поля, отказ старого baseline, запреты ENGINEER/PROCUREMENT/ACCOUNTANT, SAVEPOINT rollback при отказе аудита. Native до/после совпал по full fingerprints всех65 таблиц. Разрешённый runtime actor — существующий ADMIN; DIRECTOR/MANAGER и совмещения дополнительно покрыты локальными core/query/access тестами. Новые пользователи/роли не создавались.

**Actual HTTP и браузер:** ADMIN получает паспорт своего QA-клиента; PROCUREMENT видит того же клиента без паспортных ключей/значений. ENGINEER получает доступных ему через проекты клиентов без паспортных ключей/значений; несвязанный QA-клиент ему недоступен по обычной видимости. Это фактические RSC/HTTP-ответы без копирования содержимого в репозиторий. Карточка с паспортом открыта и закрыта при **1440×1000, 390×844, 360×800, light/dark** — 6 случаев PASS, 6 скриншотов. Оркестратор отдельно визуально проверил `client171-360-dark.png` — PASS. Staging UI-путь создания/редактирования клиента не запускался; эти действия, очистка и восстановление ввода после конфликта доказаны локальным real-component Chromium harness выше и native staging CRUD, а не этим UI receipt.

**Cleanup и сохранность общего run:** точный guarded ownership/CAS/audit cleanup удалил только собственного клиента1, контрагентов6 и их audit18. Независимый readonly inspect по runId подтвердил own counts0 и **все65 stable fingerprints без изменений**. Full fingerprints отличаются только таблицей `ApiToken`: оркестратор подтвердил движение `lastUsedAt` вперёд; это runtime поле не восстанавливалось. Полное совпадение full-снимков за весь UI-run не заявляется. Исторические/финансовые записи сохраняются по независимому stable-сравнению.

Приватные evidence в основном workspace: `.playwright-mcp/requests-171-179/staging171174/run-1c0b0ed5-b65a-4fe2-8ba4-9116e8fa4d89/{receipt,native,cleanup,independent-inspect,bundle-provenance}.json`; точные SHA256 ссылок — в staging-acceptance.json. Исходные DTO/SQL-строки, имена живых пользователей, паспорта и токены не скопированы. JWT существующих профилей900sec оставались только в памяти, никаких reset/seed/dump/newDB.

Два предыдущих HOLD сохранены: `3265359f-6662-4616-b636-fa1570aeb801` и `6c23df5f-6314-4e45-81d4-1095dd8bb23f`. Исправлены только приватные QA-сравнение порядка UNION ALL, диагностика и heading scope layout; source приложения для их устранения не менялся. Итоговый runner/cleanup/AST-parser/namespace compiler получили независимое ревью; сохранены379 differential-сравнений реальных схем. Staging-пункт3.3 закрыт на указанном SHA/образе с этими границами; выпуск main и production-миграции остаются отдельными действиями владельца.

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

## Исторический handoff и оставшаяся staging-приёмка

- Применение `20261017000100_client_passport_details` и локальная native-проверка завершены оркестратором, см. выше; исходный исполнитель БД не менял.
- Native CAS/rollback: подготовлен существующий сценарий клиента в `tests/integration/files-crud.test.ts` — паспорт при создании, независимые изменения номера/выдавшего органа, конфликт номера и rollback phone+passport при отказе DomainEvent. CI fixture локально не запускался; текущие guards интеграционного раннера сохраняются.
- Ревью, commit/merge, фактический staging SHA/образ/права/CRUD. Staging и production не менялись этим исполнителем; миграционная и runtime-приёмка не заявляются.
- Для №174 интегрировать схему/миграцию после №171; новая миграция №174 должна иметь более поздний timestamp. Уже применённые миграции не редактировать.

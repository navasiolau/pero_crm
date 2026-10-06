# Evidence — product-status-storage

## Проверки (06.10.2026, worktree `crm-81-storage`, ветка `feature/81`)

- `pnpm db:generate` — PASS, Prisma Client v6.19.3 сгенерирован со значением `STORAGE`.
- `pnpm lint` — 0 errors, 5 warnings (все предсуществующие: `cleanup-uploads.ts`, `product-attachments.tsx`, `assertManager` в `product-percentage-pay/core.ts`, `income-form-native.mjs`).
- `pnpm --filter @pero/web test` — 1245/1245 PASS, 0 fail.
- `tsc --noEmit` — чисто, без ошибок.
- `rg DELIVERY apps/web/src` — пусто (статус изделия). Остаток в тестах — только `CORRECTIONS_CLIENT_ADDRESS_NOT_DELIVERY_STOP` (адрес клиента, не статус). Старые `migration.sql` и `REPORT.md` legacy-импорта не тронуты сознательно.
- `prisma migrate status` (локальная БД 127.0.0.1:5433) — новая миграция `20261006120000_product_status_storage` обнаружена и ожидает применения; всего pending 3.

## Миграция: live-apply заблокирован (блокер, reset не выполнялся)

- `pnpm db:migrate` (`migrate dev`) отказался: три старые миграции изменены после применения на этой локальной БД (`20261002130000_product_assembly_percentage`, `20261002140000_product_assembly_payroll_fields`, `20261004120000_simplify_product_percentage_accrual`) + 2 чужие pending-миграции; требует `migrate reset` (снос БД).
- Reset запрещён без отдельного поручения (AGENTS.md: «Reset, seed … — по отдельному поручению»; SAFETY-RULES п.7 — стоп при guard mismatch). Сброс уничтожил бы 1305 изделий (DESIGN 45, PRODUCTION 16, DELIVERY 69, INSTALLATION 2, DONE 1173).
- Read-only проверка предусловий: enum `ProductStatus` в БД содержит `DELIVERY` (6 значений в порядке `DESIGN, PRODUCTION, DELIVERY, INSTALLATION, DONE, RECLAMATION`); SQL `ALTER TYPE "ProductStatus" RENAME VALUE 'DELIVERY' TO 'STORAGE'` корректен для PostgreSQL 16 и атомарно переименует значение во всех колонках типа (`Product.status`, `ProductStatusHistory.fromStatus/toStatus`, `ProductPercentageCompletion.statusAtCompletion`).
- Нужно решение владельца: сбросить локальную БД / перебазировать дрейф — затем повторить `pnpm db:migrate` и проверить `SELECT enumlabel FROM pg_enum`.

## Диагноз дрейфа + транзакционный тест (06.10.2026, продолжение, только локальная БД 127.0.0.1:5433)

### 1. `migrate status` (read-only, `DATABASE_URL=postgresql://pero:pero_crm_dev@127.0.0.1:5433/pero_crm`)

- Вывод дословно: `54 migrations found in prisma/migrations`, `Following migrations have not yet been applied: 20261003150000_remove_active_finishes, 20261005120000_product_percentage_ceil_accrual, 20261006120000_product_status_storage`. Применена 51, pending 3, exit code 1 (есть pending). Отдельных drift-секций `status` не показал.
- «2 чужих pending» из прошлой заметки — не чужие: оба коммита (`898b171` remove_active_finishes, `2492355` ceil_accrual) входят и в `feature/81`, и в `origin/staging`. Это просто неприменённые локально staging-миграции. Наша `20261006120000_product_status_storage` — самая новая (timestamp позже всех), применяется последней.
- Независимость порядка: `remove_active_finishes` трогает только `Product.finishRevision` (LOCK + DROP COLUMN), `ceil_accrual` не ссылается на `ProductStatus`/`DELIVERY`/`STORAGE` вообще, наша — один `ALTER TYPE ... RENAME VALUE`. Взаимных зависимостей нет.

### 2. Природа дрейфа: right-tool-аудит checksum (`_prisma_migrations.checksum` vs файлы, read-only SELECT)

- Контрольная методика: `sha256` файла (Prisma 6 хранит sha256 hex содержимого `migration.sql`) сверён с колонкой `checksum` для всех 51 применённой миграции; отдельно сверены рабочие файлы и git-blob'ы (`git show HEAD:...`).
- Итог: 48/51 blob'ов из `HEAD` побайтово совпадают с checksum в локальной БД. Расхождения worktree-файлов ещё у 16 миграций — только переводы строк (CRLF в checkout этого worktree против LF в blob'е); содержимое идентично, `migrate dev` их справедливо не флагует.
- Истинный контентный дрейф — ровно 3 миграции из прошлой заметки, не совпадают ни с worktree, ни с blob (ни raw, ни LF-нормализованные): `20261002130000_product_assembly_percentage`, `20261002140000_product_assembly_payroll_fields`, `20261004120000_simplify_product_percentage_accrual`. Механизм подтверждён датами: каждая — единственный коммит в истории (`e2515fb`, `e2515fb`, `412b09e`), причём время коммита (02.10 14:57, 02.10 14:57, 04.10 12:12 МСК) ПОЗЖЕ `finished_at` в локальной БД (02.10 11:45:21Z, 11:53:06Z, 04.10 08:59:51Z). То есть локально `migrate dev` применил незакоммиченные черновики, автор потом подправил SQL и закоммитил. Все три коммита входят в `origin/staging`.
- Трекированных правок старых миграций в ветке `feature/81` нет: `git diff origin/staging -- apps/web/prisma/migrations/` пуст; `git status` показывает там только новый незакоммиченный каталог `20261006120000_product_status_storage/`. `migrate dev` локально не перезапускался (применил бы pending — запрещено); диагноз только чтением.

### 3. Ключевая проверка БЕЗ изменения данных: RENAME в транзакции + ROLLBACK — УСПЕХ

- Одна транзакция на локальной 5433: `BEGIN; ALTER TYPE "ProductStatus" RENAME VALUE 'DELIVERY' TO 'STORAGE';` → проверки → `ROLLBACK`. Никакого `COMMIT`.
- Внутри транзакции: `pg_enum = DESIGN,PRODUCTION,STORAGE,INSTALLATION,DONE,RECLAMATION` (`DELIVERY` исчез, `STORAGE` на его позиции); `SELECT count(*) FROM "Product"` = 1305; группировка `DESIGN=45, DONE=1173, INSTALLATION=2, PRODUCTION=16, STORAGE=69` (те же 69 изделий, ноль потерь); `ProductStatusHistory` с `fromStatus/toStatus = STORAGE` — 69 строк (каст enum в зависимых колонках работает).
- После `ROLLBACK`: `pg_enum` снова `DESIGN,PRODUCTION,DELIVERY,INSTALLATION,DONE,RECLAMATION`. БД не изменена, данные целы.
- Вывод: SQL нашей миграции корректен для PostgreSQL 16, атомарен, потерь данных нет.

### 4. Безопасность deploy-пути (`pnpm db:deploy` на staging/prod)

- Точка запуска: `apps/web/Dockerfile` `CMD`: `prisma migrate deploy --schema apps/web/prisma/schema.prisma && node apps/web/server.js` — контейнеры staging/prod применяют pending при старте. В CI (`ci-cd.yml`) миграций нет (только build/test с dummy `DATABASE_URL`), образы в GHCR собираются из коммитов.
- Документация Prisma 6 (`migrate deploy`): применяет только pending-миграции по порядку, никогда не делает reset и не генерирует новые миграции; историю проверяет и лишь ПРЕДУПРЕЖДАЕТ (`WARNING The following migrations have been modified since they were applied`), в отличие от `migrate dev`, который на дрейфе блокируется и требует reset.
- Дрейф локальный, не поедет на staging/prod: черновики никогда не коммитились → ни в один образ не попадали. Staging/prod получали историю только из git-blob'ов (48/51 побайтово = локальной БД, 3 дрейфующие — в blob-варианте, который там и применялся через deploy после мержа). Локальная БД — единственное место со старыми checksum'ами этих трёх файлов.
- Порядок на staging/prod детерминирован timestamp'ами; наша миграция последняя и независима (см. п.1) — применится чисто поверх `remove_active_finishes` + `ceil_accrual` независимо от того, применены ли они уже там.
- Replay с нуля консистентен: файлы в `HEAD` взаимно согласованы (старые не правились в этой ветке), новая миграция — один идемпотентный по смыслу `ALTER` без зависимости от данных.
- Остаточные риски (честно): staging/prod `_prisma_migrations` напрямую не сверялись (запрещено); вывод о них — по анализу пайплайна (сборка из коммитов + deploy при старте). Локальной БД для `migrate dev` нужно решение владельца (baseline/resolve без потери данных либо reset с потерей — reset запрещён без отдельного поручения, НЕ выполнять). Никаких `resolve`/правок старых миграций в этой ветке не делать без согласования.

## Браузерная приёмка (шаги, выполнить после live-apply на staging)

1. Канбан изделий (`/products`, view=kanban): колонка «На складе ГП» на месте бывшей «Доставки», cyan-стили, drag-and-drop карточки в неё работает, счётчик колонки совпадает с фильтром.
2. Фильтр статусов: опция «На складе ГП» выбирается, query `status=["STORAGE"]`, таблица показывает те же изделия, что раньше показывала «Доставка».
3. Смена статуса: менеджер переводит изделие «В производстве» → «На складе ГП» — тост успеха, начисления `ENGINEERING`/`ASSEMBLY` как раньше; инженеру переход запрещён (ошибка прав).
4. История: вкладка истории изделия и проекта показывает старые переходы через «Доставку» с новым лейблом «На складе ГП»; записи `ChangeLog` не продублированы.
5. Регресс «не трогать»: тип задачи «Доставка» в диалоге задач, денежные поля проекта «Доставка/Выгрузка/Монтаж», склад материалов — без изменений.

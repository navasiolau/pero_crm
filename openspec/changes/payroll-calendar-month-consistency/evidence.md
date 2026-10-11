# Evidence

Дата:11.10.2026. Задача131. Worktree:`D:/Projects/pero_crm_worktrees/improvements-131`, ветка`bugfix/131`. Исходный SHA:`3819f175dca3f69f40da92760cf746bad430f4bc`. Стадия: LOCAL PASS, FINAL CODE_REVIEW_GO; фактическая staging-приёмка ожидается.

## Contract

Расчётные периоды имеют один строгий ключYYYY-MM(0001–9999,01–12). Europe/Moscow определяет новые accrual/advance months, debt cutoff и UI. Именованная monthly boundary включает leap days и исторические gap/fold: gap полночь означает первый действительный instant месяца, смежность диапазонов сохраняется. Internal10000-01 допускается только как конец9999-12; user10000-* запрещён. Invalid monetary input отказывается до DB writes; invalid CSV400; invalid page canonical redirect.

UTC FX asOf, receipt fingerprint/actor binding, повтор уже сохранённого аванса, роли, Decimal суммы, historical months/FKs/snapshots сохранены. Schema/migration отсутствуют. Month-only изменения PIECE и percentage producers сохраняют таймерные и денежные правила. Разметка и CSS UI сохранены; минимальный year0001 navigation guard описан в spec. getMonthTurnover допускает reviewed transaction client для повторного использования того же реального SQL query в native/задаче130.

## Local checks

- `pnpm install --frozen-lockfile --offline`:PASS, lockfile/версии неизменны, только собственныеnode_modules.
- `pnpm db:generate`:PASS, Prisma6.19.3 генерировался в собственном worktree; root/чужие generated clients не изменялись.
- `pnpm --filter @pero/web exec tsx --test tests/payroll-month.test.ts`:baselineRED0/5; после implementationGREEN5/5. Неверные13/00, UTC boundary, local-TZ range и early DB access воспроизведены на реальных исходных helpers.
- Historical DST review regression отдельно:RED0/1 на1981-03/04; revised helperGREEN1/1 и дальнейшие1982–84 gap/repeated23hour tests.
- Final targeted `tsx --test tests/payroll-month.test.ts tests/payroll-month-writers.test.ts`:18/18PASS.
- Final relevant suites `pnpm --filter @pero/web exec tsx --test --test-concurrency=2` с payroll-month{,-writers},combined-engineering-turnover,crm-byn-domain-payroll-actions,crm-byn-finance-payroll,manager-cash-advances,manager-cash-advances-retry,manager-cash-post-commit,product-percentage-pay,product-percentage-rate-adjust,work-shares-settlement,personal-payroll-clarity-render,calendar-dates:91/91PASS.
- `pnpm --filter @pero/web exec tsc --noEmit --incremental false`:finalPASS. Первый QA adapter typing issue исправлен на typed Proxy native delegate; guards не ослаблялись.
- Scoped `pnpm --filter @pero/web exec eslint` по17path allowlist:0errors; один уже существующий warning unusedassertManager вpercentage/core сохранён для отдельной задачи.
- `openspec validate payroll-calendar-month-consistency --strict`:PASS.
- `git diff --check`:PASS. LF→CRLF сообщения относятся к существующему Windows checkout, diff whitespace ошибок нет.
- Full web suite и Next build здесьNOT_RUN:ресурсы координирует оркестратор; они остаются этапом интеграции/CI. DI/SSR результаты не выдаются за production/browser/staging приёмку.

## Native PostgreSQL

Использована только существующая local БД через reviewed `existingLocalCrmDatabaseUrl()`. Verified container:`bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5`, running,5432/tcp bound127.0.0.1:5433. Exact ID/db/user/port guards повторены перед каждым запуском; credentials не выводились. Все записи—owned CashAccount/Payment в одной rollback-only transaction под прежним lock18435/55001. Дампы/reset/seed/новая БД/migration/cleanup не выполнялись.

Первый native запуск завершился **FAIL**:соседние1981-03/04 owned fixtures разделяли кассу, мартовская точкаend99 попала в апрельскую выборку(103.22 вместо4.22). Prisma transaction откатилась исключением. Первая baseline копия была только в памяти завершившегося процесса; полное сравнение её fingerprints после ошибки **не заявляется**. После STOP и согласования read-only verification показала0QA131 rows во всех6protected tables; никакая очистка не потребовалась. Независимое ревью подтвердило fixture flaw, production helper не менялся ради него.

QA исправление:обе native aggregates ограничены четырьмя exact owned IDs каждого периода; finally проверяет fingerprints и exact own fixture absence при любом исходе, original failure сохраняется отдельно, неподтверждённый rollback—STOP. Reviewer выдалPROTOCOL_GO; root разрешил один coordinated retry.

Команды(значение containerID не является секретом):

`CRM_LOCAL_CONTAINER_ID=<verifiedID> pnpm --filter @pero/web exec tsx tests/payroll-month-native.ts --verify-local-readonly`

Результат:ROLLBACK_OWNED_ROWS_ABSENT, readOnly=true, owned counts0 во всех CashAccount/Payment/PayrollEntry/Payout/ChangeLog/DomainEvent.

`CRM_LOCAL_CONTAINER_ID=<verifiedID> pnpm --filter @pero/web exec tsx tests/payroll-month-native.ts --execute-local`

Повторный результат:**NATIVE_PASS**; invalidChecks5; boundaryChecks5(`2024-02`,`2026-01`,`2014-10`,`1981-03`,`1981-04`); persistentFixtureRows0; protectedFingerprintsUnchanged=true. Исторические anomalous payroll/payout keys—0 в этом local снимке. Нативно проверены actual payout refusal и getMonthTurnover query, database rows на start−1ms/start/end−1ms/end. Все шесть защищённых fingerprints совпали до/после корректного повторного запуска.

Клиент отключён; эксклюзивное local-native окно освобождено. Staging/production данные эта local проверка не затрагивает.

## Independent review

Design reviewGO принят оркестратором до исходных правок; RELEASE_IMPLEMENTATION131 подтверждён. Calendar P2 был закрыт после independent actual transpiled helper scan1800–2100:errors[], start/end−1/start−1 keys и0001/9999/gap подтверждены. Native protocolGO получен после exact-ID/finally исправления. Независимый reviewer выдал FINAL CODE_REVIEW_GO после проверки финальных diff, evidence, native, typing/lint и91 tests. Оркестратор подтвердил GO; checkbox3.3 закрыт.

## Staging acceptance

NOT_RUN. Оркестратор должен зафиксировать deployed candidate SHA/image/health и выполнить valid/default/invalid payroll URL+CSV, browser appearance/behavior и защищённую historical data сверку. Checkbox4.1 остаётся открытым. Main/production запрещены владельцем и не изменялись.

Коммит разрешён оркестратором после FINAL CODE_REVIEW_GO; в него включаются только17 reviewed source/test paths и6 OpenSpec artifacts. README CLI не создавал. Push/merge выполняет оркестратор, staging checkbox4.1 остаётся открытым.

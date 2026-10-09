# Validation

## Local

- 08.10.2026, feature/110 от origin/staging 20a049b2. Коммитов, push, merge и shared DB миграций этим субагентом нет.
- OpenSpec CLI root подтверждён; change создан через openspec new change warehouse-unit-catalog. status/apply instructions и все contextFiles прочитаны. Артефакты соответствуют уже согласованному плану110.
- RED: warehouse-units-access тест показал прежнее разрешение DIRECTOR к /settings/warehouse-units. GREEN: ADMIN-only policy и nested/trailing-slash случаи прошли.
- RED: warehouse-units ядро отсутствовало. GREEN: CRUD/rename stable id, inactive usage, revoked ADMIN и audit failure tests прошли.
- Targeted server/action/DTO regressions:15/15 PASS.
- Полный pnpm --filter @pero/web test:1382/1382 PASS,49.2s, без standalone native DB scripts.
- Browser component tests:3/3 PASS. Реальные React/Tailwind компоненты, server actions заменены test boundary; каталог add/rename/delete cancel/confirm, блокировка used unit, selector unitId, обновление обозначений, сохранение дробного minStock; widths1440x900 и390x844 без document overflow. Скриншоты просмотрены: node_modules/.cache/warehouse-units-ui/1440.png и390.png. Браузерный harness не проверяет реальный транспорт/production/staging и не загружает Onest из Next layout.
- Prisma Client6.19.3 сгенерирован отдельно в этом worktree; pnpm11.10.0 frozen install не изменил lockfile. prisma validate PASS с фиктивным validation-only DATABASE_URL, без подключения к БД.
- TypeScript --noEmit --incremental false PASS; ESLint затронутых серверных/UI/новых тестовых файлов PASS; git diff --check PASS; openspec validate warehouse-unit-catalog --strict PASS.
- Складские/финансовые DTO сохраняют unit:string; номенклатурный DTO получает unitId. PriceItem.unit не изменён. Fixture adaptations относятся только к Material.unitId.
- Runtime scan deploy/**/*.py,*.sql,*.sh, warehouse94 operator и apps/web/scripts не нашёл обращений к старому Material.unit. Исторические миграции не менялись; raw unit в новом native harness110 используется сознательно до migration в rollback-only tx.

## Native PostgreSQL

08.10.2026 оркестратор выполнил apps/web/tests/warehouse-units-native.ts на существующем guarded local PostgreSQL 5433. Источник результата — фактический console-result и подтверждение root в родительском чате; raw hashes/отдельный receipt в этот change не передавались и не воспроизводятся по предположению.

- Первый запуск: FAIL, exit1, ошибка «Failed to deserialize column of type void» на pg_advisory_xact_lock до создания fixtures. Этот результат сохраняется как отказ, а не PASS. finally со сравнением inventory всех public tables и схемы остался в контуре ошибки.
- Исправление: только одна строка harness — вызов SELECT pg_advisory_xact_lock(18436,110) переведён с Prisma $queryRaw на $executeRaw. SQL, ключ блокировки, таймауты и finally не менялись. После исправления TypeScript PASS.
- Перед повторным запуском оркестратор независимо проверил и согласовал узкое исправление. Повторный запуск выполнил root; этот субагент БД повторно не запускал.
- Фактический повторный результат: PASS, exit0. Пройдены точный перенос прежних обозначений и всех полей номенклатуры, стандартные и нестандартные единицы, настоящие FK Restrict/unique constraints, запрет удаления единицы неактивной номенклатуры, стабильный идентификатор при переименовании, аудит и числовые инварианты.
- Полный rollback подтверждён сравнением исходного и итогового состояния всех строк public tables и схемы. Общая local5433 не получила постоянный MaterialUnit, миграцию110 или изменения данных.

Guard существующего pero_crm_pg и полного container id проверяет адрес, порт, БД и пользователя без вывода пароля. Миграция110 и owned fixtures выполнялись только внутри одной rollback-only транзакции с lock_timeout5s и statement_timeout20s. Дампы, новые БД/контейнеры и restic не использовались.

Исходники110 заморожены после review и проверок. 09.10.2026 владелец прямо разрешил коммит110 и обычный merge/push в staging, что подтверждено оркестратором в родительском чате. Git-интеграцию и runtime-проверки выполняет root; staging push110 ожидает завершения приёмки111 и её before/after proof. Этот субагент Git и БД не меняет.

## Staging

Не выполнено этим субагентом. Оркестратор проверяет фактически развёрнутый SHA/образ/health и сценарии после разрешённой integration по установленному GitFlow. Local/component checks не считаются staging acceptance. Production не затронут, restic не использовался.


## Staging acceptance design

План source-only, пока не выполнен. Работу начинает root после принятого111 SHA и проверки before/after111; functional110 остаётся в ранее проверенном состоянии. До push110 root фиксирует принятый исходный staging SHA, миграции и защищённую цель. Проверки выполняются в существующем staging без дампов, reset, seed, новых контейнеров или инфраструктурных изменений. При несовпадении target/SHA/schema guards — STOP.

### Migration before/after

- До push110, без QA fixtures, снять согласованный snapshot внутри REPEATABLE READ READ ONLY: имя/идентичность БД, фактический исходный deployment SHA, список public tables и применённых миграций, канонический count/hash всех Material строк и остальных public tables. Полные строки и секреты в stdout не выводить.
- Для Material исходный digest считается из to_jsonb(m)::text; после110 — из ((to_jsonb(m) - 'unitId') || jsonb_build_object('unit',u.name))::text с JOIN "MaterialUnit" u ON u.id=m."unitId". Одинаковые count/hash доказывают точность каждого прежнего поля, обозначения, updatedAt и числовых фактов.
- До миграции сохранить ожидаемый count/hash набора DISTINCT Material.unit UNION десяти стандартных обозначений: шт, м², м.п., лист, кг, м, компл, упак, л, 1/10 листа. После миграции набор MaterialUnit.name обязан совпасть; отсутствующие FK-связи и дубликаты обозначений — ноль.
- Принимать только фактически развёрнутый candidate SHA/image/health. _prisma_migrations сохраняет прежние записи и получает только успешную20261008190000_warehouse_unit_catalog; Material имеет обязательный unitId/FK ON DELETE RESTRICT/index, прежний unit отсутствует, MaterialUnit имеет ожидаемые поля и UNIQUE(name).
- После deployment, ещё до QA fixtures и входа QA-пользователей, снять такой же READ ONLY snapshot. Для всех других public tables count/hash обязаны совпасть; штатная разница только Material shape, новый каталог и migration ledger. Известную штатную bot-date/heartbeat разницу разрешать лишь в заранее согласованном конкретном поле и зафиксировать её отдельно; не расширять исключения после расхождения. Между снимками root координирует отсутствие иных writers и ночного refresh; при изменениях snapshot не выдавать за доказанный110 migration proof.

### Actual CRUD and denied roles

- После migration proof использовать существующий root scoped QA mechanism с отдельными owned actor IDs, marker и точным manifest ресурсов. Проверять фактические страницы и deployed Next server actions, без auth/server/database mocks. Запросы и cookies не печатать.
- ADMIN: карточка настройки видна и прямой URL доступен; стандартные л и1/10 листа присутствуют. Создать owned единицу, назначить её owned номенклатуре с minStock0.125, деактивировать номенклатуру и переименовать единицу. ID сохраняется, номенклатура/динамический селектор показывают новое обозначение; numeric snapshot owned материала не меняется при rename и смене единицы.
- Для inactive-used единицы урна заблокирована; прямой deployed delete action также отказывает с понятным сообщением и сохраняет обе записи. Сменить единицу owned номенклатуры на1/10 листа текущей складской ролью; теперь ADMIN успешно удаляет прежнюю свободную owned единицу. Отмена подтверждения удаления не делает запрос.
- Проверить отсутствие страницы/карточки и отказ add/rename/delete для DIRECTOR, MANAGER, ENGINEER, PROCUREMENT, ACCOUNTANT, WORKER, MOUNTER, а также MANAGER/ENGINEER role union без ADMIN. Для действий переиспользовать фактический browser-captured Next-Action transport: новые уникальные owned обозначения, существующие owned IDs, для delete — действительно неиспользуемую единицу. Не считать duplicate/FK/CSRF отказ за ролевой DENY; ADMIN positive control с тем же корректным запросом обязан проходить. Конкретный HTTP status не фиксируется заранее: Next transport может вернуть redirect/RSC error; обязательны отказ операции и отсутствие DB/audit writes.
- DIRECTOR/MANAGER/PROCUREMENT сохраняют право выбирать единицы в номенклатуре. Existing norms/movements/balances/prices/finance/payroll за пределами точного QA manifest остаются неизменными. Root закрывает QA через свой scoped cleanup по exact IDs и порядку FK, затем доказывает отсутствие owned каталог/материал/user fixtures; аудит обрабатывается только существующим согласованным механизмом QA. Никаких изменений или удаления реальной номенклатуры/единиц.
- Зафиксировать реальные hashes/counts, SHA/image/health, роли, CRUD/denial результаты, screenshots и cleanup evidence. Только затем отметить tasks4.3. Planned checks и старые local receipts staging acceptance не заменяют.


## Branch integration 09.10.2026

- По прямому разрешению владельца/root зафиксированы только три independently reviewed readonly QA файла:6024773e986f4bb470e616341aa791236ce11b7b. Источники64purePASS и independentNONE; app/coredce86b4 сохранён.
- Свежий origin/staging87c404846bdb659a2f9f45e3b9d7a0a98c5ad17a влит обычным merge20662c1e35a5ea978de117527ef5d0a59acfd335 без конфликтов. 111DRAFT/default,112participant/repeated replacement и114covers сохранены; копирование/cherry-pick/squash не использовались.
- Независимое merge review нашлоP2: SQLиндексMaterial_unitId_idx отсутствовал в Prisma declaration. Исправлено только двумя вставленными строками Material@@index([unitId]) в6abd9056b1bb47e89d1d4d28d022c0e022686b58. FrozenmigrationSQL не менялся; повторное independentreviewNONE на этомHEAD.
- Полный merged local webнабор1544/1544PASS (29.5s), TSCдо/после индексного regenPASS, targetedlintPASS, Prisma validatePASS, OpenSpec110/111/112/114valid. Генерация выполнена только в проверенном110ownednlink1.pnpm/.prisma/client, vendorhardlinkhashesunchanged; install/junction/remove отсутствовали. Prisma validate использовал fake validation-only URI, DBне подключалась.
- Штатный Git diff/status с действующей CRLF-нормализацией clean; отключениеautocrlf для диагностического diff давало только newline-noise импортированных файлов, не чужие смысловые правки.
- Три readonlyproof source пока неизменны (9f8ac972/c6576fe5/50d315e5). Staging/DBQAheld: для будущего110BEFORE необходим свежий generic ApiToken clock helper111 с доказательством всех прежних IDs/полей кроме единственногоlastUsedAt и монотонных bounded clocks. Ожидается normalmerge этого reviewedcommittedhelper через staging; selectivecopy/import из чужого worktree не разрешён. Старый глобальный111STOP не преобразуется вPASS.
- Actual unitCRUD/deny/inactiveFK/numeric/CAS cleanup пока только sourceplan, ignored handoff node_modules/.cache/task110-stage-crud-plan.md; runtimefixtures/SSH/DB/staging не выполнялись. tasks4.3 остаётся pending.


## Fresh staging proof v2 — source-only

- Generic ApiToken helper111 достигнут обычным merge stagingcfd065314024fd448c5989964e0cbc7790b196da (включая117ACL/identity/cardfocus) вe8a84e0443bead21ba32d217b7df01aeb821b886. Helper/app117 не копировались и не изменялись в110adapter.
- ONLY110entry/runner/tests используют committed crm-acceptance-token-clock.mjs: freshfull/stableминусONLYlastUsedAt, legacyMD5 иhashedID-clocks внутри того жеRRREADONLY. TokenfullFP обязан совпасть сdynamicfullApiTokenFP; helperDBend ограниченouterclock_timestamp snapshotEND. Все прочие tokenfields/IDs exact, толькоlastUsedAt можетмонотонно продвинуться; никакого lowerbound наbeforeCaptureEND. Knownbot OrgSetting допускает лишь samevalue/immutablefields иmonotonicclock≤afterEND без beforeENDlowerbound.
- Snapshot и privatecheckpoint version2 обязательны; oldv1/missingclockproof отвергаются. Sharedhelper включён вfrozen sourcehash binding. Старый111globalSTOP не переинтерпретируется; actualfresh110BEFORE ещё не запускался.
- MeaningfulRED80cases10fail → GREEN102/102 (unitadapter85+shared17), включая secret/scopes/owner/revocation/hashedIDmembership, clockregression/future/null, corruptfullFP, oldmissingproof andpositiveobservedclock. Fullmergedlocal1590/1590PASS45.99s, TSC/OpenSpecPASS, lint0warnings/syntax/diffcheckPASS.
- IndependentstaticreviewNONE точныхSHA: entry8629004951126b7ae5d9ea5d3eb04e6eb5454f825b833b9d8e2f858a8462cc7a; runner34dac1f669b567f395d87f31a6542b3abaed014380064d60a61225a105038529; testsa9b0699441c7d617c959607a2220f2c1b5f19907085de626788b3b94d597db2b; shared13407f3f719ef7962e2ffb21abb52089e7132b4ec402db87340d9c2fe3b7fc51 unchanged.
- Drybundle36998bytes/SHA104abaeeeba4298337e63fe1f999bc63f0162ef2da1c387bed50f0386f45fb43; buildonly stageExecuted=false/dbExecuted=false. FrozenunitSQL/checksumdeac962.../catalogmapping/index/schema/numericguard unchanged.
- Rootдержитactual110stage/DB/fixtures untilphysicaldeploymentfreshproof. Sourcebranchcommit/push разрешены; это не stagingacceptance. tasks4.3pending.

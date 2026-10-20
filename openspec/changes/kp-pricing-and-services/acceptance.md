# Приёмка №182 — 18.10.2026

Worktree: `D:/Projects/pero_crm_worktrees/kp-182`, ветка `feature/182`, исходная база `origin/staging` `d918ab86` по брифу оркестратора. Foundation №180 интегрирован оркестратором обычным FF merge до `aff6c105bbf17c39036ff2b3d123eb5fdbba6233`. Оркестратор выполнил native QA №182 на разрешённой local5433 с полным откатом; постоянного применения миграции №182 нет. Субагент не выполнял коммиты, push, merge, команды БД, Docker, S3 или SSH.

## Выполнено

- Чистая проекция цен: фиксированный курс с валютой/датой/источником, цены единицы до/после скидки, количество, явные категории услуг и знаковая поправка округления.
- Сохранены фактически печатаемые суммы исходного генератора: 10.075 → 10.07; 100.75 − 10% → 90.68. После считывания печатных целых копеек все денежные действия используют Decimal. Вне тестовой проверки код не импортирует исходный проект; исходные файлы и JSON не меняются.
- Два поля Project и аддитивная миграция с эксклюзивным CHECK режимов услуг. Общие итоги обслуживают карточки, списки, dashboard, экономику и bot API; явный select экономики и денежные маски расширены.
- Inline-редактирование общей суммы и разбивки очищает альтернативы одной записью. Очередь услуг сохраняет полный CAS-снимок, идентичный повтор после потерянного ACK и защиту от старых проекций; несохранённый соседний ввод остаётся.
- `applyProjectionInTransaction` проверяет реальную принадлежность КП проекту и LEAD под блокировкой, полный активный состав и количества, обновляет цены и аудит в переданной транзакции. Он не изменяет начисления.

## Проверки

- Prisma 6.19.3 generate и validate: exit 0, только локальные файлы генерации. Использован заведомо фиктивный local URL; соединение с БД не открывалось.
- 12 релевантных файлов node:test: **90/90**, 0 failures. Новые проверки находятся в kp-pricing, kp-pricing-persistence, kp-services и kp-project-money; также выполнены product-quantity, project-contact-controllers, project-inline-actions, project-inline-bot-route, finance-project-workspace, byn-price-conversion, product-percentage-pay и crm-byn-finance-history.
- Полная типизация web (`pnpm --filter @pero/web exec tsc --noEmit --incremental false`), типизация бота, ESLint затронутых файлов, OpenSpec strict и `git diff --check`: **exit 0**. Финальная web-типизация повторена после добавления совместимого чтения печатных сумм.
- Отдельная read-only сверка с фактическим `D:/Projects/pero_kp/public/js/sheet-render.js`: 512 детерминированных сценариев скидок, количеств и услуг, 0 расхождений базы/скидки/итога. Эта проверка не является production-зависимостью.

## Handoff интеграции №180/181/184

1. Получить курс до транзакции через `resolveProposalRate`. Обычное сохранение передаёт existing; смена валюты требует нового соответствующего курса. Дата КП не обновляет сохранённый курс.
2. В pricing hook №181 вычислить `projectProposalPricing(context.state, preparedRate)` после назначения стабильных ID и синхронизации состава. Сетевых вызовов в hook нет.
3. В той же транзакции записать в CommercialProposal `currency`, `rate`, `rateDate`, `rateSource`, затем вызвать `applyProjectionInTransaction(tx, context, projection)`. Возвращаемая DTO должна содержать метаданные после hook. Будущий публичный путь сохранения не допускает отсутствующего pricing hook.
4. При переносе редактора сохранить `delivery.items[].crmKind`: исходный normalizeState перестраивает строку как `{name,price}` и теряет дополнительное поле. Печатные подписи/шаблоны и денежная семантика оригинального renderer остаются прежними.
5. Native-проверка самого pricing adapter завершена, результат ниже. После обычного merge №181 остаётся проверить совместное сохранение через обязательный pricing hook, API operation idempotency и конкуренцию со сменой этапа.
6. Принять интерфейс в браузере и реальный staging SHA/образ. Unit и native-проверка адаптера не подтверждают работу общей оркестрации, постоянное применение миграции, доступность staging или визуальную приёмку.

## Независимое review

Root получил один P1: `getProjectEconomics` включал мягко скрытые изделия в ожидаемую выручку. Исправлено точным `products.where.deletedAt=null` только в коммерческой выборке. Исторические платежи, складские расходы и начисления читаются по прежним связям без такого фильтра. Регрессионный сценарий содержит активное изделие на 3 BYN, скрытое на 200 BYN, услуги 100 BYN, поправку −0.01, исторические расходы 5 BYN и зарплату 7 BYN: ожидаемая выручка 102.99, маржа 90.99. Других подтверждённых замечаний review №181/182 не выявило.

## Native QA после интеграции №180

Оркестратор выполнил обычный FF merge принятого foundation №180: HEAD `aff6c105bbf17c39036ff2b3d123eb5fdbba6233`. Изменения №182 сохранены в своей ветке. Новая миграция №182 приведена только к LF, без семантических изменений; 723 байта, SHA-256 `f1803e4761a7e3537ff9508e0ffd1f7ba859badf37b4948ebd358bc4b97d9b74`. Для неё добавлена одна строка `.gitattributes`; применённые ранее миграции не изменялись.

Подготовлен `tests/helpers/kp-pricing-native.ts`: принимает только переданную Prisma TransactionClient, автора и UUID запуска, не открывает соединений и не выполняет внешнего I/O. Он создаёт свои live КП/проекты/изделия ORM внутри внешней rollback-транзакции и вызывает настоящие `projectProposalPricing` и `applyProjectionInTransaction`. Семь независимых наборов ожидаемых значений покрывают USD/BYN, фиксированный и дробный курс, количества больше одного, процентную и абсолютную скидку, общие/раздельные/выключенные услуги, оба знака поправки, печатную границу 100.75 − 10% и пустое КП. Проверяются Decimal из PostgreSQL, фактический SQL-итог, общий итог CRM, сохранённые курс/дата/источник, аудит и повтор той же проекции.

Для native-проверки helper создаёт настоящий SETTLED percentage-снимок с прежней ценой, долю, связанное начисление PayrollEntry и факт оплаты. Полные хэши десяти таблиц финансовой истории сравниваются до/после сохранений. Запрет вне реального LEAD проверяется при поддельном LEAD в контексте; также проверяются возврат LEAD, чужая связь КП, роль и количество. Проверка частичной записи наблюдает реальные Product UPDATE, затем вызывает настоящий `Project_services_mode_check`; SAVEPOINT возвращает цены и аудит.

Ignored coordinator `.playwright-mcp/kp-182/pricing-native.ts` по умолчанию только читает и хэширует 20 локальных файлов; dry не импортирует native-helper, не открывает БД, не вызывает Docker или Git. Режим `--rollback-qa` требует явный флаг оркестратора `CRM_KP182_ROOT_ROLLBACK_QA=1`, полный ID разрешённого контейнера, reviewed plan SHA, точные URL/DB/user/port guards, существующую успешную receipt №180 с SHA `1dd319ff01ca341bac362a576f7ed298e2facff08c54791156a72bf7877560fe` и отсутствие receipt/полей №182. Только после guards он временно исполняет проверенное тело SQL одним DO/EXECUTE в своей транзакции, проверяет типы/все CHECK и гарантированно бросает приватный sentinel для ROLLBACK. Полный nativeSnapshot всех таблиц и public-каталога до/после обязателен даже при ошибке. Режима постоянного применения нет.

Dry-run, полная web-типизация и ESLint helper проходят; отдельная TypeScript-проверка включает ignored runner и также проходит без ошибок. Независимое review native helper/runner выполнено без замечаний.

Оркестратор фактически выполнил `--rollback-qa` на разрешённой local5433. Reviewed plan SHA-256: `b914afa575b05108e6fb3175a8e520d0e09d1e6a08a0eb19c6078bcbd15549c3`. Полный локальный результат: `.playwright-mcp/kp-182/native-rollback-result.jsonl`. Все семь сценариев завершились PASS: `usd-total-percent`, `byn-split-amount`, `byn-off-negative-rounding`, `byn-off-positive-rounding`, `usd-fractional-rate`, `usd-printed-rounding`, `byn-empty`. Подтверждены реальные Decimal и фиксированный курс из PostgreSQL, повтор проекции, сохранность всех десяти таблиц истории, SETTLED-снимка/доли/PayrollEntry/оплаты, серверные LEAD/связь/роль/количество, возврат в LEAD и реальный CHECK после обоих Product UPDATE с полным savepoint-откатом.

Внешний I/O заблокирован. Приватный sentinel завершил внешнюю транзакцию ROLLBACK. Все 76 таблиц и public-каталог совпали полностью до/после: SHA-256 `aead300a6d8f82454ea96a270db758f59af323ca55635f34eedb700ed6831692`. Receipt №182 отсутствует, миграция постоянно не применена. Пункт 3.2 завершён только для native pricing adapter; интеграция hook №181, API operation idempotency, конкурентные сохранения и staging остаются незавершёнными в 3.4/3.3.

## Интеграция зависимости №181

Основной агент выполнил обычный fast-forward merge staging `4b9f80acd721336936f01cea5c63e2b8c442ced3`, сохранив собственные изменения через retained stash `1eaf5fe7f1520192deca938cc22beab22ec76c13`. Конфликты разрешены совместным сохранением LF-правил обеих миграций и денежной проекции №182 вместе с контекстным draft-доступом №181. После объединения Prisma validate/generate и полный web TypeScript — PASS; 24 focused pricing/services/money/draft-readers — PASS. Validate сначала остановился на отсутствующей переменной `DATABASE_URL`; для проверки схемы использован явно нерабочий schema-only URL, соединение с БД не открывалось. Реальная staging-приёмка №181 на этот момент ещё выполняется; данный merge не считается её подтверждением.

После отдельного разрешения владельца основной агент штатным Prisma migrate deploy применил только №181–183 на local5433. Три точных checksum подтверждены, прежние строки всех 76 таблиц сохранены, четыре старых checksum-исключения и старые migration rows не исправлялись. Новые поля получили только предусмотренные NULL/0 defaults; цены и финансовые факты не пересчитывались. Receipt: `kp-183/.playwright-mcp/kp-183/apply-result-d52c92b7-fa72-4e39-8ff3-36cde052f31a.json`. Это последующее применение не заменяет приведённую выше отдельную rollback-проверку pricing adapter.

Зависимость актуализирована обычным merge принятого staging №181 `4c0ea2bf5a929bd0319bfe6d8795b7986a6e418f`, merge HEAD `28cc6b0479eac2e2f4ff3323677576af7a6e5fca`. Тот staging имеет успешный CI286 и реальную native-приёмку состава/ACL с полным откатом, точным образом и HTTP200. Цена/услуги №182 до собственного развёртывания на staging не считаются принятыми.

## Регрессия browser fixture в CI287: атомарный ACK услуг

На основании сообщения координатора о CI287 (staging SHA e92e25b2…) локально точно воспроизведён отказ inline-field-subscriptions.test.mjs: после удержанного ACK ожидалось 135,5 BYN, но оставались подтверждённые 125 BYN и сообщение pending. Тот же настоящий Chromium test до исправления завершился FAIL в этой проверке.

Причина — устаревший transport stub, возвращавший только kind/field/value/clientMutationId. В production project-field-core.ts для изменённой услуги возвращает полный derived pricing snapshot с servicesTotal, всеми суммами, поправкой и pricingVersion. Service controllers182 намеренно публикуют атомарный подтверждённый итог только из такого снимка. Допустимый bare no-op ACK не относится к проверяемому изменению20→30.50. Исправление production controllers/provider/финансовых функций не понадобилось.

Обновлён только существующий browser fixture: явные начальные servicesTotal/rounding, полный versioned service ACK, настоящий pure CAS helper и точный денежный helper для синтетического server snapshot. Fixture сохраняет receipt до потери/удержания ответа; retry возвращает тот же результат, не выполняя CAS второй раз. Числовые ожидания135,5/145/155 не менялись. Дополнительно проверяются125 до ACK, baseline30.50 при сохранённом новом draft40.00, полный expectedServices после ACK и deep equality повторного запроса после lost ACK. Pending/readonly/dirty-RSC и исходные no-unrelated-renders assertions сохранены.

RED→GREEN: pnpm --filter @pero/web exec tsx --test tests/inline-field-subscriptions.test.mjs — FAIL до исправления, PASS после; фактические viewport1440/390/360. Receipt и screenshots: apps/web/test-results/inline-field-subscriptions/48b25318-0e4b-4f03-bd2a-f5a3ef676bcc/. ProductInlineDetails/description не перерисовываются при typing цены/количества; ProjectConfirmedTotal остаётся2→2 при dirty service typing. beforeComparison=NOT_REQUESTED: историческое pixel сравнение здесь не заявляется.

Дополнительные проверки: pnpm --filter @pero/web exec tsx --test tests/kp-services.test.ts tests/project-inline-actions.test.ts —7/7; полный pnpm --filter @pero/web exec tsc --noEmit --incremental false —PASS; полный pnpm --filter @pero/web lint —exit0,0 errors и4 прежних warnings в неизменённых cleanup-uploads/product-attachments/product-percentage-pay. OpenSpec strict и scoped diff-check проходят.

Это локальный настоящий browser с синтетическим transport; новые CI/staging результаты ещё NOT_RUN. Production, money/native файлы, БД, Docker, S3 и внешние сервисы не менялись; commit/stage/push не выполнялись. Открытые пункты3.3/3.4 не объявляются завершёнными этой корректировкой fixture.

## Реальный staging №182 после CI288

Последующая проверка выполнена основным агентом на реально развёрнутом staging, отдельно от приведённых выше local/browser результатов. CI288, run `39140614362`: все шесть jobs SUCCESS по readback основного агента. Точная ревизия `6fbeb1ea76e6c17bef798dc7bd2d0a4f97c10ab4`, runtime image `sha256:ccd26031d5019550fe4fd3a85178d780eeced658f912a1a7a47a6007cf9f18a3`. Здоровье `/api/health` и `/login` — HTTP200, receipt `.playwright-mcp/kp-182/stage-pricing-diagnostic-886eb17b-c6f6-4e16-8f22-62e560e9d1db/http.json`.

Цель до/после подтверждена reviewed wrapper: host `crm-staging`, web container `21bb284d41064eafe7e4a512310fd1e96b4ed485422de81ac6448526f2acaf67`, DB container `27b8f7342b9d722ab8788e137b37b03a3037442da038c5b8b98dbb30245b8b6a`, volume `crm-staging_pgdata`, DB start `2026-09-23T11:42:14.649193151Z`. Внешний W07 wrapper SHA256 `27e3bcd727d9e83170c76a254806fde42590da76cea30c9e1441d873df680139` сохранён. Флаг КП остаётся OFF; S3 и внешние эффекты из тестового процесса заблокированы.

Первый запуск `.playwright-mcp/kp-182/stage-pricing-14f5c32c-0560-4252-b86a-432800e5c79e/capture-receipt-74914276-0d78-491d-984f-b5c2571d2582.json` сохранён как неуспешный: `ERR_ASSERTION`, phase `rollback-preservation`, `preservation=NOT_CHECKED`, exit1. Причина расхождения не установлена; этот receipt не подтверждает сохранность и не заменяется последующим успешным результатом. Старый runner не выводил различия снимков, поэтому нельзя приписывать отказ конкретной таблице или фоновому процессу.

Добавлена только ignored диагностика: при несовпадении выдаются имена таблиц, before/after count/hash, SHA256 снимков и четыре catalog hash, без строк данных. `nativeSnapshot`, `verifiedRollback`, строгая проверка всего baseline и target guards не изменены, таблицы не исключены. Неизменность guard-функций и helper, безопасность проекции и обязательность READ ONLY проверены восемью offline tests. Это подготовка диагностического runner, не изменение production-кода.

Перед повторным ценовым запуском основной агент выполнил отдельный read-only probe: `.playwright-mcp/kp-182/stage-snapshot-probe-3b284228-98e4-4d2a-9e91-cac800deafa5/capture-receipt-1821d31e-4027-4b03-a7d6-c25b68b36e2c.json`. Bundle SHA256 `d7baf3eb372d217a9d22dc2ac6c9f28a87bd02eb57d1c5a39ac9d1cf8dbfa607`. Два независимых PostgreSQL REPEATABLE READ снимка с принудительным READ ONLY и паузой1500 мс дали `stability=EXACT`: 76 таблиц,0 изменений, одинаковые constraints/functions/triggers/indexes. Оба snapshot digest `19cc96c40c4f8c4473acd6ccca6664a296d36a61376af0c444d9ca197f67f0ca`; `pricing=NOT_RUN`, `preservation=NOT_TESTED`. Стабильность этих чтений не устанавливает причину первого отказа и не подменяет rollback-проверку.

Финальная native-проверка основного агента: `.playwright-mcp/kp-182/stage-pricing-diagnostic-886eb17b-c6f6-4e16-8f22-62e560e9d1db/capture-receipt-351f62a7-3efc-47ae-9036-495a7ea83ff0.json`, run `8a804251-8c1d-47e9-8a4c-75ecac5d7249`, exit0, `PASSED`, `preservation=EXACT`. Bundle SHA256 `e1df2fc6481014f440182432c9981f3c2285ac9c1851cbb25d1868bad363c21f`, 42858 bytes. Сверены все18 source hashes относительно ранее проверенного пакета этой ревизии; общий source-proof SHA256 `b0b1244e0a8c6375a9732f91fcf1f2d41d09653b7f0b4ce1ea0371ab0b1ae826`. Runtime Prisma6.19.3/zod4.4.3 и сгенерированные поля Project подтверждены внутри контейнера. Receipts №180–182 завершены и не помечены rolledBack; receipt digest `455a8f35787b06788cb37055f3bcc0d64449cabac0c4a2ad64d5ad7701c60adf` совпал до/после.

Все семь денежных сценариев PASS, включая печатное округление и оба знака поправки; реальные Decimal и фиксированный курс считаны из PostgreSQL. Подтверждены повтор проекции, сохранность всех десяти финансовых таблиц и созданных внутри rollback-транзакции SETTLED/PayrollEntry/Payment фактов, реальный LEAD guard, возврат в LEAD, отказы по роли/количеству/чужой связи и savepoint-откат после фактических Product UPDATE и CHECK failure. Внешняя транзакция принудительно завершена rollback; ни одна её тестовая запись не фиксировалась. Все76 таблиц и четыре проверяемые группы public-каталога (constraints/functions/triggers/indexes) совпали: baseline SHA256 `9611d3fda844eaf11e046f7d8521e177d433e4d1b563ad9ee4038bb1ac668368`. Все11 новых таблиц пусты до/после, внешние tripwires0.

Принят только staging pricing adapter №182 и точная runtime identity. Общая оркестрация сохранения №181, API operation idempotency, конкуренция со сменой этапа и настоящий staging browser desktop/mobile остаются NOT_TESTED этим запуском. На этом этапе пункты3.3/3.4 оставались открытыми; последующее закрытие только3.4 приведено ниже. Production, дампы, S3 и инфраструктурная конфигурация не изменялись. По отдельному поручению основного агента субагент фиксирует только эту OpenSpec-приёмку локальным docs commit; ignored receipts и диагностический код в commit не включаются.

## 20.10.2026: общая оркестрация и интеграционная приёмка 3.4

Root принял совокупное доказательство CORE23 + AI01 + CI306 на staging
`acbd164cb6e79194b7fe87a0469d60d745dead1a`, web image
`sha256:8ef120a68e378d47b71ea5913ec8bd85391cfa4f2f8cd1ec25169151a55bd77f`.
Закрыт только 3.4; UI desktop/mobile 3.3 остаётся открытым. Далее `Q180` —
`kp-180/.playwright-mcp/kp-integration`, `Q187` — `kp-187/.playwright-mcp/kp-187` в сохранённых worktrees.

- CORE23 actual HTTP save + SQL readback: `M01-real-decimal-USD-discount-quantity-total-services`,
  `M02-explicit-crmKind-split-services-absolute-discount`, `M03-signed-rounding-and-source-10075-boundary`,
  `C04-reorder-remove-restore-stable-product-history`, `CAS-conflict-no-implicit-version`.
  Проверены реальные цены/услуги/количества, фиксированный FX, история и stale revision без неявного выпуска версии.
  Money ACK: `Q180/qa-window-e644c93c-42df-47b3-b1c1-e95cffb34974/ack-7a9362b1-0d8a-42a5-8582-2ac14411b440.private.json`,
  SHA256 `3d3c4460869cc010a1213f2b9e1edb8ce1a56a3ec31b629de553bdeafadde3d6`.
  Закрывающая классификация CORE23: `Q187/full23-closure-classification-be523ee8-ff2a-46ea-899d-ae01cdc27605.json`, SHA256 `2f53ae84561c8e8172e047695cac9818751b8ad2cc2a965cf352a84fb28555ec`.
- API operation idempotency: `AI01-SDK-confirmed-identical-UUID-replay` — тот же UUID/body, HTTP200 и native REPLAY VERIFIED;
  `AI01-SDK-real-stale-409-no-effect` — HTTP409 и native STALE VERIFIED.
  `Q187/ai-acceptance-run-e85c0578-026c-4a56-af59-9d2c49cefff9/result.json`, SHA256 `4e79ee2a3e5a5ed01fbefed8032e2f78ce4c8c4ffeaf9a5a0505f7e553c0132f`;
  Root acceptance `Q180/full4-acceptance-b784fa50-5efa-43ab-856e-7f6aa67e0baa.json`, SHA256 `dd7aad274eb93899f2a224c1bdc376f26aed956fbdad4fff416db0665baa31fa`.
- Конкуренция общего save/lifecycle: CI306/run `39290284146`, все семь jobs SUCCESS,
  `kp185/proposal-save-vs-lead-exit-save-first-real-advisory-waiter` и `kp185/proposal-save-vs-lead-exit-stage-first-real-advisory-waiter`.
  Два реальных PostgreSQL PID, наблюдаемые advisory waiter и `Project FOR UPDATE`, оба порядка commit/reject, revisions и неизменность native snapshot после отклонённого save/повторов.
  Receipt `Q180/ci306-green-d89592a4-086f-479a-9a6e-f08d285db47d.json`, SHA256 `42974641842e010620a4116ba4ac433f119740754576507cfc986c69c95c68a4`.

API `api-documents.ts:130,152,195–196` передаёт настоящий pricing hook с `applyProjectionInTransaction` общему save; `proposal-core.ts:162,187` исполняет его в той же транзакции после общего mutex.
Это составное доказательство сверх adapter-only3.2. CI race использует pricing-заглушку (`changed:false`), а SDK replay меняет описание; concurrent HTTP с реальным priced DML и повтор изменения цены этими receipts не заявляются. Root принял перечисленную совокупность для3.4 без дополнительного HTTP-concurrency gate. Исторические отказы и остальные незакрытые сценарии сохранены.


## 20.10.2026: денежные сценарии и staging browser desktop/mobile — 3.3

После принятия 3.4 Root принял отдельную композицию для 3.3 на той же развёрнутой
ревизии `acbd164cb6e79194b7fe87a0469d60d745dead1a`, web image
`sha256:8ef120a68e378d47b71ea5913ec8bd85391cfa4f2f8cd1ec25169151a55bd77f`
(CI306, run `39290284146`, attempt 1). Пункт 3.3 закрыт следующими фактическими результатами.

- Денежный HTTP/native: CORE23 Money ACK `3d3c4460869cc010a1213f2b9e1edb8ce1a56a3ec31b629de553bdeafadde3d6` по уже указанному пути подтвердил M01/M02/M03 — Decimal, USD/фиксированный курс, цену единицы и количество, процентную/абсолютную скидку, общую сумму/разбивку услуг и поправку округления. Реальные save/SQL readback и CAS409 сохранили историю; quarantine восстановлен. Границы и закрытие CORE23 — classification `2f53ae84…`, указанная в 3.4.
- API: AI01 result `4e79ee2a…` и Root acceptance `dd7aad27…` по указанным выше путям подтвердили реальное SDK/MCP/Python сохранение и сохранность денег при replay/stale. Отдельный current-image receipt `Q187/file-access-denials-run-33bfe963-adb3-400f-8751-9d26bf9fcb2d/result.private.json`, SHA256 `375d4386caa075ff85fa202148a389a5e86f3f69bc3944408774b71fef2633d7`, содержит PASSED `NBRB-BYN-2026-10-01` и `NBRB-USD-2026-10-01` (HTTP200, source:NBRB, rate 1 / 3.0207). Это API-проверки валюты/курса; браузерный ввод валют этими результатами не заявляется.
- Lead23: настоящий browser MANAGER сохранил КП перед private PDF export и выполнил `182-real-overview-pricing-and-quantity` на 390 и 1366 px. Проверены отображаемые суммы, услуги и количества против актуальной SQL-проекции. `Q187/ui-acceptance-run-0ddd28d0-a893-419d-8d9d-f098a8dec01f/receipt.json`, raw SHA256 `89ed32e384e8ae37366eff1095a6e2b7c9346de7ac7da459e7e06a074915e702`, semantic result `26a00b40e83cd3da9ef2bc13598f74c9d1ce364439bf26f8e049229979aad11f`; browserErrors:[] и сохранённые desktop/mobile screenshots.
- UI34 Locked: четыре PASSED `182-real-overview-pricing-and-quantity` — проекты 255/256 на каждой ширине 390/1366; суммы/услуги/количество в браузере сопоставлены с SQL, browserErrors:[]. `Q187/ui-acceptance-run-34ade56d-bd1f-4c10-a6e6-d87e52c7608e/receipt.json`, raw SHA256 `a6c4b7884a91c2afa2bcc70bef483c321278e803d0ba2204b36daa5f239aa307`; host producer result `a6ac46db07c901157bab6f87d8cf9c3475e9a5f38e813b1c425b8a48626c659e`. Каждый pricing read имеет native preservation с совпадением BUSINESS и сохранённым RAW; допустима только approved legacy `ApiToken.lastUsedAt`. Root full76-границы и четыре каталога зафиксированы отдельно для прогона. Финальный `Q180/fresh-ui34-run-context.json` SHA256 `98f9442b300d8a1b0eb85e49719df2f466711dda0ccf33ed209043bc8938c86b`: original finish и terminal ORIGINAL_FINISH_OBSERVED, 11 inactive / 22 revoked, alive:false, flags000, owned renderer stopped.

Денежные изменения доказаны HTTP/native сценариями, desktop/mobile — перечисленными browser pricing cases. Ранние NOT_CHECKED/REFUSED/HOLD и ограничения исходных receipts сохранены; принятый текст 3.4 не изменён. Новых запусков, миграций или изменений production это обновление документов не выполняло.

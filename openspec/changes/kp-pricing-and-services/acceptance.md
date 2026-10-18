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

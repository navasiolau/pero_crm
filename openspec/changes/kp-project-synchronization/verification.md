# Проверки №181

Дата: 18.10.2026. Работа находится в отдельном worktree kp-181, feature/181, исходно от staging d918ab86. Зависимость №180 получена обычным merge с сохранением истории; базовый SHA после merge — `aff6c105bbf17c39036ff2b3d123eb5fdbba6233`. Основной агент выполнил коммиты, обычную staging-интеграцию и фактическую native/HTTP-приёмку №181 на `4c0ea2bf5a929bd0319bfe6d8795b7986a6e418f`. Результаты и оставшиеся границы приёмки разделены ниже. Субагент этого обновления evidence БД, Docker, Git, S3 и сеть не вызывал.

## Domain

- `kp-proposal-contract.test.ts`: 9/9. Сохранность полного JSON, ID, количеств и характеристик; закрытые envelopes; структурированное ФИО и непрозрачный contact; проверенный неизменяемый временный клиент; авторитетные реквизиты, отсутствие обхода через пропущенный sidecar, смена клиента и fingerprint операций. Частичное изменение клиента сначала дало RED (ручной телефон CRM вместо снимка КП), после объединения сохранённого снимка — GREEN.
- `kp-proposal-core.test.ts`: 14/14. Общий MAX с удалёнными проектами, отсутствие расхода номера после rollback, defaults/history изделия, replay, mirror/reorder/restore, сохранность статуса/инженера/финансовых фактов, количество и существующие work/material guards, LEAD/revision/role, no-op receipt, повторное применение денег/клиента и атомарный откат hook/CAS/outbox. Дополнительно проверены изменения перед Product lock, фактическое количество после блокировки и складская заморозка.
- Ранее расширенный запуск domain/client/readers/engineer + percentage-defaults/engineering-edit/inline-actions/worker-work/confirmed-effects/status-receipts/task-work: 85/85; после дополнений расширенный прогон — 88/88. Последний focused-прогон основного агента после merge зависимости: 32/32. Более ранний domain/stage/product-inline/draft-policy запуск: 33/33.
- Проверка cache fault isolation дополнена стабильным ID и прежним номером: сбой каждого пути не останавливает остальные, один lookup сохранён; после обновления ожидаемых путей GREEN.
- ESLint всех изменённых domain файлов и тестов: PASS. `openspec validate kp-project-synchronization --strict` и `git diff --check`: PASS.
- До merge зависимости №180 полный typecheck ожидаемо не прошёл из-за отсутствующих типов CommercialProposal/ProposalItem. После обычного merge №180 основной агент выполнил Prisma validate, Prisma generate и полный typecheck: PASS. Ошибка до merge сохранена как исторический результат, а не как успешная проверка.

## Access и интерфейс

Результаты участника access: связанные тесты 80/80, draft readers первоначально 3/3, SSR 9/9, Chromium global/project 10/10, navigation/render-isolation 5/5, ESLint. Затем добавлен четвёртый reader-тест: коллизия номера с ID и отсутствие alias-fallback при недоступном ID; последний общий запуск GREEN.

Артефакты браузера в ignored `test-results/kanban-render-isolation/3c212732-8a4a-4e34-91f0-71bd0141ed10` и `test-results/product-card-navigation/6553c95a-6b7d-4ed4-a0d6-4d2b8c1723a2`.

## Guarded native local 5433: PASS с обязательным rollback

Основной агент выполнил reviewed ignored runner `.playwright-mcp/kp-181/proposal-native.ts` на существующей разрешённой БД `pero_crm`, loopback 5433. Проверены исходники, ветка/базовый SHA, точный контейнер и запись применённой миграции №180. Runner не поддерживает постоянное применение миграции. Внешние эффекты, dispatch/уведомления и обращения через singleton Prisma вне переданной транзакции блокируются.

- План запуска: `46ff8e0c60ecb36726f3983364c9702b964200c2bfbe67519f2ea80798ecbace`.
- SHA256 runner: `baeeae23395b34563c7702e7e98465349875085e482c823bb1af739422d2d221`.
- SHA256 миграции №181, LF: `a43ef108e3cbbb71cd249807b64462cbfc4f00ca2dd014d28fa86a29bb4a658d`.
- Проверенная запись №180: checksum `1dd319ff01ca341bac362a576f7ed298e2facff08c54791156a72bf7877560fe`; запись №181 до и после проверки отсутствует.

В единственной внешней interactive-транзакции временно выполнено точное тело миграции №181: сняты только проверенные внешние `BEGIN`/`COMMIT`, проверены checksum и allowlist всех 11 команд. Вызван настоящий `verifyProposalCompositionNative` с собственным синтетическим актёром и клиентами. Проверены создание проекта и КП, номер MAX+1, defaults/history, количества, повтор запроса без второй записи, мягкое скрытие CRM-only и удалённых позиций, восстановление прежних ID/назначений/истории, перестановка позиций 1↔2, восстановление реквизитов клиента из снимка, no-op receipt/timestamps, LEAD guard и полный откат ошибочных create/save без расхода номера. Ценовой DI-hook вызван 8 раз; денежные формулы №182 этим запуском не проверялись.

Все пять SQL-проб на собственных строках завершились ожидаемым отказом:

- Перепривязка ProposalItem к изделию другого проекта: `23514`, `KP181_ITEM_PROJECT_MISMATCH`.
- Смена проекта связанного Product: `23514`, `KP181_PRODUCT_PROJECT_MISMATCH`.
- Смена проекта CommercialProposal со связанными изделиями: `23514`, `KP181_PROPOSAL_PROJECT_MISMATCH`.
- Коллизия активного номера Product: `23505`, `Product_number_active_key`.
- Нулевая позиция ProposalItem: `23514`, `ProposalItem_position_check`.

SQLSTATE и разрешённый marker получены через `GET STACKED DIAGNOSTICS` во временной `pg_temp`-функции; каждая проба и сама функция находятся внутри откатываемой транзакции. Неожиданный успех любой мутации приводит к отказу проверки. Сырые ошибки и бизнес-строки в лог не выводятся.

Дополнительное второе соединение в read-only-транзакции подтвердило, что `pg_try_advisory_xact_lock(18435,55001)` не получает уже удерживаемый общий mutex. Это проверка общей блокировки, **не проверка параллельного создания** двух проектов/КП.

Обязательный private sentinel откатил миграцию и все синтетические записи. Полный `nativeSnapshot` всех **76 таблиц**, включая историю миграций, и каталога ограничений/функций/триггеров/индексов совпал до и после:

`aead300a6d8f82454ea96a270db758f59af323ca55635f34eedb700ed6831692`.

В этом первоначальном rollback-прогоне миграция №181 **постоянно не применялась**, её receipt после отката отсутствовал. Это историческое состояние, не описание текущей local БД после последующего разрешённого применения. Дампы, reset/seed, новые БД/контейнеры и S3-операции для этой проверки не использовались.

### Последующее постоянное применение local по разрешению владельца

После отдельного разрешения владельца основной агент постоянно применил №181–183 на существующей guarded local БД 5433. Сохранён receipt `.playwright-mcp/kp-183/apply-result-d52c92b7-fa72-4e39-8ff3-36cde052f31a.json` в worktree kp-183, статус `passed`, source plan `2fea3d8dff3608da329dadf57c9f56cc608bfa563a0a7f2e777ba9da6e5ac9a3`.

Receipt содержит **83 применённые миграции**, `pending: []`, **76 таблиц**, 11 пустых таблиц КП; это не 83 таблицы. Checksum применённой №181 — `a43ef108e3cbbb71cd249807b64462cbfc4f00ca2dd014d28fa86a29bb4a658d`. Проверены сохранность остальных бизнес-данных, ровно предусмотренное преобразование `Notification.link` с номера на ID, неизменность старых migration rows и точное изменение каталога. Четыре ранее учтённых исключения исторических checksum сохранены; history acceptance SHA256 `ab7ee32998320ccc057532e3222439c6b2e3f6f8ee10165f3aab4b22a4afd4ce`, post-catalog SHA256 `805b1dddc7a974baf129f63ba4fca19245e5a411b5756850f8cddea54f1d5738`.

### Предыдущий диагностический отказ

Первый запуск плана `0dbdf7a7b72dcc3042be95a61a3ea73ba352e399542c341b5f7281f5f0c06be2` прошёл временную миграцию, mutex probe и domain helper, затем остановился на `KP181_EXPECTED_TRIGGER_MARKER_MISSING`. Все 76 таблиц и каталог после обязательного rollback также совпали, receipt №181 отсутствовал. Этот запуск не считается PASS всех SQL guards. Узкое исправление диагностики заменило зависимость от текста Prisma `meta.message` на отдельные поля PostgreSQL `MESSAGE_TEXT`/`CONSTRAINT_NAME`, сохранив все пять точных ожиданий; повторный reviewed root-run указанного выше плана завершился PASS.

## Фактический staging №181: native и HTTP PASS

Основной агент принял следующий реальный runtime, не только исходники или CI:

- Staging SHA: `4c0ea2bf5a929bd0319bfe6d8795b7986a6e418f`.
- Web image: `sha256:fbdada454fb72a79dcec13f40f103580dba6647cc245b1e302d08354afe36d4d`.
- Guarded staging DB: `27b8f7342b9d722ab8788e137b37b03a3037442da038c5b8b98dbb30245b8b6a`, volume `crm-staging_pgdata`; приватный storage binding проверен, S3 I/O этот native runner не выполнял.
- Финальный bundle SHA256: `a9ad0ae625ab088b29f4e11845f98c02685238c50cfb6c75a50abf49c1fa8525`.
- Run ID: `af92ac26-c3f6-40d9-b2ff-28f5c2a53b78`.
- Receipt: `.playwright-mcp/kp-181/stage-proposal-a6b2556e-943c-4ad8-95b7-7fd7776f508f/captured-result.json`; `exitCode: 0`, `status: PASSED`.

Настоящий `verifyProposalCompositionNative` проверил весь перечисленный выше состав: все итоговые флаги `true`, количество 2, pricing DI-hook 8 вызовов. Это проверка domain №181, не денежных формул №182. Для ACL создан отдельный настоящий пустой КП со своим синтетическим «Временным» через core в той же транзакции. Проверены 11 вариантов ролей, реальные joins четырёх видов сущностей (изделия, задачи, работы, файлы), четыре способа отзыва/возврата связанного доступа и отсутствие MANAGER-доступа к соседнему CRM-only черновику.

Вся синтетика находилась в единственной обязательной rollback-транзакции. Все **76 таблиц** и каталог ограничений/функций/триггеров/индексов после неё совпали точно; baseline digest:

`60cd95db3922f07f9b9a458ee717c024014c41960d256ae1ea872ded02a19afc`.

11 таблиц КП остались пустыми, проверены применённые receipts №180/181 с точными checksum, `PERO_KP_ENABLED` выключен. Tripwire-счётчик равен **0**, `hits: {}`: singleton вне TX, fetch/http(s), dispatch/уведомления и cache effects не вызывались. Runtime dependencies: Prisma Client 6.19.3, Zod 4.4.3. Миграции или настройки production этим запуском не менялись.

В `http.json` той же папки сохранены реальные ответы **200** для `/api/health` и `/login`. Это HTTP smoke, не браузерная приёмка интерфейса на deployed staging.

Финальный [CI №286, run 39135807820](https://github.com/navasiolau/pero_crm/actions/runs/39135807820) завершил все 6 jobs со статусом SUCCESS: PostgreSQL domain **75/75**, HTTP/S3 suite PASS и остальные cohorts PASS. В native CI прошёл `kp181/shared-project-quote-allocation-real-advisory-waiter-and-repeated-request`: две реальные записывающие транзакции, общий allocator обычного проекта и КП, ожидание advisory lock и повтор операции без второго КП/события. Однотранзакционный staging runner этот параллельный сценарий не запускал; его собственное `parallelCreate: NOT_TESTED` не переименовано в PASS.

### История неуспешных staging tooling-прогонов

Эти попытки сохранены отдельно от финального PASS:

1. Первоначальный runner вернул `KP181_STAGE_NATIVE_FAILED`, а общий транспорт потерял failure body при nonzero exit. По этому выводу точная причина и сохранность не объявлялись установленными.
2. Bundle `19d666ee4e226c8b75b9ea424ffe7fdd30307d983927accfa976be1c3d51ce0e`, receipt в `stage-proposal-7ee8e3a7-c51b-4c6a-ab0b-83f5636c3fb0/captured-result.json`: FAILED на `native-acl-fixtures`, rollback preservation EXACT. Это не PASS native приёмки.
3. Bundle `5490e93474e0072ee9b31979a5fcb08a58f36e0dbb2e05f07e6f603c23796840`, receipt в `stage-proposal-d0293483-3884-4da7-96a3-6a36a284ef7a/captured-result.json`: AggregateError, `failedOperation: native-composition`, `preservation: NOT_CHECKED`. Тогда сохранность отмечалась только после дополнительных guards; NOT_CHECKED не устанавливал, что изменились данные. Попытка осталась FAILED, её причины уточнялись безопасной диагностикой, без обхода guards.
4. После этого отдельная READ_ONLY-проверка `readonly-6940d074-7125-4d3d-abd8-c45d4d97998e/receipt.json` получила PASS: за 15 секунд оба снимка 76 таблиц имели digest `a92a906667ae9d04fd40c91058287a36ec64449fe62606b227bcff80f084588a`, каталог неизменен, 11 таблиц КП пусты, склад ACTIVE, workers и KP flag выключены. Это доказательство стабильности в отдельном read-only окне, **не PASS предыдущей записывающей попытки**.
5. Исправлена только QA-диагностика: безопасные отдельные причины AggregateError, закрытые имена ошибок/аргументов и tripwire labels, diff счётчиков/hashes. Фактический preservation теперь устанавливается сразу после равенства снимков, независимо от последующих guards. QA-transform перестал заменять pure `orgRolesFor`, `receivableTypesFor`, `isOrgType`, `NOTIFICATION_TYPES`; блокируются только внешние mutators. Это исправление tooling, не изменение production.
6. Bundle `f1b4f4d7caf67d63c03c4365d2d61dca40a5655785f6c601703f19a1dd773386`, receipt в `stage-proposal-4677bda5-f779-47da-b091-83e842f145bb/captured-result.json`: FAILED на `native-acl-work`, preservation EXACT, tripwires 0, diff таблиц/каталога пуст. Основной агент установил несоответствие новой Work-фикстуры существующему `Work_stage_payment_complete`: для LEGACY требуются ценовые снимки. В ignored fixture явно заданы `paymentKind: LEGACY`, `quantityPerUnit: 1`, `priceSnapshot: 1`, `total: 1`; CHECK, domain source и scope не ослаблялись. После этого финальный bundle `a9ad0ae6…` прошёл фактический staging, как указано выше.

### Оставшиеся сценарии и границы приёмки

- Native joins и отзыв доступа приняты на реальном staging; это не замена браузерных сценариев чтения карточек, поиска, файлов и навигации через развёрнутый UI. Deployed browser-приёмка объединённой ветки остаётся pending.
- Параллельный общий allocator и replay приняты в PostgreSQL CI. На этом первоначальном этапе сохранение КП одновременно со сменой этапа через общий lifecycle/API оставалось pending после интеграции №185/187; последующее закрытие 4.5 зафиксировано ниже 20.10.2026.
- Денежные формулы, media/render/version/contract/API/retention/import последующих changes этим №181 runner не принимаются. Публичный раздел остаётся выключен до сквозной приёмки; разрешение владельца на коммиты/staging №181–189 не заменяет результаты оставшихся сценариев. Main/production-выпуск и production-миграции не выполнялись в рамках этой приёмки.

## Исправления после независимого ревью

Первый staging CI №284 (`4b9f80acd721336936f01cea5c63e2b8c442ced3`) не принят: component cohort 0 получила 62 PASS / 1 FAIL. `project-filter-component.test.mjs:257` ожидал прежние семь статусов и отсутствие «Черновика» у MANAGER; после согласованного доступа к связанным черновикам реально доступны восемь. Исправлены ожидания числа/наличия и сценарий выбора всех восьми статусов с очисткой фильтра. Проверки остальных осей, ролей и прав не ослаблены. Образ этого CI не опубликован; успешная локальная проверка и повторный CI фиксируются отдельно.

Native-набор того же CI получил 73 PASS / 2 FAIL: старый promotion-сценарий ожидал перевод удалённого черновика в PREPARATION, а новая ACL-фикстура создавала недопустимый `state: {}`. Ожидания исправлены по согласованному правилу сохранения скрытой истории: удалённый черновик остаётся DRAFT, не получает statusHistory/event; живой перевод проверяется как прежде. ACL-фикстура получила допустимый пустой состав `{items: []}` без ослабления CHECK. Браузерный `project-filter-component` после исправления прошёл все 7 сценариев локально. Последующий финальный native-набор CI №286 прошёл 75/75; исходные два отказа сохранены в истории.

Повторный CI №285 (`888625871152d97cd0e266177778ce53c49bdf08`) прошёл все три unit/browser cohorts и PostgreSQL domain-набор, включая настоящую параллельную выдачу общего номера. Публикация снова заблокирована: HTTP/S3 sketch-сценарий искал уведомления по прежнему `/products/{number}`, тогда как сервер уже создаёт согласованные стабильные ссылки `/products/{id}`. Обе выборки уведомлений переведены на ID; проверки точного состава получателей, запрет повторных effects, загрузки, CAS и физической очистки сохранены. HTTP-проверка доступа по прежнему числовому alias оставлена для обратной совместимости. Этот промежуточный CI не объявляется успешным; конечные результаты CI №286 и фактического staging зафиксированы выше.

Ревью выявило три блокера до native приёмки. Фикстура теперь моделирует настоящий `CHECK position > 0` и `UNIQUE(proposalId,position) WHERE deletedAt IS NULL`: исходное создание дало RED на CHECK, после перевода в 1-based перестановка отдельно дала RED на partial UNIQUE. Окончательная реализация сначала освобождает активные позиции положительными свободными слотами вне 1…N, затем пишет конечные позиции. Все ID и ссылки сохраняются.

Product читается только после `FOR UPDATE`. Shared warehouse lock всегда берётся раньше Product lock; фазу FROZEN/VERIFYING проверяем после заблокированного чтения только при необходимости пересчёта количества. Общее `warehouseMetadataGate` использует те же выделенные примитивы. Текстовая no-op правка при заморозке допускается, а изменение фактического количества перед Product lock приводит к guarded пересчёту либо полному откату.

Focused domain/client на этом этапе: 23/23, ESLint изменённых файлов — PASS. Native helper дополнен реальной перестановкой позиций 1↔2 и проверкой сохранённых значений; позднее этот helper успешно выполнен основным агентом в guarded rollback, как зафиксировано выше.

## 20.10.2026: интеграционная приёмка 4.5

Root принял совокупное доказательство CORE23 + AI01 + CI306 для staging
`acbd164cb6e79194b7fe87a0469d60d745dead1a`, web image
`sha256:8ef120a68e378d47b71ea5913ec8bd85391cfa4f2f8cd1ec25169151a55bd77f`.
Пункт 4.5 закрыт; browser 4.4 и прочие незакрытые gates этим решением не принимаются.
Далее `Q180` — `kp-180/.playwright-mcp/kp-integration`, `Q187` — `kp-187/.playwright-mcp/kp-187` в сохранённых worktrees.

- CI306 / run `39290284146`, attempt 1, все семь jobs SUCCESS:
  `Q180/ci306-green-d89592a4-086f-479a-9a6e-f08d285db47d.json`, SHA256 `42974641842e010620a4116ba4ac433f119740754576507cfc986c69c95c68a4`.
  Cases `kp185/proposal-save-vs-lead-exit-save-first-real-advisory-waiter` и
  `kp185/proposal-save-vs-lead-exit-stage-first-real-advisory-waiter` используют два настоящих PostgreSQL PID, advisory waiter и `Project FOR UPDATE`.
  Save-first обновляет revision и отклоняет stage exit со старым PDF; stage-first принимает этап и отклоняет save без изменения КП/позиций/истории/receipts. Повторы оставляют полный native snapshot неизменным.
- CORE23 actual API: `C01-empty-temporary-and-identical-replay`, `C04-reorder-remove-restore-stable-product-history`, `CAS-conflict-no-implicit-version`,
  `V01-V02-real-issued-PDF-history-and-explicit-restore`, `D01-D03-multi-source-DOCX-consistent-publish-and-transition`,
  `L02-locked-write-denial-raw-state-denial-contract-editable`. Принятие CORE4 и закрывающая классификация:
  `Q187/full23-closure-classification-be523ee8-ff2a-46ea-899d-ae01cdc27605.json`, SHA256 `2f53ae84561c8e8172e047695cac9818751b8ad2cc2a965cf352a84fb28555ec`.
- AI01 actual SDK PUT: `AI01-SDK-confirmed-identical-UUID-replay` и `AI01-SDK-real-stale-409-no-effect` — PASSED;
  одинаковые operationId/body вернули HTTP200, stale — HTTP409, native REPLAY/STALE — VERIFIED.
  `Q187/ai-acceptance-run-e85c0578-026c-4a56-af59-9d2c49cefff9/result.json`, SHA256 `4e79ee2a3e5a5ed01fbefed8032e2f78ce4c8c4ffeaf9a5a0505f7e553c0132f`;
  Root acceptance `Q180/full4-acceptance-b784fa50-5efa-43ab-856e-7f6aa67e0baa.json`, SHA256 `dd7aad274eb93899f2a224c1bdc376f26aed956fbdad4fff416db0665baa31fa`.

Связь доказательств: API `api-documents.ts:195–196` вызывает тот же `saveProposalInTransaction`, что и CI race; lifecycle использует общий `patchProjectStageTransaction`.
Это составное доказательство, не concurrent HTTP test. В двух CI cases pricing hook заглушён (`changed:false`); одновременные HTTP save↔stage с реальным финансовым DML не наблюдались и не объявляются принятыми. Root не вводит такой дополнительный gate. Исторические HOLD и отдельные ограничения прежних receipts сохранены.

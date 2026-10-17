# Staging-приёмка №179

**PASS_SCOPED_WITH_EXPLICIT_COVERAGE_LIMITS.** Принято настоящее canonical создание материала через оба purchase entrypoints, общий MaterialDialog каталога, actual server-props refresh, сохранение draft и вложенная отмена. Задача 3.3 закрыта в указанном scoped объёме; документы/другие роли/UNKNOWN и остальные local-only границы перечислены ниже.

## Runtime и два reviewed прогона

- Source: `0d399e96d56010b05cd8f4df077aef03a7064e05`.
- Image: `sha256:0f89f9de9c0e8a4ee0437a4e443a41784e0a173c3e429ce42a266974c8f2b189`.
- Remote QA bundle обоих runs: `4ed50f0328e83a32f48abadb471b01cbc243707ce335a23255ce408a260138c9`, 174035 bytes.
- Root identity: `D:/Projects/pero_crm_v2/.playwright-mcp/application-improvements/staging-0d399e96-identity-0c6c79bb-7ede-4c12-88c5-8042bacc962e/identity.json`.
- Private evidence root: `D:/Projects/pero_crm_v2/.playwright-mcp/requests-171-179/staging178179/`.

| Run | Настоящий material create | Producer | Результат |
|---|---|---|---|
| `6cbccff5-d00a-42df-a78b-f09090146cf2` | org-stock, из расходов | `00c651bd4bfac94f6f7aa7dcdb03753583fb87311fb54da084b53a4e4420257f` | Scoped PASS; статья и материал созданы через UI и DB-confirmed, exact cleanup и independent inspect завершены |
| `13ae6a94-379e-47b4-9ad9-5a7614a97cef` | warehouse-stock, со склада | `183badc267f01eef7fc954f5c3b8c8ba80ffc908ce60549846ec8e3ff4a90f75` | Scoped PASS с теми же проверками |

Root сменил только reviewed executionPlan location после полного завершения/очистки первого run. Producer files, immutable source closure, UI/action source hashes, identity, parser, local proof и guards идентичны; `warehouse-plan-root-review.json` и его digest включены в JSON. Во время активного run controller/pins не менялись.

В каждом run 28 check records: **27 PASS + один плановый NOT_RUN server-create противоположного material entrypoint**, где проверялись canonical selection/cancel. Противоположный create покрыт вторым run. Итого 56 records, 54 PASS, два взаимно дополняющих NOT_RUN; положительное серверное создание материала доказано **через оба entrypoint**. Статья реально создана из расхода организации в каждом run. Всего четыре own dictionary writes (2 article + 2 material), все точно очищены.

## Действия, props и черновик

Реальные действия `addExpenseArticle`/`addMaterial` вызываются UI с существующим настоящим ADMIN. Существующие units/active categories выбраны из приложения; пользователей, ролей, единиц, категорий и warehouse state runner не создавал и не менял. Native/role/FK/rollback проверки описаны в [evidence.md](evidence.md).

Перед пропуском ответа браузеру fsync ledger фиксирует ISSUED/ACK и отдельный guarded READ ONLY confirm: canonical result, full scalar row, весь entity audit chain с actor/source/newValue и FK0. Исключив только эти точные own IDs, остальные данные/каталог уже должны совпасть с baseline. Поэтому само создание справочника не создаёт payment/payout/stock/warehouse balance.

В обоих runs есть по четыре фактических server-props proofs: статья и материал из **action Flight.f и реально пришедшего refresh GET**. JSON reader стартует от f и проверяет option в props нужного panel; ACK.a сам по себе proof не даёт. Response буферизован до fulfill, доставлены те же bytes. Проверка не создаёт искусственный GET и не зависит от наличия обоих transport shapes; здесь оба реально наблюдались. После доставки/закрытия child и завершения UI update строгий snapshot подтвердил сохранность всех полей, кроме ожидаемого canonical выбора.

Фактический manual draft по reviewed PNG: **USD**, касса USD, тестовый ручной rate **0.037**, amount **12.34**; stock quantity **2**, unitPrice **3.45**, total **6.90**, operation date **2026-10-17** и комментарий сохранены. Это проверка удержания тестового ввода без проведения оплаты, не проверка пригодности такого курса для настоящего расчёта.

На desktop 1440 проходят child cancel/create/refresh, оба stock entrypoint и общий MaterialDialog каталога: canonical row открывается, accounting price readonly, cancel не создаёт третью запись. На 390 dark и 360 light проходят настоящие theme-toggle, parent/child cancel и layout checks; document/dialog horizontal overflow 0. Сохранены **26 PNG**. Root отдельно просмотрел `org-expense-after-article-refresh.png`, `org-stock-after-material-refresh.png`, `mobile-390-material-cancel.png` первого run и `warehouse-stock-after-material-refresh.png` второго — visual PASS. Просмотр всех 26 снимков не приписывается.

## Очистка и независимая сохранность

Cleanup выполняется после закрытия своего браузера только для полного known ACK+CONFIRMED chain. В одной guarded transaction блокируются точные own PK rows/audits, повторно сравниваются full rows и все entity audits, проверяется отсутствие входящих FK; удаляются только captured article/material/audit IDs. Unknown ACK, изменённая row, лишний audit или FK означают HOLD без guessed delete.

В обоих runs exact own cleanup — PASS; независимый final READ ONLY inspect подтверждает **все 65 STABLE таблиц и schema catalog constraints/functions/triggers/indexes**. Own article/material/audit IDs после очистки отсутствуют. Полные fingerprints тоже сохранены: `fullUnchanged=false` честно отражает **только** допустимый forward `ApiToken.lastUsedAt`; его before/after/idHash записаны отдельно. Остальные поля ApiToken и все прочие данные совпали. Ошибок браузера, denied requests и cleanup failures нет.

Обезличенный [staging-qa.json](staging-qa.json) содержит оба receipt summaries, exact provenance, stable/full digests и SHA-256 восьми evidence artifacts каждого run. Actual пользователя/касс, raw RSC, credentials/JWT, headers и PNG в change не копируются; собственные случайные QA IDs оставлены для связи с private cleanup proof.

## Явные границы

1. Новый FinanceDocument на staging **NOT RUN; coverage LOCAL_REAL_COMPONENT**. Штатного unlink/delete нет, поэтому новый QA PDF/S3 объект не загружали. Документ/documentId preservation проверен ранее настоящими локальными компонентами с external upload boundary. FileList-only/DOM fake probes не используются как staged evidence.
2. Project inline-create статьи, manual/conflicting codes, отсутствующие/неактивные unit/category, negative/combined роли, ошибки, UNKNOWN/blocked и mutation ID имеют local unit/DI/native/CI и настоящее компонентное покрытие из evidence. Эти staged runs используют существующего ADMIN и не выдают его за runtime-тест всех ролей или все отрицательные сценарии.
3. Не проводились payment/payout/stock/logistics submit, payout preview либо logistics save/post. Платежи и исторические финансовые факты не переписывались. Main/production/infra/restic/dump/reset/seed/import и новые БД не затрагивались.
4. Приёмка закреплена за указанным SHA/image; более поздние code changes требуют соответствующей повторной проверки. Документирование результата не является продвижением в main или production.

Прочитаны/соблюдены [SAFETY-RULES](D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md): STOP при target guard mismatch. Root исполнял serial staging QA; агент менял только документацию локально, без commits/remote и с сохранением чужих изменений.

## Сохранённые исторические HOLD

- `run-0826f264-059e-413d-bdfa-546e144a5a04`: одна статья действительно создана/подтверждена, но старый QA observer потерял unrelated RSC body (`Network.getResponseBody ... navigated away`), затем обязательный GET wait истёк. Статья/audit точно очищены, 65 stable/catalog сохранены, forward ApiToken.lastUsedAt +60 секунд отдельно. Материал в том run не создавался.
- `run-668cd124-25e5-4d92-9aeb-5c96909028c0`: ноль events/writes, неограниченный QA `Response.finished()` после headers. Root подтвердил место по stack, закрыл только собственный Chromium child для catch/finally; independent before/final inspect подтвердили all 65 stable/catalog и own rows/audits0. Это не объявлено дефектом CRM или FX provider.

Old receipts/errors/locks не переписываются и не переименовываются в PASS. Устранены только private QA capture/FX-wait defects с source-grounded bounded UI-settled check, microphase diagnostics, малыми local proofs и независимым review. Source приложения при этих исправлениях не менялся.

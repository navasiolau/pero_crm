# Staging-приёмка №175

Итог: **PASS_AVAILABLE_SCENARIOS_WITH_EXPLICIT_GAPS**. Оркестратор принял восемь доступных форм на реально развёрнутом staging. Массовая выплата осталась `NOT_TESTED_DISABLED_BY_REAL_DEBT_OR_BALANCE_GUARD`; новый документ на staging не загружался. Это приёмка начального выбора, ручной смены и открытия форм, без проведения денежных операций.

## Закреплённый runtime и evidence

- Source SHA: `0d399e96d56010b05cd8f4df077aef03a7064e05`.
- Image: `sha256:0f89f9de9c0e8a4ee0437a4e443a41784e0a173c3e429ce42a266974c8f2b189`.
- Run: `70c7e823-b77c-4769-8368-8ba6ed8082f4`.
- Identity: `D:/Projects/pero_crm_v2/.playwright-mcp/application-improvements/staging-0d399e96-identity-0c6c79bb-7ede-4c12-88c5-8042bacc962e/identity.json`, SHA-256 `7f8bd9c91f899f2688de9e0814b8e3f5bbb1a3ac666c0af63fffbc9f3389342c`.
- Private run directory: `D:/Projects/pero_crm_v2/.playwright-mcp/requests-171-179/staging175178/175/run-70c7e823-b77c-4769-8368-8ba6ed8082f4/`.
- QA bundle SHA-256: `e5ce94f3000887fec97ce7c9abb7d4bf92008ff543245ef468a142d40f8420a2`; producer SHA-256 `6cdba7315493e227e2fd55f400dbe5fd5d61dd4c28d478ab5666c02d4ab7e006`.

Обезличенный [staging-qa.json](staging-qa.json) фиксирует результаты, ограничения и хэши `receipt.json`, `baseline.json`, `restore.receipt.json`, `final-readonly-inspect.json`, `bundle-provenance.json`. Имена/ID реальных пользователей и касс, credentials/JWT, содержимое строк и screenshots в change не копируются. Private screenshots остаются в run directory.

## Native и одна настройка через UI

Reviewed transport проверил outer host/web/revision/image, неизменённые DB ID/volume/W07, DSN `db:5432/crm` и actual `crm/public`. Использован реальный существующий ADMIN с текущими roles/sessionVersion, без создания или изменения пользователей/прав.

В rollback-транзакции настоящий helper `default-cash-native.ts` проверил сохранение setting/audit, ролевую границу, stale revision, атомарную деактивацию и реальный SQL rollback. Все пять checks — PASS. Проверки конкурентных соединений на local 5433 описаны в [evidence.md](evidence.md); staging-результат не подменяет их имитацией.

Браузер выполнил **один настоящий UI CAS** назначения существующей активной RUB-кассы, отличной от исходного назначения. Canonical ACK записан fsync и подтверждён отдельным read-only DB inspect: исходные entity audit IDs плюс ровно один собственный audit, точные actor/action/source/oldValue/newValue и current value/updatedAt. Нет прямого SQL назначения вместо UI.

## Формы

| Сценарий | Фактический результат |
|---|---|
| Приход организации | PASS: default RUB, ручная BYN-касса, сохранение суммы/даты/комментария, cancel/reopen возвращает default и пустой ввод |
| Расход организации | PASS: те же проверки |
| Расход существующего проекта | PASS: те же проверки |
| Закупка из расходов организации | PASS: default/manual, quantity/unitPrice/сумма/дата/комментарий, cancel/reopen |
| Закупка со страницы склада | PASS: те же проверки |
| Зарплата | PASS: default RUB, manual BYN, предусмотренная формой очистка суммы при смене валюты, сохранение комментария, cancel/reopen |
| Аванс | PASS: те же проверки |
| Логистика | PASS: default RUB и currency label, manual BYN с сохранением суммы, close/reopen; списание без состава/ТТН disabled |
| Массовая выплата | NOT TESTED: реальный debt/balance guard держит «Рассчитать всех» disabled; guard не обходился |

Использованы реальные UI actions и props, без вызова обработчика напрямую. Action IDs разобраны по одному `createServerReference` AST call, не regex по соседним factory calls. Native Select проверялся по точному `select-value`, SearchableSelect — по собственному выбранному span. Modal screenshot/close/reopen ограничены `dialog-content` и полем/заголовком, поэтому ending popover не подменяет форму.

Успешный staging-run выполнен на desktop 1440×1000. Отдельное staged mobile/обеих тем покрытие этим run не заявляется. Предыдущие настоящие компонентные браузерные проверки и их пределы сохранены в [evidence.md](evidence.md).

## Сохранность

После закрытия браузера guarded reverse CAS восстановил исходные setting value **и updatedAt** либо исходное отсутствие строки. Удалён только подтверждённый собственный audit. Полный набор entity audit IDs снова совпал с baseline.

- **Все 65 таблиц FULL и STABLE неизменны**, включая новую Counterparty; schema catalog constraints/functions/triggers/indexes совпал.
- Full digest before = after: `a6f9d563ddc7ec892f381a0946aaf1e9fbf8d437644c8e76e3b73e56d9f15228`.
- Stable digest before = after: `bbe0ce10eddb2bb35d619df80c43e5898d977e72bde09c97ac20abf16cbedecb`.
- В этом run даже допустимого forward drift `ApiToken.lastUsedAt` нет: `tokenDrift=[]`.
- Отдельный финальный READ ONLY inspect подтвердил stable maps, original setting и все entity audit IDs; собственных native QA-касс осталось **0**.
- Browser errors, denied requests и cleanup/inspect failures: **0**.

Не выполнялись money submit, payout preview, складской приход, logistics save/post, upload/S3, reset/seed/dump, правки production/main/инфраструктуры. Прочитаны и соблюдены [SAFETY-RULES](D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md); target guard mismatch означает STOP. QA выполнялся оркестратором последовательно, без отключения W07 или обхода его busy guard.

## Явные границы покрытия

1. **Positive mass на staging не проверен.** Настоящий массовый компонент с default/manual/reopen покрыт локальным компонентным harness; disabled production-data guard на staging не превращается в положительный PASS. Для положительного staged сценария требуется подходящее разрешённое состояние данных, без искусственного изменения долгов/остатков в этой задаче.
2. **Новая загрузка FinanceDocument на staging NOT RUN; coverage LOCAL_REAL_COMPONENT.** Обычного unlink/delete нет, поэтому новый QA PDF/S3 объект не оставляли. FileList-only/DOM fake probes не использовались для утверждения о `documentId`. Локальный настоящий компонентный harness проверяет сохранение документа и restored command, как указано в evidence; server upload/S3 lifecycle на staging этим change не принимался.
3. **UNKNOWN/recovered intent и изменение справочников во время заполнения** покрыты локальными реальными компонентами и unit/DI, не отдельной staged денежной отправкой. Платежи, выплаты и исторические денежные факты этим run не создавались и не переписывались.

Все четыре требования OpenSpec имеют реализацию и local/native coverage; staging подтверждает доступные начальные/ручные сценарии. Задачи 9/9 выполнены в зафиксированном scoped объёме. Неизмеренное покрытие выше остаётся явным ограничением, а не доказательством сбоя CRM. Продвижение в main/production этой записью не выполняется.

## Сохранённые предыдущие HOLD

В private каталоге сохранены без переписывания receipt/locks:

- `run-fa35e839-e951-41e9-ac47-301627326293`: ранний UI timeout, 0 setting writes; старый stack отсутствовал, причина не объявлена доказанной.
- `run-934c503a-12a0-4422-ad07-25f30f0eb71e`: UI POST заблокирован до forward ошибочным action-ID scanner, 0 setting writes.
- `run-7ff72af5-5fbf-44a3-9ba4-bd61951e2c6f`: read-only диагностика подтвердила соседний factory-ID; исходные данные сохранены.
- `run-360f4fc1-f45f-4b69-b1ee-763b12e42297`: один UI CAS восстановлен; QA trigger assertion получил `RUB▼`; дополнительный inspect остановлен штатным W07 busy. Последующий отдельный `root-independent-inspect-after-w07-busy.json` подтвердил сохранность, старый HOLD не переименован в PASS.
- `run-d54b8619-9145-42f0-b17d-e08a74ec0c77`: первые пять форм PASS, salary screenshot встретил второй role=dialog от ending popover; exact restore и independent inspect подтвердили сохранность.

Исправлены private QA scanner/readiness/value/root-modal selectors с независимым review и локальными реальными browser regressions. CRM source ради этих QA исправлений не менялся. Итоговая приёмка относится к отдельному успешному run 70c7e823, предыдущие HOLD остаются свидетельствами ограничений прежнего harness.

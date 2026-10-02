# Tasks

## 1. Официальная база после №16

- [x] 1.1 После фактической staging-приёмки №16 сверить fresh origin/staging и последующие изменения, создать feature/17; проверить baseline SHA, official OpenSpec validate/status и сохранность чужих изменений. База implementation — 44281e4f229a9d655b70f0f73151413af66296f8, отличия от принятого 9fb844f только QA/документы.
- [x] 1.2 Сверить реальные product update consumers (product-header, server actions, status-core/quantity-core, имеющиеся API) и shared client/project callers; сохранить карту конкретных операций/compatibility contracts с доказательством отсутствия обхода нового CAS.

## 2. Контракты и домен

- [x] 2.1 Создать закрытые typed patch/result DTO и RED tests unknown field, null/zero, money decimal, quantity/title validation; проверить падения поведения до implementation и отсутствие raw Prisma/any в DTO.
- [x] 2.2 Извлечь create/update product business core и тонкие actions, общие validation/role/BYN helpers; проверить GREEN существующих product-engineering-products/product-quantity-actions/engineer-access-actions и новые DI tests прежних правил.
- [x] 2.3 Реализовать field CAS/receipt в транзакции с audit/outbox; проверить RED→GREEN two-user same-field race, разные поля, replay same ID, reused ID foreign payload, no-op без audit/event и rollback при audit/outbox failure.
- [x] 2.4 Вызвать quantity-core и status-core через профильные операции без изменения норм/оплаты; проверить tests issued/allocation нижних ограничений, пересчёт один раз, frozen snapshots/no duplicate и актуальную role/status проверку.
- [x] 2.5 Реализовать ограниченные shared Project.clientId/address и Client.phone операции, expectedClientId CAS, reuse client core; проверить race смены клиента/телефона и два изделия общего проекта, разрешённую client selection и исправление standalone Client CRUD write-gate до MANAGER_ROLES согласно AGENTS.md; ACCOUNTANT/чистый ENGINEER остаются readonly вне technical блока, MANAGER+ENGINEER сохраняет запись. Конфликт привязки отдаёт менеджменту currentClientId/label/phone без writes и UI требует явный rebase.
- [x] 2.6 Перевести существующие product update callers на shared core/действительные baseline либо stale-form отказ; защитить contactBaseline старой общей Project формы и адресного бота. Unit и real-DB rollback доказали отсутствие full-object обхода CAS и выполнение отказа до записи. Не подставлять текущие server values вместо клиентского baseline.

- [x] 2.7 Проверить обязательный phone contract: пустая/пробельная новая правка даёт field error без записи; валидное исправление legacy "" допускается с exact expectedValue="" и expectedClientId. GREEN tests подтверждают прежние phone schema/значения без миграции; existing optional address/engineer/description/price нормализуют пустое в null.
## 3. Общая клиентская механика

- [x] 3.1 Создать scheduler/reducer и useInlineSave без зависимостей; проверить RED→GREEN Enter+blur dedupe, no-op, queued latest, slow response vs new draft, отказ/потерянный ответ+тот же ID, конфликт без потери ввода.
- [x] 3.2 Создать маленькие reusable Input/Select/Textarea поля с state/error; проверить keyboard/focus и доступность соседнего поля при inflight; multiline Enter вставляет строку, save blur/Ctrl+Enter, нынешний размер/normalization сохраняется до №19.
- [x] 3.3 Подключить существующие product поля, current price/quantity lineTotal и shared client/address/phone с ясной принадлежностью данных; browser подтвердить one-field POST и compact response, никаких router.refresh/revalidatePath/revalidateTag/full card Flight на поле, включая косвенные вызовы compatibility wrappers; подтвердить network response и server query profile без getProductFor/экономики/истории и без success-toast и hidden initialPrice нового inline-writer.
- [x] 3.4 Подключить flush pending monetary fields и dirty существующих percentage panels перед status core; проверить failed save блокирует transition, successful queue flush предшествует status POST, черновики других полей доступны. Новых ставок/получателей не создавать.

## 4. Локальная и staging приёмка

- [x] 4.1 Проверить серверную матрицу MANAGER+ENGINEER, ENGINEER+ACCOUNTANT, assigned ENGINEER DESIGN, чистые WORKER/MOUNTER и stale-engineer after PRODUCTION; GREEN access tests и прямые action вызовы без раскрытия conflict hidden values.
- [x] 4.2 Запустить targeted tests, полный test/lint/typecheck/build по actual scripts и проверить diff; evidence содержит RED→GREEN и отсутствие новых dependencies/price migration/исправлений других задач.
- [x] 4.3 Лично пройти local браузер: keyboard, blur/select, slow/fail network, two-user same/different field, zero/null, changed client before phone, quantity/status flush; сохранить network evidence без full history/economics/FX чтения для title/phone.
- [x] 4.4 Проверить размеры 320×800,360×800,390×844,768×1024,1024×768,1440×900, sidebar/200%: новые controls/errors внутри области и нет page overflow; не объявлять эту visual приёмку по одному build.
- [x] 4.5 Атомарно коммитить только №17 по выданному разрешению, обычным merge в staging; после CI принять фактические SHA/образ/health и повторить targeted/browser/role сценарии. Принята ревизия6edd76ef2cee0b7ce40c5df4399ea9b7570b0728: native9/browser70/truezoom5 PASS, Web/бот healthy на том же SHA, исходные business/security поля сохранены, QA точно очищены. Night refresh/W07 сохранены; без reset/seed/дампов/restic.

## Future Scope

Main/production исключены из текущей задачи до tested staging. Другие номерные задачи плана не включаются. №16 фактически принят, feature/17 создана от свежего staging44281e4; planning validation и implementation/runtime evidence фиксируются раздельно.

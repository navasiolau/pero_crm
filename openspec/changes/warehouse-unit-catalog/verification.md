# Verification — warehouse-unit-catalog (110)

## Итог фактической staging-приёмки

**PASS / CLOSED**, 09.10.2026. Приёмку и cleanup выполнил оркестратор root; итоговая операция248cb0. Run: `3a7345bd-13d5-43ca-afea-6e499a6d8c42`. Фактически проверенная ревизия: `37f882f69a2d76901b98321ff7824d0d04db4db8`, образ `sha256:e59a361d87fb0acd84be943747375115f8aa014225b7dd8d5d39e95d693daf0f`. Physical receipt связывает healthy crm-staging web `5768bed77a88f6ce8309492c86082553801f06ce76c1d5d51a9200cc80b98959`, текущий PostgreSQL volume `crm-staging_pgdata` и неизменный внешний W07 guard.

Координатор прочитал реальные технические артефакты; эта запись не выдаёт source/local checks за staging acceptance. Исходник QA: `082a0a40dee62144d020243d23bb50882843c789`; bundle SHA256 `12e606e901f571afa7c487ae88771bae2b3101fb6b79ec38eb8eba74a12f0e74`.

## Проверенное поведение

- ADMIN: добавление и переименование единицы, удаление свободной единицы, три положительных контроля одинакового запроса add/rename/delete на каноническом compiled worker. Отмена подтверждения сохраняет единицу.
- MANAGER, ENGINEER и DIRECTOR: по три настоящих отказа для add/rename/delete. В журнале это явно **layer: route**: middleware закрывает endpoint настроек; callback requireRole отдельно проверялся локальными тестами, его исполнение этими отказами не утверждается.
- Использование единицы активным и неактивным материалом блокирует удаление. MANAGER меняет FK активного материала, DIRECTOR — неактивного; до последней замены единица остаётся используемой.
- Цены7.00, minStock3.000, quantity/norm2.000 и issued0.000 сохраняются численно. Новый справочник используется текущим селектором. Ранее принятый native migration proof сохраняет2119 исторических материалов и исходные обозначения/числа.
- Browser result: все checks `activeAndInactiveDenied`, `cancelDeletion`, `numbersPreserved` истинны; roles содержат три проверенные роли, sameWireControls — rename/add/delete. Фактически **44** запроса фонового getBellData прерваны без отправки на сервер; они не расширяют права или список разрешённых POST.
-19 зафиксированных действий,9 route-level отказов, pending0; неизвестных ссылок0. Реальные внешние данные, финансовые факты и схемы не менялись.

## Состав baseline и закрытие

Свежий подписанный PRE включал **54 public tables** и2119 исторических материалов. Во время этой приёмки в staging находились **приостановленные собственные fixtures задачи113**. Они являлись частью исходного baseline110 и сохранялись без изменений во всех original fingerprints до и после cleanup110. Это не утверждение, что база была свободна от других QA fixtures или что задача113 уже завершена.

`cleaned.json`: status CLEANED, allOriginalsPreserved=true. Точные оставшиеся собственные записи110 удалены по CAS/FK-порядку:7 ChangeLog,1 Client,2 Material,1 MaterialUnit,1 Product,3 ProductPercentageConfig,1 Project,1 ProjectMaterial,4 User. Ранее удалённые UI единицы уже отсутствовали; root подтвердил отсутствие всех собственных строк110. Никаких stock movements, денег, payroll, файлов/S3, дампов, restic или lifecycle операций110 не создавал. Fixtures113 не удалялись этой задачей.

## Точные evidence hashes

Каталог артефактов (ignored, без credentials): `apps/web/test-results/unit110-stage-3a7345bd-13d5-43ca-afea-6e499a6d8c42/`.

| Артефакт | SHA256 |
|---|---|
| pre.json | edc92e2cc5705388e3958382bcc2625d9490e054502ea444b5fedbf08bdca5f6 |
| checkpoint.json | 78dd979c9d633bb2fb2bb1b3a3136c6244e75e2272fbcd54db408c3a661fa9e1 |
| browser-result.json | 8daca23950eaf1ba4bab0c1d629559932449cace98fa7338bd2ed22bc6a48426 |
| capture-0023.json | 8e4a9714df3fc88f254bd85fb8d1295b7b1fe77001ad09092e19c106c0725f9f |
| journal-0038.json | d126873d30fe3227592fad6b514aa00d6892d1de2f786825c9d828a50ac5f7fc |
| cleaned.json | 002298c2ef2759369e80034bacfa2c16314887b922db8762c837afdf2ca2d3b2 |

## История и границы

Предыдущие попытки с dependency, compiled discovery, route/Flight и UI readiness ошибками сохраняют статус **FAIL / CLOSED**. Их ответы не переинтерпретируются как PASS; приёмка относится только к данному свежему run и фактической ревизии. Native/local и migration AFTER evidence описаны в validation.md/stage-crud-design.md; текущий итог supersedes их прежние пометки «staging pending» по времени, не переписывая историю.

В этом заключительном шаге изменены только tasks.md/verification.md; source QA, приложение, Prisma/SQL и guards сохранены. Новые тесты, аудиты, runtime/DB/HTTP/SSH действия не запускались. В main и production выпуск не выполнялся; staging/main интеграцией распоряжается владелец/root.

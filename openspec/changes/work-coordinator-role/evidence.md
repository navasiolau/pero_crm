# Проверка роли №121

Дата: 10.10.2026. Ветка `feature/121`, исходный staging `a491e974`.

## Выполненные проверки

- Один целевой `tests/work-coordinator-role.test.ts`: RED на настоящем server action `createPriceItem` («Недостаточно прав»), затем GREEN 1/1. Проверяет каталоговые права, запрет единственного дополнения и ADMIN/DIRECTOR комбинаций, базовую роль/домашний маршрут/видимость/оплату, отдельный доступ к прайсам, отсутствие финансовых/административных grants и отказ после снятия роли.
- После применения миграции оркестратором один `tests/work-coordinator-role-native.ts` на guarded существующем `pero_crm_pg`, `127.0.0.1:5433`. Только собственные QA-строки и обязательный внешний rollback.
- Native PASS: значение PostgreSQL enum присутствует; сотрудник WORKER+WORK_COORDINATOR создаёт и правит расценку; существующий Work сохраняет снимок 100, новый получает 125 и итог 250; аудит двух каталоговых операций сохранён; снятие дополнения запрещает изменение расценки; payScheme остаётся PIECE; MOUNTER+дополнение не получает PRODUCTION.
- Внешний rollback подтверждён отсутствием всех собственных QA User/Client/Project/Product/PriceItem/Work/ChangeLog. Исходные сотрудники и их данные не изменялись.
- `git diff --check` прошёл. Зависимости установлены offline/frozen/ignore-scripts, Prisma Client обновлён без изменения версий.

## Завершение стыка с №120

После принятия №120 (`d6d689f`, staging-кандидат `964bb18`) оркестратор обычным merge обновил feature/121 до `4afc9f69`. К `canCreateOrdinaryWork` добавлен только `hasWorkCoordinator`; `canAddProductWork` сохраняет draft guard и допускает дополнение вне field-status ограничения. Действующий core №120 внутри транзакции читает свежие роли и разрешает только `productVisibilityWhere` live resolved actor. Price picker и create-кнопка уже используют эти общие helpers.

Один дополнительный узкий `tests/work-coordinator-create-seam.test.ts` дал RED («Недостаточно прав»), затем GREEN 1/1. ENGINEER+WORK_COORDINATOR создаёт ordinary Work на own visible PRODUCTION (тариф 50, итог 100), получает price picker/create-флаг; чужое изделие и снятая роль отклонены до записи. Edit и TaskExecution для него остаются закрыты. Предыдущие role/native/payroll сценарии не повторялись; новой записи в БД для этого DI-теста нет. Update/remove/self-take не расширены дополнением.

Узкое чтение ordinary LEGACY работ без пула в уже видимом продукте реализовано; Product/Task/File grants и общие OFFICE/MANAGER/FINANCE/FIELD/ASSIGNEE sets не расширены. SDK остаётся на primary базовой роли, в боте добавлена только подпись.

Полный штатный suite/typecheck/lint/build выполняет неизменный CI после разрешённой интеграции; повторные полные локальные проверки не запускались. Коммит/push/merge и фактическая staging-приёмка принадлежат оркестратору. Production, restic, дампы, seed/reset не затрагивались.

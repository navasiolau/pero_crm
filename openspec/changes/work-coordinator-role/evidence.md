# Проверка роли №121

Дата: 10.10.2026. Ветка `feature/121`, исходный staging `a491e974`.

## Выполненные проверки

- Один целевой `tests/work-coordinator-role.test.ts`: RED на настоящем server action `createPriceItem` («Недостаточно прав»), затем GREEN 1/1. Проверяет каталоговые права, запрет единственного дополнения и ADMIN/DIRECTOR комбинаций, базовую роль/домашний маршрут/видимость/оплату, отдельный доступ к прайсам, отсутствие финансовых/административных grants и отказ после снятия роли.
- После применения миграции оркестратором один `tests/work-coordinator-role-native.ts` на guarded существующем `pero_crm_pg`, `127.0.0.1:5433`. Только собственные QA-строки и обязательный внешний rollback.
- Native PASS: значение PostgreSQL enum присутствует; сотрудник WORKER+WORK_COORDINATOR создаёт и правит расценку; существующий Work сохраняет снимок 100, новый получает 125 и итог 250; аудит двух каталоговых операций сохранён; снятие дополнения запрещает изменение расценки; payScheme остаётся PIECE; MOUNTER+дополнение не получает PRODUCTION.
- Внешний rollback подтверждён отсутствием всех собственных QA User/Client/Project/Product/PriceItem/Work/ChangeLog. Исходные сотрудники и их данные не изменялись.
- `git diff --check` прошёл. Зависимости установлены offline/frozen/ignore-scripts, Prisma Client обновлён без изменения версий.

## Незавершённый стык

№120 параллельно вводит единый `canCreateOrdinaryWork`. После его принятия №121 добавляет `hasWorkCoordinator` только к созданию, при обязательном `productVisibilityWhere` актуального базового actor. Update/remove/self-take не расширяются дополнением. Shared works/core/actions/UI до завершения №120 не менялись этой задачей.

Узкое чтение ordinary LEGACY работ без пула в уже видимом продукте реализовано; Product/Task/File grants и общие OFFICE/MANAGER/FINANCE/FIELD/ASSIGNEE sets не расширены. SDK остаётся на primary базовой роли, в боте добавлена только подпись.

Полный штатный suite/typecheck/lint/build выполняет неизменный CI после разрешённой интеграции; повторные полные локальные проверки не запускались. Коммит/push/merge и фактическая staging-приёмка принадлежат оркестратору. Production, restic, дампы, seed/reset не затрагивались.

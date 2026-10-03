# Tasks

## 1. Matrix and role
- [x] 1.1 RED/GREEN матрица Finance/Office/Manager/Warehouse/Advance, role union и AD/DIR exclusivity.
- [x] 1.2 Enum-only migration, private Prisma generate, user schema/labels/chips/session/home/nav; проверить типы и без новых данных.

## 2. Server/UI boundaries
- [x] 2.1 Operational routes/visibility/task recipients/files/API deny Accountant; finance-safe DTO/picklists и история сохраняются, проверить реальные boundaries.
- [x] 2.2 Warehouse actions/catalog/cost projections и material editNeed/issueReturn разделить, проверить матрицу операций.
- [x] 2.3 Уведомления/privacy и legacy advance grants согласовать, проверить role combinations.

- [x] 2.4 Проверить текущий execution scope до автостопа getActiveTimer и ограничить TimeEntry live task predicate. RED4→GREEN4: finance/readonly без записи, worker/combo сохраняют timeout, stale assignment/deleted parent исключены.
- [x] 2.5 Для отсутствующих execution grants использовать явный невозможный id in [], включая nested relation автостопа; focused RED4/5→GREEN5/5. Actual Prisma staging regression повторяет координатор, без изменения запрещённого finance grant.

- [x] 2.6 Уточнение03.10: глобальный Journal только ADMIN в nav/auth route/page/guarded query; общий ADMIN_ROLES и audit/entity/finance history не менять. Focused genuine RED на DIRECTOR navigation → GREEN route/nav/server query/page; non-admin query/page не читают DB.
- [ ] 2.7 После CI проверить actual deployed ADMIN Journal и отсутствие sidebar/directURL доступа у DIRECTOR/других ролей; runtime приёмку выполняет координатор.
## 3. Validation
- [x] 3.1 Focused/regression tests, TSC/scoped lint и strict OpenSpec validate.
- [ ] 3.2 Root migration/native/browser/staging acceptance.

- Coordinator: подтверждён OWN private Prisma client в development-58 (без shared junction), выполнена полная generation по актуальной49-table schema; полный branch TSC PASS. Первоначальный stale-client FAIL сохранён отдельно; actual stage timer/ACL proof pending.

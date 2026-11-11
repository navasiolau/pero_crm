# Tasks

## 1. Структура и сервер
- [ ] 1.1 Добавить общий каталог/адаптер и JSONB без backfill; проверить pure fixtures и Prisma generate.
- [ ] 1.2 Реализовать projection КП, diff/audit/no-op и сохранность legacy; проверить save/restore/replay тестами.
- [ ] 1.3 Реализовать scalar/structural mutations и redaction; проверить CAS, независимые правки, delete-late-patch, ACL, receipt и rollback.

## 2. Интерфейс
- [ ] 2.1 Встроить список/редактор/legacy-view в карточку и ручное создание; проверить autosave, flush и ошибки тестами компонентов.
- [ ] 2.2 Проверить local DB/runtime и браузер desktop/mobile/reload с guarded целью, сохранить evidence.

## 3. Приёмка
- [ ] 3.1 Пройти lint/typecheck/build, соответствующие тесты, независимое ревью и openspec validate.
- [ ] 3.2 Выполнить обычный commit/merge/push staging, проверить CI и фактические SHA/образ/health/UI, зафиксировать evidence.

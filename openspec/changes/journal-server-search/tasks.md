# Tasks

## 1. Контракт и фильтрация

- [x] 1.1 Реализовать проверку query/scope, московских дат и DTO; подтвердить RED→GREEN на некорректных датах, специальных символах и границах пагинации.
- [x] 1.2 Реализовать resolver достоверных исторических labels/contexts; проверить переносимую задачу, удалённый объект и разделение project/product.

## 2. Чтение истории

- [x] 2.1 Реализовать SQL-поиск canonical и полный legacy fallback, сортировку/count/page; проверить событие за 200 строками, полный вложенный текст и стабильный порядок.
- [x] 2.2 Добавить ADMIN-first list/detail/options server actions; проверить все запрещённые роли до DB-read, scope mismatch, безопасный DTO и исторических авторов.

## 3. Backfill и приёмка

- [x] 3.1 Реализовать guarded dry-run/apply пакетного backfill; проверить повтор, rollback и неизменность raw события, запрет неверной цели.
- [x] 3.2 Выполнить целевые тесты, typecheck, lint и OpenSpec validate; записать фактические результаты в evidence.md.
- [x] 3.3 Принять под root контролем actual staging после штатного CI: SHA/образ/health, SQL и роли, полный поиск, backfill integrity; зафиксировать evidence без объявления локальных проверок staging-приёмкой.

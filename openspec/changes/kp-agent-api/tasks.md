# Tasks

## 1. Авторизация и HTTP
- [x] 1.1 Добавить canonical scopes, свежий owner/session authorizer и повторные проверки с блокировками; проверить матрицу ключей/ролей/отзыва/Origin DI-тестами.
- [x] 1.2 Добавить общий router и два тонких handler с закрытыми схемами и bounded body; проверить HTTP методы, off flag, отсутствие cookie fallback и лимиты потока. Для неожиданных ошибок добавлен обезличенный server report; проверены отсутствие SQL/секретов и неизменность 503 при отказе диагностики.

## 2. Общий сервис
- [x] 2.1 Собрать №181 + №182 с фиксированным курсом, ожидаемым номером и API receipt/audit в одной транзакции; проверить rollback, replay до I/O и lookup operations. Реальные зависимости интегрированы, local DI/typecheck выполнены; actual API SQL/runtime отдельно в 3.3.
- [x] 2.2 Подключить №183 upload/prepared copies/private media и hooks; проверить owner/revision guards и отсутствие storage keys в DTO. Local DI/typecheck выполнены; настоящее хранилище отдельно в 3.3.
- [x] 2.3 Подключить №185 версии/restore/PDF worker и private artifacts с историческим курсом; проверить сохранённые снимки, приватные результаты и повторную авторизацию. Closed render adapters типизированы с реальными producers; actual worker/HTTP отдельно в 3.3.
- [x] 2.4 Подключить №186 forms/settings/contract jobs и единый finalize; проверить отсутствие raw-state bypass и частичных переходов. Реальные lifecycle/contract ports скомпонованы без заглушек; actual API/render отдельно в 3.3.

## 3. Интеграция и приёмка
- [x] 3.1 Добавить пресет ключа КП, OpenAPI и docs/API.md; сверить документацию с фактическими schema/route тестами.
- [x] 3.2 Завершить local-приёмку после обычных merge: Prisma validate/generate, full typecheck, lint, 37 unit/HTTP-DI, OpenSpec strict и guarded inert Next build выполнены.
- [ ] 3.3 Основному агенту провести guarded native/runtime и staging приёмку конкретного SHA/образа; до этого модуль выключен. По отчёту root реальные PDF/версии/private download и договорные сценарии позднее прошли; UI-save получил 403 при проверке Origin за proxy. Первый SDK PUT вернул 200; read-only диагностика локализовала отказ native event predicate до ошибочного требования одинаковых времён события и receipt (разница 2 мс). Исправление проверки и сквозная UI/AI-приёмка остаются UNACCEPTED (см. verification.md).

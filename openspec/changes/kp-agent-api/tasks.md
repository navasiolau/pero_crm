# Tasks

## 4. Правки приёмки владельца 22.10.2026
- [x] 4.1 Переставить меню после изделий, убрать шапку генератора и перенести обе команды выпуска в панель CRM.
- [x] 4.2 Убрать создание/редактирование клиента на странице КП; сохранить немедленную подстановку при выборе клиента.
- [x] 4.3 Актуализировать только затронутые существующие проверки и проверить desktop/mobile. Результат публикации и фактической staging-проверки фиксируется отдельной квитанцией этого выпуска после CI.
- [x] 4.4 Исправить имя PDF на «КП_<номер>.pdf» для новых выпусков и скачивания сохранённых версий; номер брать из снимка соответствующего КП. Проверены существующие сценарии выпуска, HTTP-заголовок и имя загрузки браузера. CI и фактическая staging-выдача фиксируются отдельной квитанцией публикации.

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
- [x] 3.3 Завершить сквозную guarded staging-приёмку закреплённого SHA/образов. Функциональная приёмка на acbd/CI306 и ab5/CI308 с принятой эквивалентностью исходников завершена: API CORE4, AI01 SDK/MCP/Python, private files, AUTH/operations, desktop/mobile Lead/Locked/Manager, physical55 10/10, retained SDK и настоящий LEAD/version/PDF/restore410. Итоговый index05257 и собственные provenance прежних компонентов приведены в verification.md. Финальные CI/deployment/OWNER110 и установка рабочего ключа — отдельные операционные шаги Root; будущий образ и установленное подключение этим checkbox не объявляются принятыми. Main/production требуют отдельного решения владельца.
  - Историческое дополнение20.10: Root принял MANAGER_BROWSER5+1, UI34 Locked8/Mixed2 и AUTH35 manager-deactivation; source HOLD сохранены в verification.md. На тот момент physical188 и финальная публикация оставались открытыми. Функциональный остаток закрыт отдельной записью21.10; старые import/replay receipts не переименованы в proof будущего образа.

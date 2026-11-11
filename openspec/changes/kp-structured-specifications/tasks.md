# Tasks

## 1. КП и печать
- [x] 1.1 Реализовать canonical write/schema/compatibility и stale-writer защиту; проверить legacy/[]/save/restore/replay тестами.
- [x] 1.2 Обновить редактор и ACK/draft сохранность; проверить добавление/удаление/свои разделы/поздний ACK.
- [x] 1.3 Обновить общий renderer, обе раскладки, assets и template identity; проверить legacy и canonical печать.

## 2. Агентские интерфейсы
- [x] 2.1 Обновить OpenAPI/MCP и репозиторный skill/references, проверить контракт и содержательный пример.
- [x] 2.2 Синхронизировать установленный skill и инструкции E:/KP после готовности; проверить валидатор и отсутствие конфликтующих правил.

## 3. Приёмка
- [x] 3.1 После интеграции #214 пройти local DB/runtime/UI/PDF, lint/typecheck/build и соответствующие тесты; сохранить evidence.
- [x] 3.2 Пройти независимое ревью и openspec validate; обычный merge/push staging, проверить CI, точный SHA/образ, API/UI/PDF на staging.

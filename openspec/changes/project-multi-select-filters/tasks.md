# Tasks

## 1. Реализация

- [x] 1.1 Codec/preferences RED→GREEN: несколько IDs, все/пусто, старый scalar/version1, новый default all, сохранение raw CAS/no expiry и независимость Products покрыты тестами.
- [x] 1.2 Projects parser/query RED→GREEN: OR внутри оси/AND между осями, два инженера/пять клиентов, activeOnly с несколькими статусами и неизменная visibility проходят регрессии.
- [x] 1.3 Dropdown/filter bar RED→GREEN: четыре чекбоксных меню, rename, сохранение выбора при открытом меню, всё/пусто/поиск и отсутствие автосброса подтверждены actual component/browser проверкой.
- [x] 1.4 Нужные local tests/TSC/build/lint/OpenSpec strict/review проходят; native preferences/query на existing DB подтверждают сохранность и отсутствие расширения доступа.

## 2. Staging

- [ ] 2.1 Ordinary commit/merge/CI и actual deployed SHA/image/health подтверждены; целевой browser выбор/возврат/reload и native persistence проходят, исходные настройки восстановлены CAS и receipts сохранены. Income61 сохранён, main/production не меняются.

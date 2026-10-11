# Tasks

## 1. Подготовка

- [x] 1.1 Согласовать proposal/design/allowlist с root и независимым reviewer до исходников; приложить scope GO.
- [x] 1.2 Зафиксировать base SHA, точные source hashes, executable bytes/LOC и прежний guard baseline; node tests без native/SQL/HTTP/браузера.

## 2. Реализация

- [x] 2.1 Добавить pure guard/fault fixtures и получить RED отсутствующего helper; собственные UUID пути и точный cleanup, без чужих файлов.
- [x] 2.2 Вынести четыре механические операции и добавить helper в source manifests; подтверждение diff allowlist и одних реализаций.
- [x] 2.3 Сохранить результаты прежних positive/negative, crash/recovery guards; GREEN, cold import, offline bundle, syntax/lint и strict OpenSpec.

## 3. Приёмка

- [x] 3.1 Зафиксировать фактическое сокращение executable bytes и отдельно LOC/тесты; independent review GO перед коммитом.
- [ ] 3.2 Создать один разрешённый коммит только allowlist; передать root SHA/проверки/ограничения, push и integration root.
- [ ] 3.3 После обычного merge root подтверждает CI и фактическую staging-ревизию; повтор pure guards в привязке к deployed SHA без запуска native runner ради консолидации.

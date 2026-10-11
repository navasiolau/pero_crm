# Tasks

## 1. Контрактная карта

- [x] 1.1 Добавить docs/testing/contract-matrix.json и README с денежными, ACL, file, timer и queue контрактами; проверить существование production/test путей и явные gaps129–140/165.
- [x] 1.2 Классифицировать согласованные смешанные блоки KEEP/REWRITE/CONSOLIDATE/RETIRE и проверить сохранение live fallback, historic settlement и защитных guards без изменения существующих тестов.

## 2. Измерение

- [x] 2.1 Добавить компактный V8 coverage runner/reporter и test:coverage:baseline script; проверить настоящее измерение целевой функции, исключение helpers/vendor и явный NOT_RUN для отсутствующих модулей.
- [x] 2.2 Выполнить единственный согласованный полный локальный coverage run и сохранить безопасную сводку SHA/input hash/runtime/command/test status/метрик; проверить, что Node-покрытие не объявляет native/browser/staging PASS.

## 3. Приёмка

- [x] 3.1 Проверить OpenSpec strict и необходимые локальные проверки tooling; независимый reviewer проверяет scope, отсутствие ослабления существующих tests и честность evidence.
- [ ] 3.2 После обычного merge в staging подтвердить CI через API, фактический deployed SHA/health и read-only HTTP smoke; записать действительные результаты, сохранив NOT_RUN/BLOCKED для неподходящих доказательств.
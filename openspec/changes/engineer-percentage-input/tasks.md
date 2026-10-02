# Tasks

## 1. Implementation
- [x] 1.1 Добавить helper и input; проверить шаг 0.1, диапазон, запрещённые символы и NULL/0 тестами.
- [x] 1.2 Применить компонент и убрать исторический блок; проверить controller CAS/UUID/lost ACK и dirty draft тестами.

## 2. Validation
- [x] 2.1 Выполнить focused tests, TypeScript и scoped lint.
- [x] 2.2 Root выполняет интеграцию, общую визуальную и staging-приёмку после №33–38.

## Evidence

RED: исходный controller принимал запятую, новый regression падал 1/4. GREEN: новые четыре и семь существующих controller-тестов проходят (11/11); TypeScript проходит. Scoped ESLint пока заблокирован отсутствующим eslint-plugin-react-hooks в зависимостях worktree, root выполняет проверку после подготовки зависимостей. Финальная визуальная/staging-приёмка не выполнялась.

Root-provided canonical lint wrapper: PASS, errors=0, warnings=0; локальная проверка завершена.

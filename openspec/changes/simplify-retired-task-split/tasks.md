# Tasks

## 1. Согласование и baseline

- [x] 1.1 Согласовать с Root production scope двух модулей; сохранить решение в evidence и проверить OpenSpec strict. Дополнительный design.md пропущен: это локальный рефакторинг без новой архитектуры, зависимостей, изменения данных или поведения; все решения определены ниже.
- [x] 1.2 До правки выполнить существующие task-share-retirement/retired-ui, work-shares-core/settlement, product-engineering-split и product-percentage-pay tests; зафиксировать команды и число прошедших проверок.

## 2. Минимальное упрощение

- [x] 2.1 В share-actions удалить только недостижимую ветку !repeated с notifyPerson/dispatchEvent и её imports. Сохранить auth, ошибки, внешний результат и существующий порядок revalidation; проверить существующие action/share regression tests.
- [x] 2.2 В share-core сузить успех до ok/childTaskId/groupId/repeated:true/projectId/productId; удалить eventId/title/projectNumber/recipientId из результата. Сохранить без изменений schema, normalized-percent receipt matching, visibility lookup и transaction. Проверить exact replay, wrong actor/изменённый payload, отсутствие writes и неизменность снимков fixture.

## 3. Проверка и доставка

- [x] 3.1 Повторить baseline, TypeScript strict, ESLint затронутых файлов и OpenSpec strict; проверить diff без UI/schema/миграций/финансовой арифметики. Новые тесты добавлять только при обнаруженном пробеле, не дублировать реализацию.
- [x] 3.2 Записать evidence с LOC/source-byte delta и сравнимым transpiled/minified JS delta; не выдавать частный размер модуля за уменьшение deployed bundle. Получить независимое review и разрешение Root на commit.
- [ ] 3.3 Root интегрирует ветку обычным merge в staging и принимает фактический SHA/образ, здоровье и retired denial/exact replay без новых операций; зафиксировать результат. Main и production не трогать.

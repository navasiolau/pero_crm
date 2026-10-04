# Proposal

## Why

Переход Склад→Номенклатура падает с digest967541885: actual Prisma P2022 materialCategory.findMany запрашивает отсутствующую MaterialCategory.revision. Поле ошибочно объявлено только в Prisma schema; ни одна миграция/операция приложения не создаёт/использует его.

## What Changes

- Удалить только неиспользуемую phantom declaration MaterialCategory.revision и пересобрать Prisma Client.
- Вернуть обычные listCategories/default create/read/update MaterialCategory против существующей схемы, без обходного select и выдуманного CAS механизма.
- Добавить focused generated-client regression и проверить настоящую страницу/категорийные операции с rollback.
- Никаких SQL migrations, изменения складских количеств/цен/категорий/доступа или новых функций.

## Capabilities

### New Capabilities

- `warehouse-category-schema-alignment`: корректное совпадение category Prisma model с исторической физической схемой, доступная Номенклатура безP2022.

### Modified Capabilities

Нет соответствующего warehouse capability в основных specs; существующая функциональность восстанавливается без новых business правил.

## Impact

Одна Prisma declaration, сгенерированный клиент/сборка, focused test/native/read-only browser. Корректировка warehouse access foundation задачи58 в bugfix/58 от fresh origin/staging8479. Income61 продолжается независимо; main/production не входят.

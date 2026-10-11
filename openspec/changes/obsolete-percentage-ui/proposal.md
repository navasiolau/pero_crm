# Proposal

## Why

После перехода карточки изделия на SinglePercentageRow в коде остались два UI-модуля, которые используются только собственными тестами. Их удаление сокращает обслуживаемый код и устаревшие проверки, сохраняя действующие расчёты, права, исторические суммы и пользовательский интерфейс.

## What Changes

- Задача156 зависит от принятой карты тестов159. Изолированная feature/156 создана после fresh fetch от origin/staging d121f0798e963f32d13f52c9bde57c0aa82b7929.
- Удалить только orphan lib/inline-percentage-projection.ts и components/engineering-fund.tsx с девятью неиспользуемыми вне тестов exports.
- Удалить три test blocks старой inline projection и семь test blocks старого fund UI/helpers. Сохранить cryptographic createRequestId block дословно, переместив в отдельный request-id.test.ts.
- В mixed inline-engineer-fallback сохранить оба query/compatibility blocks; убрать только import canRebaseSuggestedParticipants и одну зависимую assertion, не удаляя весь файл или mixed block.
- Повторить действующие SinglePercentageRow/controller/ACK/null-zero/dirty/frozen проверки и исторические projection/schema/payroll tests без изменения их assertions; принять реальную карточку на staging отдельным этапом.

## Capabilities

### New Capabilities

Нет. skip_specs: true: это удаление подтверждённо отключённого UI-кода, без нового поведения приложения.

### Modified Capabilities

Нет. Существующие требования доступа, расчётника и неизменяемых финансовых снимков сохраняются.

## Impact

- Exact allowlist: шесть source/test paths — две production deletion, две obsolete test-file deletion после переноса живого block, один mixed test edit, один новый UUID test. Подробная классификация каждого block и исключения находятся в design.md.
- Измеренный baseline candidate source: 108 physical LOC, девять exports, ноль production consumers; исходные три test-файла содержат 13 blocks, после операции сохраняются три blocks в двух файлах. Удаляются десять obsolete blocks; root/test LOC не приравниваются к production JavaScript.
- Не включать engineering-fund-view, server/products/engineering-view, preview старых обязательств, settlement DTO, financial models/rows/migrations, shared product-percentage-ui, request-id implementation или действующую SinglePercentageRow.
- Product-card chunks и executed-JS savings не измерены и не обещаются. Версии и lockfile не меняются; БД/хранилища/production не затрагиваются.
- Scope прошёл independent DESIGN_GO и ROOT_RELEASE_IMPLEMENTATION; локальная реализация и проверки зафиксированы в evidence.md. Independent CODE review пройден; root разрешил atomic156commit, фактический SHA фиксируется Git. Staging-приёмка не выполнена; main запрещён.

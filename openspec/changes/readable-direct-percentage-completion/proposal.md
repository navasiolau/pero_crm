# Proposal

## Why

№164 согласован Root как форматирование одного критического direct-completion.ts. Текущий module на freshed2f имеет131source lines/max564chars; многопольные snapshot/payroll/audit записи и условные ветви затрудняют review. Исторические плановые1725–3459chars не заявляются как current baseline.

## What Changes

- Только layout apps/web/src/server/product-percentage-pay/direct-completion.ts. Functions/exports/queries/effects/conditions/literals/Decimal/FX/month/ACL/settled history остаются семантически прежними.
- Существующий TypeScript5.9.3 printer: LF/default indentation, object/array elements, длинные параметры и conditional branches на отдельных строках. Не добавлять formatter dependency/config/framework, не форматировать другие модули.
- До записи проверить fixed point, полный semantic AST source и emitted ES2022 JS. Сравнивать node kinds/children order/identifiers/literals/operators/declaration flags/type-only imports, игнорировать позиции/trivia.

## Capabilities

### New Capabilities

Нет.

### Modified Capabilities

Нет, skip_specs:true. Поведение сохраняется.

## Impact

Exact1production source +ownOpenSpec. No migrations/data/transactions/audit changes, no source copy/rewrite/history/force; feature/164 from freshorigin/staginged2f. Existing percentage/direct/legacy suites, affected typing/lint and independent review. Source LOC growth не экономия/ухудшение executable JS; byte formatting difference не declared runtime improvement. Rootfinance150 owns other4wrappers and confirms thisfile not touched. Main/prod/restic/dumps/seed/newDB forbidden; SAFETY-RULES mismatchSTOP.

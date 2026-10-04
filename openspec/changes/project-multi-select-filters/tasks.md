# Tasks

По указанию05.10.2026 scope расширен на Изделия и общий компонент. Прежние Projects proofs сохраняются в evidence.md как история; текущая корректировка ниже.

## 1. Реализация

- [x] 1.1 Общая панель и thin wrappers заменяют дублирующий JSX; actual React tests обоих разделов подтверждают rename, multi/Сброс/empty/full и сохранение других осей.
- [x] 1.2 Один codec/normalizer/preferencesV2 обслуживает оба раздела; RED→GREEN подтверждает scalar/V1rawCAS/noTTL/isolation/bounds/races без сброса прежних значений.
- [x] 1.3 Product parser/query RED→GREEN поддерживает OR/AND/status/project/client/engineer arrays, empty nofilter, participant union и прежние role/softdelete ограничения.
- [x] 1.4 Нужные localchecks/TSC/build/lint/strict/review и actual native обоих разделов outerROLLBACK проходят, originaldata/schema MATCH.

## 2. Staging

- [ ] 2.1 Ordinary merge/CI и actualdeployedsource/image/health; новый Products browser partial/reset/reload/newcontext и короткий Project shared smoke приняты, originals restored exactCAS/MATCH, receipts сохранены. Production/main и W07/refresh не меняются.

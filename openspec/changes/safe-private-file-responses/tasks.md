# Tasks

## 1. Planning

- [x] 1.1 Проверить branch bugfix/129, baseline3819f17 и guards безопасности; подготовить proposal/spec/design/tasks, `openspec validate --strict` и согласовать дизайн до исходных правок.

## 2. Implementation

- [x] 2.1 Добавить RED матрицу настоящего file GET: MIME×view/thumb×hasThumb×ACL с HTML/SVG, корректным raster/PDF, повреждённым изображением; подтвердить прежний unsafe inline и отсутствие storage read для deny.
- [x] 2.2 Направить legacy thumb в существующий bounded thumbnail сервис; проверить GREEN матрицу, отсутствие оригинального fallback и byte-exact download.
- [x] 2.3 Подключить общий private file response helper к обычному GET, проверенным previews и read finance/logistics; подтвердить headers, PDFview и raster inline соответствующими настоящими adapter тестами.
- [x] 2.4 Сохранить существующие engineer access/cache/ETag/PDF/print проверки и обновить только недекодируемую raster-заглушку; выполнить targeted suites, scoped lint и typecheck без изменения dependencies/lockfile.

## 3. Acceptance

- [x] 3.1 Пройти независимое review, исправить замечания в этой ветке и записать exact commands/results в evidence.
- [x] 3.2 Проверить local browser raster/fullscreen и PDFview/печать/download при CSP sandbox; совпадение оригинального SHA256 и отсутствие активного HTML/SVG.
- [ ] 3.3 После root merge/CI принять actual deployed staging SHA/образ, health и сценарии thumbnail/PDF/print/download/ACL; записать PASS/NOT_RUN/BLOCKED без переноса на main.

## 4. Auxiliary staging adapter (QA-only)

- [x] 4.1 Fixed14-row/six-file manifest alongside113 without guard broadening; signed PRE/version/current observation/guarded exact cleanup.
- [x] 4.2 Bounded actual-GET checker and7 meaningful cold tests; source/test scoped lint.
- [ ] 4.3 Independent source/protocol review and shared163 current target/catalog/source binding.
- [ ] 4.4 Root-approved actual fixtures/HTTP/browser PDF/native print/own cleanup; original fingerprints and storage unchanged.

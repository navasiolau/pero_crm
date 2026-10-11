# Evidence

Дата: 11.10.2026. Change: `safe-private-file-responses`, задача 129, ветка `bugfix/129`, исходная ревизия `3819f175dca3f69f40da92760cf746bad430f4bc`.

Дизайн согласован root после независимого design review: `RELEASE_IMPLEMENTATION`. Независимый reviewer подтвердил CODE_REVIEW_GO после финальной типизации и проверки evidence; root разрешил атомарный коммит. Интеграция и staging-приёмка пока не выполнены.

## Local checks

- `openspec validate safe-private-file-responses --strict`: PASS.
- `pnpm install --frozen-lockfile --offline`: PASS, 724 пакета из cache, 0 downloads, lockfile/версии не менялись.
- `pnpm db:generate`: PASS, Prisma 6.19.3; подключения к БД и миграций нет.
- RED: `pnpm --filter @pero/web exec tsx --test tests/safe-file-response.test.ts`: первоначальные 8 случаев дали 2 PASS / 6 FAIL. Настоящий GET вернул HTML thumb `200` вместо `415`, повреждённый raster `200` вместо `422`; исходные запреты ACL и document-adapters PASS.
- GREEN: `pnpm --filter @pero/web exec tsx --test tests/safe-file-response.test.ts tests/file-pdf-view-route.test.ts tests/image-preview.test.ts tests/engineer-access-actions.test.ts tests/finance-documents-http.test.ts`: 33/33 PASS.
- `pnpm --filter @pero/web exec tsx --test tests/browser-file-print.test.ts`: 27/27 PASS.
- Scoped ESLint для route, helper, image-preview, двух HTTP-adapters, обоих `.test.ts` и browser probe: PASS.
- `pnpm --filter @pero/web exec tsc --noEmit --incremental false`: итоговый PASS, включая standalone browser probe; scoped ESLint и git diff --check повторно PASS после финальной типизации.
- `git diff --check`: PASS. Fullsuite/Nextbuild выполняются отдельно root.

Матрица настоящего GET покрывает HTML/SVG, PNG, повреждённый PNG и PDF; `hasThumb` false/true; original/view/thumb/view+thumb/preview; анонимный и чужой файл; byte-exact SHA256; missing storage; приоритет `preview`; cached ETag/304 без body и Content-Length; отзыв доступа после cache. Обе document HTTP-adapters сохраняют raster inline, PDF только explicit view, Content-Length и Vary.

## Browser checks

`pnpm --filter @pero/web exec tsx tests/safe-file-response-browser.ts --local-fixtures`: PASS, отдельный Google Chrome `154.0.8037.98`, actual file GET с in-memory relational fixture и storage, локальный HTTP listener на случайном loopback-порту.

- legacy thumbnail: WebP 160×107; original PNG 600×400;
- actual PDF response с `CSP sandbox` открыт штатным PDF viewer; screenshot с текстом `SAFE FILE 129` просмотрен визуально;
- скачивание оригинала сохраняет SHA256 `8d39468ea3903da5f416ad38e237ec545e2da39f1de5802d0aff2dbbe4dd4d79`;
- HTML `thumb=1&view=1`: 415;
- actual `printViewableFile` browser API: PASS в headless режиме; физическая печать и видимый native preview этим замером не подтверждаются;
- `pageErrors=[]`, `consoleErrors=[]`.

Артефакты: `apps/web/test-results/safe-file-response/browser.json` и `browser.png` (ignored).

`pnpm --filter @pero/web exec node tests/browser-file-print-runtime.mjs`: PASS, 28 сценариев, Chromium `153.0.8010.12`, actual FileListRow/ReportDocumentButton/FileViewer/Tailwind с fixture HTTP transport и controlled-print-spy. Сохраняются fullscreen оригиналов project1440 и finance390, скачивание PDF/CAD/video, авторизация, отказ HTML/fake PDF, SVG только img, error/cancel/timeout/cleanup. Артефакт: `apps/web/test-results/browser-file-print/runtime.json` (ignored). Это local UI/runtime дополнение, не реальный staging и не физическая печать.

## Preservation

Проверки не используют настоящую БД или рабочее storage. DB/models/migrations, upload lifecycle, оригинальные keys/bytes, UI/CSS и lockfile не менялись. Никаких dump/seed/reset/restic/cleanup/production/main операций.

## Remaining acceptance

- CODE_REVIEW: PASS. Независимый reviewer подтвердил CODE_REVIEW_GO129 после проверки финального tsc/evidence; actionable замечаний нет.
- FINAL_TYPECHECK: PASS, pnpm --filter @pero/web exec tsc --noEmit --incremental false, exit0.
- STAGING: NOT_RUN. Требуются принятый deployed SHA/образ и health, реальная карточка с thumbnail/fullscreen, обычный и финансовый/логистический PDF view/печать, download SHA256, HTML/SVG legacy thumb deny и actor ACL. Main запрещён владельцем.
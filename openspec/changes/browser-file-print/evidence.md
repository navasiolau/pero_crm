# Evidence — задача 116, Phase A

Дата проверки: 08.10.2026. Ветка feature/116, основа origin/staging 8f48aafc39e7db98be03421df20bc2b5466ae978. Коммит, push и merge не выполнялись; разрешение на commit задачи 116 ожидается отдельно.

## Реализация

Добавлены только новые helper browser-file-print, FilePrintButton, focused unit/SSR tests, отдельный browser runtime fixture и данный OpenSpec change. FileList/адаптеры задачи 115, серверные маршруты, schema/package/lockfile, БД и инфраструктура не менялись.

Форматы: PDF и browser image MIME (JPEG/PNG/APNG/GIF/WebP/AVIF/BMP/SVG/ICO). TIFF/HEIC/неизвестные изображения, DOCX/XLSX/CAD, видео и остальные файлы кнопки не получают. Файл выбирается только через ViewableFile и известный защищённый route; arbitrary URL не принимается. Имя используется как текст, SVG остаётся img и не исполняет script.

## Локальные проверки

| Проверка | Результат |
|---|---|
| `pnpm --filter @pero/web exec tsx --test tests/browser-file-print.test.ts tests/file-print-button.test.ts` | 30/30 PASS; RED до helper: MODULE_NOT_FOUND, затем GREEN |
| `node apps/web/tests/browser-file-print-runtime.mjs` | 21/21 controlled-print-spy групп PASS на полном Chromium 153.0.8010.12 |
| `node apps/web/tests/browser-file-print-runtime.mjs --native-preview` | 4/4 НАСТОЯЩИХ native preview PASS, Chromium 153.0.8010.12 |
| `pnpm --filter @pero/web exec tsc --noEmit --incremental false` | PASS, exit 0 |
| scoped ESLint двух source и трёх test файлов | PASS, exit 0 |
| `openspec validate browser-file-print --strict` | PASS |

Controlled runtime проверяет реальные fetch/iframe/img decode, selected source и MIME, afterprint cleanup, отказ доступа/HTML/redirect/битый PDF/битое изображение, отмену и timeout без поздней печати, busy и rapid double click, global guard, next job/pagehide/unmount и bounded resource cleanup, отключённый native PDF viewer и HTML context masquerade. В этих группах `window.print` перехвачен; сами по себе они НЕ доказывают native диалог.

## Настоящий native print preview

Реальная печать запускалась на синтетических документах через новые helper и кнопку в отдельном loopback fixture. Для проектного и финансового PDF (у финансового ответа CSP sandbox), вертикального и горизонтального оригинала получен native `chrome://print/`, `state=1`, `error=0`, `page-count=1` и ожидаемый is-pdf. Каждый rapid повторный click во время подготовки дал ровно один запрос. В каждом случае нажата штатная «Отмена», target закрылся; кнопка «Печать» НЕ нажималась, физическое задание не отправлялось.

Артефакты находятся в ignored `apps/web/test-results/browser-file-print/`:
- `native-preview.json` — четыре actual native проверки и защищённые запросы.
- `runtime.json` — отдельный receipt controlled-print-spy.
- `native-project-pdf.png`, `native-finance-pdf.png` — белая страница с чётким PROJECT116/FINANCE116 SELECTED PDF; интерфейса CRM нет.
- `native-project-image-tall.png`, `native-project-image-wide.png` — целые изображения с четырьмя цветными краями, без обрезки; по одной странице.

Оба PDF и оба изображения просмотрены агентом. Оркестратор независимо подтвердил чёткие PDF страницы и все края вертикального изображения. Первые PDF снимки были сделаны раньше compositor paint и имели серый overlay; после замечания оркестратора повторены. Test-only bringToFront + 2.5 сек settle используются ТОЛЬКО для снимка, не для готовности PDF и не как доказательство результата. Продуктовый helper не добавляет задержку готовности или private Chromium protocol.

## Ограничение lifecycle и оставшаяся интеграция

В Chromium PDF print возвращается асинхронно и не даёт надёжного outer afterprint. Busy/guard действует до передачи native print, не до физического завершения или закрытия диалога. Frame/blob сохраняются до доступного afterprint, ухода со страницы, unmount/abort, следующего задания или ограниченной двухминутной очистки; одновременно не более одного iframe. Таймаут очистки не является PASS печати.

Phase A source готов к независимому ревью. Подключение кнопки перед урной в FileList задачи 115 выполняется после принятой зависимости в Phase B. Приёмка реального staging SHA и его файлов пока НЕ выполнена; синтетический fixture её не заменяет. Дампы, restic, production и инфраструктура не использовались.

## Продолжение 09.10.2026 — source freeze и разрешённый коммит

Владелец разрешил необходимые коммиты и staging-тестирование; оркестратор поручил отдельный коммит только принятой Phase A задачи 116. Независимое ревью Phase A — без замечаний (NONE), по подтверждению оркестратора. Старые результаты native/controlled/unit не перезапускались: код helper и кнопки совпадает с зафиксированным source freeze. Изменение ожидания compositor касается только test harness.

Manifest коммита Phase A: два новых source файла (browser-file-print и FilePrintButton), три новых test файла и шесть артефактов данного OpenSpec change. Все существующие файлы сохранены. Далее ветка 116 получает свежий origin/staging обычным merge, затем только согласованную foundation ветки 115 для подключения кнопки в общем FileListRow. Ветку 116 можно push; интеграция/развёртывание 116 на staging остаётся после фактической приёмки 115. Main, production, БД и инфраструктура не изменяются.

## Phase B foundation — 09.10.2026

Phase A закоммичена как 18d9c8fe60dd85212f0ef18f04cc32b06ab0edc9. Обычный merge origin/staging 87c404846bdb659a2f9f45e3b9d7a0a98c5ad17a дал 813128f0dfb3f7ee2df57e5b013538e44e970459; этот HEAD опубликован только в origin/feature/116 и подтверждён remote ref. Затем обычным merge получена точно согласованная foundation 115 8aaf5eb293280a9cdf82e73a4beac75c4b00a809; локальная основа принтерного подключения — ab4e68df578d4052884dfe7fd75e32e80f917426. Конфликтов не было; selective copy/cherry-pick/squash не применялись.

FileListRow получил один импорт/вызов FilePrintButton перед урной и невидимые data-file-id/data-file-source для стабильных локаторов 113. Helpers/button Phase A не изменены. Существующий PNG unit-кейс 115 теперь ожидает два action icon вместо одного; новый typed file-list-printing.test.ts проверяет regular/finance, порядок действий, сохранение download filename и read-only/disabled семантики.

Focused unit/SSR: 38/38 PASS (`tsx --test tests/browser-file-print.test.ts tests/file-print-button.test.ts tests/plain-file-list.test.ts tests/file-list-printing.test.ts`). Scoped ESLint ряда и двух row test файлов — PASS; scoped TypeScript program для ряда, print source и typed tests с действующими строгими web tsconfig options — PASS. Здесь не запускались приложение, браузер, staging/DB/runtime/network QA, Prisma generation, установки или изменения shared dependencies. Новые frontend проверки не заменяют full merged checks и actual staging.

Новый hook/diff готов к независимому ревью; он пока не закоммичен. Требуются ordinary merge финальной reviewed ветки 115 с адаптерами и последующая проверка общей интеграции. Фактический deployment задачи 116 остаётся после принятого 115. Старые четыре actual native preview и 21 controlled browser группы остаются evidence Phase A и не выдаются за приёмку нового общего ряда на staging.

## Финальная локальная интеграция 115 → 116 — 09.10.2026

Четыре файла принтерного hook прошли независимое ревью без замечаний (NONE); commit 7265b72844b5f94eaf0256546a76b71beb8fb454 опубликован только в feature/116. Затем ordinary merge финальной reviewed origin/feature/115 37db1eb09d4413fa45ef20adb2e8adfdb7451172 дал локальную основу c4517334b4c806573c79beadec5327a66b42f67b. Конфликтов не было; общая строка сохранила printer/id/source атрибуты, а все адаптеры/минимальные DTO/серверные ACL/неактивную финансовую урну/task pending задачи 115 получены из Git merge.

Для новых FileSection/DRAFT types regenerated ONLY own116 Prisma outputs после realpath guard в own worktree: 18 generated файлов, у каждого nlink=1 до/после. 115 vendor package файлов сверены SHA256 до/после и остались неизменны; shared runtime, установки и package updates не выполнялись. CLI запускались из locked dependencies с pnpm verify-deps-before-run=false либо напрямую. Build/test окружение использовало нерабочий локальный DATABASE_URL на port9; существующие БД не читались/не менялись.

| Проверка объединённого кода | Результат |
|---|---|
| Full web suite | 1632/1632 PASS |
| Full TypeScript noEmit/incremental=false | PASS, exit0 |
| Full ESLint через locked pnpm executable resolver | PASS, 0 ошибок/6 существующих warnings |
| Next production build | PASS, exit0 |
| OpenSpec strict | PASS |
| Local coupled browser — настоящий общий FileListRow + ReportDocumentButton + Tailwind | 28/28 controlled-print-spy групп PASS; pageErrors=[] |
| Actual LOCAL native Chrome print preview из общей строки/финансового адаптера | 5/5 PASS; pageErrors=[]; все Cancel, без физического задания |

Local coupled harness теперь проверяет имя изображения на desktop1440 и finance mobile390: полностью оригинальные 300×1200, object-fit contain, точный viewport fullscreen после штатной Dialog zoom-in-95 анимации. Исходный ранний bbox assertion попал в её 100ms переход; test-only ожидание точного конечного bbox исправило readiness, критерий не ослаблялся и app source не менялся.

Filename PDF project/finance скачивает byte-exact original с расширением, CAD/video также скачиваются; iframe/video viewer не открываются. Настоящий финансовый ReportDocumentButton сохраняет неактивную урну и доступный printer. Связанные callbacks и task pending проверены full suite; local transport синтетический и не заменяет stage ACL/data приёмку.

Пять actual native случаев: projectPDF, financePDF, project tall/wide, financePNG wide. На каждом сохранены actual chrome://print target, state1/error0/pageCount1/ожидаемый is-pdf, один protected GET при повторном клике во время подготовки, закрытие штатной «Отменой». Просмотрены новые projectPDF/financePDF PNG с чёткими чёрными маркерами на белой странице и financePNG с четырьмя цветными краями. Повтор warranted новым coupling общей строки и finance adapter; private Chromium protocol в продукт не добавлен, helpers/button SHA freeze неизменен.

Результаты находятся в прежней ignored папке apps/web/test-results/browser-file-print/: full-web-tests.log, full-typecheck.log, full-lint.log, full-build.log, runtime.json (28 controlled), native-preview.json (5 actual), native-finance-image-wide.png и остальные native PNG. Native/controlled receipts разделены и содержат coupling + pageErrors.

Изменён только TEST harness для этого повторного coupling и OpenSpec evidence/tasks. Новая QA дельта ждёт ревью. Source задачи реализован и проверен локально; фактический staging приёмки ещё не было, 116 разворачивается только после actual accepted115. Протокол stage/DB/root cleanup не запускался. Producer ABI нового 113 memory-only signed handoff ещё не заморожен — stage consumer не угадывает auth/fields и ждёт точный verified интерфейс.

## Финальное ревью локального QA — 09.10.2026

Независимый reviewer114_112 проверил три текущих QA/doc файла на основе c4517334b4c806573c79beadec5327a66b42f67b: FINAL NONE. Неизменность app helpers/button/Row подтверждена. Оркестратор передал прямое разрешение на коммит только этих трёх файлов и push feature/116; обычные merge истории 115/staging сохраняются. Пункт 2.3 закрыт по полным локальным проверкам и ревью; actual staging пункт 2.4 остаётся открытым. Никаких повторных runtime/stage/DB действий для этого документационного закрытия не выполнялось.

Producer113 V2 memory-only verified ABI/paths ещё ожидаются. Source-stage consumer не создаётся по догадкам и не получает existing profiles/prefs; runtime/root cleanup и future linked financial fixtures остаются в согласованном контуре оркестратора. Merge/push staging/main данным коммитом не выполняются.

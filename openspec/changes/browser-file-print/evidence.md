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

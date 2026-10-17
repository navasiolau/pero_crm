# QA — №177, 17.10.2026

## Result

17.10.2026: отдельный reviewer `review_176` и оркестратор проверили diff; замечаний нет. Владелец явно разрешил сохранение отдельных веток и staging-тестирование. Фактическая staging-приёмка остаётся открытой до отдельного receipt.

Локальная реализация готова к независимому ревью. Ветка `feature/177` в worktree `D:/Projects/pero_crm_worktrees/requests-177` перед работой fast-forward обновлена до `origin/staging` `e8886cc3030f9fe48db83362e262447bf56941e8` с изменением №176. Исходники №176 не менялись.

Красный цвет применяется к имени, а не всему контейнеру: `ProductMeasurement` / `ProductDocuments` и product-ветка `FilesTab` передают необязательный `filenameTone="red"` через общий список. Прежний default сохранён, а параметр hook передаёт цвет непосредственно в portal `FileViewer`. Геометрия, dispatch, защищённые маршруты и полноэкранные фотографии без панели имени не изменены.

## Checks

- `pnpm install --offline --frozen-lockfile` — PASS; lockfile без diff, скачиваний нет.
- RED: до изменения компонентов новый сценарий в существующем `file-list-printing.test.ts` завершился ожидаемым `PRODUCT_FILENAME_RED_REQUIRED`: фактический цвет был обычным цветом текста. Лог `.playwright-mcp/files177/red.log` сохранён.
- `pnpm --filter @pero/web exec tsx --test tests/file-list-printing.test.ts tests/plain-file-list.test.ts tests/file-list-view.test.ts tests/plain-file-adapters.test.ts` — PASS, **48/48**. Сохраняются прежние проверки защищённых оригиналов, прав, печати image/PDF, ошибок/таймаутов/очистки ресурсов, скачивания и подтверждения удаления.
- Новый сценарий реальных `ProductMeasurement`, `ProductDocuments`, `FilesTab`, `FileList`, `FileViewer` — PASS на **1440×900, 390×844, 360×800**, в светлой и тёмной темах. Проверены все группы, изображения/PDF/CAD/видео, длинное имя с расширением без overflow, default-изоляция, красный заголовок portal и обычный viewer без красного цвета. Из группы изделия проверены открытие оригинала картинки, keyboard zoom/reset/Escape и возврат фокуса, байты скачанного PDF, печать и подтверждение удаления.
- После визуального просмотра первоначального прогона снимки повторены с `animations: 'disabled'`, чтобы не сохранять промежуточную прозрачность Dialog. Повтор целевого сценария — PASS, 6 сочетаний темы/viewport и 12 скриншотов.
- `pnpm db:generate` — PASS без соединения с БД; `pnpm --filter @pero/web exec tsc --noEmit --incremental false` — PASS.
- Scoped ESLint изменённых файлов — 0 ошибок; 2 существующих предупреждения `_noModel` / `_canManage` в `product-attachments.tsx`, эти объявления не менялись.
- `git diff --check` и `openspec validate product-file-name-color --strict` — PASS.

## Artifacts

Финальный receipt: `apps/web/test-results/product-file-name-color/a602b203-4abd-4239-96ca-3b4c857777aa/receipt.json`.

Рядом находятся `groups-{1440,390,360}-{light,dark}.png` и `viewer-{1440,390,360}-{light,dark}.png`. Визуально просмотрены группы 1440 light/dark, 390 dark, 360 light и заголовки viewer 360 light / 390 dark: имена красные и читаемые, полное длинное имя переносится, принтер/урна сохраняют прежний цвет, обычные проектные имена остаются стандартными. Числовые проверки выполнены для всех шести сочетаний.

Логи RED, регрессии, генерации Prisma, lint и типизации находятся в `.playwright-mcp/files177/`. Артефакты ignored, пути относятся только к этому worktree.

## Limits

Браузер компилирует настоящие client-компоненты и Tailwind CSS; Next-навигация, действие удаления и регистрация inline-guard заменены синтетическим транспортом. Проверка portal подтверждает цвет видимого заголовка и скачивание, не является приёмкой содержимого PDF или полной страницы приложения. Изображения сохраняют текущую полноэкранную раскладку без добавления имени.

БД, staging и production не использовались; серверные ACL этим сценарием не доказываются. Коммитов, интеграции в staging, push и deploy не выполнялось. Независимое ревью и приёмка развёрнутого staging с SHA/образом/сценариями остаются открытым пунктом 3.1 для оркестратора.

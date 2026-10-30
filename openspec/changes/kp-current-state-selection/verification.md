# Проверка bugfix/200 — 30.10.2026

Исходный staging: `5be2194d79e91b86bf75a52785ddf2b370e222ee`. Исправление находится в отдельном worktree `D:/Projects/pero_crm_worktrees/bugfix-200-kp-current`, ветка `bugfix/200`. Владелец отдельно разрешил коммит, push, обычный merge в staging, полный CI и staging-приёмку; main/production исключены из этого разрешения.

## Выполнено локально

- `pnpm --filter @pero/kp-template test`: **41/41 PASS**. Включены реальный editor JS, полевая матрица, фото/перенос/удаление позиций, sidecar клиента/курса, потерянные ACK и точные UUID/body, ограничение retry, серверный/локальный выбор целиком и поздний ввод до собственного ACK. Focus и visibilitychange выбирают свежий сервер без PUT.
- `pnpm --filter @pero/web exec tsx --test tests/kp-editor-component.test.mjs tests/kp-editor-access.test.ts`: **16/16 PASS**, настоящий Chromium и перенесённые ресурсы. После последнего уточнения legacy/visibility повторён затронутый браузерный набор: **3/3 PASS**.
- Проверены переполненное localStorage, восстановление более нового черновика после reload, последующее сохранение агента, отсутствие диалогов и отсутствие PUT при открытии. Native IndexedDB проверяет actor/document boundary, сохранность неизвестного формата, более новый черновик другой вкладки, условное удаление и единственную операцию при конкурентном claim.
- При отказе IndexedDB серверное КП открылось, **настоящий PDF** сформирован без PUT; новые правки остаются в памяти после reconcile с понятным статусом.
- Настоящий PDF и четыре страницы raster/DPR2 совпадают с исходным шаблоном побайтово. Новые JS/CSS не меняют печатные шаблоны и расчёты.
- `pnpm --filter @pero/web exec tsc --noEmit --incremental false`: **PASS**; целевой ESLint: **PASS без предупреждений**; `git diff --check`: **PASS**; `openspec validate kp-current-state-selection --strict`: **PASS**.
- Лично просмотрены screenshots 1440×900, 390×844 и 360×800. Небольшое ограничение ширины полей размера/цены/количества в CRM CSS устраняет обнаруженный выход строки за 360px; исходный печатный CSS сохранён.

Логи находятся в ignored `apps/web/test-results/kp-current-state-200/`. Полный browser/PDF receipt и снимки: `apps/web/test-results/kp-editor/8382b5dd-422b-4f76-b9c8-3f4530de2a9a/`; последний storage/memory сценарий — в пути из `browser-storage.log`.

## Фактическая staging-приёмка

Код `af5debfcebbdcce277416ab1a7d1bd94a3a50099` обычным merge включён в staging `d8a6af0e21603dc3f8f61538ad5cf4a4d5e5652d`. Штатный [CI41024660588](https://github.com/navasiolau/pero_crm/actions/runs/41024660588) завершён **7/7 SUCCESS**, включая native PostgreSQL/HTTP/S3, Linux renderer и обе публикации. Workflow не менялся.

Работающий CT101 проверен по hostname, compose ownership, фактическим web/renderer revision/run/image, healthy и четырём SHA редактора. Через приватный SSH-туннель и настоящий HTTP session API проверены существующий ADMIN и UI без подмены авторизации или бизнес-сервисов. Публичная Basic Auth оболочка отдельно не проверялась.

Сохранён отдельный QA-КП **№296** (`cmvupo6e90003mi0100s2jfdu`, только staging): редакция0 → локальные правки и reload без PUT → сохранение агента в редакцию1 → автоматический показ сервера без диалога → новые локальные правки → штатное сохранение редакции2 и настоящий PDF. Переполнение localStorage воспроизведено. Итоговый PDF на2 страницах скачан настоящим Chromium; проверены SHA, актуальный маркер FINAL, сумма123,45 BYN и лично просмотрены обе страницы. Desktop1440×900 и mobile390×844/360×800 просмотрены. QA сохранён для проверки, рабочие КП не редактировались.

Первая попытка скачивания через перехват сетевых запросов приёмочного инструмента отменялась браузером; серверный выпуск уже был успешен. Перевод проверки на прямой HTTP по SSH-туннелю со штатным Service Worker подтвердил обычное скачивание. Приложение и CI ради обхода ошибки инструмента не менялись.

Web/renderer PID/image/env не изменялись во время сценария; DB container/PID/start/mount остались прежними. Машиночитаемое подтверждение — `staging-acceptance.json`; подробные private receipts и PDF — в ignored `apps/web/test-results/kp-current-state-200/`. Main/production, миграции, дампы, restic и S3 cleanup не затрагивались. Заключительная запись приёмки меняет только документацию; финальный интеграционный SHA проверяется отдельно без повторной записи QA.

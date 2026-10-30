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

## Не выполнено

Штатный полный CI и фактическая staging-приёмка ещё не выполнены; пункт 3.2 оставлен открытым. Статус local/Chromium не объявляется приёмкой staging. Main и production не менялись. Изменений БД, дампов, restic, S3 cleanup и CI workflow нет.

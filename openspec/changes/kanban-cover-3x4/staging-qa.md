# Actual staging QA 114 — подготовлено, runtime не выполнен

Harness: `apps/web/tests/kanban-cover-staging-browser.mjs`, экспорт `runKanbanCoverStagingBrowser`. Импорт не запускает браузер, не создаёт файлов и не обращается к сети или БД. У него нет CLI для ввода секретов через argv и нет собственного prepare/restore/session mint.

## Private handoff и ревизия

- Использовать SAME qaTransport задачи 112 после fresh PREPARED и только до её exact cleanup. Её reviewed readonly bridge проверяет физическую staging-цель, HMAC исходного checkpoint и текущего собственного manager QA actor, затем возвращает краткие encrypted Auth.js cookies в приватный stdout pipe координатора.
- Вызов принимает `{authorized:true, origin, expectedRevision, identity, checkpoint, profile, ownedPaths, currentSketchFileId, basicAuth?}`. `identity` — физическое свидетельство существующего qaTransport; hostname строго crm-staging, полный SHA равен expectedRevision и checkpoint.revision. Origin строго https://staging-crm.peromebel.by.
- Checkpoint содержит runId/signature, ids.product/ids.project, productNumber, number и actors.manager.id/roles. Profile.id/roles обязаны совпадать с ним и актуальным GET /api/auth/session. Own paths выводятся из checkpoint, а не принимаются как произвольные URL: `/products/<productNumber>`, `/projects/<projectId>`.
- Cookies/basicAuth остаются только в памяти IPC; не писать их в argv, Git, stdout, trace, HAR, storageState или receipt. AUTH_SECRET вообще не передаётся harness. `/api/health` проверяется отдельно, SHA в этом endpoint отсутствует.

## Read-only граница

Новый browser context с serviceWorkers=block и HTTPS verification. Request interception устанавливается до первой навигации; upstream разрешаются только GET/HEAD точных досок, own details, health/session, fixed static и reviewed protected image namespace. Все POST/PUT/PATCH/DELETE блокируются до upstream, включая автоматические preferences. Next Link prefetch блокируется до upstream без посещения /my, export или чужих details. Cross-origin, login redirects, произвольные query/image proxy URL и неизвестные mutations закрывают проверку.

Response observer требует ноль upstream responses любых non-GET/HEAD методов. Никаких бизнес CRUD, файловых uploads, S3 writes, настройок пользователя, новых fixtures, production, restic или инфраструктурных действий. Protected preview route проверен по исходникам: оригинал читается, оптимизированный preview кешируется только в памяти процесса.

## Что проверяется и сохраняется

На 1440×900, 390×844 и 360×800: настоящая own product card на глобальной доске и внутри own project, текущий synthetic sketch и detail contain. Миниатюра проверяется по числовым rect, отношению ширины/высоты 3:4, отсутствию gutters, object-cover/center. Own sketch source обязан совпадать с текущим fileId из readonly bridge; его изменение даёт STOP.

Скриншоты — только own image frame/detail image region с synthetic fixture изображения, без карточных клиентских подписей и всей страницы. Существующие covered project cards выбираются только структурно по наличию img, до трёх образцов на viewport. Для них сохраняются только aggregate numeric geometry, computed fit/position, natural shape category и load status: ни text/name/id/src/HTML/response body, ни screenshot, ни detail navigation. Это actual geometry proof; pixel proof проектов остаётся локальным synthetic browser QA 114.

Receipt и PNG появляются лишь при отдельном разрешённом runtime в ignored `.playwright-mcp/kanban114/staging-<runId>-<timestamp>`, с проверкой workspace-bound пути. Печать/скачивание отсутствуют. На STOP не происходит очистки fixtures; управление ими остаётся у root/112. Браузерные contexts закрываются до возврата результата.

## Проверка подготовленного кода

Pure invariant tests: `pnpm --filter @pero/web exec node --test tests/kanban-cover-staging-contract.test.mjs` — 7/7 PASS. Проверены immutable private input, staging/full SHA/run/manager/path binding, cookie namespace, GET/HEAD allowlist, block всех writes, cross-origin/export/timer/query guards и numeric cover geometry. `node --check` и ESLint двух новых файлов — PASS.

Design, auth reuse и bounded existing-project geometry extension согласованы root/reviewer. Конкретные bytes требуют независимого review перед любым runtime на будущем принятом SHA 112. Staging task 2.3 остаётся открытым; эта подготовка не является actual staging acceptance.
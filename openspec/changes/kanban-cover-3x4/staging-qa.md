# Actual staging QA 114 — протокол и результаты

Harness: `apps/web/tests/kanban-cover-staging-browser.mjs`, экспорт `runKanbanCoverStagingBrowser`. Импорт не запускает браузер, не создаёт файлов и не обращается к сети или БД. У него нет CLI для ввода секретов через argv и нет собственного prepare/restore/session mint.

## Private handoff и ревизия

- Использовать SAME qaTransport задачи 112 после fresh PREPARED и только до её exact cleanup. Её reviewed readonly bridge проверяет физическую staging-цель, HMAC исходного checkpoint и текущего собственного manager QA actor, затем возвращает краткие encrypted Auth.js cookies в приватный stdout pipe координатора.
- Вызов принимает `{authorized:true, origin, expectedRevision, identity, checkpoint, profile, ownedPaths, currentSketchFileId, basicAuth?}`. `identity` — физическое свидетельство существующего qaTransport; hostname строго crm-staging, полный SHA равен expectedRevision и checkpoint.revision. Origin строго https://staging-crm.peromebel.by.
- Checkpoint содержит runId/signature, ids.product/ids.project, productNumber, number и actors.manager.id/roles. Profile.id/roles обязаны совпадать с ним и актуальным GET /api/auth/session. Own paths выводятся из checkpoint, а не принимаются как произвольные URL: `/products/<productNumber>`, `/projects/<projectId>`.
- Cookies/basicAuth остаются только в памяти IPC; не писать их в argv, Git, stdout, trace, HAR, storageState или receipt. AUTH_SECRET вообще не передаётся harness. `/api/health` проверяется отдельно, SHA в этом endpoint отсутствует.

## Read-only граница

Новый browser context с serviceWorkers=block и HTTPS verification. До application boot self-contained addInitScript удаляет только configurable serviceWorker API по existing work-shares pattern: Serwist использует обычный unsupported-API fallback. Если API не удалось безопасно убрать, проверка даёт STOP. API absence, window.serwist absence и отсутствие active workers проверяются после каждой навигации; offline/PWA поведение вне приёмки 114. Request interception устанавливается до первой навигации; upstream разрешаются только GET/HEAD точных досок, own details, health/session, fixed static и reviewed protected image namespace. Все POST/PUT/PATCH/DELETE блокируются до upstream, включая автоматические preferences. Next Link prefetch блокируется до upstream без посещения /my, export или чужих details. Cross-origin, login redirects, произвольные query/image proxy URL и неизвестные mutations закрывают проверку.

Response observer требует ноль upstream responses любых non-GET/HEAD методов. Никаких бизнес CRUD, файловых uploads, S3 writes, настройок пользователя, новых fixtures, production, restic или инфраструктурных действий. Protected preview route проверен по исходникам: оригинал читается, оптимизированный preview кешируется только в памяти процесса.

## Что проверяется и сохраняется

На 1440×900, 390×844 и 360×800: настоящая own product card на глобальной доске и внутри own project, текущий synthetic sketch и detail contain. Миниатюра проверяется по числовым rect, отношению ширины/высоты 3:4, отсутствию gutters, object-cover/center. Own sketch source обязан совпадать с текущим fileId из readonly bridge; его изменение даёт STOP.

Скриншоты — только own image frame/detail image region с synthetic fixture изображения, без карточных клиентских подписей и всей страницы. Существующие covered project cards выбираются только структурно по наличию img, до трёх образцов на viewport. Для них сохраняются только aggregate numeric geometry, computed fit/position, natural shape category и load status: ни text/name/id/src/HTML/response body, ни screenshot, ни detail navigation. Это actual geometry proof; pixel proof проектов остаётся локальным synthetic browser QA 114.

Receipt и PNG появляются лишь при отдельном разрешённом runtime в ignored `.playwright-mcp/kanban114/staging-<runId>-<timestamp>`, с проверкой workspace-bound пути. Печать/скачивание отсутствуют. На STOP не происходит очистки fixtures; управление ими остаётся у root/112. Браузерные contexts закрываются до возврата результата.

## Проверка подготовленного кода

Pure invariant tests: `pnpm --filter @pero/web exec node --test tests/kanban-cover-staging-contract.test.mjs` — 12/12 PASS. Проверены immutable private input, staging/full SHA/run/manager/path binding, cookie namespace, GET/HEAD allowlist, block всех writes, cross-origin/export/timer/query guards и numeric cover geometry; пять дополнительных bootstrap сценариев покрывают отсутствие API, configurable own/prototype descriptors без вызова getter/register, сохранение unrelated descriptors и fail-closed при non-configurable либо inherited shadow API. `node --check` и ESLint двух новых файлов — PASS.

Design, auth reuse и bounded existing-project geometry extension согласованы root/reviewer. Исходные bytes получили concrete review и root-only runtime; bootstrap patch получил независимый concrete review NONE и один разрешённый root read-only повтор PASS. Staging task 2.3 закрыт по фактической приёмке приложения на SHA 322bd3d542e9d503e955127dc4c1f32644646bc4; ограничения geometry/pixel evidence приведены ниже.
## Root runtime 09.10.2026 — STOP сохранён

На SHA 322bd3d542e9d503e955127dc4c1f32644646bc4 root выполнил read-only проверку существующего own112 fixture fa98ed24-49a0-419e-b03d-09422a7625df. Девять own board/nested/detail geometry checks прошли на трёх viewport; существующие project samples также дали 3:4, gaps=0, object-cover/center. Сохранены девять own image screenshots. Результат остаётся STOP K114_CLIENT_ERROR_OBSERVED: blockedNonReads=18, upstreamNonReadResponses=0, deniedReads=0, pageErrorCount=12. Исходный receipt не исправлялся и не заменяется успешным статусом.

Root отдельной one-page безопасной диагностикой подтвердил TypeError при чтении waiting, SW API present=true, window.serwist present=true и registration undefined=true, upstream non-read=0. Playwright 1.63 при serviceWorkers:block ставит async register stub без результата; Serwist register затем читает registration.waiting. Этот конфликт уже описан в existing work-shares browser helper. Причина не классифицируется как общий Failed-fetch: ListStateController.flush и NotificationsBell.refresh ловят rejected actions, AppLayout нормализует name/email, JWT callback обновляет display fields. Сырые message/stack/headers/cookies/response bodies не сохранялись.

Исправление ограничено bootstrap QA-контекста. Сетевой allowlist, serviceWorkers:block и строгий pageErrorCount==0 сохранены; generic error ignore, local preference noop, разрешение POST, изменения приложения/JWT/БД/S3 и повтор uploads отсутствуют. Root допускает только один read-only повтор на том же SHA и том же signed fixture после concrete review, со свежим приватным JWT. Все 112 capture/cleanup остаются у root. Подготовка bootstrap и pure-тесты не являются повторным staging-run.


## Root read-only повтор 09.10.2026 — PASS и закрытие fixture

После независимого review bootstrap c370dec03189f71dd24321007db288a77e151595a631e7d9543ae59411762946 root выполнил ровно один разрешённый read-only повтор на том же фактически развёрнутом SHA 322bd3d542e9d503e955127dc4c1f32644646bc4 и том же signed own112 fixture fa98ed24-49a0-419e-b03d-09422a7625df, со свежей приватной сессией. Импорт/helper setup не выполнял новых uploads или бизнес mutations.

PASS receipt: `.playwright-mcp/kanban114/staging-fa98ed24-49a0-419e-b03d-09422a7625df-1791495632036/receipt.json`. Девять own product/global+nested/detail checks прошли на 1440×900, 390×844 и 360×800. Два existing covered project samples на каждом viewport имеют width=238, height≈317.328, gaps=0, object-cover/center. pageErrorCount=0, deniedReads=0, upstreamNonReadResponses=0; blockedNonReads=18. Ноль pageerrors требуется строго, ни один класс исключений не игнорировался.

Сохранены девять own image-region PNG. Root просмотрел own product board 1440, nested 390 и detail 390; это synthetic fixture со сплошной синей заливкой. Он подтверждает корректное отображение региона, но сам по себе не доказывает пиксельную обрезку либо сохранение каждого пикселя оригинала. Центрирование, пропорциональный crop и отсутствие полей подтверждены actual geometry/computed CSS и отдельно local patterned-image QA 114; detail contain подтверждён actual computed CSS. Existing client-card pixels/имена/IDs/HTML/response bodies не сохранялись; existing-project evidence остаётся numeric geometry proof.

Root завершил approved capture/cleanup 112 для fa98: SUCCESS, fullOriginalMatch=true, все собственные QA строки и S3 versions закрыты. В этом агентском шаге DB/S3 не читались и не изменялись; результат cleanup предоставлен root. Прежний STOP receipt и безопасная диагностика конфликта Playwright/Serwist сохранены как отдельные попытки.

OpenSpec 114 — 5/5. QA supplemental изменения ограничены helper/tests/protocol/tasks, прикладной app diff равен нулю. Коммит и normal merge/push staging выполняет root с уже данным разрешением и координацией после 111 до следующей фиксации принятого SHA; агент commit/push не выполняет. Ночная staging refresh/W07, production и restic не затрагиваются.
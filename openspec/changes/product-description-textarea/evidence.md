# Evidence — product-description-textarea (local / prestage)

Дата: 02.10.2026. Реализация19 в feature/19 начата отfresh24bdc21494a57877b23f64c803152b619146b360 и после fresh fetch обновлена root ff-only до f2f529137ce8a799a7c554941591b0ed6851a1d6, все19правки сохранены. №18 фактически принят на24bd; web/prisma/bot source diff24bd→f2 пуст, только QA/документы. Этот документ отделяет code/unit/native и завершённую local compiled browser/zoom приёмку от ещё незавершённой hosted staging-приёмки. Оркестратор владеет DB/runtime/Git; автор этой проверки их не запускал.

## Completed Local Evidence

Оркестратор сообщает: full web713 PASS, TypeScript PASS, production-mode local build с корректным NODE_PATH PASS, lint0 errors и одно прежнее cleanup-uploads warning. Это local build, не production/deployment.

Native receipt `.playwright-mcp/modernization/native19-local.json`: 6 групп фактического existing-local PostgreSQL выполнения — create exact LF/CRLF/literal/whitespace→null; inline raw CAS/replay/whitespace conflict; legacy exact baseline/явное очищение; legacy raw whitespace no-op без audit; assigned ENGINEER DESIGN/manager union/readonly roles/revoked access; audit failure exact rollback без изменения qty/money. rollbackVerified=true, capturedTableCount43, fingerprints all-models-and-migrations with ApiToken.lastUsedAt-only operational exception; UserPreference включён.

Исходный RED подтверждён оркестратором: UI2 failures — old whitespace/DOMCRLF focus/blur записывалиnull; затем targeted17/17 GREEN (5description+12controller). Backend RED3/4 — фактические trim/no-op/legacyblank потери; GREENcore4/helper2+related11=17. Root полный713 PASS.

Поведенческие unit tests: product-description-helper/core, inline-description-controller и прежние controller/domain/access suites. Helper проверяет ASCII/Unicode/NBSP/literal HTML/Markdown-like text; core сохраняет строку в create/inline/legacy, raw no-op, exact whitespace CAS и audit rollback; controller не canonicalizes untouched old whitespace/DOM-only CRLF and retries same raw request. Runtime scoped geometry/keyboard/raw reload этими unit/native тестами не доказываются.

QA helper8 tests PASS по сводке оркестратора: HMAC ownership/closed field/target/receipt/prefs/zoom guards и redacted diagnostics. Они доказывают ограниченный QA контур, не успешный browser scenario.

## First Browser Attempt — Not Accepted

Receipt directory `.playwright-mcp/modernization/local-description-browser-8027905d-6498-4b8a-8e90-698cd3497173/`: product-description-browser-receipt.json имеет FAIL, checks=[], requests=[], ownWrites=[], preferenceOwnWrites=[]; phase session, TimeoutError. Причина по диагностике оркестратора — QA предположение о вкладке «Общее» на product page. Это ошибка сценария QA, не найденный application bug и не completed browser proof.

Cleanup: fixture-cleanup CLEANED/dataIntegrity PASS; удалены только2own Product/1Project/2Client, audit/events/history own effects0. Preference-cleanup RESTORED: checked21/unchanged21/restored0/deleted0, integrity PASS. Cleanup PASS не означает PASS текстового reload/keyboard/resize/roles/шести размеров/actual200%.

## Second Browser Attempt — Partial, Not Accepted

Receipt `.playwright-mcp/modernization/local-description-browser-f4e7c396-3e6e-460f-8f06-db5200ce7a49/product-description-browser-receipt.json`: FAIL,5 completed checks — untouched legacy whitespace/CRLF no request; exact LF boundaries/tabs/blank/trailing lines CtrlEnter+blur/reload/no-op/bareEnter; late ACK preserves newer draft; lostresponse sameUUID/payload retry; two-user whitespace-only CAS/explicit rebase. Реальный network assertion не обнаружил дополнительных RSC/document requests обычного description save.

Остановка в literal_and_long_text: QA JSON-line decoder сравнил Flight reference "$2" с ожидаемым длинным literal text вместо разбора реального stream reference. Оркестратор подтверждает фактическое UI сохранение; это QA decoder failure, не application text loss. На момент этой попытки приёмка literal DOM/reload/resize/roles/six sizes/actualzoom не была завершена; QA-only decode затем исправлен. Fixture cleanup CLEANED,7own audit rows и только own2Product/1Project/2Client удалены с data integrity PASS; prefs cleanup PASS по оркестратору. Эти результаты не дают общей browser PASS.

## Third Browser Attempt — Partial, Not Accepted

`.playwright-mcp/modernization/local-description-browser-0be27752-b539-4e18-8020-cda4365dbeac/`: FAIL6checks, phase null_visible_and_native_resize. Literal DOM group уже прошёл; QA asserted previous long-text ACK against expectednull while synchronizing a new clear (saved matcher), а не подтвердил приложение с новым ответом. После QA matcher fix app code оставался frozen. Fixture cleanup CLEANED/dataIntegrityPASS и prefs RESTORED checked21/unchanged21; как0/5 прошлых попыток, это не общая приёмка.

## Final Local Browser / Actual Zoom — Accepted

Authoritative `.playwright-mcp/modernization/local-description-browser-fe30bef6-39b5-4be0-9010-a7023054a204/description-receipt.json`: statusPASS,targetlocal,baseline revisionf2f529137ce8a799a7c554941591b0ed6851a1d6, browser60checks/skips0/failures0, trueChrome200zoom5checksPASS, dataCleanupCLEANED,prefCleanupRESTORED. Revision обозначает свежую Git-базу компилированного dirty19 candidate, не ещё не созданный release commit19.

Подтверждены exact LF input/save/reload/Tab/CtrlEnter/blur/no-op, legacy whitespace/DOMCRLF no-write, literal HTML/Markdown inert DOM+long lines, explicit whitespace→null/empty visible, native vertical resize/fixed sizing, delayed ACK/draft/retry/same UUID, two-user whitespace CAS/explicit rebase, роли/readonly/direct requests, шесть размеров/sidebar/smooth width и actual browser zoom. Zoom выполнен chrome.tabs.setZoom/getZoom=2, не CSS zoom. Root лично просмотрел все6sizes, native-resize и errorzoom изображения.

Native6groups43tablesrollbackPASS остаётся независимым real-DB proof, browser cleanup подтверждает точное удаление только own fixtures/effects и CAS prefs restore, сохранив исходные fingerprints. Дампы/restic/reset/seed/newDB и prod не использовались.

## Final Automated Evidence / Pending Staging

Последний полный web722PASS; после него14 QA codec/guard/matcher testsPASS, включая добавленный synchronizing matcher. Root выполняет ещё finalfullrerun перед коммитом; его итог пока не выдаётся за выполненный. App buildproperNODE_PATH/typecheck/lint0errors(1oldwarning)PASS на frozen19source; QA-only repairs не были app fix.

Только4.5: commit/ordinarymerge/CI и фактические image/SHA/health/text/roles/browser hosted staging19 acceptance pending. Gateaccepted18DONE24bd; это не acceptance19. Main/production вне scope. Три FAIL QA receipts остаются частью истории проверок и не заменяются одной финальной PASS записью.

Финальный root full-suite после всех QA исправлений: 723/723 PASS, failures0/skips0; tests19-final.log. App source оставался заморожен, production build/typecheck и lint0errors подтверждены ранее.

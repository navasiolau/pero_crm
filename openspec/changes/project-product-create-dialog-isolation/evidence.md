# Evidence — задача143

## Current status

CODE_READY_LOCAL_VERIFIED. bugfix/143/worktree D:/Projects/pero_crm_worktrees/improvements-143 создан от d121f0798e963f32d13f52c9bde57c0aa82b7929 и ordinary FF merge обновлён до принятого c6508448450813450b5dbb6a67d77494c37f6cdb. Main/production и чужие edits сохранены. Root одобрил2production paths, local pending/status pending union и малую corresponding before/after проверку; commit/integration/staging ещё ожидаются.

## Historical baseline

Неизменяемый BEFORE d121: apps/web/test-results/create143-protocol/runs/baseline/22c4cebd-7ef9-482d-a989-d87112b088b4/accepted-runtime-v5.json SHA082bd302511348ef010b56ee6979819e8ae60f6189f3c05fc79f6d81db4b7159.20series400trusted title/price keys и6PNG относятся только к старому источнику. Они не переобозначены какc650 и не повторялись.

## Current source

ProductsTab оставляет open, status transition и refresh после подтверждённого create. CreateProductDialog постоянно смонтирован и содержит прежние6drafts, validation, action/toasts/JSX. Busy объединяет local create pending и external status pending. Footer cancel сохраняет drafts; X/Escape handler reset6; success reset5/engineer kept; поздние ответы сохраняют старую семантику. Server/API/ACL/CSS/schema/packages не меняются.

Shared existing kanban-render-observer добавляет только3 mini authored bodies без callback. Тела функций и React/DnD настоящие; transport толькоmemory Next actions.

## Local checks

- Observer: pnpm --filter @pero/web exec node --test tests/kanban-render-observer.test.mjs →3/3PASS (exact11bodies, missing/duplicate/memo guards).
- Existing affected suites: pnpm --filter @pero/web exec node --import tsx --test --test-concurrency=1 tests/product-quantity.test.ts tests/product-quantity-input.test.ts tests/product-preparation-status.test.ts tests/product-card-navigation.test.ts →24/24PASS. Windows sandbox userInfo error до тестов обойдён разрешённым обычным execution context, tests не менялись.
- Scoped ESLint двух production-файлов →PASS. Использован установленный own node_modules/eslint/bin/eslint.js; единственный дочерний process NODE_PATH указывает own node_modules/.pnpm/node_modules для existingplugin resolution. No dependency/config churn.
- Own static Prisma6.19.3 generate изтекущейschema →PASS, безDB/версий/lock changes.
- Полная CLI TSC первоначально EXIT2 только изстарого ignored measurement entry143.tsx (инъецируемые compile constants/globals). По Root разрешению SAME strict TypeScript program/options/include проверил966files с ЕДИНСТВЕННЫМ дополнительным exclude test-results/create143-protocol/entry143.tsx →PASS/noEmit/incrementalfalse. Старый fixture и tsconfig не менялись; это scoped exception, не claim all-file CLI PASS.
- Strict OpenSpec и git diff --check →PASS.

## Actual component browser

Default command pnpm --filter @pero/web exec node --test tests/project-product-create-dialog.test.mjs →PASS8.5s: actualAFTER, не требуетGit/history вshallowCI. Receipt test-results/create-product-dialog/ba3a642d-4bab-423f-a049-b0dfa0a1a12c/receipt.json.

Та же команда с локальным CRM_CREATE_DIALOG_COMPARE_BEFORE=1 →PASS13.5s, currentc650 original parent читается одним git show. Receipt test-results/create-product-dialog/a59b34ed-0da6-4bf7-84b1-81e2be181872/receipt.json SHA c1804253eda9d36a584d943db3c2cc90c5c6d8cfaa0581379edb5816bfd40505. Before bundle a7d17612478a78ffa655b1d43b2db6cee9bfc802414e20a92b416e2b002d7b22; after c952984690cc8a7a93588b89b90faf9200ffa18620125bc78dc86157f6b29c04. Own transitiveinputbyte checks проходят pre/post, browser/pages/server awaitedclosed.

Fixture20cards, MANAGER/BYN, настоящие title/description/price/quantity events и caret/value assertions+idle150ms. Counts delta BEFORE: ProductsTab32, StatusColumn224, DraggableProduct640, ProductKanbanCard640; AFTER все0. Это стоимость исполнения компонентов, не показатель p95 input latency.

Функциональные8contracts: validation включаяempty/quantity0/max+1/negativeprice; footer cancel keeps all drafts; X clears six; error retains draft/no refresh; exactpayload(title/kind trim/price/quantity/engineer); success one action/one confirmedrefresh/21rows; success keeps engineer; late error keeps edited currentdraft; late success closes reopened dialog. Labels/values/defaults не менялись.

Closed/open1440×900/390×844/360×800 →6matching pairs: final WHOLE decodedRGBA0diff, content pixels/actualDOM/text/styles/controlrect/geometry exact. Paths в томже receipt directory: before/after-closed/open-1440/390/360.png. Same data/CSS/Arial,sans-serif/DPR1; caret mask одинаковый; screenshot animations disabled дляbothvariants.

Предыдущие остановленные runs сохранены: compressedPNGbytes differed при0RGBA; затемmobile360shadow/backdrop variance68…1594pixels/maxRGB1…3, в томчислеbefore-vs-before. Root согласовал exactcontentregion изactualDialogbbox/computedpadding, exactcontrolsDOM/styles/geometry иknownboundaryvariance≤3 отдельно отwhole0claim. Final currentcomparison случайноwhole0 иэто записано фактически; дальнейшийwholePNG0 не обещается, CSS/goldens не изменены.

## Limits and remaining acceptance

No DB/full Next/staging create исполнены этим компонентным harness; memory action не заменяет серверную/staging приёмку. Independent review, atomiccommit, root normalstaging integration/CI/image/health иactualdesktop/mobile scenario ещёPENDING. Main/production запрещены.

По прямому решению владельца141 скорость оценивается на доступномПК: iMac не проверяется, его отсутствие не блокирует; specific hardwarefix/driver cause не заявляются. Итоговые latency/longtasks measurements141 после143/144/146 отдельно. SAFETY-RULES прочитан; STOP приguard mismatch, restic/dumps/seed/reset/newDB не использовались.

## Integration regression correction

CI d339ce56 (run38248941946/notok1910) failed ONLY compiler observer bookkeeping: transitive inline-fields144 registry made observedfiles3 instead of2. The form/application was not executed at failure. Cleanbugfix143 ordinaryFFupdated from48c5b88 toorigin/staging d339ce56a66c5831753423b492521a3797bb4f6d.

One-line existingtest change scopes observer to literal ProductsTab+ProductKanbanCard modules. Strict2files/4authoredbodies and allrender/lifecycle/caret/visual assertions stayunchanged; otherregistrytargets remainfor their own tests. No production/controller/CSS edits.

AffecteddefaultactualReact/Chromium command →PASS19.1s/8contracts/0unchangedcardrenders, ownbrowser/serverawaitedclosed. Receipt apps/web/test-results/create-product-dialog/1de1e21c-91a4-40d0-8262-57d9dc0a7b83/receipt.json SHAc28548f7e0fe6652ec38e72d57bdb6d7bcd8fc9c8824e8685491ebbe82a7295a. Scopedtestlint/diffcheckPASS; no repeatedprofiling/visualmatrix/DB/stage. Independentreview/commit/rootnormalintegrationpending. Prior source-bound before/after artifacts preserved.

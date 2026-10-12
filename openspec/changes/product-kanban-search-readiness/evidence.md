# Evidence — задача 145

## Scope and status

- Ветка bugfix/145, исходный accepted parent cd38cb745759becd58dbbad4d6d37afa03f0ab7a; отдельный worktree D:/Projects/pero_crm_worktrees/improvements-145. Source128 и его immutable18 stagingPNG сохранены в другом worktree без изменений.
- Production diff: только apps/web/src/app/(app)/products/products-kanban.tsx. Общий hook, ProductsView, роли, server actions, SQL/schema/lockfile, DOM и CSS не изменены.
- Установлены собственные dependencies: pnpm install --offline --frozen-lockfile --ignore-scripts (downloaded0), pnpm --filter @pero/web exec prisma generate; PostgreSQL не открывался.
- DESIGN_GO независимого reviewer получен до source; CODE_REVIEW_GO. Прямое разрешение владельца на необходимые коммиты по плану получено; staging integration выполняет оркестратор. Main/production не затрагивались.
- Локальные проверки завершены. Actual deployed source145, staging search/preservation/data/CAS acceptance: NOT_RUN. Task145 не объявлена завершённой.
- iMac недоступен: task141 остаётся BLOCKED_DEVICE_UNAVAILABLE. Эти проверки не диагностируют его графический стек и не закрывают инцидент.

## RED and GREEN

Исходный actual ProductsView/ProductsKanban/React/DnD/KanbanScrollArea/useKanbanSearchFocus в Chromium, с контролируемыми Next/server boundaries, подтвердил отсутствие перехода к точному 199.5: допустимая ошибка центрирования <2px, фактическая1223.5px. Это соответствует всегда ложному сравнению массива после filter с initialProducts.

RED command (из worktree root):

    pnpm --filter @pero/web exec node D:/Projects/pero_crm_worktrees/improvements-145/apps/web/test-results/search145-protocol/red-existing-harness.mjs

Exit1, checks0; immutable record .playwright-mcp/search145/red/receipt.json. Producer — products-only копия существующего117 component harness с теми же реальными компонентами; private/ignored, не включается в commit.

GREEN command:

    pnpm --filter @pero/web exec node --test D:/Projects/pero_crm_worktrees/improvements-145/apps/web/tests/product-kanban-search-readiness.test.mjs

1/1 actual-browser regression PASS,18.7s; он переиспользует общий harness и проверяет21 products contracts. Readonly observer фиксирует реальные props searchFocus до passive-effect commit; actual shared component/hook остаются исполняемыми. Ни React-state, ни DnD, ни hook не подменены.

Подтверждены: одна пара board/page scroll для точного номера, caret, отсутствие повторов после ручной прокрутки/SSE, clear/re-enter, поздний RSC и прежние filter axes, пустой точный результат с реально появившейся позднее карточкой, новое role prop до commit фильтра, deferred DnD, success/confirmed-rollback оптимистичного статуса без раннего focus, ожидание нового авторитетного ответа, мобильная Sheet, реальный touch и восстановление snap. QA pointer-drop сначала завершался до render over-state; исправлен только тестовый порядок ожиданием RAF и реального состояния droppable. Production bypass не добавлялся.

## Preservation baseline

Actual UI-component baseline: .playwright-mcp/search145/before/receipt.json; AFTER .playwright-mcp/search145/after/receipt.json; comparison .playwright-mcp/search145/comparison.json. BEFORE PNG не менялись.61 production input hashes зафиксированы; изменён только ProductsKanban. Fixture synthetic, роли/данные/viewport/DPR одинаковы; общий117 harness использует Arial wrapper вместо полноэкранного app Onest. Настоящий staging layout/Onest дополнительно имеет18 immutable beforePNGcd38 task128; staging AFTER145 ещё NOT_RUN.

| Viewport | BEFORE SHA256 | AFTER |
|---|---|---|
| 1440×900 | 496e8ce64b67d14e601024a52ba32caa6433d2abfd976bfe42ea8deee00e6afd | Тот же SHA; PNG bytes и геометрия совпали |
| 390×844 | 4a47cf1d5ffafb74bdf1e7a7d2a726b6ff62f9bbb2b590bb372021ff0c2e6455 | Тот же SHA; PNG bytes и геометрия совпали |
| 360×800 | 64dc466d6f3cf02f41081039575c2f58aa6c98ec441449807eaf98b7b511898f | Тот же SHA; PNG bytes и геометрия совпали |

Просмотрены все3 исходных изображения; comparison подтвердил побайтное равенство PNG и полное равенство размеров/порядка колонок и карточек. Снимки обычной доски сохраняют расположение; центрирование после подтверждённого точного поиска — отдельно согласованное исправление145.

## Local verification

Команды из корня worktree:

    pnpm --filter @pero/web exec tsx --test --test-concurrency=1 tests/kanban-identity-search.test.ts tests/kanban-search-page-adapter.test.mjs tests/list-state.test.ts tests/list-state-controller.test.ts tests/list-preferences.test.ts tests/product-draft-boards.test.ts tests/global-product-thumbnail-navigation.test.ts tests/product-card-navigation.test.ts tests/product-return-navigation.test.ts tests/product-return-navigation-ui.test.ts tests/product-percentage-ui.test.ts

81/81PASS,0skip; log .playwright-mcp/search145/unit.log. Query/visibility — настоящие builders на fixture adapter, server page — controlled read-boundary, navigation — фактические callbacks SSR. Это не native SQL/hosted auth доказательство.

    pnpm --filter @pero/web exec node tests/kanban-search-focus-browser.mjs

38/38 real-browser contracts PASS (17projects+21products),6 screenshots,3viewports; .playwright-mcp/search117/receipt.json. Actual React Views/list controller/filters/DnD/BaseUI/Tailwind плюс readonly props observer и controlled Next/server transport, без PostgreSQL.

    pnpm --filter @pero/web exec eslint 'src/app/(app)/products/products-kanban.tsx' tests/kanban-search-focus-browser.mjs tests/product-kanban-search-readiness.test.mjs
    pnpm --filter @pero/web exec tsc --noEmit --incremental false
    openspec validate product-kanban-search-readiness --strict
    git diff --check

Все PASS; TSC выполнен один раз в согласованном слоте, session76004 exit0. Обычный build/CI не запускает автор; actual staging deployment оркестратор подтвердит после разрешённого commit/merge.

## Staging acceptance still required

Accepted candidate SHA/image/health, reviewed source closure, guarded read/getBellData/prefs-CAS scenario, genuine preference ACK journal and exact restore, protected business/audit/financial fingerprint equality, search145 behavior and18 visual AFTER comparisons — NOT_RUN. Нет бизнес-записей, runtime CRM/DB/production вызовов или выданного разрешения stage-business DnD. DI/component/build результаты не заменяют эти receipts.

## Independent review correction

Reviewer выявил P1 в test-only observer: статический абсолютный путь связывал harness с авторским Windows worktree и ломал Linux/другой checkout. Observer теперь строит import из runtime web текущего caller через path.join и JSON.stringify. Actual esbuild metafile сохраняется, каждый physical production input проверяется под текущим web до запуска браузера; virtual test boundaries и locked node_modules отделены от этой проверки.

После исправления повторены requested products wrapper (1/1PASS,18.4s), полный both-sections harness (38contractsPASS,6PNG), scoped lint и diff-check. Receipt sourceClosure подтвердил61 physical production inputs под D:/Projects/pero_crm_worktrees/improvements-145/apps/web, без импортов чужого worktree. CI уже устанавливает Chromium штатным playwright install --with-deps до тестов. Production source145,81unitPASS и один tscPASS не изменились; immutable BEFORE3 PNG и task12818 PNG сохранены. Независимый FINAL_CODE_REVIEW_GO получен после проверки portable import/metafile61 и38contracts; прямое разрешение владельца на коммит получено, actual staging acceptance остаётся NOT_RUN.

## Commit authorization and preflight

Прямой trusted user reply владельца: «Разрешаю коммиты по всему плану» (message01a129b2-c4bb-7303-a225-73033254f4ba); источник прочитан через app API. Независимый FINAL_CODE_REVIEW_GO получен, source/tests после него не менялись. Перед атомарным commit повторены strict validation и diff-check: PASS. Allowlist только1production source,2tests и6OpenSpec artifacts; private before/afterPNG, caller и env остаются ignored. Main/production и самостоятельный merge/push не разрешены.
## Совместная интеграция128/142/145: ожидание готовности ручного сброса

Первый совместный existing component run88435/cbf3bc:128 pointer8PASS,142 functional17PASS,145 отказал в title/partial/no-match проверке — left884 вместо0. Ожидание этой проверки не ослаблено. Единственная readonly диагностика существующего browser launcher db9300/b5b650 дала21PASS; дополнительные awaited чтения влияют на тайминг, поэтому этот факт сам по себе не объявлен исправлением приложения. Desktop snapnone исключает предположение о query-cleanup CSSsnap как доказанной причине desktop отказа.

Конкретная ошибка подготовки launcher: settledCenter подтверждает геометрию, но не завершённый предыдущий query/focus; resetPosition выполнял manual scroll и только два RAF, без подтверждения синхронизации нижней полосы. Исправлен только existing resetPosition: перед manual reset требуется !pending и ready для текущего canonical query, после него — точные main/bottom/page0. Дополнительного scrollTo в poll нет; остаётся прежний один manual reset. Все исходные title/partial/no-match0, caret, роли, DnD, Sheet и late-response expectations сохранены. Новых тестов, fixtures, adapters, framework или matrix нет; application source и ready/cardId политики не менялись.

Actual existing failed test после этой узкой правки:80323/c43a2b exit0,1wrapper/21products contracts,19.33s. Scoped lint onlylauncher61618/71a856 exit0/maxwarnings0; один webTSC62955/1b8169 exit0. Application shared component не менялся этой правкой;1288/14217 предыдущие PASS не выдаются за повтор. Diffcheck edab97 PASS.

История сохранена обычными операциями:145combined baseline38e786bc, ordinary currentstage merge26560d2b5613b1aa055498235fa1557c764d8f40 и topic revert-revert e0cc26c8497d1866396a62c9cd38f57f858124e9. Stage exclusiondf05 остаётся до независимо проверенного нового merge. Никаких reset/copy/cherry/squash, staging business records, DB/S3, main/production или restic/dumps. Independent final source review/commit/new stage merge/CI и actual staging acceptance по правке ещё NOT_RUN.
## CI4de: ожидание зеркала после мобильного touch/SSE

CI run38186287639/job114609201921/source4de5569c: единственный отказ test1596, kanban-search-focus-browser.mjs218. Private log SHAe4919d1b4936b6fd9f6a8ac395300b278042547a72b14a4db7c799da1f4e6e26, exactblock10729–10763. Непосредственная строгая проверка main position==manual прошла; отказала только мгновенная bottom/manual delta<2 после350ms и двухRAF. Новое приложение/135image не было собрано, stage осталсяdf05, migration135 не применялась.

Только existing launcher: добавлено bounded5s ожидание фактического bottom/manual delta<2, после него повторяется строгий main==manual, исходный bottom assertion сохранён. Это не изменяет координаты, не компенсирует scrollTo, не допускает recenter и не ослабляет epsilon/ready/card/caret/scenario. Время фиксированных кадров само по себе не гарантирует завершение scroll-мirroring события в загруженном CI. Application source не менялся; новых tests/fixtures/adapters/framework нет.

Actual onlyfailedcase71469/1ed8e1 exit0,1wrapper/21contracts,19.52s. Scoped lint4a6b2d exit0/maxwarnings0; TSC повтор не нужен для .mjs-only patch. Diff462bb3 — ровно три дополнительные строки (комментарий, poll, strict main reassert). Приёмка Root review/commit/normalmerge/newCI/staging ещё pending.135 чужой код не изменялся; обычный currentCI dependency merge694086 сохранил историю. Main/production/DB/S3/restic/dumps эффекты0.
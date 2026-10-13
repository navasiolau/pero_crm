# Проверка №168

## Authored D–G continuation

Root согласовал closure старых completed stage/recovery operators и общую native setup консолидацию. По exact allowlist из `reduction-map.md` удалены12 файлов через `Remove-Item -LiteralPath` после проверки абсолютной границы checkout и reparse attributes всех предков. Нового framework/test case файла нет. Общие source-pinned `qa-private-primitives.mjs`/transport/session guards и historical receipts сохранены.

Retained проверки: description/attachments browser suites **18/18 PASS**; пять fixture/session/description/security suites **56/56 PASS**; unit110 browser/shared/draft/wire suites **37/37 PASS**. Это проверки сохранённых helpers/cases, не новая фактическая browser/native/HTTP/DB/S3 приёмка. Четыре build-only native CLI — PASS, outputs110449/126998/118043/36469 bytes, каждый `dbExecuted:false` и ≤256KiB. Сверка с текущим readonly169 исходником подтвердила совпадение captured original hashes и побайтовую неизменность всех четырёх native `async main` business bodies.

Scoped ESLint15 изменённых файлов **PASS, exit0, --max-warnings0**. Первые запуски остановились на отсутствующих `.bin/eslint`/web react-hooks projection; использован штатный уже установленный ESLint9.39.5 напрямую и только дочерний `NODE_PATH` существующих `.pnpm` plugin directories, без install/изменения dependency files. Три unused variables закрытого unit-reader/sourceManifest control удалены; финальных warnings0. Live refs поиска по deleted paths в `apps/web/tests`/`docs/testing`:0hits. Общий full run/typecheck/Git/CI/DB/данные не выполнялись по scope Root.

Единый authored snapshot30 исходных test/QA путей: **1794→914 LF (−880)**, normalized UTF-8 **381522→203184 bytes (−178338)**;12deleted/15modified/3unchanged. README и карта получают closure/common-helper пояснение; contract matrix убирает только historical source-guard pointer closed unit operator. Это вклад D–G, не полный знаменатель или достижение50%. Общие tasks5.x остаются pending до финального результата оркестратора.

База: `da5bf32cd5a103c041222694ef59c54866d25e0c`, ветка `feature/168`. Карта удаления согласована до edits; 35 файлов удалены по буквальным путям с проверкой границы checkout/reparse points. Runtime `src`, Prisma, package versions и lockfile не меняются.

Независимое review: `FINAL_CODE_REVIEW_GO_168`, замечаний P1/P2 нет. Уникальные frontend cases перенесены в существующие автоматические suites.

| Проверка | Результат |
|---|---|
| `python -m unittest discover -s deploy/tests -p 'test_*.py'` | PASS, exit 0: 58 tests, 2 прежних skips |
| `node tests/coverage-baseline.mjs --check` | PASS, exit 0: 19 contracts, 16 dispositions, 27 targets, 357 test files |
| `openspec validate test-basis-reduction --strict` | PASS, exit 0 |
| `git diff --check`; protected runtime/Prisma/package/lock paths | PASS, exit 0; protected diff пуст |
| `node node_modules/prisma/build/index.js generate --schema prisma/schema.prisma` | PASS, exit 0; client сгенерирован только в task checkout |
| `node node_modules/typescript/bin/tsc --noEmit --incremental false` | PASS, exit 0 |
| `pnpm --filter @pero/web lint` | PASS, exit 0: 0 errors; две новые unused test imports удалены, targeted lint двух файлов PASS, exit 0 |
| `node --import tsx --test --test-concurrency=2 <357 existing test files>` | PASS, exit 0: 2 518 tests, 2 516 PASS, 0 FAIL, 2 skips; 236,3 s |

Первый web запуск в Windows sandbox остановился до test bodies: `tsx os.userInfo / uv_os_get_passwd ENOMEM` во всех 357 workers. Cached projection не содержал busboy/types и hoisted ESLint plugin; эти ошибки не считаются результатом приложения. Разрешённый `pnpm install --frozen-lockfile --ignore-scripts` завершился exit 0, версии/lockfile прежние. Cached targets сохранены; только локальные dependency junctions сняты без recursion. Единственный выполненный полный автоматический прогон с доступом к ОС прошёл; БД/данные не запускались.

Единая метрика: `git ls-files` в каждой области, HEAD blob до/существующий файл после, UTF-8 count `\n`; files/suites считаются отдельно. Web tests — 64 722 → 59 831 строк (−4 891, −7,56%), 683 → 658 файлов, 365 → 357 suites. Ранее сообщённые 64 775 использовали другое соглашение CR/unterminated lines и не являются знаменателем этого сравнения. Deploy acceptance — 3 553 → 2 280 строк, 21 → 15 файлов; deploy tests — 1 387 → 976 строк, 11 → 7 файлов. Совокупное сокращение — 69 662 → 63 087 строк (−6 575, −9,44%) и 715 → 680 файлов (−35). Из 35 файлов — 12 автоматических test files и 23 завершённых QA/helper entrypoints. Новые артефакты change в test/helper/QA denominator не входят.

Локальные журналы находятся в ignored `.playwright-mcp/task168-{full-web-os,typecheck-fixed,lint-pnpm,deploy-tests}.log`.

LOCAL_GO. Commit/merge/CI и реально развёрнутый staging SHA/образ/здоровье/GET-only smoke выполняет оркестратор; task 4.2 остаётся pending до фактической приёмки.

STAGING_ACCEPTED, 13.10.2026: `e986e2900f9a7911b4863ec3e6e3ecae3715545a`, feature `28751df`; task 4.2 DONE, 7/7 задач.
CI `38332094373`: test `115083905706`, web `115086541903`, bot `115086541925` — ALL 3 SUCCESS, подтверждены оркестратором через текущий IAB UI.
Actual web `4a32347440efe41386b48d90d8356dd46ce16ae826b9001e52a0b6ba9a9a3779`, image `09fcc6707af0de112e5ba3c275dbd31056ee1ce0d42b4abdec4b5d950ce6e558`, healthy; DB ID/start/volume/W07 прежние.
Авторитетный источник — Root owner execution и postdeploy receipt: `D:/Projects/pero_crm_v2/.playwright-mcp/application-improvements/staging-e986e290-identity-c299ba87-0835-4d7e-be95-d8e333936f14/identity.json`, SHA-256 `3ae30ca0355ba10394042548c765c5f999947b21eb3af754fa3493a7f6f91e7c`.
GET-only smoke `get-smoke.json` в том же каталоге, SHA-256 `5a412710dd1e68393e1148846b78aef1eb3b767c903c090f0f18d18ef93bdc02`: health/login 200, password field есть, projects/products 307 → login без CRM-session; fixtures/DB/S3 writes отсутствуют. Main `3819f175dca3f69f40da92760cf746bad430f4bc` и production неизменны; эти локальные closure docs не коммитятся и не запускают новый CI/deploy.

## Owner refinement: 50 percent

После принятия первой фазы владелец уточнил цель №168: не менее 50% исходного test/QA кода без потери качества. Прежний единый tracked-text denominator сохраняется: web 64 722 → не более 32 361; общий 69 662 → не более 34 831. Принятые выше PASS и staging `e986e290` подтверждают только первую фазу 9,44% и не являются приёмкой продолжающихся edits.

Продолжение: PENDING. Предстоят согласованная карта, консолидация повторов с сохранением уникальных контрактов, итоговое измерение, один полный автоматический прогон после всех edits, typecheck/lint/contract-map/OpenSpec и новая staging-приёмка. DB/S3/инфраструктура, native QA runs, дампы, reset и seed в продолжении не выполняются. Финальные команды и результаты добавляются только после фактической проверки оркестратором.

Native authored delta относительно принятого `e986e290`: 16 затронутых файлов, семь удалений; 3 288 → 1 810 Git-LF (−1 478), normalized UTF-8 303 652 → 171 070 bytes (−132 582). Это локальная область исполнителя, не общий итог цели 50%. Точная карта retirement и сохранённых native contracts находится в `reduction-map.md`.

Offline controls native области: девять изменённых TS files проходят esbuild TypeScript→CJS transform, `git diff --check` PASS. Сравнение с HEAD подтверждает неизменность нормализованного тела текущего `verifyNative135Cases` и current materials thin source/body; queue diagnostic перенесён без изменения условий. Clients/native bodies/DB/S3/network/dumps/reset/seed не запускались. Mixed warehouse-unit runner возвращён к точным HEAD bytes; новый current-mode SQL scenario не входит в cleanup scope. Полная проверка и независимое review остаются общими pending gates после всех edits.

Reviewer P2 в native148 устранён: восстановлены две исходные локальные `owned`/`productId` declarations внутри `native148FixtureManifest` с привязкой к входному `runId`; старые module globals и frozen CLI остаются retired. Статическое сравнение полного manifest function с HEAD PASS; новых native/test runs при исправлении не было.

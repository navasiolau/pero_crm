# Evidence

## Scope

№157, `feature/157`, worktree `D:/Projects/pero_crm_worktrees/improvements-157`, fresh origin/staging base `fa1dbec4984e31fc235afc87749eefb5e2177d22`. Утверждены retire file-stages + QA guard и одна строка README с актуальным перечнем package. Независимый `independent_cleanup_review` дал **CODE_GO + LOCAL_CHECKS_ACCEPTED**: actual registry/policy, revision/source guards, importer-only lock и сохранность данных приняты. Root разрешил собственный atomic 14-path commit; новых проверок/QA не выполняется. Staging/CI для №157: **NOT_RUN**.

Точный allowlist: README.md; три существующих QA-файла fixtures, fixtures.test, runner; четыре удаляемых package-файла; pnpm-lock.yaml; пять собственных OpenSpec metadata/proposal/design/tasks/evidence. Всего 14 paths. Действующий registry/demo/SDK, schema/migrations и workspace glob не менялись (`git diff --exit-code`, `82540f`).

## Current guard

QA импортирует и компилирует настоящий `apps/web/src/server/plugins/registry.ts` / `getManifest`, а через него demo manifest с действующими hooks и SDK. Для известной исторической enabled row `file-stages` 0.1.0 / API 1 нужны совпавшая revision политики и отсутствие manifest в actual registry. Зарегистрированный enabled manifest, неизвестные ID/версия/API, старая sourceHash policy или чужая revision приводят к STOP до дальнейших эффектов.

`stageGuard` по-прежнему проверяет actual staging proof/revision/DB/S3 перед Prisma constructor. Политика сохраняется в HMAC-signed PRE и строго сравнивается перед prepare; current-source CAS, corruption checks, physical receipt binding и запрет blind retry сохранены. Только три невызываемых ленивых UI imports demo (`./slots/dashboard-widget`, `./slots/project-tab`, `./slots/settings-note`) external в QA bundle. Manifest, hooks и commands не заменяются заглушкой. Native/DB/HTTP действия №157 не выполнялись.

Runner больше не читает удалённый package source. Его source map содержит текущие registry, demo package entry/manifest и SDK package entry/source наряду с прежними QA/wrapper pins. Никакой новой registry/inventory системы нет.

## Local checks

- Meaningful RED `6d7577`: существующий policy test временно добавил manifest file-stages с hook в настоящий registry; старый guard не бросил исключение. Registry в процессе теста восстановлен в `finally`.
- После удаления package: `7d1e8b`, **29/29 PASS**, `node --import tsx --test` для существующих fixtures/runner/wire suites. Policy positive разрешает retired row без manifest; negatives охватывают demo hook, неизвестный ID, другую version/API/revision, прежний sourceHash и зарегистрированный file-stages hook. Счётчик действий после preflight равен нулю при отказах; source registry восстановлен.
- Те же suites сохранили signed PRE/HMAC, target proof, durable-before-DB, exact cleanup CAS, private artifact refusal, corruption/ledger/wire bounds и lost-response guards. Оба настоящих bundles собраны offline в неизменном лимите **256 KiB**. Экономия клиентского JS/CSS не измерялась и не заявляется.
- Strict TypeScript текущего registry и его import graph: `18bc18`, PASS. Scoped ESLint трёх изменённых QA-файлов: `04e8bc`, exit 0. `git diff --check` и `openspec validate retire-file-stages-package --strict`: `e74636`, PASS.
- Зависимости установлены frozen/offline/ignore-scripts; generated Prisma Client 6.19.3 выполнен source-only (`214e36`), без обращения к БД. После package deletion pnpm offline lockfile-only (`061324`) изменил только 13 строк одного importer; остальные версии/resolutions остались прежними. Frozen install после этого успешен, workspace содержит пять проектов.

## Deleted source and consumers

Текущий адресный поиск (`14ae36`, затем `e74636`) по apps/packages/deploy/.github/package exports нашёл только внутренние ссылки самого retired package и прежний QA source read. После изменения package imports/exports/source reads отсутствуют. Исторические упоминания Plugin ID в других QA/данных не удаляются.

| Удалённый TS-файл | Физические строки | SHA256 до удаления |
|---|---:|---|
| packages/plugins/file-stages/src/index.ts | 2 | 63c8d6bb934e86df9792a5ec5e3af1d83373dd936e0338289e34ede37dd80653 |
| packages/plugins/file-stages/src/plugin.ts | 29 | d01325f64ecd7a2cb1cbcefcd7193d4a1c27f280470239f26a74ad95cb253544 |
| packages/plugins/file-stages/src/lib/file-stages.ts | 90 | c614f27bacb23ddba41ee183ce76b8f6bd3e6f73c61426c48175d178f6687934 |

Итого **3 TS / 121 LOC** по одному методу: число строк UTF-8 source без конечных CR/LF; совпало с `git diff --numstat`. Дополнительно удалён package.json (17 строк) и lock importer (13 строк). Удалены только четыре проверенных абсолютных file paths внутри worktree; каждый ancestor проверен на ReparsePoint, recursive deletion не использовалось (`061324`). Ignored данные не очищались.

## Reviewed bytes

Physical SHA256 из `82540f`:

| Файл | SHA256 |
|---|---|
| apps/web/tests/product-draft-stage-fixtures.mjs | ce149d887dfebf260855ef8e8af13c685b3c2d269517db380485edbe3d603b64 |
| apps/web/tests/product-draft-stage-fixtures.test.mjs | 7218e9a6058f5bb9173f58c030fe59e989c502665e21109281363c2b005fe2f7 |
| apps/web/tests/product-draft-stage-runner.mjs | 9458a6e614321a70ec0ca4b1be42fc7709f6a671f1807c0b1cfdd8093c574bf6 |
| apps/web/src/server/plugins/registry.ts | 6280385cae285a01e2f851561fe6f29b4469f70caa299dc2c0da94a266074bb2 |
| packages/plugins/demo/package.json | bad14e4f544e3998a4768a5c2dac51f1551698d4f0c26fa49783d1b5168214ba |
| packages/plugins/demo/src/plugin.ts | d9854a13897578d1fb3892539e52c616d09d0ae907d006dff253f847d384206b |
| packages/plugin-sdk/package.json | 5635d0b300d8d290ffc6a4242de085646a3edd1a8989f7689a81e71ff0383af3 |
| packages/plugin-sdk/src/index.ts | 2d900d8d997c26f46d0f47f6975bd3b08f2fe80d6459d1113539d75833bc1cbf |
| pnpm-lock.yaml | 5c96f276fe3cfdc85ae268ce68cf124c80c8659f8eb8d2024780bf6220b9d74e |

Исторические Plugin rows/settings/files и бизнес-данные не записывались: соответствующих DB/runtime действий в этом этапе нет. Root выполняет normal merge, CI и фактическую staging-приёмку отдельно. Main/production, restic, dumps, seed/reset/new DB не использовались; SAFETY-RULES прочитана, STOP при guard mismatch остаётся обязательным.

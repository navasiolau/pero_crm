# Verification — задача159

## Local

Source run:3819f175dca3f69f40da92760cf746bad430f4bc, feature/159. Production-код, схема, CI-команда и lockfile не меняются.

- Собственный pnpm offline/frozen install и Prisma6.19.3 generate: PASS, без SQL.
- Node22.23.1, pnpm11.10.0. Matrix check: PASS —19контрактов,18dispositions,27targets,320testfiles.
- Actual TS small probe: одна authored openProductCardCover функция и два невыполненных диапазона; helpers/export wrappers исключены. Ложные100% встроенного Node/tsx summary не публикуются.
- Фактический полный measured baseline:2154/2154 PASS,0fail/skip/cancel,320files,146.181s, concurrency2. Это реальный Node/Chromium-component прогон до исправления postprocessor; он не повторялся и не выдаётся за2158тестов.
- Final postprocessor targeted suite:8/8 PASS; проверены authored mapping, source/map mismatch, input change/traversal, real split geometry, sparse inherited counts, nested zero/positive overrides и whole-function zero.
- Final lint четырёх QA файлов и OpenSpec strict: PASS.

Первый startup до тестов остановился на Windows ESM reporter D: path. Исправлен относительный ./tests/coverage-baseline-reporter.mjs; неудачный FAIL receipt сохраняется и не считается прогоном.

## Genuine capture и corrected derivation

Private directory: .playwright-mcp/coverage-baseline/8e62371d-3085-4724-9401-e17f2c75a4be/.

Original coverage.json и raw V8 неизменны. Original report SHA256ad8bc677445e5b6e36d63758ed621a3a989b657e767fdd0108ed2e3e162e9a80; capture inputs до/после совпадают на ee407c31c73a5a04181d01221ef4e4418f1b847ce71c3c6be25239881d60b8bd. Node test summary и capture source facts действительны. Старые derived range metrics и прежний postprocess-recheck.json обозначены OBSOLETE_DO_NOT_USE: exact-range OR терял split/inherited coverage между snapshots.

P2 независимого reviewer исправлен: общий interval grid внутри точного generated variant; innermost override в каждом snapshot, sparse child наследует outer count; union всех effective intervals выполняется до source mapping. Между разной генерацией offsets не смешиваются.

Actual counterexample: raw coverage-169036-1791681206645-0.json и coverage-195544-1791681316839-0.json, POST4716..5995. Старый zero5487..5994 полностью исполнен вторым snapshot через5487..5607/count18 +5607..5994/count11. Corrected merger показывает NO_FALSE_ZERO, raw не правился.

Действующий derived receipt: coverage-corrected.json.

- SHA256:28f264d9b30245e188393973b02399e4ef96cc495f23573c1320f6c151069722.
- Final collector SHA256:39b4dda556b1254696790b0d1753cc956be1033d792afee3e2a548161b8cef31.
- Current input digest:ff6973e8fb076ceede90c5488736a66f0ffa16a6922e9ce79c383795dc291784.
- Raw manifest digest:04092c088d24ba1a48ef038eea3f25581c82ab885e6faafdd53a65d3c67297b4.
- От capture изменились только collector, его regression suite и README. Все production/package/прочие test/helper inputs идентичны.
-25/27modules MEASURED;323observed authored functions,252executed.1119observed effective mapped V8 intervals,650executed. Это counts наблюдаемого Node кода по generated variant, не общий процент TS-функций/ветвей.
- GET apps/web/src/app/api/files/[id]/route.ts: BLOCKED/SOURCE_MAP_UNAVAILABLE; реальный DI route test прошёл, mapping VM-style кода не доказана.
- apps/web/src/server/logistics/documents.ts: NOT_RUN/NO_V8_SCRIPT_OBSERVED, gap140/163.
- TS line/branch/global coverage:null. Native PostgreSQL/HTTP/staging:NOT_RUN; iMac141:BLOCKED.

## Review / Staging

Повторное независимое code review: FINAL CODE_REVIEW_GO. Reviewer самостоятельно повторил8/8 targeted tests, actual raw POST replay и exact corrected report equality; P2 false-zero закрыт. Root разрешил атомарный commit159; staging остаётся NOT_RUN.

CI после обычного merge159, deployed staging candidate SHA/image/health/read-only HTTP smoke: NOT_RUN. Root baseline identity3819f17 не заменяет candidate acceptance. Main запрещён и не изменяется.

Дампы/restic/seed/reset/новая БД, production/infra mutations не выполнялись.

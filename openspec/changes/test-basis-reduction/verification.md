# Проверка №168

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
